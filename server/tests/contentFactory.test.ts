/**
 * contentFactory.test.ts
 *
 * Tests for the content asset generation pipeline:
 *   - generateScoreCard: SVG → PNG generation, file written to disk
 *   - generateStreakBadge: streak milestone PNG generation
 *   - onMatchFinished: idempotency, DB record creation, image URL stored in metadata
 *   - onDaily5Finished: idempotency, DB record creation, rank/streak stored
 *
 * Generated test images are written to:
 *   public/generated/share/<date>/<assetId>.png
 * and deleted after each test suite.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { contentAssets, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateScoreCard, generateStreakBadge } from "../contentFactory/generateScoreCard";
import { onMatchFinished, onDaily5Finished } from "../contentFactory/index";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
let testUserId: string;
const createdAssetIds: string[] = [];
const createdImagePaths: string[] = [];

beforeAll(async () => {
  testUserId = `test-cf-${randomUUID()}`;
  await db.insert(users).values({
    id: testUserId,
    username: `testcf_${Date.now()}`,
    points: 0,
    gamesPlayed: 0,
    correctAnswers: 0,
    totalAnswers: 0,
    isAdmin: false,
  });
});

afterAll(async () => {
  // Remove DB records created during tests
  if (createdAssetIds.length > 0) {
    for (const id of createdAssetIds) {
      await db.delete(contentAssets).where(eq(contentAssets.id, id)).catch(() => null);
    }
  }
  // Remove generated image files
  for (const filePath of createdImagePaths) {
    fs.rmSync(filePath, { force: true });
  }
  // Remove test user
  await db.delete(users).where(eq(users.id, testUserId)).catch(() => null);
});

// ── generateScoreCard ─────────────────────────────────────────────────────────

describe("generateScoreCard()", () => {
  it("writes a PNG file to disk and returns the correct paths", async () => {
    const assetId = `test-sc-${randomUUID()}`;
    const result = await generateScoreCard(
      {
        username: "TestPlayer",
        score: 850,
        correctCount: 8,
        totalQuestions: 10,
        mode: "1v1",
        date: TODAY,
      },
      assetId,
    );

    // imagePath is the absolute disk path
    expect(result.imagePath).toContain(assetId);
    expect(result.imagePath).toEndWith(".png");
    expect(fs.existsSync(result.imagePath)).toBe(true);

    // imageUrl is the Express-served relative path
    expect(result.imageUrl).toBe(`/generated/share/${TODAY}/${assetId}.png`);

    // Verify it is actually a PNG (magic bytes: 89 50 4E 47)
    const buf = fs.readFileSync(result.imagePath);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G

    createdImagePaths.push(result.imagePath);
  });

  it("includes streak and rank in daily5 mode without error", async () => {
    const assetId = `test-d5-${randomUUID()}`;
    const result = await generateScoreCard(
      {
        username: "DailyPlayer",
        score: 420,
        correctCount: 4,
        totalQuestions: 5,
        mode: "daily5",
        streak: 7,
        rank: 3,
        date: TODAY,
      },
      assetId,
    );

    expect(fs.existsSync(result.imagePath)).toBe(true);
    createdImagePaths.push(result.imagePath);
  });
});

// ── generateStreakBadge ───────────────────────────────────────────────────────

describe("generateStreakBadge()", () => {
  it("writes a PNG streak badge to disk", async () => {
    const assetId = `test-sb-${randomUUID()}`;
    const result = await generateStreakBadge("StreakUser", 7, TODAY, assetId);

    expect(result.imagePath).toContain(assetId);
    expect(fs.existsSync(result.imagePath)).toBe(true);
    expect(result.imageUrl).toBe(`/generated/share/${TODAY}/${assetId}.png`);

    const buf = fs.readFileSync(result.imagePath);
    expect(buf[0]).toBe(0x89); // PNG magic byte

    createdImagePaths.push(result.imagePath);
  });
});

// ── onMatchFinished ───────────────────────────────────────────────────────────

describe("onMatchFinished()", () => {
  it("creates a SCORE_CARD asset and returns imageUrl", async () => {
    const matchId = `test-match-${randomUUID()}`;
    const result = await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 750,
      correctCount: 7,
      totalQuestions: 10,
      mode: "1v1",
    });

    expect(result).not.toBeNull();
    expect(result!.imageUrl).toMatch(/^\/generated\/share\//);
    expect(result!.imageUrl).toEndWith(".png");

    // Verify DB record
    const [asset] = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `match_${matchId}`),
        ),
      )
      .limit(1);

    expect(asset).toBeDefined();
    expect(asset.assetType).toBe("SCORE_CARD");
    expect((asset.metadata as any)?.imageUrl).toBe(result!.imageUrl);
    expect(asset.imagePath).toBeTruthy();
    expect(fs.existsSync(asset.imagePath!)).toBe(true);

    createdAssetIds.push(asset.id);
    createdImagePaths.push(asset.imagePath!);
  });

  it("is idempotent: calling twice with the same matchId returns the same asset", async () => {
    const matchId = `test-idem-${randomUUID()}`;

    const first = await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 600,
      correctCount: 6,
      totalQuestions: 10,
      mode: "solo",
    });
    const second = await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 600,
      correctCount: 6,
      totalQuestions: 10,
      mode: "solo",
    });

    expect(first!.assetId).toBe(second!.assetId);
    expect(first!.imageUrl).toBe(second!.imageUrl);

    // Only one DB record should exist
    const rows = await db
      .select({ id: contentAssets.id })
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `match_${matchId}`),
        ),
      );
    expect(rows.length).toBe(1);

    createdAssetIds.push(first!.assetId);
    const [asset] = await db.select().from(contentAssets).where(eq(contentAssets.id, first!.assetId)).limit(1);
    if (asset.imagePath) createdImagePaths.push(asset.imagePath);
  });

  it("generates a streak badge when streak is a milestone value", async () => {
    const matchId = `test-streak-${randomUUID()}`;

    await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 900,
      correctCount: 9,
      totalQuestions: 10,
      mode: "1v1",
      streak: 7,
    });

    // Should have created a SCORE_CARD + a STREAK_BADGE
    const badges = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.assetType, "STREAK_BADGE"),
          eq(contentAssets.sourceEventId, `match_streak_${matchId}`),
        ),
      );

    expect(badges.length).toBe(1);
    expect((badges[0].metadata as any)?.streak).toBe(7);
    expect(fs.existsSync(badges[0].imagePath!)).toBe(true);

    createdAssetIds.push(badges[0].id);
    createdImagePaths.push(badges[0].imagePath!);

    const scoreCards = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `match_${matchId}`),
        ),
      );
    for (const sc of scoreCards) {
      createdAssetIds.push(sc.id);
      if (sc.imagePath) createdImagePaths.push(sc.imagePath);
    }
  });
});

// ── onDaily5Finished ──────────────────────────────────────────────────────────

describe("onDaily5Finished()", () => {
  it("creates a DAILY5_RANK_CARD asset with rank stored in metadata", async () => {
    const challengeId = `test-d5c-${randomUUID()}`;
    const result = await onDaily5Finished({
      challengeId,
      userId: testUserId,
      score: 380,
      correctCount: 4,
      totalQuestions: 5,
      rank: 12,
      date: TODAY,
    });

    expect(result).not.toBeNull();
    expect(result!.imageUrl).toMatch(/^\/generated\/share\//);

    const [asset] = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `daily5_${challengeId}`),
        ),
      )
      .limit(1);

    expect(asset.assetType).toBe("DAILY5_RANK_CARD");
    expect((asset.metadata as any)?.rank).toBe(12);
    expect(fs.existsSync(asset.imagePath!)).toBe(true);

    createdAssetIds.push(asset.id);
    createdImagePaths.push(asset.imagePath!);
  });

  it("is idempotent: calling twice with the same challengeId returns the same asset", async () => {
    const challengeId = `test-d5idem-${randomUUID()}`;

    const first = await onDaily5Finished({
      challengeId,
      userId: testUserId,
      score: 300,
      correctCount: 3,
      totalQuestions: 5,
      date: TODAY,
    });
    const second = await onDaily5Finished({
      challengeId,
      userId: testUserId,
      score: 300,
      correctCount: 3,
      totalQuestions: 5,
      date: TODAY,
    });

    expect(first!.assetId).toBe(second!.assetId);

    const rows = await db
      .select({ id: contentAssets.id })
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `daily5_${challengeId}`),
        ),
      );
    expect(rows.length).toBe(1);

    createdAssetIds.push(first!.assetId);
    const [asset] = await db.select().from(contentAssets).where(eq(contentAssets.id, first!.assetId)).limit(1);
    if (asset.imagePath) createdImagePaths.push(asset.imagePath);
  });

  it("generates a streak badge when Daily 5 streak hits a milestone", async () => {
    const challengeId = `test-d5streak-${randomUUID()}`;

    await onDaily5Finished({
      challengeId,
      userId: testUserId,
      score: 500,
      correctCount: 5,
      totalQuestions: 5,
      streak: 3,
      date: TODAY,
    });

    const badges = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.assetType, "STREAK_BADGE"),
          eq(contentAssets.sourceEventId, `daily5_streak_${challengeId}`),
        ),
      );

    expect(badges.length).toBe(1);
    expect((badges[0].metadata as any)?.streak).toBe(3);
    expect(fs.existsSync(badges[0].imagePath!)).toBe(true);

    createdAssetIds.push(badges[0].id);
    createdImagePaths.push(badges[0].imagePath!);

    const rankCards = await db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.userId, testUserId),
          eq(contentAssets.sourceEventId, `daily5_${challengeId}`),
        ),
      );
    for (const rc of rankCards) {
      createdAssetIds.push(rc.id);
      if (rc.imagePath) createdImagePaths.push(rc.imagePath);
    }
  });
});
