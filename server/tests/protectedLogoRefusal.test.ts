/**
 * The 1986 Fleer logo stop is an exact member, not an ordinal.
 * A pass-candidate and a later hold review both stay closed.
 */
import { createHash, randomUUID } from "crypto";
import express from "express";
import { mkdir, rm, writeFile } from "fs/promises";
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
const { rejectPublicMask } = await import("../services/publicMaskGate");
const { handleMaskedToken, handleRevealToken } = await import("../services/playImageHttp");
const { sendMaskedCard, sendUnmaskedCard } = await import("../services/playImageSend");
const { handlePublicSetCover } = await import("../services/setCovers");
const { maskTokenMatches, maskedPlayPath, revealPlayPath } = await import("../services/playImageToken");
const { MASKED_CARDS_DIR } = await import("../masking/maskPlanStore");
const { CURRENT_MASK_VERSION } = await import("@shared/maskGeometry");
const { PER_CARD_RENDERER_IDS } = await import("../services/baseballExpansion/perCardRelease");
const { readBoundSourceState, UD_1991_DISCOVERY } = await import("../services/baseballExpansion/discoveryCohort");
const { PROTECTED_LOGO_CODE, PROTECTED_LOGO_MEMBER } = await import("../services/baseballExpansion/protectedIdentity");

const SET = PROTECTED_LOGO_MEMBER.setId;
const OTHER = "f690058c-3bde-51d4-a4e5-057b5d45478a";
const TOKEN = "proposal-preview-token";
const STOP = PROTECTED_LOGO_CODE;

function sha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function reset(setId: string): Promise<void> {
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
  await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, setId));
}

describe("protected logo identity refusal", () => {
  const previousToken = process.env.COVER_QA_TOKEN;
  const previousCover = process.env.SET_COVER_CACHE;
  const warmNames: string[] = [];

  afterAll(async () => {
    if (previousToken === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previousToken;
    if (previousCover === undefined) delete process.env.SET_COVER_CACHE;
    else process.env.SET_COVER_CACHE = previousCover;
    for (const name of warmNames) await rm(path.join(MASKED_CARDS_DIR, name), { force: true });
    await reset(SET);
    await reset(OTHER);
  });

  it("refuses the exact pass-candidate and a hold review, and leaves every other identity open", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    await reset(SET);
    await reset(OTHER);
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Fleer", year: 1986, setName: "1986 Fleer Baseball",
      isActive: true, cardhedgeSetQuery: "1986 Fleer Baseball", cardhedgeCategory: "Baseball",
    });
    await insertIntegratedGameSet({
      id: OTHER, sport: "baseball", brand: "Donruss", year: 1988, setName: "1988 Donruss Baseball",
      isActive: true, cardhedgeSetQuery: "1988 Donruss Baseball", cardhedgeCategory: "Baseball",
    });
    const controlJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 9, g: 20, b: 30 } } }).jpeg().toBuffer();
    const controlSha = sha(controlJpeg);
    const control = {
      memberKey: `candidate-0001|${controlSha}`,
      ordinal: 1,
      cardNumber: "1",
      supplierId: "logo-control-1",
      originalSha256: controlSha,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: controlJpeg.length,
    };
    const controls = [control];
    for (let n = 2; n <= 35; n += 1) {
      const digest = sha(`logo-control-${n}`);
      controls.push({
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        ordinal: n,
        cardNumber: String(n),
        supplierId: `logo-control-${n}`,
        originalSha256: digest,
        originalWidth: 40,
        originalHeight: 60,
        originalBytes: 40,
      });
    }
    const otherJpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 4, g: 4, b: 4 } } }).jpeg().toBuffer();
    const otherSha = sha(otherJpeg);
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerDiscoveryCohortRoutes(app);
    const bound = { cardId: "" };
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
          if (!bound.cardId || !maskTokenMatches(scope as "solo", sessionId, index, bound.cardId, token)) return null;
          return bound.cardId;
        },
        sendUnmasked: sendUnmaskedCard,
        sendMasked: sendMaskedCard,
      });
    });
    app.get("/api/play/r/:scope/:sessionId/:index/:exp/:token", (req, res) => {
      void handleRevealToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: async (_req, scope, sessionId, index, _exp, token) => {
          const path = revealPlayPath({ scope: "solo", sessionId: "sess-stop", index: 0, cardId: bound.cardId, binder: "stop" });
          const issued = path.split("/").pop();
          if (scope === "solo" && sessionId === "sess-stop" && index === 0 && token === issued) return { ok: true, cardId: bound.cardId };
          return { ok: false, reason: "bad" };
        },
        resolveMask: async () => null,
        sendUnmasked: sendUnmaskedCard,
        sendMasked: sendMaskedCard,
      });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (urlPath: string, body: unknown, token = TOKEN) => {
      const response = await fetch(`${base}${urlPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": token },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
    };
    try {
      const cohort = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort`, {
        artifactSha256: "cd".repeat(32),
        members: [
          ...controls.map((card) => ({ ...card, disposition: "pass-candidate", routing: "ordinary-canonical-candidate" })),
          {
            memberKey: PROTECTED_LOGO_MEMBER.memberKey,
            ordinal: 44,
            cardNumber: "53",
            supplierId: PROTECTED_LOGO_MEMBER.supplierId,
            originalSha256: PROTECTED_LOGO_MEMBER.sourceSha256,
            originalWidth: PROTECTED_LOGO_MEMBER.width,
            originalHeight: PROTECTED_LOGO_MEMBER.height,
            originalBytes: PROTECTED_LOGO_MEMBER.originalBytes,
            disposition: "pass-candidate",
            routing: "ordinary-canonical-candidate",
          },
        ],
      });
      expect(cohort.status).toBe(200);
      const membershipSha256 = String(cohort.body.membershipSha256);
      expect(cohort.body.originalCount).toBe(36);
      const other = await post(`/api/qa/baseball-expansion/${OTHER}/discovery-cohort`, {
        artifactSha256: "ab".repeat(32),
        members: [{
          memberKey: `candidate-0044|${otherSha}`,
          ordinal: 44,
          cardNumber: "44",
          supplierId: "other-ordinal-44",
          originalSha256: otherSha,
          originalWidth: 40,
          originalHeight: 60,
          originalBytes: otherJpeg.length,
          disposition: "pass-candidate",
          routing: "ordinary-canonical-candidate",
        }],
      });
      expect(other.status).toBe(200);
      const otherStage = await post(`/api/qa/baseball-expansion/${OTHER}/discovery-cohort/stage`, {
        supplierId: "other-ordinal-44", imageBase64: otherJpeg.toString("base64"),
      });
      expect(otherStage.status).toBe(200);

      const opened = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: control.supplierId, imageBase64: controlJpeg.toString("base64"),
      });
      expect(opened.status).toBe(200);
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: control.supplierId, imageUrl: "https://cdn.bubble.io/logo-control.jpg", player: "Synthetic Player",
      })).status).toBe(200);

      const stoppedHost = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: PROTECTED_LOGO_MEMBER.supplierId,
        imageUrl: "https://nkzgyskcdwthqgdvrnak.supabase.co/candidate-0044",
        player: "Synthetic Player",
      });
      expect(stoppedHost.body.code).toBe("protected_logo_under_paint");
      const stoppedStage = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: PROTECTED_LOGO_MEMBER.supplierId, imageBase64: controlJpeg.toString("base64"),
      });
      expect(stoppedStage.status).toBe(409);
      expect(stoppedStage.body.code).toBe(STOP);
      const reviewBody = {
        memberKey: PROTECTED_LOGO_MEMBER.memberKey,
        supplierId: PROTECTED_LOGO_MEMBER.supplierId,
        sourceSha256: PROTECTED_LOGO_MEMBER.sourceSha256,
        width: PROTECTED_LOGO_MEMBER.width,
        height: PROTECTED_LOGO_MEMBER.height,
        originalBytes: PROTECTED_LOGO_MEMBER.originalBytes,
        evidenceRef: "evidence-preview-gate",
        reviewedBy: "reviewer",
        expectedRevision: 0,
      };
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, reviewBody)).body.code).toBe(STOP);
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: PROTECTED_LOGO_MEMBER.supplierId, imageUrl: "https://cdn.bubble.io/logo-stop.jpg", player: "Synthetic Player",
      })).body.code).toBe(STOP);
      for (const path of ["source-acceptance", "output-approval", "serve-clearance"] as const) {
        const body = path === "source-acceptance"
          ? { memberKey: PROTECTED_LOGO_MEMBER.memberKey, sourceSha256: PROTECTED_LOGO_MEMBER.sourceSha256, evidenceRef: "evidence-preview-gate", acceptedBy: "reviewer" }
          : path === "output-approval"
            ? { memberKey: PROTECTED_LOGO_MEMBER.memberKey, acceptanceId: randomUUID(), proposalId: randomUUID(), polygonPixels: [[1, 1]], polygonNormalized: [[0, 0]], rendererId: PER_CARD_RENDERER_IDS[1], nativeBase64: "aa", preview300Base64: "bb", nativeSha256: "ab".repeat(32), preview300Sha256: "cd".repeat(32), evidenceRef: "evidence-preview-gate", approvedBy: "reviewer" }
            : { memberKey: PROTECTED_LOGO_MEMBER.memberKey, outputApprovalId: randomUUID(), evidenceRef: "evidence-preview-gate", clearedBy: "reviewer" };
        expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/${path}`, body)).body.code).toBe(STOP);
      }
      const released = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
        memberKeys: [PROTECTED_LOGO_MEMBER.memberKey, ...controls.map((card) => card.memberKey)],
        version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(released.body.code).toBe(STOP);
      const ordinary = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
        memberKeys: controls.map((card) => card.memberKey),
        version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(ordinary.body.code).not.toBe(STOP);
      expect(ordinary.body.releaseAuthorized).not.toBe(true);

      const [manifest] = await db.insert(expansionReleaseManifests).values({
        setId: SET, version: 1, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer",
        memberCount: 35, releasedMembershipSha256: "ab".repeat(32), discoveryMembershipSha256: membershipSha256,
      }).returning({ id: expansionReleaseManifests.id });
      await db.insert(expansionReleaseMembers).values(controls.map((card) => ({
        manifestId: manifest!.id, memberKey: card.memberKey, setId: SET, sourceSha256: card.originalSha256,
        nativeSha256: "11".repeat(32), preview300Sha256: "22".repeat(32), polygonSha256: "33".repeat(32),
        rendererId: PER_CARD_RENDERER_IDS[1]!, proposalId: randomUUID(),
      })));
      const replaced = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance/replace`, {
        expectedManifestId: manifest!.id,
        memberKeys: [PROTECTED_LOGO_MEMBER.memberKey, ...controls.map((card) => card.memberKey)],
        version: 2, evidenceRef: "evidence-preview-gate", clearedBy: "reviewer", discoveryMembershipSha256: membershipSha256,
      });
      expect(replaced.body.code).toBe(STOP);
      const [active] = await db.select({ id: expansionReleaseManifests.id, revokedAt: expansionReleaseManifests.revokedAt }).from(expansionReleaseManifests).where(eq(expansionReleaseManifests.id, manifest!.id));
      expect(active?.revokedAt).toBeNull();
      const listed = await db.select({ memberKey: expansionReleaseMembers.memberKey }).from(expansionReleaseMembers).where(eq(expansionReleaseMembers.manifestId, manifest!.id));
      expect(listed.map((row) => row.memberKey)).not.toContain(PROTECTED_LOGO_MEMBER.memberKey);
      expect(listed).toHaveLength(35);

      const cardId = randomUUID();
      bound.cardId = cardId;
      const staged = Buffer.from("protected-source-image");
      const stagedSha = sha(staged);
      const warm = Buffer.from("warm-protected-jpeg-not-served");
      await db.insert(playableCards).values({
        id: cardId, gameSetId: SET, cardhedgeCardId: PROTECTED_LOGO_MEMBER.supplierId, player: "Synthetic Player",
        set: "1986 Fleer Baseball", number: "53", variant: "Base", imageUrl: "https://cdn.bubble.io/logo-stop.jpg",
        category: "Baseball", isPlayable: true,
      });
      await db.update(discoveryCohortMembers).set({ playableCardId: cardId }).where(eq(discoveryCohortMembers.memberKey, PROTECTED_LOGO_MEMBER.memberKey));
      await db.insert(discoveryImportProvenance).values({
        playableCardId: cardId, setId: SET, memberKey: PROTECTED_LOGO_MEMBER.memberKey,
        supplierId: PROTECTED_LOGO_MEMBER.supplierId, sha256: stagedSha, byteLength: staged.length,
      });
      await db.insert(discoverySourceStaging).values({
        setId: SET, supplierId: PROTECTED_LOGO_MEMBER.supplierId, sha256: stagedSha,
        width: PROTECTED_LOGO_MEMBER.width, height: PROTECTED_LOGO_MEMBER.height, bytes: staged.length, imageBytes: staged,
      });
      await mkdir(MASKED_CARDS_DIR, { recursive: true });
      const warmFile = `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
      const warmMark = `${cardId}_${CURRENT_MASK_VERSION}.ok`;
      warmNames.push(warmFile, warmMark);
      await writeFile(path.join(MASKED_CARDS_DIR, warmFile), warm);
      await writeFile(path.join(MASKED_CARDS_DIR, warmMark), "ok\n");
      process.env.SET_COVER_CACHE = "1";
      expect(await readBoundSourceState(cardId)).toMatchObject({ kind: "refused" });
      const mask = await fetch(`${base}/api/cards/${cardId}/masked-image`, { headers: { "if-none-match": "\"warm\"" } });
      const maskBody = Buffer.from(await mask.arrayBuffer());
      expect(mask.status).toBe(404);
      expect(maskBody).not.toEqual(warm);
      expect(maskBody).not.toEqual(staged);
      const play = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "sess-stop", index: 0, cardId })}`, { headers: { "if-none-match": "\"warm\"" } });
      expect(play.status).toBe(404);
      const reveal = await fetch(`${base}${revealPlayPath({ scope: "solo", sessionId: "sess-stop", index: 0, cardId, binder: "stop" })}`);
      expect(reveal.status).toBe(404);
      expect(Buffer.from(await reveal.arrayBuffer())).not.toEqual(staged);
      for (let slot = 0; slot < 8; slot += 1) {
        const cover = await fetch(`${base}/api/sets/${SET}/covers/${slot}`, { headers: { "if-none-match": "\"warm\"" } });
        const body = Buffer.from(await cover.arrayBuffer());
        expect(body).not.toEqual(warm);
        expect(body).not.toEqual(staged);
      }
      await rm(path.join(MASKED_CARDS_DIR, warmFile), { force: true });
      await rm(path.join(MASKED_CARDS_DIR, warmMark), { force: true });
      const stopped = await post(`/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/discovery-cohort/member-review`, reviewBody);
      expect(stopped.status).toBe(409);
      expect(stopped.body.code).toBe("ud_stopped");

      const [beforeHold] = await db.select({
        disposition: discoveryCohortMembers.disposition,
        hash: discoveryCohorts.membershipSha256,
        count: discoveryCohorts.originalCount,
      }).from(discoveryCohortMembers)
        .innerJoin(discoveryCohorts, eq(discoveryCohorts.setId, discoveryCohortMembers.setId))
        .where(eq(discoveryCohortMembers.memberKey, PROTECTED_LOGO_MEMBER.memberKey));
      expect(beforeHold).toEqual({ disposition: "pass-candidate", hash: membershipSha256, count: 36 });
      await db.update(discoveryCohortMembers).set({ disposition: "hold" }).where(eq(discoveryCohortMembers.memberKey, PROTECTED_LOGO_MEMBER.memberKey));
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/member-review`, reviewBody)).body.code).toBe(STOP);
      expect((await db.select().from(expansionMemberReviews).where(eq(expansionMemberReviews.memberKey, PROTECTED_LOGO_MEMBER.memberKey)))).toEqual([]);
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: PROTECTED_LOGO_MEMBER.supplierId, imageBase64: controlJpeg.toString("base64"),
      })).body.code).toBe(STOP);
      expect((await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: PROTECTED_LOGO_MEMBER.supplierId, imageUrl: "https://cdn.bubble.io/logo-stop.jpg", player: "Synthetic Player",
      })).body.code).toBe(STOP);
      expect((await fetch(`${base}/api/cards/${cardId}/masked-image`)).status).toBe(404);
      const [after] = await db.select({ hash: discoveryCohorts.membershipSha256, count: discoveryCohorts.originalCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
      expect(after).toEqual({ hash: membershipSha256, count: 36 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60000);
});
