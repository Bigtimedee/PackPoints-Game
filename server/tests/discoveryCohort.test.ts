/**
 * Synthetic discovery cohort. No supplier URLs and no private inventory.
 */
import { createHash } from "crypto";
import express from "express";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const supplierCards: { card_id: string; player: string; set: string; number: string; variant: string; category: string; image: string }[] = [];

vi.mock("../services/cardhedge/client", async (orig) => {
  const actual = await orig<typeof import("../services/cardhedge/client")>();
  return {
    ...actual,
    cardSearch: vi.fn(async () => ({ cards: supplierCards, pages: 1 })),
    cardDetails: vi.fn(async () => ({ cards: [] })),
  };
});

const { db } = await import("../db");
const { cardImageMaskCache, discoveryAdditions, discoveryCohortMembers, discoveryCohorts, discoveryImportProvenance, discoverySourceRevisions, discoverySourceStaging, expansionOutputApprovals, expansionReleaseManifests, expansionReleaseMembers, expansionServeClearances, expansionSourceAcceptances, gameSets, geometryProposals, playableCards } = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { fillMissingCards } = await import("../services/setFillMissing");
const { sendUnmaskedCard } = await import("../services/playImageSend");
const { MASKED_CARDS_DIR } = await import("../masking/maskPlanStore");
const { getMaskedImagePath, resetMaskBakeForTests, takeBoundBakeSourceShaForTests, warmMaskedFilename } = await import("../masking/maskingService");
const { CURRENT_MASK_VERSION } = await import("../masking/maskProfiles");
const { handleMaskedToken } = await import("../services/playImageHttp");
const { maskTokenMatches, maskedPlayPath } = await import("../services/playImageToken");
const { resetPublicMaskSetCacheForTests } = await import("../services/publicMaskGate");
const { fetchImportImage } = await import("../services/images/approvedImageFetch");
const { recordOriginalMembership } = await import("../services/baseballExpansion/store");
const { designApprovalDecision } = await import("../services/baseballExpansion/health");
const { getMaskProfile } = await import("../masking/maskProfiles");
const { isDaily5ExpansionBlocked, isMissingExpansionId } = await import("../services/baseballExpansion/registry");
const {
  UD_1991_DISCOVERY,
  canonicalMemberRecord,
  appendSourceRevision,
  createDiscoveryCohort,
  discoveryPin,
  evaluateCohortHealth,
  geometryUsable,
  parseCohortMembers,
  readDiscoveryCohort,
  recordDiscoveryAddition,
  insertGuardedPlayable,
  cohortGuardsImport,
  loadExactSourceGate,
  readBoundSourceState,
  registerGeometryProposal,
  renderMeasuredProposal,
  stageExactSource,
} = await import("../services/baseballExpansion/discoveryCohort");
const { registerDiscoveryCohortRoutes: mountRoutes } = await import("../routes/discoveryCohortQa");

const UD = UD_1991_DISCOVERY.setId;
const OTHER = "72dc22b4-38e0-5f7a-8295-a7f5488a5e81";
const token = "cohort-token";

function member(ordinal: number, sha: string, supplierId: string, disposition: "pass-candidate" | "hold" | "drop", width = 40, height = 60, bytes = 100) {
  return {
    memberKey: `candidate-${String(ordinal).padStart(4, "0")}|${sha}`,
    ordinal,
    cardNumber: String(ordinal),
    supplierId,
    originalSha256: sha,
    originalWidth: width,
    originalHeight: height,
    originalBytes: bytes,
    disposition,
    routing: disposition === "pass-candidate" ? "ordinary-canonical-candidate" : disposition,
  };
}

describe("discovery cohort rules", () => {
  it("pins the 1991 Upper Deck discovery file and refuses a 22 or 150 subset", () => {
    expect(discoveryPin(UD)).toEqual({
      originalCount: 486,
      artifactSha256: UD_1991_DISCOVERY.artifactSha256,
      membershipSha256: UD_1991_DISCOVERY.membershipSha256,
    });
    expect(discoveryPin(OTHER)).toBeNull();
    const one = member(1, "a".repeat(64), "supplier-a", "pass-candidate");
    expect(parseCohortMembers([one], 800)).toHaveLength(1);
    expect(parseCohortMembers([{ ...one, supplierId: "https://img.example/a.jpg" }], 800)).toBeNull();
    const unset = {
      playableCardId: null, importedSha256: null, originalSha256: "a".repeat(64),
      sourceAccepted: false, opaqueQaPassed: false, geometryMeasured: false, staged: true,
    };
    const health = evaluateCohortHealth({
      members: [
        { ...unset, disposition: "pass-candidate" },
        { ...unset, disposition: "hold", staged: false },
        { ...unset, disposition: "drop", staged: false },
      ],
      additions: 4,
      requiredCount: 486,
    });
    expect(health.partial).toBe(true);
    expect(health.passCount).toBe(0);
    expect(health.stagedDiscoveryCount).toBe(1);
    expect(health.qualifying).toBe(false);
    expect(health.reviewReady).toBe(false);
    expect(health.additionsIncludedInRate).toBe(false);
    expect(health.releaseAuthorized).toBe(false);
    expect(health.originalRate).toBe(0);
    const allNull = evaluateCohortHealth({
      members: [1, 2, 3].map(() => ({ ...unset, disposition: "pass-candidate" })),
      additions: 2,
      requiredCount: 3,
    });
    expect(allNull.passCount).toBe(0);
    expect(allNull.nonPassCount).toBe(3);
    expect(allNull.reviewReady).toBe(false);
    expect(allNull.originalRate).toBe(0);
  });

  it("does not treat an unversioned polygon as a usable mask", async () => {
    const bound = { setId: UD, supplierId: "s", originalSha256: "ab", originalWidth: 10, originalHeight: 20 };
    const polygon = [[0, 0], [1, 0], [1, 1]];
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ff", width: 10, height: 20, geometryVersion: "v", polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 9, height: 20, geometryVersion: "v", polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 10, height: 20, geometryVersion: null, polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 10, height: 20, geometryVersion: "not-a-version", polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 10, height: 20, geometryVersion: "v", polygonPixels: null, polygonNormalized: null }, bound).ok).toBe(false);
    const left = { memberKey: `candidate-0001|${"a".repeat(64)}`, ordinal: 1, cardNumber: "1", supplierId: "id|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|1|1|1|hold", originalSha256: "a".repeat(64), originalWidth: 2, originalHeight: 2, originalBytes: 2, disposition: "hold" as const, routing: "x" };
    const right = { ...left, supplierId: "id", originalWidth: 1, originalHeight: 1, originalBytes: 1, routing: `${"a".repeat(64)}|2|2|2|hold|x` };
    expect(canonicalMemberRecord(left)).not.toBe(canonicalMemberRecord(right));
    const calls: string[] = [];
    const body = new Uint8Array([1, 2, 3]);
    expect(await fetchImportImage("https://img.example/a.jpg", { lookup: async () => [{ address: "1.1.1.1" }], fetchImpl: fetch })).toBeNull();
    expect(await fetchImportImage("https://127.0.0.1/a.jpg", { lookup: async () => [{ address: "1.1.1.1" }], fetchImpl: fetch })).toBeNull();
    expect(await fetchImportImage("https://[::1]/a.jpg", { lookup: async () => [{ address: "1.1.1.1" }], fetchImpl: fetch })).toBeNull();
    expect(await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "100.64.0.1" }],
      fetchImpl: (async () => { throw new Error("should not connect"); }) as typeof fetch,
    })).toBeNull();
    let redirects = 0;
    expect(await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "1.1.1.1" }],
      fetchImpl: (async () => { redirects += 1; return { ok: false, status: 302, headers: { get: () => "https://127.0.0.1/secret" }, body: null }; }) as unknown as typeof fetch,
    })).toBeNull();
    expect(redirects).toBe(1);
    expect(await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "10.1.1.1" }],
      fetchImpl: (async () => { throw new Error("should not connect"); }) as typeof fetch,
    })).toBeNull();
    expect(await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "1.1.1.1" }],
      fetchImpl: (async () => ({ ok: true, status: 200, headers: { get: (name: string) => name === "content-length" ? "3000000" : null }, body: { getReader: () => { throw new Error("read"); } } })) as unknown as typeof fetch,
    })).toBeNull();
    const over = await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "1.1.1.1" }],
      fetchImpl: (async () => ({
        ok: true, status: 200, headers: { get: () => null },
        body: { getReader: () => ({ async read() { calls.push("read"); return calls.length > 3 ? { done: true, value: undefined } : { done: false, value: new Uint8Array(1_000_000) }; }, async cancel() { calls.push("cancel"); } }) },
      })) as unknown as typeof fetch,
    });
    expect(over).toBeNull();
    expect(calls).toContain("cancel");
    let sent = false;
    const small = await fetchImportImage("https://cdn.bubble.io/a.jpg", {
      lookup: async () => [{ address: "1.1.1.1" }],
      fetchImpl: (async () => ({
        ok: true, status: 200, headers: { get: () => null },
        body: { getReader: () => ({ async read() { if (sent) return { done: true, value: undefined }; sent = true; return { done: false, value: body }; }, async cancel() {} }) },
      })) as unknown as typeof fetch,
    });
    expect(small?.equals(Buffer.from(body))).toBe(true);
  });
});

describe("discovery cohort persistence", () => {
  let jpeg = Buffer.alloc(0);
  let sha = "";
  const supplierA = "supplier-synth-a";
  const supplierB = "supplier-synth-b";

  async function resetCohort(setId: string) {
    await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, setId));
    await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, setId));
    await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, setId));
    await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, setId));
    await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, setId));
    await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, setId));
    await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
    await db.delete(playableCards).where(eq(playableCards.cardhedgeCardId, supplierA));
    await db.delete(geometryProposals).where(eq(geometryProposals.setId, setId));
    await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
    await db.delete(discoveryAdditions).where(eq(discoveryAdditions.setId, setId));
    const members = await db.select({ memberKey: discoveryCohortMembers.memberKey }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
    for (const member of members) await db.delete(discoverySourceRevisions).where(eq(discoverySourceRevisions.memberKey, member.memberKey));
    await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
    await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
  }

  beforeAll(async () => {
    jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 8, g: 16, b: 24 } } }).jpeg().toBuffer();
    sha = createHash("sha256").update(jpeg).digest("hex");
    await insertIntegratedGameSet({
      id: OTHER, sport: "baseball", brand: "Upper Deck", year: 1990, setName: "1990 Upper Deck Baseball",
      isActive: true, cardhedgeSetQuery: "1990 Upper Deck Baseball", cardhedgeCategory: "Baseball",
    });
    await insertIntegratedGameSet({
      id: UD, sport: "baseball", brand: "Upper Deck", year: 1991, setName: "1991 Upper Deck Baseball",
      isActive: true, cardhedgeSetQuery: "1991 Upper Deck Baseball", cardhedgeCategory: "Baseball",
    });
    await db.update(gameSets).set({ isActive: true }).where(eq(gameSets.id, OTHER));
    await db.update(gameSets).set({ isActive: true }).where(eq(gameSets.id, UD));
    await resetCohort(OTHER);
    await resetCohort(UD);
  });

  afterAll(async () => {
    await resetCohort(OTHER);
    await resetCohort(UD);
  });

  it("refuses every held expansion import until that set has a cohort", async () => {
    const topps = "14f17bb7-a697-5080-9ec5-381c6d7e15ce";
    await insertIntegratedGameSet({
      id: topps, sport: "baseball", brand: "Topps", year: 1991, setName: "1991 Topps Baseball",
      isActive: true, cardhedgeSetQuery: "1991 Topps Baseball", cardhedgeCategory: "Baseball",
    });
    await db.update(gameSets).set({ isActive: true }).where(eq(gameSets.id, topps));
    expect(await cohortGuardsImport(topps)).toBe(true);
    expect(await cohortGuardsImport("3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4")).toBe(false);
    const gate = await loadExactSourceGate(topps);
    expect(gate("supplier-topps-1991", "8")).toBe("exact_source_required");
    supplierCards.splice(0, supplierCards.length, {
      card_id: "supplier-topps-1991", player: "Alex Player", set: "1991 Topps Baseball", number: "8", variant: "Base", category: "Baseball", image: "https://cdn.bubble.io/a.jpg",
    });
    const report = await fillMissingCards(topps, { dryRun: false, details: false, fetchImage: async () => jpeg });
    expect(report.inserted).toEqual([]);
    expect(report.excluded.some((row) => row.reason === "exact_source_required")).toBe(true);
    expect(report.sourceValidated).toBe(false);
    expect(await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.cardhedgeCardId, "supplier-topps-1991"))).toEqual([]);
  });

  it("keeps the original cohort across a later read, rejects a changed membership, and appends revisions", async () => {
    const holdSha = "b".repeat(64);
    const dropSha = "c".repeat(64);
    const first = [
      member(1, sha, supplierA, "pass-candidate", 40, 60, jpeg.length),
      member(2, holdSha, "supplier-hold", "hold"),
      member(3, dropSha, "supplier-drop", "drop"),
    ];
    const created = await createDiscoveryCohort({ setId: OTHER, artifactSha256: "d".repeat(64), members: first });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const again = await createDiscoveryCohort({ setId: OTHER, artifactSha256: "d".repeat(64), members: first });
    expect(again).toMatchObject({ ok: true, unchanged: true });
    const changed = await createDiscoveryCohort({
      setId: OTHER,
      artifactSha256: "e".repeat(64),
      members: [member(1, "f".repeat(64), supplierA, "pass-candidate", 40, 60, jpeg.length), first[1]!, first[2]!],
    });
    expect(changed).toMatchObject({ ok: false, code: "membership_mismatch" });
    const persisted = await readDiscoveryCohort(OTHER);
    expect(persisted?.members).toHaveLength(3);
    expect(persisted?.members.find((row) => row.supplierId === supplierA)?.originalSha256).toBe(sha);
    expect(persisted?.health.qualifying).toBe(false);
    expect(persisted?.health.reviewReady).toBe(false);
    expect(persisted?.releaseAuthorized).toBe(false);
    const revision = await appendSourceRevision({
      setId: OTHER, memberKey: first[1]!.memberKey, sha256: "1".repeat(64), width: 40, height: 60, bytes: 10, parentSha256: holdSha,
    });
    expect(revision).toMatchObject({ ok: true, revision: 1, replacedOriginal: false });
    const after = await readDiscoveryCohort(OTHER);
    expect(after?.members.find((row) => row.memberKey === first[1]!.memberKey)?.originalSha256).toBe(holdSha);
    expect(after?.members.find((row) => row.memberKey === first[1]!.memberKey)?.revisions).toBe(1);
    const addition = await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-new", cardNumber: "9", sha256: "2".repeat(64), width: 40, height: 60, bytes: 10,
    });
    expect(addition).toMatchObject({ ok: true, countsTowardOriginal: false });
    const claimed = await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-other", cardNumber: "1", sha256: "3".repeat(64), width: 40, height: 60, bytes: 10,
    });
    expect(claimed).toMatchObject({ ok: false, code: "number_claimed" });
    const rate = await readDiscoveryCohort(OTHER);
    expect(rate?.health.originalCount).toBe(3);
    expect(rate?.health.additions).toBe(1);
    expect(rate?.health.additionsIncludedInRate).toBe(false);
    const locked = await recordOriginalMembership({
      setId: OTHER, slug: "1990-upper-deck", cardIds: ["00000000-0000-4000-8000-000000000001"], sources: [{ id: "00000000-0000-4000-8000-000000000001", sourceUrl: "https://img.example/a.jpg" }],
    });
    expect(locked).toMatchObject({ stored: false, code: "discovery_cohort_locked" });
  });

  it("refuses a partial 1991 cohort and an unstaged or alternate source", async () => {
    expect(isMissingExpansionId(UD)).toBe(true);
    expect(isDaily5ExpansionBlocked(UD)).toBe(true);
    expect(getMaskProfile("1991 Upper Deck Baseball", UD).id).toBe("default");
    expect(designApprovalDecision({ isExpansion: true, profileId: null }).ok).toBe(false);
    const refused = await createDiscoveryCohort({
      setId: UD,
      artifactSha256: UD_1991_DISCOVERY.artifactSha256,
      members: [member(1, sha, supplierA, "pass-candidate", 40, 60, jpeg.length)],
    });
    expect(refused).toMatchObject({ ok: false, code: "partial_cohort" });
    const wrongFile = await createDiscoveryCohort({
      setId: UD,
      artifactSha256: "a".repeat(64),
      members: Array.from({ length: 486 }, (_, index) => member(index + 1, sha, `supplier-${index}`, index < 150 ? "pass-candidate" : "hold")),
    });
    expect(wrongFile).toMatchObject({ ok: false, code: "artifact_mismatch" });
    expect(await readDiscoveryCohort(UD)).toBeNull();

    supplierCards.splice(0, supplierCards.length, {
      card_id: supplierA, player: "Alex Player", set: "1991 Upper Deck Baseball", number: "5", variant: "Base", category: "Baseball", image: "https://img.example/a.jpg",
    }, {
      card_id: supplierB, player: "Alex Player", set: "1991 Upper Deck Baseball", number: "5", variant: "Base", category: "Baseball", image: "https://img.example/b.jpg",
    });
    const blocked = await fillMissingCards(UD, { dryRun: true, details: false });
    expect(blocked.sourceValidated).toBe(false);
    expect(blocked.candidates).toEqual([]);
    expect(blocked.excluded.map((row) => row.reason)).toContain("exact_source_required");
    expect(blocked.inserted).toEqual([]);

    const cohort = [member(5, sha, supplierA, "pass-candidate", 40, 60, jpeg.length)];
    const created = await createDiscoveryCohort({ setId: OTHER, artifactSha256: "d".repeat(64), members: [
      member(1, sha, supplierA, "pass-candidate", 40, 60, jpeg.length),
      member(2, "b".repeat(64), "supplier-hold", "hold"),
      member(3, "c".repeat(64), "supplier-drop", "drop"),
    ] });
    expect(created).toMatchObject({ ok: true, unchanged: true });
    const drifted = await stageExactSource(OTHER, supplierA, Buffer.from("not-the-jpeg"));
    expect(drifted).toMatchObject({ ok: false, code: "source_drift" });
    const staged = await stageExactSource(OTHER, supplierA, jpeg);
    expect(staged.ok).toBe(true);

    supplierCards.splice(0, supplierCards.length, {
      card_id: supplierA, player: "Alex Player", set: "1990 Upper Deck Baseball", number: "1", variant: "Base", category: "Baseball", image: "https://img.example/a.jpg",
    }, {
      card_id: supplierB, player: "Alex Player", set: "1990 Upper Deck Baseball", number: "1", variant: "Base", category: "Baseball", image: "https://img.example/b.jpg",
    });
    const preview = await fillMissingCards(OTHER, { dryRun: true, details: false });
    expect(preview.sourceValidated).toBe(false);
    expect(preview.candidates.map((row) => row.cardhedgeCardId)).toEqual([supplierA]);
    expect(preview.excluded.map((row) => row.cardhedgeCardId)).toContain(supplierB);
    expect(preview.inserted).toEqual([]);
    expect(cohort[0]!.supplierId).toBe(supplierA);

    const proposal = await registerGeometryProposal({
      setId: OTHER,
      memberKey: `candidate-0001|${sha}`,
      supplierId: supplierA,
      sourceSha256: "f".repeat(64),
      width: 40,
      height: 60,
      geometryVersion: null,
      polygonPixels: [[1, 1], [2, 1], [2, 2]],
      polygonNormalized: [[0, 0], [1, 0], [1, 1]],
    });
    expect(proposal).toMatchObject({ ok: false, code: "wrong_hash" });
    const unmeasured = await registerGeometryProposal({
      setId: OTHER,
      memberKey: `candidate-0001|${sha}`,
      supplierId: supplierA,
      sourceSha256: sha,
      width: 40,
      height: 60,
      geometryVersion: null,
      polygonPixels: [[1, 1], [20, 1], [20, 20]],
      polygonNormalized: [[0, 0], [0.5, 0], [0.5, 0.3]],
    });
    expect(unmeasured).toMatchObject({ ok: false, code: "unknown_version" });
    const substituted = await createDiscoveryCohort({
      setId: UD,
      artifactSha256: UD_1991_DISCOVERY.artifactSha256,
      members: Array.from({ length: 486 }, (_, index) => member(index + 1, "ab".repeat(32), `sub-${index}`, "drop")),
    });
    expect(substituted).toMatchObject({ ok: false, code: "membership_mismatch" });
    expect(await readDiscoveryCohort(UD)).toBeNull();

    const hold = await stageExactSource(OTHER, "supplier-hold", Buffer.alloc(0));
    expect(hold.ok).toBe(false);
    let productionFetches = 0;
    const savedProductionFetch = global.fetch;
    global.fetch = (async () => { productionFetches += 1; throw new Error("remote"); }) as typeof fetch;
    try {
      const unapproved = await fillMissingCards(OTHER, { dryRun: false, details: false });
      expect(unapproved.inserted).toEqual([]);
      expect(unapproved.excluded.some((row) => row.cardhedgeCardId === supplierA && row.reason === "source_drift")).toBe(true);
      expect(productionFetches).toBe(0);
    } finally {
      global.fetch = savedProductionFetch;
    }
    supplierCards.push({
      card_id: "supplier-hold", player: "Held Player", set: "1990 Upper Deck Baseball", number: "2", variant: "Base", category: "Baseball", image: "https://img.example/hold.jpg",
    });
    const driftedImport = await fillMissingCards(OTHER, {
      dryRun: false,
      details: false,
      fetchImage: async () => Buffer.from("changed-bytes"),
    });
    expect(driftedImport.inserted).toEqual([]);
    expect(driftedImport.excluded.some((row) => row.cardhedgeCardId === supplierA && row.reason === "source_drift")).toBe(true);
    expect(driftedImport.excluded.some((row) => row.cardhedgeCardId === "supplier-hold" && row.reason === "not_importable")).toBe(true);
    expect(driftedImport.sourceValidated).toBe(false);
    await expect(insertGuardedPlayable({
      setId: OTHER, supplierId: supplierA, cardNumber: "1", downloaded: jpeg, failBeforeProvenance: true,
      values: { description: null, player: "Alex Player", set: "1990 Upper Deck Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/a.jpg", category: "Baseball", rookie: null, isPlayable: true, blockedReason: null },
    })).rejects.toThrow(/injected-bind-failure/);
    expect(await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.cardhedgeCardId, supplierA))).toEqual([]);
    const matched = await fillMissingCards(OTHER, {
      dryRun: false,
      details: false,
      fetchImage: async () => jpeg,
    });
    expect(matched.inserted.map((row) => row.cardhedgeCardId)).toEqual([supplierA]);
    expect(matched.sourceValidated).toBe(false);
    const health = await readDiscoveryCohort(OTHER);
    expect(health?.health.passCount).toBe(0);
    expect(health?.health.reviewReady).toBe(false);
    expect(health?.members.find((row) => row.supplierId === supplierA)?.playableCardId).toBeTruthy();
    const served = { headers: {} as Record<string, string>, body: null as Buffer | null, setHeader(name: string, value: string) { this.headers[name] = value; }, removeHeader() {}, end(body?: Buffer) { this.body = body ?? null; } };
    await sendUnmaskedCard(served as never, matched.inserted[0]!.id);
    expect(served.body?.equals(jpeg)).toBe(true);
    await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, matched.inserted[0]!.id));
    let remoteCalls = 0;
    const previousFetch = global.fetch;
    global.fetch = (async () => { remoteCalls += 1; throw new Error("remote"); }) as typeof fetch;
    const closed = { statusCode: 200, headers: {} as Record<string, string>, setHeader() {}, removeHeader() {}, status(code: number) { this.statusCode = code; return this; }, json() { return this; }, end() {} };
    try {
      await sendUnmaskedCard(closed as never, matched.inserted[0]!.id);
      const baked = await getMaskedImagePath(matched.inserted[0]!.id, { ignoreCache: true });
      expect(baked).toBeNull();
      expect(remoteCalls).toBe(0);
      expect(closed.statusCode).toBe(404);
    } finally {
      global.fetch = previousFetch;
    }
    const repaired = await insertGuardedPlayable({
      setId: OTHER, supplierId: supplierA, cardNumber: "1", downloaded: jpeg,
      values: { description: null, player: "Alex Player", set: "1990 Upper Deck Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/a.jpg", category: "Baseball", rookie: null, isPlayable: true, blockedReason: null },
    });
    expect(repaired).toMatchObject({ ok: true });
    expect((await readBoundSourceState(matched.inserted[0]!.id)).kind).toBe("bound");
    await expect(insertGuardedPlayable({
      setId: OTHER, supplierId: supplierA, cardNumber: "1", downloaded: jpeg, failBeforeProvenance: true,
      values: { description: null, player: "Alex Player", set: "1990 Upper Deck Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/a.jpg", category: "Baseball", rookie: null, isPlayable: true, blockedReason: null },
    })).resolves.toMatchObject({ ok: true, unchanged: true });
    const replay = await appendSourceRevision({
      setId: OTHER, memberKey: `candidate-0002|${"b".repeat(64)}`, sha256: "1".repeat(64), width: 40, height: 60, bytes: 10, parentSha256: "b".repeat(64),
    });
    expect(replay).toMatchObject({ ok: true, unchanged: true, importEffect: "none" });
    const [left, right] = await Promise.all([
      appendSourceRevision({ setId: OTHER, memberKey: `candidate-0002|${"b".repeat(64)}`, sha256: "4".repeat(64), width: 40, height: 60, bytes: 11, parentSha256: "1".repeat(64) }),
      appendSourceRevision({ setId: OTHER, memberKey: `candidate-0002|${"b".repeat(64)}`, sha256: "5".repeat(64), width: 40, height: 60, bytes: 12, parentSha256: "1".repeat(64) }),
    ]);
    expect([left.ok, right.ok].filter(Boolean).length).toBeGreaterThan(0);
    expect([left, right].every((row) => row.ok || ("code" in row && row.code === "revision_conflict" || row.code === "parent_mismatch"))).toBe(true);
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-claimed", cardNumber: "2", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "number_claimed" });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "0", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "invalid_addition" });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "801", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "invalid_addition" });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "09", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "number_claimed" });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "11", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: true, unchanged: false, countsTowardOriginal: false });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "11", sha256: "6".repeat(64), width: 41, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "addition_conflict" });
    expect(await recordDiscoveryAddition({
      setId: OTHER, supplierId: "supplier-second", cardNumber: "12", sha256: "6".repeat(64), width: 40, height: 60, bytes: 10,
    })).toMatchObject({ ok: false, code: "supplier_conflict" });
    const polygon = [[1, 1], [30, 1], [30, 30], [1, 30]] as [number, number][];
    const norm = polygon.map(([x, y]) => [x / 40, y / 60]);
    const measuredProposal = {
      setId: OTHER, memberKey: `candidate-0001|${sha}`, supplierId: supplierA, sourceSha256: sha,
      width: 40, height: 60, geometryVersion: "plate-polygon-v1" as string | null,
      polygonPixels: polygon as number[][], polygonNormalized: norm,
    };
    const memberBound = { setId: OTHER, supplierId: supplierA, originalSha256: sha, originalWidth: 40, originalHeight: 60 };
    expect((await renderMeasuredProposal({ jpeg, proposal: { ...measuredProposal, geometryVersion: null }, member: memberBound })).ok).toBe(false);
    expect((await renderMeasuredProposal({ jpeg, proposal: { ...measuredProposal, geometryVersion: "nope" }, member: memberBound })).ok).toBe(false);
    expect((await renderMeasuredProposal({ jpeg, proposal: { ...measuredProposal, polygonPixels: [[1, 1], [80, 1], [80, 30], [1, 30]] }, member: memberBound })).ok).toBe(false);
    expect((await renderMeasuredProposal({ jpeg, proposal: { ...measuredProposal, polygonPixels: [[1, 1], [1, 1], [1, 1]], polygonNormalized: [[0, 0], [0, 0], [0, 0]] }, member: memberBound })).ok).toBe(false);
    expect((await renderMeasuredProposal({ jpeg, proposal: { ...measuredProposal, polygonNormalized: [[0.9, 0.9], [0.9, 0.9], [0.9, 0.9], [0.9, 0.9]] }, member: memberBound })).ok).toBe(false);
    const otherJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 200, g: 1, b: 1 } } }).jpeg().toBuffer();
    expect((await renderMeasuredProposal({ jpeg: otherJpeg, proposal: measuredProposal, member: memberBound })).ok).toBe(false);
    const drawn = await renderMeasuredProposal({ jpeg, proposal: measuredProposal, member: memberBound });
    expect(drawn.ok).toBe(true);
    const rendered = drawn.ok ? drawn : { native: Buffer.alloc(0), maskedPreview: Buffer.alloc(0), originalPreview: Buffer.alloc(0) };
    expect(rendered.native.length).toBeGreaterThan(0);
    expect(rendered.maskedPreview.length).toBeGreaterThan(0);
    expect(rendered.originalPreview.length).toBeGreaterThan(0);
    const cardId = matched.inserted[0]!.id;
    const state = await readBoundSourceState(cardId);
    expect(state.kind).toBe("bound");
    if (state.kind !== "bound") return;
    const driftedUrl = "https://cdn.bubble.io/drifted-bytes.jpg";
    await db.update(playableCards).set({ imageUrl: driftedUrl }).where(eq(playableCards.id, cardId));
    const staleName = warmMaskedFilename(cardId);
    const staleBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);
    await mkdir(MASKED_CARDS_DIR, { recursive: true });
    await writeFile(path.join(MASKED_CARDS_DIR, staleName), staleBytes);
    await db.insert(cardImageMaskCache).values({
      cardId, rawImageUrl: driftedUrl, maskedImagePath: staleName, maskVersion: CURRENT_MASK_VERSION,
    }).onConflictDoUpdate({
      target: cardImageMaskCache.cardId,
      set: { rawImageUrl: driftedUrl, maskedImagePath: staleName, maskVersion: CURRENT_MASK_VERSION },
    });
    resetMaskBakeForTests();
    let bakeFetches = 0;
    const savedFetch = global.fetch;
    const remoteJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer();
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return savedFetch(input, init);
      bakeFetches += 1;
      return new Response(remoteJpeg, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    }) as typeof fetch;
    try {
      const baked = await getMaskedImagePath(cardId);
      expect(baked).toBeNull();
      expect(baked).not.toBe(staleName);
      expect(takeBoundBakeSourceShaForTests()).toBeNull();
      expect(await readFile(path.join(MASKED_CARDS_DIR, staleName))).toEqual(staleBytes);
      expect(state.bytes.equals(jpeg)).toBe(true);
      expect(bakeFetches).toBe(0);
      resetPublicMaskSetCacheForTests();
      const app = express();
      let servedMasked = false;
      app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
        void handleMaskedToken(req, res, {
          authorizeCardId: async () => "denied",
          resolveReveal: async () => ({ ok: false, reason: "bad" }),
          resolveMask: async (scope, sessionId, index, token) => (
            maskTokenMatches(scope, sessionId, index, cardId, token) ? cardId : null
          ),
          sendUnmasked: async (response) => { response.status(500).end(); },
          sendMasked: async () => { servedMasked = true; },
        });
      });
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const play = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${maskedPlayPath({ scope: "solo", sessionId: "cohort-held", index: 0, cardId })}`);
        expect(play.status).toBe(404);
        const body = Buffer.from(await play.arrayBuffer());
        expect(body[0]).not.toBe(0xff);
        expect(play.headers.get("content-type") || "").toContain("json");
        expect(servedMasked).toBe(false);
        expect(bakeFetches).toBe(0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      global.fetch = savedFetch;
      await db.delete(cardImageMaskCache).where(eq(cardImageMaskCache.cardId, cardId));
      await rm(path.join(MASKED_CARDS_DIR, staleName), { force: true });
    }
  });

  it("refuses a cohort when a legacy manifest already holds the lock, in either order", async () => {
    const fleer = "891b39b8-0058-5e55-9837-6e4830c55d32";
    const later = "cc78d8df-0502-5876-aab4-5d6a49f72899";
    await insertIntegratedGameSet({ id: fleer, sport: "baseball", brand: "Fleer", year: 1986, setName: "1986 Fleer Baseball", isActive: true, cardhedgeSetQuery: "1986 Fleer Baseball", cardhedgeCategory: "Baseball" });
    await insertIntegratedGameSet({ id: later, sport: "baseball", brand: "Fleer", year: 1988, setName: "1988 Fleer Baseball", isActive: true, cardhedgeSetQuery: "1988 Fleer Baseball", cardhedgeCategory: "Baseball" });
    const cardId = "12121212-1212-4121-8121-121212121212";
    const laterCard = "13131313-1313-4131-8131-131313131313";
    await db.insert(playableCards).values([
      { id: cardId, gameSetId: fleer, cardhedgeCardId: "legacy-a", player: "Alex Player", set: "1986 Fleer Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/a.jpg", category: "Baseball", isPlayable: true },
      { id: laterCard, gameSetId: later, cardhedgeCardId: "legacy-b", player: "Alex Player", set: "1988 Fleer Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/b.jpg", category: "Baseball", isPlayable: true },
    ]).onConflictDoNothing();
    const first = await recordOriginalMembership({ setId: fleer, slug: "1986-fleer", cardIds: [cardId], sources: [{ id: cardId, sourceUrl: "https://cdn.bubble.io/a.jpg" }] });
    expect(first).toMatchObject({ stored: true });
    const blocked = await createDiscoveryCohort({ setId: fleer, artifactSha256: "e".repeat(64), members: [member(1, "a".repeat(64), "not-the-legacy", "hold")] });
    expect(blocked).toMatchObject({ ok: false, code: "legacy_membership_exists" });
    const cohortFirst = "855e8125-4169-5d0b-b04c-3513feae9637";
    const cohortCard = "14141414-1414-4141-8141-141414141414";
    await insertIntegratedGameSet({ id: cohortFirst, sport: "baseball", brand: "Fleer", year: 1989, setName: "1989 Fleer Baseball", isActive: true, cardhedgeSetQuery: "1989 Fleer Baseball", cardhedgeCategory: "Baseball" });
    await db.insert(playableCards).values({
      id: cohortCard, gameSetId: cohortFirst, cardhedgeCardId: "legacy-c", player: "Alex Player", set: "1989 Fleer Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/c.jpg", category: "Baseball", isPlayable: true,
    }).onConflictDoNothing();
    await resetCohort(cohortFirst);
    const cohortStored = await createDiscoveryCohort({ setId: cohortFirst, artifactSha256: "e".repeat(64), members: [member(1, "9".repeat(64), "cohort-first", "hold")] });
    expect(cohortStored).toMatchObject({ ok: true });
    const legacyAfter = await recordOriginalMembership({ setId: cohortFirst, slug: "1989-fleer", cardIds: [cohortCard], sources: [{ id: cohortCard, sourceUrl: "https://cdn.bubble.io/c.jpg" }] });
    expect(legacyAfter).toMatchObject({ stored: false, code: "discovery_cohort_locked" });
    const members = [member(1, "a".repeat(64), "race-supplier", "hold")];
    const [legacy, cohort] = await Promise.all([
      recordOriginalMembership({ setId: later, slug: "1988-fleer", cardIds: [laterCard], sources: [{ id: laterCard, sourceUrl: "https://cdn.bubble.io/b.jpg" }] }),
      createDiscoveryCohort({ setId: later, artifactSha256: "e".repeat(64), members }),
    ]);
    const legacyWon = "stored" in legacy && legacy.stored;
    const cohortWon = "ok" in cohort && cohort.ok;
    expect(Number(legacyWon) + Number(cohortWon)).toBe(1);
    await resetCohort(fleer);
    await resetCohort(later);
    await resetCohort(cohortFirst);
    const { cardhedgeImportRuns, designPoolSubmissions } = await import("@shared/schema");
    await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, fleer));
    await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, later));
    await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, cohortFirst));
    await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, fleer));
    await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, later));
    await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, cohortFirst));
    await db.delete(playableCards).where(eq(playableCards.id, cardId));
    await db.delete(playableCards).where(eq(playableCards.id, laterCard));
    await db.delete(playableCards).where(eq(playableCards.id, cohortCard));
  });
});

describe("discovery cohort route", () => {
  it("is 404 without the token and does not accept a source URL", async () => {
    process.env.COVER_QA_TOKEN = token;
    const app = express();
    app.use(express.json());
    mountRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = `${base}/api/qa/baseball-expansion/${OTHER}/discovery-cohort`;
    expect((await fetch(url, { method: "POST" })).status).toBe(404);
    const refused = await fetch(url, {
      method: "POST",
      headers: { "X-QA-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ artifactSha256: "d".repeat(64), imageUrl: "https://img.example/a.jpg", members: [] }),
    });
    expect(refused.status).toBe(400);
    const body = await refused.json();
    expect(JSON.stringify(body)).not.toMatch(/img\.example/);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
