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
import { gameSets, playableCards } from "@shared/schema";
import { CLEARED_SET_IDS, holdReasonForIdentity, isDesignApprovedSetId, isHeldSet, NO_MASK_PROFILE_REASON, refreshHeldSets } from "../config/heldSets";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { missingExpansionTargets } from "../services/baseballExpansion/registry";
import { insertIntegratedGameSet } from "../services/baseballExpansion/createIntegratedSet";
import { resolveDaily5SetForDate } from "../services/daily5SetPick";
import { publicMaskDenyReason, resetPublicMaskSetCacheForTests } from "../services/publicMaskGate";
import { handlePublicSetDetail } from "../services/publicSets";
import { handlePublicSetCover } from "../services/setCovers";
import { registerDesignApprovalQaRoutes } from "../routes/designApprovalQa";

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
    await db.insert(playableCards).values({
      id: `00000000-0000-4000-8000-${target.id.slice(-12)}`,
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
  }
  await refreshHeldSets();
  resetPublicMaskSetCacheForTests();
  const app = express();
  app.use(express.json());
  app.get("/api/sets/:id", (req, res) => { void handlePublicSetDetail(req, res); });
  app.get("/api/sets/:setId/covers/:slot", (req, res) => { void handlePublicSetCover(req, res); });
  registerDesignApprovalQaRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(playableCards).where(inArray(playableCards.gameSetId, ids));
  await db.delete(gameSets).where(inArray(gameSets.id, ids));
  await refreshHeldSets();
  if (process.env.COVER_QA_TOKEN === TOKEN) delete process.env.COVER_QA_TOKEN;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("16 missing sets stay held and unreachable", () => {
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

  it("blocks public set pages, covers, play masks, and Design GREEN", async () => {
    for (const target of targets) {
      const cardId = `00000000-0000-4000-8000-${target.id.slice(-12)}`;
      const setRes = await fetch(`${base}/api/sets/${target.id}`);
      expect(setRes.status).toBe(404);
      expect(await setRes.text()).not.toMatch(/Evidence Player|img.example|CARDHEDGE|COVER_QA/);
      const cover = await fetch(`${base}/api/sets/${target.id}/covers/0`);
      expect(cover.status).toBe(404);
      expect(await publicMaskDenyReason(cardId)).toBe("held");
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
