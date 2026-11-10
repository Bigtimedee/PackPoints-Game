/**
 * A held original stays unimportable until an append-only review names that
 * same identity. The review does not publish the card or rewrite the cohort.
 */
import { createHash } from "crypto";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const { db } = await import("../db");
const {
  discoveryCohortMembers,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceStaging,
  expansionMemberReviews,
  expansionOutputApprovals,
  expansionReleaseManifests,
  expansionReleaseMembers,
  expansionServeClearances,
  expansionSetClearanceAttempts,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { registerDiscoveryCohortRoutes } = await import("../routes/discoveryCohortQa");
const { rejectPublicMask, resetPublicMaskSetCacheForTests } = await import("../services/publicMaskGate");
const { sendMaskedCard } = await import("../services/playImageSend");
const { PER_CARD_RENDERER_IDS } = await import("../services/baseballExpansion/perCardRelease");
const { recordMemberReview } = await import("../services/baseballExpansion/memberReview");
const { UD_1991_DISCOVERY } = await import("../services/baseballExpansion/discoveryCohort");

const SET = "64130c7a-6b1a-533c-9575-1089f7adfdce";
const TOKEN = "proposal-preview-token";
const PIXELS = [[1, 1], [30, 1], [30, 30], [1, 30]];
const NORMALIZED = PIXELS.map(([x, y]) => [x / 40, y / 60]);
const RENDERER = PER_CARD_RENDERER_IDS[1];

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function resetSet(setId: string): Promise<void> {
  await db.delete(expansionMemberReviews).where(eq(expansionMemberReviews.setId, setId));
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, setId));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, setId));
  await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, setId));
  await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, setId));
  await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, setId));
  await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, setId));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, setId));
  const provenance = await db.select({ id: discoveryImportProvenance.playableCardId }).from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  for (const row of provenance) await db.delete(playableCards).where(eq(playableCards.id, row.id));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, setId));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
}

describe("held member review ledger", () => {
  const previous = process.env.COVER_QA_TOKEN;

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await resetSet(SET);
  });

  it("keeps an unreviewed hold closed and imports only that exact member after a review", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    await resetSet(SET);
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Donruss", year: 1990, setName: "1990 Donruss Baseball",
      isActive: true, cardhedgeSetQuery: "1990 Donruss Baseball", cardhedgeCategory: "Baseball",
    });
    const cards = [];
    for (let n = 1; n <= 37; n += 1) {
      const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: n, g: 30, b: 50 } } }).jpeg().toBuffer();
      const digest = sha(jpeg);
      cards.push({
        n, jpeg, digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `hold-review-${n}`,
        native: Buffer.from(`native-${n}-${digest.slice(0, 8)}`),
        preview: Buffer.from(`preview-${n}-${digest.slice(0, 8)}`),
        disposition: n <= 35 ? "pass-candidate" as const : n === 36 ? "hold" as const : "drop" as const,
      });
    }
    const held = cards[35]!;
    const dropped = cards[36]!;
    const app = express();
    app.use(express.json({ limit: "3mb" }));
    registerDiscoveryCohortRoutes(app);
    app.get("/api/cards/:cardId/masked-image", async (req, res) => {
      if (await rejectPublicMask(req, res, req.params.cardId)) return;
      await sendMaskedCard(req, res, req.params.cardId);
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "content-type": "application/json", "x-qa-token": TOKEN };
    const post = async (urlPath: string, body: unknown, token = TOKEN) => {
      const response = await fetch(`${base}${urlPath}`, {
        method: "POST",
        headers: { ...headers, "x-qa-token": token },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
    };
    try {
      const cohort = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort`, {
        artifactSha256: "ab".repeat(32),
        members: cards.map((card) => ({
          memberKey: card.memberKey, ordinal: card.n, cardNumber: String(card.n), supplierId: card.supplierId,
          originalSha256: card.digest, originalWidth: 40, originalHeight: 60, originalBytes: card.jpeg.length,
          disposition: card.disposition, routing: "ordinary-canonical-candidate",
        })),
      });
      expect(cohort.status).toBe(200);
      const membershipSha256 = String(cohort.body.membershipSha256);
      expect(cohort.body.originalCount).toBe(37);
      for (const card of cards.slice(0, 35)) {
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
          supplierId: card.supplierId, imageBase64: card.jpeg.toString("base64"),
        })).status).toBe(200);
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
          supplierId: card.supplierId, imageUrl: `https://cdn.bubble.io/hold-review/${card.n}.jpg`, player: "Synthetic Player",
        })).status).toBe(200);
        const proposal = await post(`/api/qa/baseball-expansion/${SET}/geometry-proposals`, {
          memberKey: card.memberKey, supplierId: card.supplierId, sourceSha256: card.digest, width: 40, height: 60,
          geometryVersion: "plate-polygon-v1", polygonPixels: PIXELS, polygonNormalized: NORMALIZED,
        });
        const accepted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/source-acceptance`, {
          memberKey: card.memberKey, sourceSha256: card.digest, evidenceRef: "evidence-preview-gate", acceptedBy: "reviewer",
        });
        const approved = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/output-approval`, {
          memberKey: card.memberKey, acceptanceId: accepted.body.id, proposalId: proposal.body.id,
          polygonPixels: PIXELS, polygonNormalized: NORMALIZED, rendererId: RENDERER,
          nativeBase64: card.native.toString("base64"), preview300Base64: card.preview.toString("base64"),
          nativeSha256: sha(card.native), preview300Sha256: sha(card.preview),
          evidenceRef: "evidence-preview-gate", approvedBy: "reviewer",
        });
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/serve-clearance`, {
          memberKey: card.memberKey, outputApprovalId: approved.body.id, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer",
        })).status).toBe(200);
      }
      const released = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
        memberKeys: cards.slice(0, 35).map((card) => card.memberKey),
        version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(released.body).toMatchObject({ releaseAuthorized: true, memberCount: 35 });
      const manifestId = String(released.body.manifestId);
      const [liveMember] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[0]!.memberKey));
      resetPublicMaskSetCacheForTests();
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${liveMember!.id}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);

      const heldStage = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: held.supplierId, imageBase64: held.jpeg.toString("base64"),
      });
      expect(heldStage.status).toBe(409);
      expect(heldStage.body.code).toBe("not_importable");
      const review = {
        memberKey: held.memberKey, supplierId: held.supplierId, sourceSha256: held.digest,
        width: 40, height: 60, originalBytes: held.jpeg.length,
        evidenceRef: "evidence-hold-review", reviewedBy: "reviewer", expectedRevision: 0,
      };
      const drifted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, { ...review, sourceSha256: "ab".repeat(32) });
      expect(drifted.status).toBe(409);
      expect(drifted.body.code).toBe("source_drift");
      const otherIdentity = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, { ...review, memberKey: "candidate-9999|" + "cd".repeat(32) });
      expect(otherIdentity.body.code).toBe("member_mismatch");
      const otherSize = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, { ...review, width: 41 });
      expect(otherSize.body.code).toBe("source_drift");
      const dropReview = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, {
        ...review, memberKey: dropped.memberKey, supplierId: dropped.supplierId, sourceSha256: dropped.digest, originalBytes: dropped.jpeg.length,
      });
      expect(dropReview.body.code).toBe("not_importable");
      const stopped = await post(`/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/discovery-cohort/member-review`, review);
      expect(stopped.status).toBe(409);
      expect(stopped.body.code).toBe("ud_stopped");
      const anonymous = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, review, "nope");
      expect(anonymous.status).toBe(404);
      const opened = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, review);
      expect(opened.status).toBe(200);
      expect(opened.body).toMatchObject({ unchanged: false, revision: 1, releaseAuthorized: false, profileApproved: false, serveCleared: false });
      const replay = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, review);
      expect(replay.body).toMatchObject({ unchanged: true, id: opened.body.id, revision: 1, releaseAuthorized: false });
      const conflict = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, { ...review, evidenceRef: "evidence-other-review" });
      expect(conflict.body.code).toBe("review_conflict");
      const [left, right] = await Promise.all([
        recordMemberReview({ setId: SET, ...review, evidenceRef: "evidence-race-left", expectedRevision: 1 }),
        recordMemberReview({ setId: SET, ...review, evidenceRef: "evidence-race-right", expectedRevision: 1 }),
      ]);
      const settled = [left, right];
      expect(settled.filter((row) => row.ok && row.unchanged === false && row.revision === 2)).toHaveLength(1);
      expect(settled.filter((row) => !row.ok && row.code === "review_conflict")).toHaveLength(1);
      const reviews = await db.select().from(expansionMemberReviews).where(eq(expansionMemberReviews.memberKey, held.memberKey));
      expect(reviews).toHaveLength(2);
      const [still] = await db.select({ disposition: discoveryCohortMembers.disposition }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, held.memberKey));
      expect(still?.disposition).toBe("hold");
      const [cohortRow] = await db.select({ membershipSha256: discoveryCohorts.membershipSha256, originalCount: discoveryCohorts.originalCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
      expect(cohortRow).toEqual({ membershipSha256, originalCount: 37 });
      const geometryRows = await db.select({ id: geometryProposals.id }).from(geometryProposals).where(eq(geometryProposals.memberKey, held.memberKey));
      expect(geometryRows).toEqual([]);

      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: held.supplierId, imageBase64: held.jpeg.toString("base64"),
      })).status).toBe(200);
      const imported = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: held.supplierId, imageUrl: "https://cdn.bubble.io/hold-review/36.jpg", player: "Synthetic Player",
      });
      expect(imported.status).toBe(200);
      expect(imported.body.releaseAuthorized).toBe(false);
      const [heldCard] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, held.memberKey));
      resetPublicMaskSetCacheForTests();
      expect((await fetch(`${base}/api/cards/${heldCard!.id}/masked-image`)).status).toBe(404);
      const proposal = await post(`/api/qa/baseball-expansion/${SET}/geometry-proposals`, {
        memberKey: held.memberKey, supplierId: held.supplierId, sourceSha256: held.digest, width: 40, height: 60,
        geometryVersion: "plate-polygon-v1", polygonPixels: PIXELS, polygonNormalized: NORMALIZED,
      });
      expect(proposal.body).toMatchObject({ approval: false, releaseAuthorized: false });
      const accepted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/source-acceptance`, {
        memberKey: held.memberKey, sourceSha256: held.digest, evidenceRef: "evidence-preview-gate", acceptedBy: "reviewer",
      });
      const output = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/output-approval`, {
        memberKey: held.memberKey, acceptanceId: accepted.body.id, proposalId: proposal.body.id,
        polygonPixels: PIXELS, polygonNormalized: NORMALIZED, rendererId: RENDERER,
        nativeBase64: held.native.toString("base64"), preview300Base64: held.preview.toString("base64"),
        nativeSha256: sha(held.native), preview300Sha256: sha(held.preview),
        evidenceRef: "evidence-preview-gate", approvedBy: "reviewer",
      });
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/serve-clearance`, {
        memberKey: held.memberKey, outputApprovalId: output.body.id, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer",
      })).status).toBe(200);
      resetPublicMaskSetCacheForTests();
      expect((await fetch(`${base}/api/cards/${heldCard!.id}/masked-image`)).status).toBe(404);
      const replaced = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        expectedManifestId: manifestId,
        memberKeys: [...cards.slice(0, 35).map((card) => card.memberKey), held.memberKey],
        version: 2, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(replaced.body).toMatchObject({ releaseAuthorized: true, memberCount: 36 });
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${liveMember!.id}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${heldCard!.id}/masked-image`)).arrayBuffer())).toEqual(held.native);
      const [after] = await db.select({ membershipSha256: discoveryCohorts.membershipSha256, originalCount: discoveryCohorts.originalCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
      expect(after).toEqual(cohortRow);
      const prior = await db.select({ memberKey: expansionReleaseMembers.memberKey }).from(expansionReleaseMembers).where(eq(expansionReleaseMembers.manifestId, manifestId));
      expect(prior).toHaveLength(35);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 180000);
});
