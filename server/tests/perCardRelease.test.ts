/**
 * Synthetic per-card release gate. No supplier URLs, inventories, or real scans.
 * The cohorts below are not the 448-member 1986 Fleer discovery inventory.
 */
import { createHash } from "crypto";
import express from "express";
import { createServer } from "http";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "../db";
import {
  discoveryCohortMembers,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceStaging,
  expansionOutputApprovals,
  expansionServeClearances,
  expansionSetClearanceAttempts,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { isHeldSet, refreshHeldSets } from "../config/heldSets";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { getMaskedImagePath } from "../masking/maskingService";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { largeQaJsonPost } from "../middleware/apiJsonBody";
import { registerDiscoveryCohortRoutes } from "../routes/discoveryCohortQa";
import { insertIntegratedGameSet } from "../services/baseballExpansion/createIntegratedSet";
import { cohortGuardsImport, createDiscoveryCohort, renderMeasuredProposal } from "../services/baseballExpansion/discoveryCohort";
import { designApprovalDecision } from "../services/baseballExpansion/health";
import { PUBLIC_SET_MIN_ELIGIBLE_CARDS } from "../services/playableSetEligibility";
import {
  EXPANSION_RELEASE_MIN_ELIGIBLE,
  PER_CARD_RENDERER_IDS,
  RELEASE_DENOMINATOR_STATUS,
  applyExpansionServe,
  attemptExpansionSetClearance,
  canonicalPolygon,
  countExpansionGameplayEligible,
  expansionSetIsCleared,
  inspectBoundServe,
  recordOutputApproval,
  recordServeClearance,
  recordSourceAcceptance,
} from "../services/baseballExpansion/perCardRelease";
import { BASEBALL_EXPANSION_TARGETS, isDaily5ExpansionBlocked } from "../services/baseballExpansion/registry";
import { handlePublicSetDetail } from "../services/publicSets";
import { handlePublicSetCover } from "../services/setCovers";

const small = BASEBALL_EXPANSION_TARGETS.find((target) => target.slug === "1986-donruss-baseball")!;
const floor = BASEBALL_EXPANSION_TARGETS.find((target) => target.slug === "1991-donruss-baseball")!;
const live = BASEBALL_EXPANSION_TARGETS.find((target) => target.slug === "1987-donruss-baseball")!;
const stopped = BASEBALL_EXPANSION_TARGETS.find((target) => target.slug === "1991-upper-deck-baseball")!;
const PIXELS = [[1, 1], [30, 1], [30, 20], [1, 20]];
const NORMALIZED = PIXELS.map(([x, y]) => [x / 40, y / 30]);
const RENDERER = PER_CARD_RENDERER_IDS[1];

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cardId(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function wipe(setId: string): Promise<void> {
  await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, setId));
  await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, setId));
  await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, setId));
  await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, setId));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, setId));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, setId));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
  await db.delete(playableCards).where(and(eq(playableCards.gameSetId, setId), like(playableCards.cardhedgeCardId, "per-card-serve:%")));
}

describe("per-card release denominator", () => {
  it("keeps both 95% readings and does not authorize a set", () => {
    expect(RELEASE_DENOMINATOR_STATUS.authorized).toBe(false);
    expect(RELEASE_DENOMINATOR_STATUS.code).toBe("release_denominator_unresolved");
    expect(RELEASE_DENOMINATOR_STATUS.retainedDiscoveryExample.count).toBe(448);
    expect(RELEASE_DENOMINATOR_STATUS.readings.map((reading) => reading.id)).toEqual([
      "entire_discovery_inventory",
      "approved_submitted_playable_pool",
    ]);
    expect(RELEASE_DENOMINATOR_STATUS).not.toHaveProperty("selected");
    expect(EXPANSION_RELEASE_MIN_ELIGIBLE).toBe(35);
    expect(PUBLIC_SET_MIN_ELIGIBLE_CARDS).toBe(5);
    expect(largeQaJsonPost("POST", `/api/qa/baseball-expansion/${floor.id}/discovery-cohort/output-approval`)).toEqual({ kind: "output", setId: floor.id });
    expect(largeQaJsonPost("GET", `/api/qa/baseball-expansion/${floor.id}/discovery-cohort/output-approval`)).toBeNull();
    const bytes = Buffer.from("approved-opaque");
    expect(applyExpansionServe({ scope: "live", boundBytes: bytes, refuseCode: null, setCleared: true })).toEqual({ action: "passthrough" });
    expect(applyExpansionServe({ scope: "stopped", boundBytes: bytes, refuseCode: null, setCleared: true })).toEqual({ action: "refuse", code: "ud_stopped" });
    expect(applyExpansionServe({ scope: "expansion", boundBytes: bytes, refuseCode: null, setCleared: false })).toEqual({ action: "refuse", code: "set_held" });
    expect(applyExpansionServe({ scope: "expansion", boundBytes: bytes, refuseCode: "output_hash_mismatch", setCleared: true })).toEqual({ action: "refuse", code: "output_hash_mismatch" });
    const served = applyExpansionServe({ scope: "expansion", boundBytes: bytes, refuseCode: null, setCleared: true });
    expect(served).toEqual({ action: "serve", bytes });
  });
});

describe("per-card release bindings", () => {
  beforeAll(async () => {
    for (const target of [small, floor, live, stopped]) {
      await insertIntegratedGameSet({
        id: target.id,
        sport: "Baseball",
        brand: target.identity.brand,
        year: target.identity.year,
        setName: target.identity.setName,
        cardhedgeSetQuery: target.identity.cardhedgeSetQuery,
        cardhedgeCategory: "Baseball",
        isActive: true,
      });
    }
    await wipe(small.id);
    await wipe(floor.id);
  });

  afterAll(async () => {
    await wipe(small.id);
    await wipe(floor.id);
    await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, live.id));
    await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, stopped.id));
  });

  it("rejects drift, the wrong binding, holds, drops, and uncleared rows, and still holds public routes", async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 20, g: 40, b: 60 } } }).jpeg().toBuffer();
    const sourceSha = sha(jpeg);
    const specs = [
      { n: 1, disposition: "pass-candidate" as const, bytes: jpeg },
      { n: 2, disposition: "pass-candidate" as const, bytes: Buffer.from("second-source") },
      { n: 3, disposition: "hold" as const, bytes: Buffer.from("hold-source") },
      { n: 4, disposition: "drop" as const, bytes: Buffer.from("drop-source") },
    ];
    const members = specs.map((spec) => {
      const digest = sha(spec.bytes);
      return {
        ...spec,
        sha: digest,
        memberKey: `candidate-${String(spec.n).padStart(4, "0")}|${digest}`,
        supplierId: `synthetic-${spec.n}`,
      };
    });
    const created = await createDiscoveryCohort({
      setId: small.id,
      artifactSha256: sha(Buffer.from(members.map((member) => member.memberKey).join("\n"))),
      members: members.map((member) => ({
        memberKey: member.memberKey,
        ordinal: member.n,
        cardNumber: String(member.n),
        supplierId: member.supplierId,
        originalSha256: member.sha,
        originalWidth: 40,
        originalHeight: 30,
        originalBytes: member.bytes.length,
        disposition: member.disposition,
        routing: "synthetic",
      })),
    });
    expect(created).toMatchObject({ ok: true, originalCount: 4 });
    for (const member of members.filter((row) => row.disposition === "pass-candidate")) {
      await db.insert(discoverySourceStaging).values({
        setId: small.id,
        supplierId: member.supplierId,
        sha256: member.sha,
        width: 40,
        height: 30,
        bytes: member.bytes.length,
        imageBytes: member.bytes,
      });
    }
    const primary = members[0]!;
    const second = members[1]!;
    expect(await recordSourceAcceptance({
      setId: small.id, memberKey: primary.memberKey, sourceSha256: "a".repeat(64), evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "source_drift" });
    expect(await recordSourceAcceptance({
      setId: floor.id, memberKey: primary.memberKey, sourceSha256: primary.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "set_mismatch" });
    expect(await recordSourceAcceptance({
      setId: small.id, memberKey: "candidate-9999|" + "b".repeat(64), sourceSha256: primary.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "member_mismatch" });
    expect(await recordSourceAcceptance({
      setId: stopped.id, memberKey: primary.memberKey, sourceSha256: primary.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "ud_stopped" });
    expect(await recordSourceAcceptance({
      setId: live.id, memberKey: primary.memberKey, sourceSha256: primary.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "not_expansion" });
    expect(await recordSourceAcceptance({
      setId: small.id, memberKey: members[2]!.memberKey, sourceSha256: members[2]!.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "not_importable" });
    expect(await recordSourceAcceptance({
      setId: small.id, memberKey: members[3]!.memberKey, sourceSha256: members[3]!.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "not_importable" });
    const accepted = await recordSourceAcceptance({
      setId: small.id, memberKey: primary.memberKey, sourceSha256: primary.sha, evidenceRef: "evidence-source", acceptedBy: "reviewer",
    });
    expect(accepted).toMatchObject({ ok: true, unchanged: false });
    const provenanceBefore = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, small.id));
    expect(provenanceBefore).toEqual([]);
    const rendered = await renderMeasuredProposal({
      jpeg,
      proposal: {
        setId: small.id,
        memberKey: primary.memberKey,
        supplierId: primary.supplierId,
        sourceSha256: sourceSha,
        width: 40,
        height: 30,
        geometryVersion: "plate-polygon-v1",
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
      },
      member: { originalSha256: sourceSha, originalWidth: 40, originalHeight: 30, supplierId: primary.supplierId, setId: small.id },
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.approval).toBe(false);
    expect(await db.select({ id: expansionOutputApprovals.id }).from(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, small.id))).toEqual([]);
    const proposal = await db.insert(geometryProposals).values({
      setId: small.id,
      memberKey: primary.memberKey,
      supplierId: primary.supplierId,
      sourceSha256: primary.sha,
      width: 40,
      height: 30,
      geometryVersion: "plate-polygon-v1",
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      approval: false,
    }).returning({ id: geometryProposals.id, approval: geometryProposals.approval });
    expect(proposal[0]?.approval).toBe(false);
    const otherProposal = await db.insert(geometryProposals).values({
      setId: small.id,
      memberKey: second.memberKey,
      supplierId: second.supplierId,
      sourceSha256: second.sha,
      width: 40,
      height: 30,
      geometryVersion: "plate-polygon-v1",
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      approval: false,
    }).returning({ id: geometryProposals.id });
    const nativeSha = sha(rendered.native);
    const previewSha = sha(rendered.maskedPreview);
    expect(await recordOutputApproval({
      setId: small.id,
      memberKey: primary.memberKey,
      acceptanceId: accepted.ok ? accepted.id : "",
      proposalId: proposal[0]!.id,
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      rendererId: "renderMeasuredProposal@" + "c".repeat(40),
      nativeBytes: rendered.native,
      preview300Bytes: rendered.maskedPreview,
      nativeSha256: nativeSha,
      preview300Sha256: previewSha,
      evidenceRef: "evidence-output",
      approvedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "renderer_mismatch" });
    expect(await recordOutputApproval({
      setId: small.id,
      memberKey: primary.memberKey,
      acceptanceId: accepted.ok ? accepted.id : "",
      proposalId: otherProposal[0]!.id,
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      rendererId: RENDERER,
      nativeBytes: rendered.native,
      preview300Bytes: rendered.maskedPreview,
      nativeSha256: nativeSha,
      preview300Sha256: previewSha,
      evidenceRef: "evidence-output",
      approvedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "proposal_mismatch" });
    expect(await recordOutputApproval({
      setId: small.id,
      memberKey: primary.memberKey,
      acceptanceId: accepted.ok ? accepted.id : "",
      proposalId: proposal[0]!.id,
      polygonPixels: [[1, 1], [2, 1], [2, 2]],
      polygonNormalized: NORMALIZED,
      rendererId: RENDERER,
      nativeBytes: rendered.native,
      preview300Bytes: rendered.maskedPreview,
      nativeSha256: nativeSha,
      preview300Sha256: previewSha,
      evidenceRef: "evidence-output",
      approvedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "proposal_mismatch" });
    expect(await recordOutputApproval({
      setId: small.id,
      memberKey: primary.memberKey,
      acceptanceId: accepted.ok ? accepted.id : "",
      proposalId: proposal[0]!.id,
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      rendererId: RENDERER,
      nativeBytes: rendered.native,
      preview300Bytes: rendered.maskedPreview,
      nativeSha256: "d".repeat(64),
      preview300Sha256: previewSha,
      evidenceRef: "evidence-output",
      approvedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "output_hash_mismatch" });
    const approved = await recordOutputApproval({
      setId: small.id,
      memberKey: primary.memberKey,
      acceptanceId: accepted.ok ? accepted.id : "",
      proposalId: proposal[0]!.id,
      polygonPixels: PIXELS,
      polygonNormalized: NORMALIZED,
      rendererId: RENDERER,
      nativeBytes: rendered.native,
      preview300Bytes: rendered.maskedPreview,
      nativeSha256: nativeSha,
      preview300Sha256: previewSha,
      evidenceRef: "evidence-output",
      approvedBy: "reviewer",
    });
    expect(approved).toMatchObject({ ok: true, unchanged: false });
    expect(await recordServeClearance({
      setId: small.id, memberKey: primary.memberKey, outputApprovalId: "00000000-0000-4000-8000-000000000099", evidenceRef: "evidence-serve", clearedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "output_unapproved" });
    const id = cardId("a1000001", 1);
    await db.insert(playableCards).values({
      id, gameSetId: small.id, cardhedgeCardId: "per-card-serve:1", player: "Synthetic Player", set: small.identity.setName,
      number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/synthetic.jpg", category: "Baseball", isPlayable: true,
    });
    await db.update(discoveryCohortMembers).set({ playableCardId: id }).where(eq(discoveryCohortMembers.memberKey, primary.memberKey));
    await db.insert(discoveryImportProvenance).values({
      playableCardId: id, setId: small.id, memberKey: primary.memberKey, supplierId: primary.supplierId, sha256: primary.sha, byteLength: primary.bytes.length,
    });
    expect((await inspectBoundServe(id)).kind === "refused" && (await inspectBoundServe(id) as { code: string }).code).toBe("serve_unbound");
    const cleared = await recordServeClearance({
      setId: small.id, memberKey: primary.memberKey, outputApprovalId: approved.ok ? approved.id : "", evidenceRef: "evidence-serve", clearedBy: "reviewer",
    });
    expect(cleared).toMatchObject({ ok: true });
    const seen = await inspectBoundServe(id);
    expect(seen.kind).toBe("bound_held");
    if (seen.kind === "bound_held") expect(Buffer.compare(seen.bytes, rendered.native)).toBe(0);
    expect(canonicalPolygon(PIXELS)).toBe(JSON.stringify(PIXELS));
    const [storedProposal] = await db.select({ approval: geometryProposals.approval }).from(geometryProposals).where(eq(geometryProposals.id, proposal[0]!.id));
    expect(storedProposal?.approval).toBe(false);
    const [provenance] = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, id));
    expect(provenance?.sourceAccepted).toBe(false);
    expect(provenance?.opaqueQaPassed).toBe(false);
    await db.update(expansionOutputApprovals).set({ nativeBytes: Buffer.from("tampered-output") }).where(eq(expansionOutputApprovals.memberKey, primary.memberKey));
    expect(await inspectBoundServe(id)).toMatchObject({ kind: "refused", code: "output_hash_mismatch" });
    expect(await countExpansionGameplayEligible(small.id)).toBe(0);
    await mkdir(MASKED_CARDS_DIR, { recursive: true });
    await writeFile(path.join(MASKED_CARDS_DIR, `${id}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
    expect(await getMaskedImagePath(id)).toBeNull();
    expect(await expansionSetIsCleared(small.id)).toBe(false);
    const attempt = await attemptExpansionSetClearance({ setId: small.id, evidenceRef: "evidence-set", attemptedBy: "reviewer" });
    expect(attempt).toMatchObject({ ok: false, code: "below_expansion_minimum", eligibleCount: 0 });
    expect(await cohortGuardsImport(live.id)).toBe(false);
    expect(profileIsRegistered(getMaskProfile(live.identity.setName, live.id), live.id)).toBe(true);
    const decision = designApprovalDecision({ isExpansion: true, profileId: "unused" });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("held_prep_only");
    expect(isDaily5ExpansionBlocked(small.id)).toBe(true);
    expect(isDaily5ExpansionBlocked(live.id)).toBe(false);
    const stoppedAttempt = await attemptExpansionSetClearance({ setId: stopped.id, evidenceRef: "evidence-set", attemptedBy: "reviewer" });
    expect(stoppedAttempt.code).toBe("ud_stopped");
    const liveAttempt = await attemptExpansionSetClearance({ setId: live.id, evidenceRef: "evidence-set", attemptedBy: "reviewer" });
    expect(liveAttempt.code).toBe("not_expansion");
    await refreshHeldSets();
    expect(isHeldSet(small.id)).toBe(true);
    expect(isHeldSet(live.id)).toBe(false);
    const detail = capture();
    await handlePublicSetDetail({ params: { id: small.id }, headers: {} } as never, detail.res as never);
    expect(detail.status).toBe(404);
    const cover = capture();
    await handlePublicSetCover({ params: { setId: small.id, slot: "0" }, method: "GET", headers: {}, query: {} } as never, cover.res as never);
    expect(cover.status).toBe(404);
    const previousToken = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = "synthetic-release-token";
    const app = express();
    app.use(express.json());
    registerDiscoveryCohortRoutes(app);
    const server = createServer(app);
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as { port: number }).port;
      const missing = await fetch(`http://127.0.0.1:${port}/api/qa/baseball-expansion/${small.id}/discovery-cohort/set-clearance`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceRef: "evidence-set", attemptedBy: "reviewer" }),
      });
      expect(missing.status).toBe(404);
      const refused = await fetch(`http://127.0.0.1:${port}/api/qa/baseball-expansion/${small.id}/discovery-cohort/set-clearance`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": "synthetic-release-token" },
        body: JSON.stringify({ evidenceRef: "evidence-set", attemptedBy: "reviewer" }),
      });
      expect(refused.status).toBe(409);
      const body = await refused.json() as { ok: boolean; code: string; releaseAuthorized?: boolean };
      expect(body.ok).toBe(false);
      expect(body.code).toBe("below_expansion_minimum");
      expect(JSON.stringify(body)).not.toContain("http");
    } finally {
      if (previousToken === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previousToken;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires 35 gameplay-eligible cards and still refuses the set at 35", async () => {
    const rows = Array.from({ length: 41 }, (_, index) => {
      const n = index + 1;
      const bytes = Buffer.from(`floor-source-${n}`);
      const digest = sha(bytes);
      return {
        n,
        bytes,
        sha: digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `floor-${n}`,
        disposition: n === 38 ? "hold" as const : n === 39 ? "drop" as const : "pass-candidate" as const,
      };
    });
    const created = await createDiscoveryCohort({
      setId: floor.id,
      artifactSha256: sha(Buffer.from(rows.map((row) => row.memberKey).join("\n"))),
      members: rows.map((row) => ({
        memberKey: row.memberKey,
        ordinal: row.n,
        cardNumber: String(row.n),
        supplierId: row.supplierId,
        originalSha256: row.sha,
        originalWidth: 40,
        originalHeight: 30,
        originalBytes: row.bytes.length,
        disposition: row.disposition,
        routing: "synthetic",
      })),
    });
    expect(created).toMatchObject({ ok: true, originalCount: 41 });
    for (const row of rows.filter((item) => item.disposition === "pass-candidate")) {
      await db.insert(discoverySourceStaging).values({
        setId: floor.id, supplierId: row.supplierId, sha256: row.sha, width: 40, height: 30, bytes: row.bytes.length, imageBytes: row.bytes,
      });
      if (row.n === 40) {
        await recordSourceAcceptance({ setId: floor.id, memberKey: row.memberKey, sourceSha256: row.sha, evidenceRef: "evidence-floor", acceptedBy: "reviewer" });
        continue;
      }
      const accepted = await recordSourceAcceptance({ setId: floor.id, memberKey: row.memberKey, sourceSha256: row.sha, evidenceRef: "evidence-floor", acceptedBy: "reviewer" });
      const proposal = await db.insert(geometryProposals).values({
        setId: floor.id, memberKey: row.memberKey, supplierId: row.supplierId, sourceSha256: row.sha, width: 40, height: 30,
        geometryVersion: "plate-polygon-v1", polygonPixels: PIXELS, polygonNormalized: NORMALIZED, approval: false,
      }).returning({ id: geometryProposals.id });
      const native = Buffer.from(`opaque-${row.n}`);
      const preview = Buffer.from(`preview-${row.n}`);
      const approved = await recordOutputApproval({
        setId: floor.id,
        memberKey: row.memberKey,
        acceptanceId: accepted.ok ? accepted.id : "",
        proposalId: proposal[0]!.id,
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
        rendererId: RENDERER,
        nativeBytes: native,
        preview300Bytes: preview,
        nativeSha256: sha(native),
        preview300Sha256: sha(preview),
        evidenceRef: "evidence-floor",
        approvedBy: "reviewer",
      });
      expect(approved.ok).toBe(true);
      if (row.n === 41) continue;
      const serve = await recordServeClearance({
        setId: floor.id, memberKey: row.memberKey, outputApprovalId: approved.ok ? approved.id : "", evidenceRef: "evidence-floor", clearedBy: "reviewer",
      });
      expect(serve.ok).toBe(true);
      const id = cardId("a1000002", row.n);
      await db.insert(playableCards).values({
        id, gameSetId: floor.id, cardhedgeCardId: `per-card-serve:floor-${row.n}`, player: "Synthetic Player", set: floor.identity.setName,
        number: String(row.n), variant: "Base",
        imageUrl: row.n === 37 ? "http://cdn.bubble.io/synthetic.jpg" : "https://cdn.bubble.io/synthetic.jpg",
        category: "Baseball", isPlayable: row.n !== 36,
      });
      await db.update(discoveryCohortMembers).set({ playableCardId: id }).where(eq(discoveryCohortMembers.memberKey, row.memberKey));
      await db.insert(discoveryImportProvenance).values({
        playableCardId: id, setId: floor.id, memberKey: row.memberKey, supplierId: row.supplierId, sha256: row.sha, byteLength: row.bytes.length,
      });
    }
    expect(await recordSourceAcceptance({
      setId: floor.id, memberKey: rows[37]!.memberKey, sourceSha256: rows[37]!.sha, evidenceRef: "evidence-floor", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "not_importable" });
    expect(await recordSourceAcceptance({
      setId: floor.id, memberKey: rows[38]!.memberKey, sourceSha256: rows[38]!.sha, evidenceRef: "evidence-floor", acceptedBy: "reviewer",
    })).toMatchObject({ ok: false, code: "not_importable" });
    expect(await countExpansionGameplayEligible(floor.id)).toBe(35);
    const ready = await attemptExpansionSetClearance({ setId: floor.id, evidenceRef: "evidence-floor", attemptedBy: "reviewer" });
    expect(ready).toMatchObject({ ok: false, code: "release_denominator_unresolved", eligibleCount: 35, discoveryCount: 41 });
    expect(await expansionSetIsCleared(floor.id)).toBe(false);
    await refreshHeldSets();
    expect(isHeldSet(floor.id)).toBe(true);
    expect(isDaily5ExpansionBlocked(floor.id)).toBe(true);
    const detail = capture();
    await handlePublicSetDetail({ params: { id: floor.id }, headers: {} } as never, detail.res as never);
    expect(detail.status).toBe(404);
    await db.delete(expansionServeClearances).where(eq(expansionServeClearances.memberKey, rows[0]!.memberKey));
    expect(await countExpansionGameplayEligible(floor.id)).toBe(34);
    const short = await attemptExpansionSetClearance({ setId: floor.id, evidenceRef: "evidence-floor", attemptedBy: "reviewer" });
    expect(short).toMatchObject({ ok: false, code: "below_expansion_minimum", eligibleCount: 34, discoveryCount: 41 });
    const [cohort] = await db.select({ originalCount: discoveryCohorts.originalCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, floor.id));
    expect(cohort?.originalCount).toBe(41);
    expect(RELEASE_DENOMINATOR_STATUS.retainedDiscoveryExample.count).toBe(448);
  });
});

function capture(): { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } {
  const box: { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } = {
    res: {
      headersSent: false,
      status(code: number) { box.status = code; return box.res; },
      json() { return box.res; },
      setHeader() { return box.res; },
      removeHeader() { return box.res; },
      end() { box.res.headersSent = true; return box.res; },
    },
  };
  return box;
}
