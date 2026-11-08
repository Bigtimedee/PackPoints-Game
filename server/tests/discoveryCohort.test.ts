/**
 * Synthetic discovery cohort. No supplier URLs and no private inventory.
 */
import { createHash } from "crypto";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
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
const { discoveryAdditions, discoveryCohortMembers, discoveryCohorts, discoverySourceRevisions, discoverySourceStaging, gameSets, geometryProposals } = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { fillMissingCards } = await import("../services/setFillMissing");
const { recordOriginalMembership } = await import("../services/baseballExpansion/store");
const { designApprovalDecision } = await import("../services/baseballExpansion/health");
const { getMaskProfile } = await import("../masking/maskProfiles");
const { isDaily5ExpansionBlocked, isMissingExpansionId } = await import("../services/baseballExpansion/registry");
const {
  UD_1991_DISCOVERY,
  appendSourceRevision,
  createDiscoveryCohort,
  discoveryPin,
  evaluateCohortHealth,
  geometryUsable,
  parseCohortMembers,
  readDiscoveryCohort,
  recordDiscoveryAddition,
  registerGeometryProposal,
  renderOpaqueNameplate,
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
    expect(discoveryPin(UD)).toEqual({ originalCount: 486, artifactSha256: UD_1991_DISCOVERY.artifactSha256 });
    expect(discoveryPin(OTHER)).toBeNull();
    const one = member(1, "a".repeat(64), "supplier-a", "pass-candidate");
    expect(parseCohortMembers([one], 800)).toHaveLength(1);
    expect(parseCohortMembers([{ ...one, supplierId: "https://img.example/a.jpg" }], 800)).toBeNull();
    const health = evaluateCohortHealth({
      members: [
        { disposition: "pass-candidate", sourceVerified: true, geometryMeasured: false },
        { disposition: "hold", sourceVerified: false, geometryMeasured: false },
        { disposition: "drop", sourceVerified: false, geometryMeasured: false },
      ],
      additions: 4,
      requiredCount: 486,
    });
    expect(health.partial).toBe(true);
    expect(health.qualifying).toBe(false);
    expect(health.reviewReady).toBe(false);
    expect(health.additionsIncludedInRate).toBe(false);
    expect(health.releaseAuthorized).toBe(false);
    expect(health.originalRate).toBeCloseTo(1 / 3);
  });

  it("does not treat an unversioned polygon as a usable mask", () => {
    const bound = { setId: UD, supplierId: "s", originalSha256: "ab", originalWidth: 10, originalHeight: 20 };
    const polygon = [[0, 0], [1, 0], [1, 1]];
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ff", width: 10, height: 20, geometryVersion: "v", polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 9, height: 20, geometryVersion: "v", polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 10, height: 20, geometryVersion: null, polygonPixels: polygon, polygonNormalized: polygon }, bound).ok).toBe(false);
    expect(geometryUsable({ ...bound, memberKey: "m", sourceSha256: "ab", width: 10, height: 20, geometryVersion: "v", polygonPixels: null, polygonNormalized: null }, bound).ok).toBe(false);
  });
});

describe("discovery cohort persistence", () => {
  let jpeg = Buffer.alloc(0);
  let sha = "";
  const supplierA = "supplier-synth-a";
  const supplierB = "supplier-synth-b";

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
  });

  afterAll(async () => {
    await db.delete(geometryProposals).where(eq(geometryProposals.setId, OTHER));
    await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, OTHER));
    await db.delete(discoveryAdditions).where(eq(discoveryAdditions.setId, OTHER));
    const members = await db.select({ memberKey: discoveryCohortMembers.memberKey }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, OTHER));
    if (members.length) {
      for (const member of members) {
        await db.delete(discoverySourceRevisions).where(eq(discoverySourceRevisions.memberKey, member.memberKey));
      }
    }
    await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, OTHER));
    await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, OTHER));
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
    expect(unmeasured).toMatchObject({ ok: true, approval: false, usable: false });
    const rendered = await renderOpaqueNameplate(jpeg, [[1, 1], [20, 1], [20, 20], [1, 20]]);
    expect(rendered.native.length).toBeGreaterThan(0);
    expect(rendered.maskedPreview.length).toBeGreaterThan(0);
    expect(rendered.originalPreview.length).toBeGreaterThan(0);
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
