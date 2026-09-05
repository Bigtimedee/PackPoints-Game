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
 *   public/generated/share/<date>/<assetId>.png  (local / CI)
 *   /app/data/masked-cards/generated/share/<date>/<assetId>.png  (Railway volume)
 * and deleted after each test suite.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { contentAssets, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateScoreCard, generateStreakBadge, getShareOutputBase, buildScoreCardHeadline, buildScoreCardSvg, buildPipsSvg, SCORE_CARD_SIZE } from "../contentFactory/generateScoreCard";
import { FONT_FILES, resolveFontsDir } from "../contentFactory/fonts";
import sharp from "sharp";
import { onMatchFinished, onDaily5Finished, ensureAssetImage } from "../contentFactory/index";

function isGreen(r: number, g: number, b: number): boolean {
  return r < 80 && g > 160 && b < 130;
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 220 && g > 220 && b > 220;
}

async function regionHasColor(
  filePath: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pred: (r: number, g: number, b: number) => boolean,
): Promise<boolean> {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * ch;
      if (pred(data[i], data[i + 1], data[i + 2])) return true;
    }
  }
  return false;
}

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
    expect(result.imagePath).toMatch(/\.png$/);
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

  it("renders a 1080×1080 Daily 5 contract card with the real 3/5 session", async () => {
    const assetId = `test-contract-${randomUUID()}`;
    const input = {
      username: "Charter",
      score: 525,
      correctCount: 3,
      totalQuestions: 5,
      mode: "daily5",
      date: TODAY,
    };
    const svg = buildScoreCardSvg(input);
    expect(svg).toContain(`width="${SCORE_CARD_SIZE}"`);
    expect(svg).toContain(`height="${SCORE_CARD_SIZE}"`);
    expect(svg).toContain("#0b0f16");
    expect(svg).toContain("#22C55E");
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("DAILY 5");
    expect(svg).toContain("Three locked. Two open.");
    expect(svg).toContain("525 pts");
    expect(svg).toContain("PackPTS");
    expect(svg).toContain("packpts.com/daily");
    expect(svg).not.toContain("PackPoints");
    expect(svg).not.toContain("Four locked");
    expect(svg).toContain("data:font/ttf;base64,");
    expect(svg).toContain("@font-face");
    expect(svg).not.toMatch(/<text[\s>]/);

    const result = await generateScoreCard(input, assetId);
    const meta = await sharp(result.imagePath).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    // Outlined type must paint (missing fonts = blank navy / tofu).
    expect(await regionHasColor(result.imagePath, 80, 200, 280, 400, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 80, 660, 720, 720, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 150, 950, 340, 1000, isNearWhite)).toBe(true);
    expect(await regionHasColor(result.imagePath, 720, 950, 1020, 1000, isNearWhite)).toBe(true);

    // First three pips filled #22C55E; fourth outline only.
    expect(await regionHasColor(result.imagePath, 80, 560, 136, 616, isGreen)).toBe(true);
    expect(await regionHasColor(result.imagePath, 220, 560, 276, 616, isGreen)).toBe(true);
    expect(await regionHasColor(result.imagePath, 290, 560, 346, 616, isGreen)).toBe(false);

    createdImagePaths.push(result.imagePath);
  });
});

describe("bundled score-card fonts", () => {
  it("ships Inter TTFs next to the generator", () => {
    const dir = resolveFontsDir();
    expect(fs.existsSync(path.join(dir, FONT_FILES.regular))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.semibold))).toBe(true);
    expect(fs.existsSync(path.join(dir, FONT_FILES.bold))).toBe(true);
  });
});

describe("buildPipsSvg()", () => {
  it("fills the first X pips green and leaves the rest as outlines", () => {
    const svg = buildPipsSvg(3, 5);
    const fills = svg.match(/fill="#22C55E"/g) || [];
    const outlines = svg.match(/fill="none"/g) || [];
    expect(fills.length).toBe(3);
    expect(outlines.length).toBe(2);
  });
});

describe("buildScoreCardHeadline()", () => {
  it("uses the real session counts and never fakes 4/5", () => {
    expect(buildScoreCardHeadline(3, 5)).toBe("Three locked. Two open.");
    expect(buildScoreCardHeadline(4, 5)).toBe("Four locked. One open.");
    expect(buildScoreCardHeadline(5, 5)).toBe("Five locked.");
    expect(buildScoreCardHeadline(0, 5)).toBe("None locked. Five open.");
    expect(buildScoreCardHeadline(3, 5)).not.toContain("Four");
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
    expect(result!.imageUrl).toMatch(/\.png$/);

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

// ── missing-PNG repair ────────────────────────────────────────────────────────

describe("getShareOutputBase()", () => {
  it("uses the local public/ path when the Railway volume is absent", () => {
    expect(getShareOutputBase()).toMatch(/public[/\\]generated[/\\]share$/);
  });
});

describe("ensureAssetImage() / finish-handler repair", () => {
  it("regenerates a SCORE_CARD when onMatchFinished finds a row with no PNG", async () => {
    const matchId = `test-repair-${randomUUID()}`;
    const [inserted] = await db.insert(contentAssets).values({
      assetType: "SCORE_CARD",
      userId: testUserId,
      sourceEventId: `match_${matchId}`,
      metadata: {
        score: 525,
        correctCount: 3,
        totalQuestions: 5,
        mode: "solo",
        date: TODAY,
      },
    }).returning();
    createdAssetIds.push(inserted.id);

    const result = await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 525,
      correctCount: 3,
      totalQuestions: 5,
      mode: "solo",
    });

    expect(result).not.toBeNull();
    expect(result!.assetId).toBe(inserted.id);
    expect(result!.imageUrl).toMatch(/^\/generated\/share\//);
    expect(result!.imageUrl).toMatch(/\.png$/);

    const [asset] = await db.select().from(contentAssets).where(eq(contentAssets.id, inserted.id)).limit(1);
    expect((asset.metadata as any)?.imageUrl).toBe(result!.imageUrl);
    expect(asset.imagePath).toBeTruthy();
    expect(fs.existsSync(asset.imagePath!)).toBe(true);
    createdImagePaths.push(asset.imagePath!);
  });

  it("rewrites a deleted PNG via ensureAssetImage", async () => {
    const matchId = `test-ensure-${randomUUID()}`;
    const first = await onMatchFinished({
      matchId,
      userId: testUserId,
      score: 200,
      correctCount: 2,
      totalQuestions: 5,
      mode: "solo",
    });
    expect(first).not.toBeNull();
    createdAssetIds.push(first!.assetId);

    const [asset] = await db.select().from(contentAssets).where(eq(contentAssets.id, first!.assetId)).limit(1);
    expect(asset.imagePath).toBeTruthy();
    fs.rmSync(asset.imagePath!, { force: true });
    expect(fs.existsSync(asset.imagePath!)).toBe(false);

    const repaired = await ensureAssetImage(asset);
    expect(repaired.imagePath).toBeTruthy();
    expect(fs.existsSync(repaired.imagePath!)).toBe(true);
    expect((repaired.metadata as any)?.imageUrl).toMatch(/^\/generated\/share\//);
    createdImagePaths.push(repaired.imagePath!);
  });
});
