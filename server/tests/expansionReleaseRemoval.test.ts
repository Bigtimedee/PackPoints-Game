/**
 * An explicit removal drops one leaked card without taking the set offline.
 * Omitting a member without that list is still refused. A permanent drop
 * cannot come back. The removed card's mask is gone on the next request.
 */
import { createHash } from "crypto";
import express from "express";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

const { db } = await import("../db");
const {
  discoveryCohortMembers,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceStaging,
  expansionOutputApprovals,
  expansionReleaseManifests,
  expansionReleaseMembers,
  expansionReleaseRemovals,
  expansionServeClearances,
  expansionSetClearanceAttempts,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { registerDiscoveryCohortRoutes } = await import("../routes/discoveryCohortQa");
const { sendMaskedCard } = await import("../services/playImageSend");
const { handleMaskedToken } = await import("../services/playImageHttp");
const { maskTokenMatches, maskedPlayPath } = await import("../services/playImageToken");
const { PER_CARD_RENDERER_IDS } = await import("../services/baseballExpansion/perCardRelease");
const { CURRENT_MASK_VERSION } = await import("@shared/maskGeometry");
const { MASKED_CARDS_DIR } = await import("../masking/maskPlanStore");

const SET = "e4f4a86e-3908-5e93-af8f-fd8462c25d97";
const TOKEN = "proposal-preview-token";
const PIXELS = [[1, 1], [30, 1], [30, 30], [1, 30]];
const NORMALIZED = PIXELS.map(([x, y]) => [x / 40, y / 60]);
const RENDERER = PER_CARD_RENDERER_IDS[1];
const COUNT = 37;

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function maskFiles(cardId: string): string[] {
  return ["jpg", "ok", "json"].map((ext) => path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.${ext}`));
}

async function resetSet(): Promise<void> {
  await db.delete(expansionReleaseRemovals).where(eq(expansionReleaseRemovals.setId, SET));
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, SET));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, SET));
  await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, SET));
  await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, SET));
  await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, SET));
  await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, SET));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
  const provenance = await db.select({ id: discoveryImportProvenance.playableCardId }).from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  for (const row of provenance) await db.delete(playableCards).where(eq(playableCards.id, row.id));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, SET));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, SET));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
}

describe("explicit expansion release removal", () => {
  const previous = process.env.COVER_QA_TOKEN;
  const focus = { cardId: "" };
  const written: string[] = [];

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await resetSet();
    for (const file of written) await rm(file, { force: true });
  });

  it("audits a removal, refuses an implicit or undersized drop, blocks a permanent re-add, and 404s the purged mask", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    await resetSet();
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Donruss", year: 1991, setName: "1991 Donruss Baseball",
      isActive: true, cardhedgeSetQuery: "1991 Donruss Baseball", cardhedgeCategory: "Baseball",
    });
    const cards = [];
    for (let n = 1; n <= COUNT; n += 1) {
      const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: n, g: 20, b: 40 } } }).jpeg().toBuffer();
      const digest = sha(jpeg);
      cards.push({
        n, jpeg, digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `removal-public-${n}`,
        native: Buffer.from(`native-removal-${n}-${digest.slice(0, 8)}`),
        preview: Buffer.from(`preview-removal-${n}-${digest.slice(0, 8)}`),
      });
    }
    const leaked = cards[COUNT - 1]!;
    const permanent = cards[COUNT - 2]!;
    const kept = cards[0]!;
    const allKeys = cards.map((card) => card.memberKey);
    const app = express();
    app.use(express.json({ limit: "3mb" }));
    registerDiscoveryCohortRoutes(app);
    app.get("/api/cards/:cardId/masked-image", async (req, res) => {
      await sendMaskedCard(req, res, req.params.cardId);
    });
    app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
      void handleMaskedToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: async () => ({ ok: false, reason: "bad" }),
        resolveMask: async (scope, sessionId, index, token) => (
          focus.cardId && maskTokenMatches(scope, sessionId, index, focus.cardId, token) ? focus.cardId : null
        ),
        sendUnmasked: async (response) => { response.status(500).end(); },
        sendMasked: sendMaskedCard,
      });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (urlPath: string, body: unknown) => {
      const response = await fetch(`${base}${urlPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
    };
    const maskOf = async (cardId: string) => {
      focus.cardId = cardId;
      const direct = await fetch(`${base}/api/cards/${cardId}/masked-image`, { headers: { "if-none-match": `"${CURRENT_MASK_VERSION}"` } });
      const daily = await fetch(`${base}${maskedPlayPath({ scope: "d5", sessionId: "daily-removal", index: 0, cardId })}`, {
        headers: { "if-none-match": `"${CURRENT_MASK_VERSION}"` },
      });
      return {
        directStatus: direct.status,
        directBytes: Buffer.from(await direct.arrayBuffer()),
        dailyStatus: daily.status,
        dailyBytes: Buffer.from(await daily.arrayBuffer()),
      };
    };
    const activeManifest = async () => {
      const [row] = await db.select().from(expansionReleaseManifests).where(and(
        eq(expansionReleaseManifests.setId, SET),
        isNull(expansionReleaseManifests.revokedAt),
      ));
      return row;
    };
    try {
      const cohort = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort`, {
        artifactSha256: "ab".repeat(32),
        members: cards.map((card) => ({
          memberKey: card.memberKey, ordinal: card.n, cardNumber: String(card.n), supplierId: card.supplierId,
          originalSha256: card.digest, originalWidth: 40, originalHeight: 60, originalBytes: card.jpeg.length,
          disposition: "pass-candidate", routing: "ordinary-canonical-candidate",
        })),
      });
      expect(cohort.status).toBe(200);
      const membershipSha256 = String(cohort.body.membershipSha256);
      for (const card of cards) {
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
          supplierId: card.supplierId, imageBase64: card.jpeg.toString("base64"),
        })).status).toBe(200);
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
          supplierId: card.supplierId, imageUrl: `https://cdn.bubble.io/removal/${card.n}.jpg`, player: "Synthetic Player",
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
        memberKeys: allKeys, version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(released.body).toMatchObject({ releaseAuthorized: true, memberCount: COUNT, version: 1 });
      const manifestId = String(released.body.manifestId);
      const memberRows = await db.select({
        memberKey: discoveryCohortMembers.memberKey,
        id: discoveryCohortMembers.playableCardId,
      }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
      const idOf = (memberKey: string) => memberRows.find((row) => row.memberKey === memberKey)?.id ?? "";
      const leakedId = idOf(leaked.memberKey);
      const permanentId = idOf(permanent.memberKey);
      const keptId = idOf(kept.memberKey);
      expect(leakedId).not.toBe("");
      const replaceBase = {
        expectedManifestId: manifestId,
        version: 2,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
      };

      const implicit = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBase, memberKeys: allKeys.slice(0, COUNT - 1),
      });
      expect(implicit.status).toBe(409);
      expect(implicit.body.code).toBe("release_member_removed");
      expect((await activeManifest())?.id).toBe(manifestId);
      expect(await db.select({ id: expansionReleaseRemovals.id }).from(expansionReleaseRemovals).where(eq(expansionReleaseRemovals.setId, SET))).toHaveLength(0);

      const undersized = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBase,
        memberKeys: allKeys.slice(0, 34),
        removals: cards.slice(34).map((card) => ({ memberKey: card.memberKey, reason: "leaked-surname" })),
      });
      expect(undersized.status).toBe(409);
      expect(undersized.body.code).toBe("below_expansion_minimum");
      expect((await activeManifest())?.memberCount).toBe(COUNT);
      expect(await db.select({ id: expansionReleaseRemovals.id }).from(expansionReleaseRemovals).where(eq(expansionReleaseRemovals.setId, SET))).toHaveLength(0);

      const stale = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBase,
        expectedManifestId: "00000000-0000-4000-8000-000000000000",
        memberKeys: allKeys.slice(0, COUNT - 1),
        removals: [{ memberKey: leaked.memberKey, reason: "leaked-surname" }],
      });
      expect(stale.body.code).toBe("release_manifest_mismatch");
      expect(await db.select({ id: expansionReleaseRemovals.id }).from(expansionReleaseRemovals).where(eq(expansionReleaseRemovals.setId, SET))).toHaveLength(0);

      await mkdir(MASKED_CARDS_DIR, { recursive: true });
      const leakedFiles = maskFiles(leakedId);
      const keptFiles = maskFiles(keptId);
      written.push(...leakedFiles, ...keptFiles);
      for (const file of [...leakedFiles, ...keptFiles]) await writeFile(file, Buffer.from(`stale-${path.basename(file)}`));
      const before = await maskOf(leakedId);
      expect(before.directStatus).toBe(200);
      expect(before.directBytes).toEqual(leaked.native);
      expect(before.dailyStatus).toBe(200);
      expect(before.dailyBytes).toEqual(leaked.native);

      const removed = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBase,
        memberKeys: allKeys.filter((key) => key !== leaked.memberKey),
        removals: [{ memberKey: leaked.memberKey, reason: "leaked-surname" }],
      });
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ releaseAuthorized: true, unchanged: false, memberCount: COUNT - 1, version: 2 });
      const afterRemoval = await activeManifest();
      expect(afterRemoval?.id).not.toBe(manifestId);
      const audits = await db.select().from(expansionReleaseRemovals).where(eq(expansionReleaseRemovals.setId, SET));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        memberKey: leaked.memberKey,
        reason: "leaked-surname",
        permanent: false,
        removedBy: "reviewer",
        evidenceRef: "evidence-preview-gate",
        fromManifestId: manifestId,
        toManifestId: afterRemoval?.id,
      });
      const after = await maskOf(leakedId);
      expect(after.directStatus).toBe(404);
      expect(after.directBytes.equals(leaked.native)).toBe(false);
      expect(after.dailyStatus).toBe(404);
      expect(after.dailyBytes.equals(leaked.native)).toBe(false);
      for (const file of leakedFiles) expect(existsSync(file)).toBe(false);
      for (const file of keptFiles) expect(existsSync(file)).toBe(true);
      const keptStill = await maskOf(keptId);
      expect(keptStill.directStatus).toBe(200);
      expect(keptStill.directBytes).toEqual(kept.native);

      const permanentFiles = maskFiles(permanentId);
      written.push(...permanentFiles);
      for (const file of permanentFiles) await writeFile(file, Buffer.from("stale-permanent"));
      const dropped = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        expectedManifestId: afterRemoval!.id,
        version: 3,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
        memberKeys: allKeys.filter((key) => key !== leaked.memberKey && key !== permanent.memberKey),
        removals: [{ memberKey: permanent.memberKey, reason: "name-leak-permanent", permanent: true }],
      });
      expect(dropped.status).toBe(200);
      expect(dropped.body).toMatchObject({ releaseAuthorized: true, memberCount: COUNT - 2, version: 3 });
      const live = await activeManifest();
      const permanentRows = await db.select().from(expansionReleaseRemovals).where(and(
        eq(expansionReleaseRemovals.setId, SET),
        eq(expansionReleaseRemovals.memberKey, permanent.memberKey),
      ));
      expect(permanentRows).toHaveLength(1);
      expect(permanentRows[0]?.permanent).toBe(true);
      for (const file of permanentFiles) expect(existsSync(file)).toBe(false);
      const permanentMask = await maskOf(permanentId);
      expect(permanentMask.directStatus).toBe(404);
      expect(permanentMask.dailyStatus).toBe(404);
      const putBack = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        expectedManifestId: live!.id,
        version: 4,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
        memberKeys: allKeys.filter((key) => key !== leaked.memberKey),
      });
      expect(putBack.status).toBe(409);
      expect(putBack.body.code).toBe("release_member_permanent_drop");
      expect((await activeManifest())?.id).toBe(live!.id);

      const revoked = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/revoke`, {
        version: 3, evidenceRef: "evidence-revoke-removal", revokedBy: "reviewer",
      });
      expect(revoked.status).toBe(200);
      expect(revoked.body).toMatchObject({ ok: true, unchanged: false, releaseAuthorized: false });
      expect(await activeManifest()).toBeUndefined();
      for (const file of keptFiles) expect(existsSync(file)).toBe(false);
      const revokedMask = await maskOf(keptId);
      expect(revokedMask.directStatus).toBe(404);
      expect(revokedMask.dailyStatus).toBe(404);
      expect(revokedMask.directBytes.equals(kept.native)).toBe(false);

      const blockedClearance = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
        memberKeys: allKeys.filter((key) => key !== leaked.memberKey),
        version: 4,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
      });
      expect(blockedClearance.status).toBe(409);
      expect(blockedClearance.body.code).toBe("release_member_permanent_drop");
      expect(await activeManifest()).toBeUndefined();
      const withoutDropped = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
        memberKeys: allKeys.filter((key) => key !== leaked.memberKey && key !== permanent.memberKey),
        version: 4,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
      });
      expect(withoutDropped.status).toBe(200);
      expect(withoutDropped.body).toMatchObject({ releaseAuthorized: true, memberCount: COUNT - 2, version: 4 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 180000);
});
