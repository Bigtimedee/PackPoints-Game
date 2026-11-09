/**
 * A card imported into an already released expansion set stays off public
 * routes until one transaction replaces the manifest. A failed replacement
 * leaves the current manifest active.
 */
import { createHash } from "crypto";
import express from "express";
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
const { handleMaskedToken, handleRevealToken } = await import("../services/playImageHttp");
const { maskTokenMatches, maskedPlayPath, revealPlayPath } = await import("../services/playImageToken");
const { resolveRevealCard } = await import("../services/playImageAccess");
const { cachedCoverCardIds, clearLastGoodCoversForTests, clearReadyCoverIndexForTests, clearSetCoverCaches, handlePublicSetCover, setCoverWarmReadyForTests, warmSetCoverCache } = await import("../services/setCovers");
const { PER_CARD_RENDERER_IDS, replaceExpansionRelease, setReplaceReleaseAfterRevokeForTests } = await import("../services/baseballExpansion/perCardRelease");
const { handlePublicSetDetail } = await import("../services/publicSets");
const { storage } = await import("../storage");
const { CURRENT_MASK_VERSION } = await import("@shared/maskGeometry");
const { markSchemaReady, resetSchemaGateForTests, schemaGateMiddleware } = await import("../startup/schemaGate");
const { setWarmMaskDirForTests } = await import("../startup/warmMaskGate");
const { MASKED_CARDS_DIR } = await import("../masking/maskPlanStore");

const SET = "97456b32-7b68-56fe-971a-1c821e2b09c4";
const TOKEN = "proposal-preview-token";
const PIXELS = [[1, 1], [30, 1], [30, 30], [1, 30]];
const NORMALIZED = PIXELS.map(([x, y]) => [x / 40, y / 60]);
const RENDERER = PER_CARD_RENDERER_IDS[1];

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function resetSet(): Promise<void> {
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

describe("atomic expansion release replacement", () => {
  const previous = process.env.COVER_QA_TOKEN;
  const previousCache = process.env.SET_COVER_CACHE;

  afterAll(async () => {
    setReplaceReleaseAfterRevokeForTests(null);
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    if (previousCache === undefined) delete process.env.SET_COVER_CACHE;
    else process.env.SET_COVER_CACHE = previousCache;
    resetSchemaGateForTests();
    setWarmMaskDirForTests(null);
    clearSetCoverCaches();
    await resetSet();
  });

  it("publishes an added member only when the replacement commits", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    setReplaceReleaseAfterRevokeForTests(null);
    await resetSet();
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Topps", year: 1990, setName: "1990 Topps Baseball",
      isActive: true, cardhedgeSetQuery: "1990 Topps Baseball", cardhedgeCategory: "Baseball",
    });
    const cards = [];
    for (let n = 1; n <= 36; n += 1) {
      const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: n, g: 20, b: 40 } } }).jpeg().toBuffer();
      const digest = sha(jpeg);
      cards.push({
        n, jpeg, digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `append-public-${n}`,
        native: Buffer.from(`native-${n}-${digest.slice(0, 8)}`),
        preview: Buffer.from(`preview-${n}-${digest.slice(0, 8)}`),
      });
    }
    const extra = cards[35]!;
    const firstKeys = cards.slice(0, 35).map((card) => card.memberKey);
    const allKeys = cards.map((card) => card.memberKey);
    const bound = { releasedId: "" };
    const app = express();
    app.use(express.json({ limit: "3mb" }));
    registerDiscoveryCohortRoutes(app);
    app.get("/api/cards/:cardId/masked-image", async (req, res) => {
      if (await rejectPublicMask(req, res, req.params.cardId)) return;
      await sendMaskedCard(req, res, req.params.cardId);
    });
    app.get("/api/sets/:setId/covers/:slot", (req, res) => { void handlePublicSetCover(req, res); });
    app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
      void handleMaskedToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: async () => ({ ok: false, reason: "bad" }),
        resolveMask: async (scope, sessionId, index, token) => (
          bound.releasedId && maskTokenMatches(scope, sessionId, index, bound.releasedId, token) ? bound.releasedId : null
        ),
        sendUnmasked: async (response) => { response.status(500).end(); },
        sendMasked: sendMaskedCard,
      });
    });
    app.get("/api/play/r/:scope/:sessionId/:index/:exp/:token", (req, res) => {
      void handleRevealToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: resolveRevealCard,
        resolveMask: async () => null,
        sendUnmasked: sendMaskedCard,
        sendMasked: sendMaskedCard,
      });
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
    const detail = async () => {
      let status = 0;
      let body: Record<string, unknown> = {};
      const capture = {
        status(code: number) { status = code; return capture; },
        json(payload: unknown) { if (!status) status = 200; body = payload as Record<string, unknown>; return capture; },
        setHeader() { return capture; },
        removeHeader() { return capture; },
        end() { return capture; },
        headersSent: false,
      };
      await handlePublicSetDetail({ params: { id: SET }, headers: {}, query: {} } as never, capture as never);
      return { status, body };
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
      }
      for (const card of cards.slice(0, 35)) {
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
          supplierId: card.supplierId, imageUrl: `https://cdn.bubble.io/append/${card.n}.jpg`, player: "Synthetic Player",
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
        memberKeys: firstKeys, version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(released.body).toMatchObject({ releaseAuthorized: true, memberCount: 35 });
      const manifestId = String(released.body.manifestId);
      const [liveMember] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[0]!.memberKey));
      bound.releasedId = liveMember!.id!;
      resetPublicMaskSetCacheForTests();
      expect((await detail()).body.cardCount).toBe(35);
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${bound.releasedId}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);

      const imported = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: extra.supplierId, imageUrl: "https://cdn.bubble.io/append/36.jpg", player: "Synthetic Player",
      });
      expect(imported.body.releaseAuthorized).toBe(false);
      const geometry = await post(`/api/qa/baseball-expansion/${SET}/geometry-proposals`, {
        memberKey: extra.memberKey, supplierId: extra.supplierId, sourceSha256: extra.digest, width: 40, height: 60,
        geometryVersion: "plate-polygon-v1", polygonPixels: PIXELS, polygonNormalized: NORMALIZED,
      });
      expect(geometry.body).toMatchObject({ approval: false, releaseAuthorized: false });
      const [extraRow] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, extra.memberKey));
      const extraId = extraRow!.id!;
      resetPublicMaskSetCacheForTests();
      expect((await detail()).body.cardCount).toBe(35);
      expect((await storage.getRandomCardsFromSet(SET, 40)).map((card) => card.id)).not.toContain(extraId);
      expect((await fetch(`${base}/api/cards/${extraId}/masked-image`)).status).toBe(404);
      expect((await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "sess-extra", index: 0, cardId: extraId })}`)).status).toBe(404);
      expect((await fetch(`${base}${revealPlayPath({ scope: "solo", sessionId: "sess-extra", index: 35, cardId: extraId, binder: "sess-extra" })}`)).status).toBe(403);

      const stale = Buffer.from("stale-warm-new-member-not-public");
      await mkdir(MASKED_CARDS_DIR, { recursive: true });
      const staleName = `${extraId}_${CURRENT_MASK_VERSION}.jpg`;
      const staleMarker = `${extraId}_${CURRENT_MASK_VERSION}.ok`;
      await writeFile(path.join(MASKED_CARDS_DIR, staleName), stale);
      await writeFile(path.join(MASKED_CARDS_DIR, staleMarker), "ok\n");
      process.env.SET_COVER_CACHE = "1";
      clearSetCoverCaches();
      clearReadyCoverIndexForTests();
      clearLastGoodCoversForTests();
      setCoverWarmReadyForTests(true);
      await warmSetCoverCache();
      expect(await cachedCoverCardIds(SET)).not.toContain(extraId);
      for (let slot = 0; slot < 8; slot += 1) {
        const cover = await fetch(`${base}/api/sets/${SET}/covers/${slot}`, { headers: { "if-none-match": `"${CURRENT_MASK_VERSION}"` } });
        expect(cover.status).not.toBe(304);
        const body = Buffer.from(await cover.arrayBuffer());
        expect(body.equals(stale)).toBe(false);
        expect(body.equals(extra.native)).toBe(false);
      }
      const boot = express();
      boot.use(schemaGateMiddleware);
      const bootServer = createServer(boot);
      await new Promise<void>((resolve) => bootServer.listen(0, "127.0.0.1", resolve));
      const bootDir = path.join(MASKED_CARDS_DIR, "replace-boot");
      await mkdir(bootDir, { recursive: true });
      await writeFile(path.join(bootDir, staleName), stale);
      await writeFile(path.join(bootDir, staleMarker), "ok\n");
      setWarmMaskDirForTests(bootDir);
      resetSchemaGateForTests();
      const booting = await fetch(`http://127.0.0.1:${(bootServer.address() as AddressInfo).port}${maskedPlayPath({ scope: "solo", sessionId: "boot", index: 0, cardId: extraId })}`, {
        headers: { "if-none-match": `"${CURRENT_MASK_VERSION}"` },
      });
      expect(booting.status).toBe(503);
      expect(Buffer.from(await booting.arrayBuffer()).equals(stale)).toBe(false);
      setWarmMaskDirForTests(null);
      resetSchemaGateForTests();
      markSchemaReady();
      await new Promise<void>((resolve) => bootServer.close(() => resolve()));

      const accepted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/source-acceptance`, {
        memberKey: extra.memberKey, sourceSha256: extra.digest, evidenceRef: "evidence-preview-gate", acceptedBy: "reviewer",
      });
      const approved = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/output-approval`, {
        memberKey: extra.memberKey, acceptanceId: accepted.body.id, proposalId: geometry.body.id,
        polygonPixels: PIXELS, polygonNormalized: NORMALIZED, rendererId: RENDERER,
        nativeBase64: extra.native.toString("base64"), preview300Base64: extra.preview.toString("base64"),
        nativeSha256: sha(extra.native), preview300Sha256: sha(extra.preview),
        evidenceRef: "evidence-preview-gate", approvedBy: "reviewer",
      });
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/serve-clearance`, {
        memberKey: extra.memberKey, outputApprovalId: approved.body.id, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer",
      })).status).toBe(200);
      resetPublicMaskSetCacheForTests();
      expect((await detail()).body.cardCount).toBe(35);
      expect((await fetch(`${base}/api/cards/${extraId}/masked-image`)).status).toBe(404);

      const replaceBody = {
        expectedManifestId: manifestId,
        memberKeys: allKeys,
        version: 2,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
        discoveryMembershipSha256: membershipSha256,
      };
      const wrongHash = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBody, discoveryMembershipSha256: "cd".repeat(32),
      });
      expect(wrongHash.status).toBe(409);
      expect(wrongHash.body.code).toBe("membership_mismatch");
      const wrongVersion = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, { ...replaceBody, version: 3 });
      expect(wrongVersion.body.code).toBe("release_version_mismatch");
      const dropped = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBody, memberKeys: allKeys.slice(1),
      });
      expect(dropped.body.code).toBe("release_member_removed");
      const staleExpected = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBody, expectedManifestId: "00000000-0000-4000-8000-000000000000",
      });
      expect(staleExpected.body.code).toBe("release_manifest_mismatch");
      const anonymous = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, replaceBody, "nope");
      expect(anonymous.status).toBe(404);
      resetPublicMaskSetCacheForTests();
      expect((await activeManifest())?.id).toBe(manifestId);
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${bound.releasedId}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);

      setReplaceReleaseAfterRevokeForTests(() => { throw new Error("forced-after-revoke"); });
      await expect(replaceExpansionRelease({
        setId: SET, ...replaceBody,
      })).rejects.toThrow("forced-after-revoke");
      setReplaceReleaseAfterRevokeForTests(null);
      expect((await activeManifest())?.id).toBe(manifestId);
      expect((await db.select().from(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, SET))).map((row) => row.version)).toEqual([1]);
      resetPublicMaskSetCacheForTests();
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${bound.releasedId}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);

      const [won, lost] = await Promise.all([
        replaceExpansionRelease({ setId: SET, ...replaceBody }),
        replaceExpansionRelease({ setId: SET, ...replaceBody, memberKeys: firstKeys }),
      ]);
      const results = [won, lost];
      expect(results.filter((row) => row.ok && row.unchanged === false)).toHaveLength(1);
      expect(results.filter((row) => !row.ok && row.code === "release_manifest_mismatch")).toHaveLength(1);
      const committed = await activeManifest();
      expect(committed?.version).toBe(2);
      expect(committed?.memberCount).toBe(results.find((row) => row.ok)?.memberCount);
      const priorMembers = await db.select({ memberKey: expansionReleaseMembers.memberKey }).from(expansionReleaseMembers).where(eq(expansionReleaseMembers.manifestId, manifestId));
      expect(priorMembers).toHaveLength(35);
      resetPublicMaskSetCacheForTests();
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${bound.releasedId}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);
      const extraAfterRace = await fetch(`${base}/api/cards/${extraId}/masked-image`);
      if (committed?.memberCount === 36) expect(Buffer.from(await extraAfterRace.arrayBuffer())).toEqual(extra.native);
      else expect(extraAfterRace.status).toBe(404);

      const nextVersion = (committed?.version ?? 1) + 1;
      const identical = {
        setId: SET, ...replaceBody, expectedManifestId: committed!.id, version: nextVersion,
      };
      const [firstCopy, secondCopy] = await Promise.all([
        replaceExpansionRelease(identical),
        replaceExpansionRelease(identical),
      ]);
      expect([firstCopy, secondCopy].every((row) => row.ok)).toBe(true);
      expect([firstCopy, secondCopy].filter((row) => row.ok && row.unchanged === false)).toHaveLength(1);
      const live = await activeManifest();
      expect(live?.memberCount).toBe(36);
      const replay = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        ...replaceBody,
        expectedManifestId: manifestId,
        version: live!.version,
      });
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({ releaseAuthorized: true, unchanged: true, manifestId: live!.id, memberCount: 36 });
      const [again, removal] = await Promise.all([
        replaceExpansionRelease({ setId: SET, ...replaceBody, expectedManifestId: live!.id, version: live!.version + 1 }),
        replaceExpansionRelease({ setId: SET, ...replaceBody, expectedManifestId: live!.id, version: live!.version + 1, memberKeys: firstKeys }),
      ]);
      expect([again, removal].some((row) => !row.ok && (row.code === "release_member_removed" || row.code === "release_manifest_mismatch"))).toBe(true);
      const finalManifest = await activeManifest();
      expect(finalManifest?.memberCount).toBe(36);
      const finalMembers = await db.select({ memberKey: expansionReleaseMembers.memberKey }).from(expansionReleaseMembers).where(eq(expansionReleaseMembers.manifestId, finalManifest!.id));
      expect(new Set(finalMembers.map((row) => row.memberKey))).toEqual(new Set(allKeys));
      resetPublicMaskSetCacheForTests();
      expect((await detail()).body.cardCount).toBe(36);
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${bound.releasedId}/masked-image`)).arrayBuffer())).toEqual(cards[0]!.native);
      expect(Buffer.from(await (await fetch(`${base}/api/cards/${extraId}/masked-image`)).arrayBuffer())).toEqual(extra.native);
      expect((await storage.getRandomCardsFromSet(SET, 40)).map((card) => card.id)).toContain(extraId);
      const [cohortRow] = await db.select({ membershipSha256: discoveryCohorts.membershipSha256, originalCount: discoveryCohorts.originalCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
      expect(cohortRow).toEqual({ membershipSha256, originalCount: 36 });
    } finally {
      setReplaceReleaseAfterRevokeForTests(null);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      setWarmMaskDirForTests(null);
      resetSchemaGateForTests();
      if (previousCache === undefined) delete process.env.SET_COVER_CACHE;
      else process.env.SET_COVER_CACHE = previousCache;
      clearSetCoverCaches();
      await rm(path.join(MASKED_CARDS_DIR, "replace-boot"), { recursive: true, force: true });
      await rm(path.join(MASKED_CARDS_DIR, `${bound.releasedId}_${CURRENT_MASK_VERSION}.jpg`), { force: true });
      await rm(path.join(MASKED_CARDS_DIR, `${bound.releasedId}_${CURRENT_MASK_VERSION}.ok`), { force: true });
    }
  }, 180000);
});
