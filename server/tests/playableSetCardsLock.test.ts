/**
 * Answer-key card rows are admin-only.
 * Logged-out is 401, a non-admin is 403, an admin receives the full row.
 * Public set detail still renders without player, number, variant, or a raw scan.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import express, { type Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  baseballCards,
  cardSetCards,
  cardSets,
  catalogCards,
  gameSets,
  playableCards,
  userOnboarding,
  users,
} from "@shared/schema";
import { db } from "../db";
import { isAuthenticated } from "../auth";
import { handleOnboardingStart, registerLockedCardRowRoutes } from "../services/lockedCardRows";
import { handlePublicSetDetail } from "../services/publicSets";

const stamp = randomUUID().slice(0, 8);
const setId = randomUUID();
const haleyId = randomUUID();
const eligibleId = randomUUID();
const catalogSetId = randomUUID();
const catalogCardId = randomUUID();
const baseballId = randomUUID();
const adminId = `lock-admin-${randomUUID()}`;
const memberId = `lock-member-${randomUUID()}`;
const setName = `Lockdown Football ${stamp}`;
const player = `Charles Haley ${stamp}`;
const eligiblePlayer = `Eligible Lock ${stamp}`;
const variant = `Gold Parallel ${stamp}`;
const rawUrl = `https://scans.packpts.test/${stamp}/charles-haley-125.jpg`;
const catalogUrl = `https://scans.packpts.test/${stamp}/catalog-raw.jpg`;
const baseballUrl = `https://scans.packpts.test/${stamp}/baseball-raw.jpg`;
const cardhedgeId = `lock-cardhedge-${stamp}`;

function leakText(value: unknown): string {
  return JSON.stringify(value);
}

function assertNoAnswerLeak(value: unknown) {
  const text = leakText(value);
  expect(text).not.toContain(player);
  expect(text).not.toContain(eligiblePlayer);
  expect(text).not.toContain(rawUrl);
  expect(text).not.toContain(catalogUrl);
  expect(text).not.toContain(baseballUrl);
  expect(text).not.toContain(variant);
  expect(text).not.toContain(cardhedgeId);
  expect(text).not.toContain('"isPlayable"');
  expect(text).not.toContain('"player"');
  expect(text).not.toContain('"playerName"');
  expect(text).not.toContain('"number"');
  expect(text).not.toContain('"cardNumber"');
  expect(text).not.toContain('"variant"');
}

beforeAll(async () => {
  await db.insert(users).values([
    {
      id: adminId,
      username: `lock_admin_${stamp}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: true,
    },
    {
      id: memberId,
      username: `lock_member_${stamp}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    },
  ]);
  await db.insert(gameSets).values({
    id: setId,
    sport: "football",
    brand: "Topps",
    year: 1987,
    setName,
    isUserCreated: false,
    isActive: true,
  });
  await db.insert(playableCards).values([
    {
      id: haleyId,
      gameSetId: setId,
      cardhedgeCardId: cardhedgeId,
      player,
      set: setName,
      number: "125",
      variant,
      description: `${setName} ${player}`,
      imageUrl: rawUrl,
      category: "football",
      isPlayable: false,
      blockedReason: "checklist",
      contentVerified: true,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
    },
    {
      id: eligibleId,
      gameSetId: setId,
      cardhedgeCardId: `lock-eligible-${stamp}`,
      player: eligiblePlayer,
      set: setName,
      number: "200",
      variant: "Base",
      description: `${setName} ${eligiblePlayer}`,
      imageUrl: `https://scans.packpts.test/${stamp}/eligible.jpg`,
      category: "football",
      isPlayable: true,
      contentVerified: true,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      imageFailureCount: 0,
    },
  ]);
  await db.insert(baseballCards).values({
    id: baseballId,
    playerName: `Legacy ${player}`,
    cardNumber: "125",
    imageUrl: baseballUrl,
    year: 1987,
    setName,
  });
  await db.insert(cardSets).values({
    id: catalogSetId,
    sport: "Football",
    year: 1987,
    brand: "Topps",
    setName,
    isActive: true,
  });
  await db.insert(catalogCards).values({
    id: catalogCardId,
    provider: "cardhedge",
    providerCardId: `lock-catalog-${stamp}`,
    sport: "Football",
    year: 1987,
    player,
    cardNumber: "125",
    variant,
    description: `${setName} ${player}`,
    imageUrl: catalogUrl,
    raw: { source: "lock-test" },
  });
  await db.insert(cardSetCards).values({
    setId: catalogSetId,
    cardId: catalogCardId,
  });
});

afterAll(async () => {
  await db.delete(userOnboarding).where(eq(userOnboarding.userId, memberId)).catch(() => null);
  await db.delete(cardSetCards).where(eq(cardSetCards.setId, catalogSetId)).catch(() => null);
  await db.delete(catalogCards).where(eq(catalogCards.id, catalogCardId)).catch(() => null);
  await db.delete(cardSets).where(eq(cardSets.id, catalogSetId)).catch(() => null);
  await db.delete(baseballCards).where(eq(baseballCards.id, baseballId)).catch(() => null);
  await db.delete(playableCards).where(eq(playableCards.gameSetId, setId)).catch(() => null);
  await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  await db.delete(users).where(eq(users.id, adminId)).catch(() => null);
  await db.delete(users).where(eq(users.id, memberId)).catch(() => null);
});

function appServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    (req as Request & { session: { localUserId?: string } }).session = {};
    if (user) (req as Request & { session: { localUserId?: string } }).session.localUserId = user;
    next();
  });
  app.get("/api/cards/stats", (_req, res) => {
    res.json({ total: 0, verified: 0, unverified: 0 });
  });
  registerLockedCardRowRoutes(app);
  app.post("/api/onboarding/start", isAuthenticated, (req, res) => {
    void handleOnboardingStart(req, res);
  });
  app.get("/api/sets/:id", (req, res) => {
    void handlePublicSetDetail(req, res);
  });
  const server = createServer(app);
  return server;
}

describe("locked playable card rows", () => {
  const server = appServer();
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function get(path: string, user?: string) {
    return fetch(`${base}${path}`, {
      headers: user ? { "x-test-user": user } : {},
    });
  }

  it("registers the dumps behind admin auth, after the public stats route", () => {
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    const locked = readFileSync(new URL("../services/lockedCardRows.ts", import.meta.url), "utf8");
    const statsAt = routes.indexOf('app.get("/api/cards/stats"');
    const lockAt = routes.indexOf("registerLockedCardRowRoutes(app)");
    expect(statsAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(statsAt);
    expect(routes.slice(statsAt, lockAt)).not.toContain("requireAdmin");
    expect(routes).not.toContain('app.get("/api/playable-sets/:id/cards", async');
    expect(routes).not.toContain('app.get("/api/cards/:cardhedgeCardId", async');
    expect(routes).not.toContain('app.get("/api/diag/card-review-test", async');
    for (const path of [
      '"/api/diag/card-review-test"',
      '"/api/cards"',
      '"/api/playable-sets/:id/cards"',
      '"/api/cards/:cardhedgeCardId"',
      '"/api/card-sets/:id/cards"',
    ]) {
      const at = locked.indexOf(path);
      expect(at).toBeGreaterThan(-1);
      expect(locked.slice(at, at + 180)).toContain("isAuthenticated, requireAdmin");
    }
    const start = routes.indexOf('app.post("/api/onboarding/start"');
    const complete = routes.indexOf('app.post("/api/onboarding/complete"');
    const onboarding = routes.slice(start, complete);
    expect(onboarding).toContain("isAuthenticated");
    expect(onboarding).toContain("handleOnboardingStart");
    expect(onboarding).not.toContain("playableCards.player");
    expect(onboarding).not.toContain("playableCards.imageUrl");
  });

  it("hides playable-set rows from logged-out and non-admin callers and returns them to an admin", async () => {
    const loggedOut = await get(`/api/playable-sets/${setId}/cards?player=${encodeURIComponent(player)}`);
    expect(loggedOut.status).toBe(401);
    assertNoAnswerLeak(await loggedOut.json());

    const member = await get(`/api/playable-sets/${setId}/cards`, memberId);
    expect(member.status).toBe(403);
    assertNoAnswerLeak(await member.json());

    const admin = await get(`/api/playable-sets/${setId}/cards?limit=50`, adminId);
    expect(admin.status).toBe(200);
    expect(admin.headers.get("cache-control")).toContain("no-store");
    const rows = await admin.json() as Array<Record<string, unknown>>;
    const haley = rows.find((row) => row.id === haleyId);
    expect(haley?.player).toBe(player);
    expect(haley?.number).toBe("125");
    expect(haley?.variant).toBe(variant);
    expect(haley?.imageUrl).toBe(rawUrl);
    expect(haley?.isPlayable).toBe(false);
    expect(rows.some((row) => row.id === eligibleId)).toBe(true);
  });

  it("locks the cardhedge row, the legacy dump, the catalog list, and the diagnostic", async () => {
    const paths = [
      `/api/cards/${cardhedgeId}`,
      "/api/cards",
      `/api/card-sets/${catalogSetId}/cards`,
      "/api/diag/card-review-test",
    ];
    for (const path of paths) {
      const loggedOut = await get(path);
      expect(loggedOut.status).toBe(401);
      assertNoAnswerLeak(await loggedOut.json());
      const member = await get(path, memberId);
      expect(member.status).toBe(403);
      assertNoAnswerLeak(await member.json());
    }

    const byId = await get(`/api/cards/${cardhedgeId}`, adminId);
    expect(byId.status).toBe(200);
    const card = await byId.json() as Record<string, unknown>;
    expect(card.player).toBe(player);
    expect(card.number).toBe("125");
    expect(card.imageUrl).toBe(rawUrl);
    expect(card.isPlayable).toBe(false);

    const legacy = await get("/api/cards", adminId);
    expect(legacy.status).toBe(200);
    const legacyRows = await legacy.json() as Array<Record<string, unknown>>;
    const baseball = legacyRows.find((row) => row.id === baseballId);
    expect(baseball?.playerName).toContain(player);
    expect(baseball?.cardNumber).toBe("125");
    expect(baseball?.imageUrl).toBe(baseballUrl);

    const catalog = await get(`/api/card-sets/${catalogSetId}/cards`, adminId);
    expect(catalog.status).toBe(200);
    const catalogBody = await catalog.json() as { cards: Array<Record<string, unknown>> };
    expect(catalogBody.cards[0]?.player).toBe(player);
    expect(catalogBody.cards[0]?.cardNumber).toBe("125");
    expect(catalogBody.cards[0]?.variant).toBe(variant);
    expect(catalogBody.cards[0]?.imageUrl).toBe(catalogUrl);

    const diag = await get("/api/diag/card-review-test", adminId);
    expect(diag.status).toBe(200);
    const diagBody = await diag.json() as { ok: boolean; steps: { sampleCard?: { player?: string; isPlayable?: boolean } } };
    expect(diagBody.ok).toBe(true);
    expect(diagBody.steps.sampleCard?.player).toBeTruthy();

    const stats = await get("/api/cards/stats");
    expect(stats.status).toBe(200);
    assertNoAnswerLeak(await stats.json());
  });

  it("returns a masked onboarding card and still renders the public set page", async () => {
    const loggedOut = await fetch(`${base}/api/onboarding/start`, { method: "POST" });
    expect(loggedOut.status).toBe(401);
    assertNoAnswerLeak(await loggedOut.json());

    const started = await fetch(`${base}/api/onboarding/start`, {
      method: "POST",
      headers: { "x-test-user": memberId },
    });
    expect(started.status).toBe(200);
    const body = await started.json() as { guidedCard: { imageUrl?: string; player?: string } | null; rewardPts: number };
    expect(body.rewardPts).toBe(50);
    expect(body.guidedCard?.imageUrl).toMatch(/^\/api\/cards\/[^/]+\/masked-image\?v=/);
    expect(body.guidedCard).not.toHaveProperty("player");
    expect(body.guidedCard).not.toHaveProperty("number");
    expect(body.guidedCard).not.toHaveProperty("variant");
    expect(body.guidedCard).not.toHaveProperty("isPlayable");
    expect(leakText(body.guidedCard)).not.toContain("https://");
    expect(leakText(body)).not.toContain(player);
    expect(leakText(body)).not.toContain(rawUrl);

    const detail = await get(`/api/sets/${setId}`);
    expect(detail.status).toBe(200);
    const set = await detail.json() as {
      setName: string;
      cardCount: number;
      previewCards: Array<{ imageUrl?: string | null }>;
    };
    expect(set.setName).toBe(setName);
    expect(set.cardCount).toBe(1);
    expect(Array.isArray(set.previewCards)).toBe(true);
    assertNoAnswerLeak(set);
    for (const card of set.previewCards) {
      if (card.imageUrl) {
        expect(card.imageUrl.startsWith(`/api/sets/${setId}/covers/`)).toBe(true);
      }
    }
  });
});
