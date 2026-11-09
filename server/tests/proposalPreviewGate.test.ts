/**
 * Proposal ids and stored opaque bytes are readable by the QA token.
 * Public mask and set routes stay closed until an explicit release.
 */
import { createHash } from "crypto";
import express from "express";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const { db } = await import("../db");
const {
  designPoolSubmissions,
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
const { maskTokenMatches, maskedPlayPath } = await import("../services/playImageToken");
const { cachedCoverCardIds, clearLastGoodCoversForTests, clearReadyCoverIndexForTests, clearSetCoverCaches, handlePublicSetCover, setCoverWarmReadyForTests, warmSetCoverCache } = await import("../services/setCovers");
const { PER_CARD_RENDERER_IDS } = await import("../services/baseballExpansion/perCardRelease");
const { CURRENT_MASK_VERSION } = await import("@shared/maskGeometry");
const { isHeldSet } = await import("../config/heldSets");
const { getMaskedImagePath, resetMaskBakeForTests } = await import("../masking/maskingService");
const { MASKED_CARDS_DIR } = await import("../masking/maskPlanStore");
const { releasedExpansionCoverIds } = await import("../services/baseballExpansion/perCardRelease");
const { handlePublicSetDetail } = await import("../services/publicSets");
const { isDaily5ExpansionBlocked } = await import("../services/baseballExpansion/registry");
const { UD_1991_DISCOVERY } = await import("../services/baseballExpansion/discoveryCohort");

const SET = "49e656e0-3762-5113-82b5-1480f1c77541";
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
  await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, SET));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
  const provenance = await db.select({ id: discoveryImportProvenance.playableCardId }).from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  for (const row of provenance) await db.delete(playableCards).where(eq(playableCards.id, row.id));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, SET));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, SET));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
}

describe("proposal id and opaque preview", () => {
  const previous = process.env.COVER_QA_TOKEN;
  let base = "";
  let server: ReturnType<typeof createServer> | null = null;

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await resetSet();
  });

  it("walks acceptance, proposal id, output approval, held preview, then explicit release", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    resetMaskBakeForTests();
    await resetSet();
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Fleer", year: 1991, setName: "1991 Fleer Baseball",
      isActive: true, cardhedgeSetQuery: "1991 Fleer Baseball", cardhedgeCategory: "Baseball",
    });
    const cards = [];
    for (let n = 1; n <= 36; n += 1) {
      const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: n, g: 40, b: 80 } } }).jpeg().toBuffer();
      const digest = sha(jpeg);
      cards.push({
        n,
        jpeg,
        digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `preview-gate-${n}`,
        native: Buffer.from(`native-${n}-${digest.slice(0, 8)}`),
        preview: Buffer.from(`preview-${n}-${digest.slice(0, 8)}`),
      });
    }
    const bound = { releasedId: "", heldId: "" };
    const app = express();
    app.use(express.json({ limit: "2mb" }));
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
        resolveMask: async (scope, sessionId, index, token) => {
          if (scope !== "solo" && scope !== "d5" && scope !== "ad5" && scope !== "match") return null;
          if (bound.releasedId && maskTokenMatches(scope, sessionId, index, bound.releasedId, token)) return bound.releasedId;
          if (bound.heldId && maskTokenMatches(scope, sessionId, index, bound.heldId, token)) return bound.heldId;
          return null;
        },
        sendUnmasked: async (response) => { response.status(500).end(); },
        sendMasked: sendMaskedCard,
      });
    });
    app.get("/api/play/r/:scope/:sessionId/:index/:exp/:token", (req, res) => {
      void handleRevealToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: async () => ({ ok: false, reason: "bad" }),
        resolveMask: async () => null,
        sendUnmasked: async (response) => { response.status(500).end(); },
        sendMasked: sendMaskedCard,
      });
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "content-type": "application/json", "x-qa-token": TOKEN };
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const closed = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals`);
    expect(closed.status).toBe(404);

    const cohort = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort`, {
      artifactSha256: "ab".repeat(32),
      members: cards.map((card) => ({
        memberKey: card.memberKey,
        ordinal: card.n,
        cardNumber: String(card.n),
        supplierId: card.supplierId,
        originalSha256: card.digest,
        originalWidth: 40,
        originalHeight: 60,
        originalBytes: card.jpeg.length,
        disposition: "pass-candidate",
        routing: "ordinary-canonical-candidate",
      })),
    });
    expect(cohort.status).toBe(200);
    const membershipSha256 = String(cohort.body.membershipSha256);
    const proposalIds: string[] = [];
    const acceptanceIds: string[] = [];
    for (const card of cards) {
      const staged = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: card.supplierId,
        imageBase64: card.jpeg.toString("base64"),
      });
      expect(staged.status).toBe(200);
      const imported = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: card.supplierId,
        imageUrl: `https://cdn.bubble.io/preview-gate/${card.n}.jpg`,
        player: "Synthetic Player",
      });
      expect(imported.status).toBe(200);
      const proposal = await post(`/api/qa/baseball-expansion/${SET}/geometry-proposals`, {
        memberKey: card.memberKey,
        supplierId: card.supplierId,
        sourceSha256: card.digest,
        width: 40,
        height: 60,
        geometryVersion: "plate-polygon-v1",
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
      });
      expect(proposal.status).toBe(200);
      expect(proposal.body).toMatchObject({ ok: true, approval: false, usable: true, releaseAuthorized: false, profileApproved: false });
      expect(typeof proposal.body.id).toBe("string");
      proposalIds.push(String(proposal.body.id));
      const accepted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/source-acceptance`, {
        memberKey: card.memberKey,
        sourceSha256: card.digest,
        evidenceRef: "evidence-preview-gate",
        acceptedBy: "reviewer",
      });
      expect(accepted.status).toBe(200);
      acceptanceIds.push(String(accepted.body.id));
      const approved = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/output-approval`, {
        memberKey: card.memberKey,
        acceptanceId: accepted.body.id,
        proposalId: proposal.body.id,
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
        rendererId: RENDERER,
        nativeBase64: card.native.toString("base64"),
        preview300Base64: card.preview.toString("base64"),
        nativeSha256: sha(card.native),
        preview300Sha256: sha(card.preview),
        evidenceRef: "evidence-preview-gate",
        approvedBy: "reviewer",
      });
      expect(approved.status).toBe(200);
      expect(approved.body.releaseAuthorized).toBe(false);
    }
    const listed = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals`, { headers });
    const listBody = await listed.json() as { releaseAuthorized: boolean; approval: boolean; proposals: Array<{ id: string; memberKey: string }> };
    expect(listed.status).toBe(200);
    expect(listBody.releaseAuthorized).toBe(false);
    expect(listBody.approval).toBe(false);
    expect(listBody.proposals.map((row) => row.id)).toEqual(proposalIds);
    const one = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals?memberKey=${encodeURIComponent(cards[0]!.memberKey)}`, { headers });
    const oneBody = await one.json() as { proposals: Array<{ id: string }> };
    expect(oneBody.proposals).toHaveLength(1);
    expect(oneBody.proposals[0]).toMatchObject({ id: proposalIds[0], memberKey: cards[0]!.memberKey, usable: true, approval: false });

    const native = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(native.status).toBe(200);
    expect(native.headers.get("x-release-authorized")).toBe("false");
    expect(native.headers.get("x-serve-cleared")).toBe("false");
    expect(native.headers.get("x-content-sha256")).toBe(sha(cards[0]!.native));
    expect(Buffer.from(await native.arrayBuffer())).toEqual(cards[0]!.native);
    const preview = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/preview300`, { headers });
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(cards[0]!.preview);
    const [playable] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[0]!.memberKey));
    bound.releasedId = playable!.id!;
    resetPublicMaskSetCacheForTests();
    const earlyMask = await fetch(`${base}/api/cards/${playable!.id}/masked-image`);
    expect(earlyMask.status).toBe(404);
    expect(await earlyMask.json()).toMatchObject({ error: "Masked image not found" });
    const earlyCover = await fetch(`${base}/api/sets/${SET}/covers/0`);
    expect(earlyCover.status).toBe(404);
    const reveal = await fetch(`${base}/api/play/r/solo/sess/0/999/not-a-token`);
    expect(reveal.status).toBe(403);
    expect(await getMaskedImagePath(playable!.id!)).toBeNull();
    const heldDetail = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, heldDetail.res as never);
    expect(heldDetail.status).toBe(404);
    expect(isHeldSet(SET)).toBe(true);
    expect(isDaily5ExpansionBlocked(SET)).toBe(true);

    for (const card of cards) {
      const cleared = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/serve-clearance`, {
        memberKey: card.memberKey,
        outputApprovalId: (await db.select({ id: expansionOutputApprovals.id }).from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, card.memberKey)))[0]!.id,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.releaseAuthorized).toBe(false);
    }
    expect(await getMaskedImagePath(playable!.id!)).toBeNull();
    const stillHeld = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, stillHeld.res as never);
    expect(stillHeld.status).toBe(404);

    const released = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
      memberKeys: cards.slice(0, 35).map((card) => card.memberKey),
      version: 1,
      evidenceRef: "evidence-preview-gate",
      clearedBy: "reviewer",
      discoveryMembershipSha256: membershipSha256,
    });
    expect(released.status).toBe(200);
    expect(released.body.releaseAuthorized).toBe(true);
    expect(released.body.memberCount).toBe(35);
    const opened = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, opened.res as never);
    expect(opened.status).not.toBe(404);
    expect(isHeldSet(SET)).toBe(false);
    const servedName = await getMaskedImagePath(playable!.id!);
    expect(servedName).toBeTruthy();
    const [heldOut] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[35]!.memberKey));
    bound.heldId = heldOut!.id!;
    resetPublicMaskSetCacheForTests();
    expect(await getMaskedImagePath(heldOut!.id!)).toBeNull();
    const publicMask = await fetch(`${base}/api/cards/${playable!.id}/masked-image`);
    expect(publicMask.status).toBe(200);
    expect(publicMask.headers.get("content-type")).toContain("image/jpeg");
    expect(Buffer.from(await publicMask.arrayBuffer())).toEqual(cards[0]!.native);
    expect(await readFile(path.join(MASKED_CARDS_DIR, servedName!))).toEqual(cards[0]!.native);
    const staleCover = Buffer.from("stale-warm-cover-not-approved-jpeg");
    const staleName = `${playable!.id}_${CURRENT_MASK_VERSION}.jpg`;
    const staleMarker = `${playable!.id}_${CURRENT_MASK_VERSION}.ok`;
    await mkdir(MASKED_CARDS_DIR, { recursive: true });
    await writeFile(path.join(MASKED_CARDS_DIR, staleName), staleCover);
    await writeFile(path.join(MASKED_CARDS_DIR, staleMarker), "ok\n");
    const previousCoverCache = process.env.SET_COVER_CACHE;
    process.env.SET_COVER_CACHE = "1";
    try {
    clearSetCoverCaches();
    clearReadyCoverIndexForTests();
    clearLastGoodCoversForTests();
    setCoverWarmReadyForTests(true);
    const filesBeforeCovers = new Set(await readdir(MASKED_CARDS_DIR).catch(() => [] as string[]));
    const play = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "sess-release", index: 0, cardId: playable!.id! })}`);
    expect(play.status).toBe(200);
    expect(Buffer.from(await play.arrayBuffer())).toEqual(cards[0]!.native);
    await warmSetCoverCache();
    const primedCovers = await cachedCoverCardIds(SET);
    expect(process.env.SET_COVER_CACHE).toBe("1");
    expect(primedCovers[0]).toBe(playable!.id);
    let openEtag = "";
    for (const slot of [0, 1, 2]) {
      const cover = await fetch(`${base}/api/sets/${SET}/covers/${slot}`);
      expect(cover.status).toBe(200);
      expect(cover.headers.get("content-type")).toContain("image/jpeg");
      expect(cover.headers.get("x-card-id")).toBeNull();
      const body = Buffer.from(await cover.arrayBuffer());
      expect(body).toEqual(cards[slot]!.native);
      expect(body.equals(staleCover)).toBe(false);
      if (slot === 0) openEtag = cover.headers.get("etag") ?? "";
    }
    expect(openEtag).not.toBe("");
    const fresh304 = await fetch(`${base}/api/sets/${SET}/covers/0`, { headers: { "if-none-match": openEtag } });
    expect(fresh304.status).toBe(304);
    expect(await cachedCoverCardIds(SET)).toBe(primedCovers);
    const createdByCovers = (await readdir(MASKED_CARDS_DIR).catch(() => [] as string[])).filter((name) => !filesBeforeCovers.has(name) && !name.endsWith(".ok"));
    expect(createdByCovers).toEqual([]);
    const hidden = await fetch(`${base}/api/cards/${heldOut!.id}/masked-image`);
    expect(hidden.status).toBe(404);
    expect(Buffer.from(await hidden.arrayBuffer()).equals(cards[35]!.native)).toBe(false);
    const hiddenPlay = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "sess-held", index: 0, cardId: heldOut!.id! })}`);
    expect(hiddenPlay.status).toBe(404);
    const revealAfter = await fetch(`${base}/api/play/r/solo/sess/0/999/not-a-token`);
    expect(revealAfter.status).toBe(403);
    const releasedNative = cards[0]!.native;
    const releasedKey = cards[0]!.memberKey;
    const releasedId = playable!.id!;
    const expectClosed = async (label: string) => {
      resetPublicMaskSetCacheForTests();
      const mask = await fetch(`${base}/api/cards/${releasedId}/masked-image`);
      expect(mask.status, label).toBe(404);
      expect(Buffer.from(await mask.arrayBuffer()).equals(releasedNative), label).toBe(false);
      const played = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "sess-release", index: 0, cardId: releasedId })}`);
      expect(played.status, label).toBe(404);
      expect(await cachedCoverCardIds(SET), label).toBe(primedCovers);
      for (let slot = 0; slot < 8; slot += 1) {
        const cover = await fetch(`${base}/api/sets/${SET}/covers/${slot}`, { headers: { "if-none-match": openEtag } });
        expect(cover.status, label).not.toBe(304);
        if (cover.status !== 200) {
          expect(cover.status, label).toBe(404);
          continue;
        }
        const body = Buffer.from(await cover.arrayBuffer());
        expect(body.equals(releasedNative), `${label} cover ${slot}`).toBe(false);
        expect(body.equals(staleCover), `${label} stale ${slot}`).toBe(false);
      }
    };
    const reopened = async () => {
      resetPublicMaskSetCacheForTests();
      const mask = await fetch(`${base}/api/cards/${releasedId}/masked-image`);
      expect(mask.status).toBe(200);
      expect(Buffer.from(await mask.arrayBuffer())).toEqual(releasedNative);
      const cover = await fetch(`${base}/api/sets/${SET}/covers/0`);
      expect(cover.status).toBe(200);
      const coverBody = Buffer.from(await cover.arrayBuffer());
      expect(coverBody).toEqual(releasedNative);
      expect(coverBody.equals(staleCover)).toBe(false);
    };
    const [serveRow] = await db.select().from(expansionServeClearances).where(eq(expansionServeClearances.memberKey, releasedKey));
    await db.delete(expansionServeClearances).where(eq(expansionServeClearances.id, serveRow!.id));
    try { await expectClosed("serve clearance"); } finally { await db.insert(expansionServeClearances).values(serveRow!); }
    await reopened();
    const [acceptance] = await db.select().from(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.memberKey, releasedKey));
    await db.update(expansionSourceAcceptances).set({ sourceSha256: "ab".repeat(32) }).where(eq(expansionSourceAcceptances.id, acceptance!.id));
    try { await expectClosed("source acceptance"); } finally { await db.update(expansionSourceAcceptances).set({ sourceSha256: acceptance!.sourceSha256 }).where(eq(expansionSourceAcceptances.id, acceptance!.id)); }
    await reopened();
    const [provenance] = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.memberKey, releasedKey));
    await db.update(discoveryImportProvenance).set({ sha256: "cd".repeat(32) }).where(eq(discoveryImportProvenance.playableCardId, provenance!.playableCardId));
    try { await expectClosed("provenance"); } finally { await db.update(discoveryImportProvenance).set({ sha256: provenance!.sha256 }).where(eq(discoveryImportProvenance.playableCardId, provenance!.playableCardId)); }
    await reopened();
    await db.update(playableCards).set({ isPlayable: false }).where(eq(playableCards.id, releasedId));
    try { await expectClosed("playable"); } finally { await db.update(playableCards).set({ isPlayable: true }).where(eq(playableCards.id, releasedId)); }
    await reopened();
    const [playableRow] = await db.select({ imageUrl: playableCards.imageUrl }).from(playableCards).where(eq(playableCards.id, releasedId));
    await db.update(playableCards).set({ imageUrl: "http://cdn.bubble.io/not-https.jpg" }).where(eq(playableCards.id, releasedId));
    try { await expectClosed("source url"); } finally { await db.update(playableCards).set({ imageUrl: playableRow!.imageUrl }).where(eq(playableCards.id, releasedId)); }
    await reopened();
    const [output] = await db.select().from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, releasedKey));
    await db.update(expansionOutputApprovals).set({ rendererId: `renderMeasuredProposal@${"f".repeat(40)}` }).where(eq(expansionOutputApprovals.id, output!.id));
    try { await expectClosed("renderer"); } finally { await db.update(expansionOutputApprovals).set({ rendererId: output!.rendererId }).where(eq(expansionOutputApprovals.id, output!.id)); }
    await reopened();
    await db.update(expansionOutputApprovals).set({ geometryVersion: "not-a-plate" }).where(eq(expansionOutputApprovals.id, output!.id));
    try { await expectClosed("geometry"); } finally { await db.update(expansionOutputApprovals).set({ geometryVersion: output!.geometryVersion }).where(eq(expansionOutputApprovals.id, output!.id)); }
    await reopened();
    await db.update(expansionOutputApprovals).set({ polygonSha256: "ef".repeat(32) }).where(eq(expansionOutputApprovals.id, output!.id));
    try { await expectClosed("polygon"); } finally { await db.update(expansionOutputApprovals).set({ polygonSha256: output!.polygonSha256 }).where(eq(expansionOutputApprovals.id, output!.id)); }
    await reopened();
    await db.update(expansionOutputApprovals).set({ acceptanceId: acceptanceIds[1] }).where(eq(expansionOutputApprovals.id, output!.id));
    try { await expectClosed("acceptance binding"); } finally { await db.update(expansionOutputApprovals).set({ acceptanceId: output!.acceptanceId }).where(eq(expansionOutputApprovals.id, output!.id)); }
    await reopened();
    await db.update(expansionOutputApprovals).set({ nativeSha256: "aa".repeat(32) }).where(eq(expansionOutputApprovals.id, output!.id));
    try { await expectClosed("output hash"); } finally { await db.update(expansionOutputApprovals).set({ nativeSha256: output!.nativeSha256 }).where(eq(expansionOutputApprovals.id, output!.id)); }
    await reopened();
    const [manifestMember] = await db.select().from(expansionReleaseMembers).where(eq(expansionReleaseMembers.memberKey, releasedKey));
    await db.update(expansionReleaseMembers).set({ nativeSha256: "bb".repeat(32) }).where(eq(expansionReleaseMembers.memberKey, releasedKey));
    try { await expectClosed("manifest hash"); } finally { await db.update(expansionReleaseMembers).set({ nativeSha256: manifestMember!.nativeSha256 }).where(eq(expansionReleaseMembers.memberKey, releasedKey)); }
    await reopened();
    await db.update(discoveryCohortMembers).set({ disposition: "hold" }).where(eq(discoveryCohortMembers.memberKey, releasedKey));
    try { await expectClosed("disposition"); } finally { await db.update(discoveryCohortMembers).set({ disposition: "pass-candidate" }).where(eq(discoveryCohortMembers.memberKey, releasedKey)); }
    await reopened();
    const after = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(after.headers.get("x-release-authorized")).toBe("false");
    expect(after.headers.get("x-serve-cleared")).toBe("false");
    await db.update(expansionOutputApprovals).set({ nativeSha256: "aa".repeat(32) }).where(eq(expansionOutputApprovals.memberKey, cards[35]!.memberKey));
    const drifted = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[35]!.memberKey)}/native`, { headers });
    expect(drifted.status).toBe(409);
    const driftedBody = await drifted.json() as { code: string; releaseAuthorized: boolean };
    expect(driftedBody).toMatchObject({ ok: false, code: "output_hash_mismatch", releaseAuthorized: false });
    const driftedPublic = await fetch(`${base}/api/cards/${heldOut!.id}/masked-image`);
    expect(driftedPublic.status).toBe(404);
    expect(Buffer.from(await driftedPublic.arrayBuffer()).equals(cards[35]!.native)).toBe(false);
    await db.delete(expansionServeClearances).where(eq(expansionServeClearances.memberKey, cards[10]!.memberKey));
    await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, cards[10]!.memberKey));
    const [unapproved] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[10]!.memberKey));
    resetPublicMaskSetCacheForTests();
    const unapprovedMask = await fetch(`${base}/api/cards/${unapproved!.id}/masked-image`);
    expect(unapprovedMask.status).toBe(404);
    expect(Buffer.from(await unapprovedMask.arrayBuffer()).equals(cards[10]!.native)).toBe(false);
    expect(await releasedExpansionCoverIds(UD_1991_DISCOVERY.setId)).toEqual([]);
    const udCover = await fetch(`${base}/api/sets/${UD_1991_DISCOVERY.setId}/covers/0`);
    expect(udCover.status).toBe(404);
    expect(acceptanceIds).toHaveLength(36);
    const stopped = await fetch(`${base}/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/geometry-proposals`, { headers });
    expect(stopped.status).toBe(409);
    expect(await stopped.json()).toMatchObject({ ok: false, code: "ud_stopped" });
    const stoppedPreview = await fetch(`${base}/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(stoppedPreview.status).toBe(409);
    expect(await stoppedPreview.json()).toMatchObject({ ok: false, code: "ud_stopped", releaseAuthorized: false });
    } finally {
      if (previousCoverCache === undefined) delete process.env.SET_COVER_CACHE;
      else process.env.SET_COVER_CACHE = previousCoverCache;
      clearSetCoverCaches();
      clearReadyCoverIndexForTests();
      clearLastGoodCoversForTests();
      setCoverWarmReadyForTests(false);
      await rm(path.join(MASKED_CARDS_DIR, staleName), { force: true });
      await rm(path.join(MASKED_CARDS_DIR, staleMarker), { force: true });
    }
  }, 180000);
});

function capture(): { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } {
  const box: { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } = {
    res: {
      headersSent: false,
      status(code: number) { box.status = code; return box.res; },
      json() { box.res.headersSent = true; return box.res; },
      setHeader() { return box.res; },
      removeHeader() { return box.res; },
      end() { box.res.headersSent = true; return box.res; },
    },
  };
  return box;
}
