/**
 * Held-prep evidence for all 16 missing baseball sets.
 * No source pool is required. REVIEW_READY is not exercised here as a release.
 */
import express from "express";
import type { AddressInfo } from "net";
import { createServer } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { cardhedgeImportRuns, designPoolSubmissions, discoveryAdditions, discoveryCohortMembers, discoveryCohorts, discoveryImportProvenance, discoverySourceRevisions, discoverySourceStaging, expansionOutputApprovals, expansionReleaseManifests, expansionReleaseMembers, expansionServeClearances, expansionSetClearanceAttempts, expansionSourceAcceptances, gameSets, geometryProposals, playableCards } from "@shared/schema";
import { CLEARED_SET_IDS, holdReasonForIdentity, isDesignApprovedSetId, isHeldSet, NO_MASK_PROFILE_REASON, refreshHeldSets } from "../config/heldSets";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { missingExpansionTargets } from "../services/baseballExpansion/registry";
import { insertIntegratedGameSet } from "../services/baseballExpansion/createIntegratedSet";
import { resolveDaily5SetForDate } from "../services/daily5SetPick";
import { publicMaskDenyReason, resetPublicMaskSetCacheForTests } from "../services/publicMaskGate";
import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSessionsTable } from "@shared/schema";
import { handlePublicSetDetail } from "../services/publicSets";
import { handlePublicSetCover } from "../services/setCovers";
import { registerDesignApprovalQaRoutes } from "../routes/designApprovalQa";
import { respondIfHeldGameStart } from "../routes/gameStartHeld";
import { handleMaskedToken } from "../services/playImageHttp";
import { sendMaskedCard } from "../services/playImageSend";
import { resolveMaskCard } from "../services/playImageAccess";
import { maskedPlayPath } from "../services/playImageToken";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";

const targets = missingExpansionTargets();
const ids = targets.map((target) => target.id);
const FALLBACK = "229f0379-aa56-40a8-abe3-1af217a397e8";
const TOKEN = "held-prep-evidence-token";
let base = "";
let server: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  process.env.COVER_QA_TOKEN = TOKEN;
  for (const target of targets) {
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
    const cardId = `00000000-0000-4000-8000-${target.id.slice(-12)}`;
    await db.insert(playableCards).values({
      id: cardId,
      gameSetId: target.id,
      cardhedgeCardId: `held-prep:${target.id}`,
      player: "Evidence Player",
      set: target.identity.setName,
      number: "1",
      variant: "Base",
      imageUrl: "https://img.example/evidence.jpg",
      category: "Baseball",
      isPlayable: true,
    }).onConflictDoNothing();
    await db.insert(gameSessionsTable).values({
      id: `session-${target.id}`,
      mode: "solo",
      questions: [{ card: { id: cardId, playableCardId: cardId } }],
      totalQuestions: 1,
      startedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    await mkdir(MASKED_CARDS_DIR, { recursive: true });
    const buf = Buffer.alloc(24);
    buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xc0;
    buf.writeUInt16BE(11, 4); buf[6] = 8; buf.writeUInt16BE(800, 7); buf.writeUInt16BE(600, 9);
    await writeFile(path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), buf);
    await writeFile(path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
  }
  await refreshHeldSets();
  resetPublicMaskSetCacheForTests();
  const app = express();
  app.use(express.json());
  app.get("/api/sets/:id", (req, res) => { void handlePublicSetDetail(req, res); });
  app.get("/api/sets/:setId/covers/:slot", (req, res) => { void handlePublicSetCover(req, res); });
  app.post("/api/game/start", (req, res) => { void respondIfHeldGameStart(req, res); });
  app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
    void handleMaskedToken(req, res, {
      authorizeCardId: async () => "denied",
      resolveReveal: async () => ({ ok: false, reason: "bad" }),
      resolveMask: resolveMaskCard,
      sendUnmasked: async (response) => { response.status(500).end(); },
      sendMasked: sendMaskedCard,
    });
  });
  registerDesignApprovalQaRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(gameSessionsTable).where(inArray(gameSessionsTable.id, targets.map((target) => `session-${target.id}`)));
  await db.delete(expansionReleaseMembers).where(inArray(expansionReleaseMembers.setId, ids));
  await db.delete(expansionReleaseManifests).where(inArray(expansionReleaseManifests.setId, ids));
  await db.delete(expansionServeClearances).where(inArray(expansionServeClearances.setId, ids));
  await db.delete(expansionOutputApprovals).where(inArray(expansionOutputApprovals.setId, ids));
  await db.delete(expansionSourceAcceptances).where(inArray(expansionSourceAcceptances.setId, ids));
  await db.delete(expansionSetClearanceAttempts).where(inArray(expansionSetClearanceAttempts.setId, ids));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(inArray(discoveryCohortMembers.setId, ids));
  await db.delete(discoveryImportProvenance).where(inArray(discoveryImportProvenance.setId, ids));
  await db.delete(geometryProposals).where(inArray(geometryProposals.setId, ids));
  await db.delete(discoverySourceStaging).where(inArray(discoverySourceStaging.setId, ids));
  await db.delete(discoveryAdditions).where(inArray(discoveryAdditions.setId, ids));
  const members = await db.select({ memberKey: discoveryCohortMembers.memberKey }).from(discoveryCohortMembers).where(inArray(discoveryCohortMembers.setId, ids));
  for (const member of members) await db.delete(discoverySourceRevisions).where(eq(discoverySourceRevisions.memberKey, member.memberKey));
  await db.delete(discoveryCohortMembers).where(inArray(discoveryCohortMembers.setId, ids));
  await db.delete(discoveryCohorts).where(inArray(discoveryCohorts.setId, ids));
  await db.delete(cardhedgeImportRuns).where(inArray(cardhedgeImportRuns.gameSetId, ids));
  await db.delete(designPoolSubmissions).where(inArray(designPoolSubmissions.setId, ids));
  await db.delete(playableCards).where(inArray(playableCards.gameSetId, ids));
  await db.delete(gameSets).where(inArray(gameSets.id, ids));
  await refreshHeldSets();
  if (process.env.COVER_QA_TOKEN === TOKEN) delete process.env.COVER_QA_TOKEN;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("16 missing sets stay held and unreachable", () => {
  it("wires the production game-start and play-mask routes", () => {
    const source = readFileSync(path.join(__dirname, "../routes.ts"), "utf8");
    expect(source).toContain("if (await respondIfHeldGameStart(req, res)) return;");
    expect(source).toContain("await handleMaskedToken(req, res, playImageDeps)");
  });

  it("has no clearance, no approved profile, and no fallback mask", () => {
    expect(targets).toHaveLength(16);
    for (const target of targets) {
      const identity = { id: target.id, ...target.identity, isActive: true, isUserCreated: false };
      expect(holdReasonForIdentity(identity)).toBe(NO_MASK_PROFILE_REASON);
      expect(CLEARED_SET_IDS).not.toContain(target.id);
      expect(isDesignApprovedSetId(target.id)).toBe(false);
      expect(isHeldSet(target.id)).toBe(true);
      const profile = getMaskProfile(target.identity.setName, target.id);
      expect(profile.matched).toBe(false);
      expect(profile.id).toBe("default");
      expect(profile.id).not.toBe("1989-upper-deck");
      expect(profileIsRegistered(profile, target.id)).toBe(false);
    }
  });

  it("isolation: held game-start gate and play-mask gate, not a full game-start E2E", async () => {
    for (const target of targets) {
      const cardId = `00000000-0000-4000-8000-${target.id.slice(-12)}`;
      const setRes = await fetch(`${base}/api/sets/${target.id}`);
      expect(setRes.status).toBe(404);
      expect(await setRes.text()).not.toMatch(/Evidence Player|img.example|CARDHEDGE|COVER_QA/);
      const cover = await fetch(`${base}/api/sets/${target.id}/covers/0`);
      expect(cover.status).toBe(404);
      expect(await publicMaskDenyReason(cardId)).toBe("held");
      const start = await fetch(`${base}/api/game/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "solo", totalQuestions: 5, setId: target.id }),
      });
      expect(start.status).toBe(404);
      expect(await start.text()).toContain("Set not found");
      const play = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: `session-${target.id}`, index: 0, cardId })}`);
      expect(play.status).toBe(404);
      const bytes = Buffer.from(await play.arrayBuffer());
      expect(bytes[0]).not.toBe(0xff);
      expect(play.headers.get("content-type") || "").toContain("json");
      const green = await fetch(`${base}/api/qa/sets/${target.id}/design-approval`, {
        method: "POST",
        headers: { "X-QA-Token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true, approvedBy: "Design" }),
      });
      expect(green.status).toBe(409);
      const greenBody = await green.json();
      expect(greenBody.code).toBe("held_prep_only");
      expect(JSON.stringify(greenBody)).not.toMatch(/CARDHEDGE|COVER_QA/);
    }
    const clearedId = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    const clearedCard = "12121212-1212-4121-8121-121212121212";
    await insertIntegratedGameSet({
      id: clearedId, sport: "baseball", brand: "Topps", year: 1987, setName: "1987 Topps Baseball", isActive: true,
    });
    await db.insert(playableCards).values({
      id: clearedCard, gameSetId: clearedId, cardhedgeCardId: `cleared:${clearedCard}`, player: "Cleared Player",
      set: "1987 Topps Baseball", number: "9", variant: "Base", imageUrl: "https://img.example/cleared.jpg",
      category: "Baseball", isPlayable: true,
    }).onConflictDoNothing();
    await db.insert(gameSessionsTable).values({
      id: `session-${clearedId}`, mode: "solo", questions: [{ card: { id: clearedCard, playableCardId: clearedCard } }],
      totalQuestions: 1, startedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    await writeFile(path.join(MASKED_CARDS_DIR, `${clearedCard}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 3, 32, 2, 88]));
    await writeFile(path.join(MASKED_CARDS_DIR, `${clearedCard}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
    await refreshHeldSets();
    resetPublicMaskSetCacheForTests();
    const allowed = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: `session-${clearedId}`, index: 0, cardId: clearedCard })}`);
    expect(allowed.status).toBe(200);
    const allowedBytes = Buffer.from(await allowed.arrayBuffer());
    expect(allowedBytes[0]).toBe(0xff);
    expect(allowedBytes[1]).toBe(0xd8);
    const heldTarget = targets[0]!;
    const heldCard = `00000000-0000-4000-8000-${heldTarget.id.slice(-12)}`;
    const denied = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: `session-${heldTarget.id}`, index: 0, cardId: heldCard })}`);
    expect(denied.status).toBe(404);
    expect(Buffer.from(await denied.arrayBuffer())[0]).not.toBe(0xff);
    await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, `session-${clearedId}`));
    await db.delete(playableCards).where(eq(playableCards.id, clearedCard));
  });

  it("keeps every id out of Daily 5 even when the hold flag is ignored and the id is scheduled", async () => {
    for (const target of targets) {
      const choice = await resolveDaily5SetForDate("2026-10-05", {
        config: () => ({ greenSetIds: [target.id], fallbackSetId: FALLBACK }),
        legacyPick: async () => ({ id: "37fd025d-2ae1-4c92-b8ad-133375d0c722", setName: "1987 Topps" }),
        refreshHeld: async () => {},
        isHeld: () => false,
        describe: async (id) => ({ id, setName: "scheduled", isActive: true, isUserCreated: false }),
        dealableCount: async () => 100,
      });
      expect(choice?.id).not.toBe(target.id);
      expect(choice?.skipped).toContainEqual({ id: target.id, reason: "expansion_not_enrolled" });
    }
  });

  it("serializes two integrated creates of the same product", async () => {
    const left = "11111111-1111-4111-8111-111111111111";
    const right = "22222222-2222-4222-8222-222222222222";
    const [a, b] = await Promise.all([
      insertIntegratedGameSet({ id: left, sport: "Baseball", brand: "Fleer", year: 1971, setName: "1971 Fleer Baseball", isActive: false }),
      insertIntegratedGameSet({ id: right, sport: "mlb", brand: "FLEER", year: 1971, setName: "Fleer-1971", isActive: false }),
    ]);
    const created = [a, b].filter((row) => row.created);
    const blocked = [a, b].filter((row) => !row.created);
    expect(created).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ code: "existing_identity" });
    const rows = await db.select({ id: gameSets.id }).from(gameSets).where(inArray(gameSets.id, [left, right]));
    expect(rows).toHaveLength(1);
    await db.delete(gameSets).where(eq(gameSets.id, rows[0]!.id));
  });
});
