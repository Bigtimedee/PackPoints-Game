import fs from "fs";
import { db } from "../db";
import { contentAssets, users, type ContentAsset } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateScoreCard, generateStreakBadge, type ScoreCardInput } from "./generateScoreCard";

const STREAK_MILESTONES = [3, 7, 14, 30];

const SCORE_CARD_BUDGET_MS = 1500;

/** Await generation up to a budget so Game Complete can show the PNG within ~2s. */
export async function awaitScoreCard<T>(work: Promise<T>, ms = SCORE_CARD_BUDGET_MS): Promise<T | null> {
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch (err: any) {
    console.error("[ContentFactory] awaitScoreCard error:", err?.message);
    return null;
  }
}

export interface MatchFinishedEvent {
  matchId: string;
  userId: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  mode: string;
  setName?: string;
  streak?: number;
}

export interface Daily5FinishedEvent {
  challengeId: string;
  userId: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  rank?: number;
  streak?: number;
  date: string;
}

async function getUsername(userId: string): Promise<string> {
  try {
    const [user] = await db.select({ username: users.username })
      .from(users).where(eq(users.id, userId)).limit(1);
    return user?.username || "Player";
  } catch {
    return "Player";
  }
}

function imageFileReady(imagePath: string | null | undefined, imageUrl: string | undefined): boolean {
  return !!(imageUrl && imagePath && fs.existsSync(imagePath));
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function scoreCardInputFromMetadata(username: string, metadata: Record<string, unknown> | null, fallbackMode: string): ScoreCardInput {
  const meta = metadata || {};
  const date = typeof meta.date === "string" ? meta.date : new Date().toISOString().slice(0, 10);
  return {
    username,
    score: asFiniteNumber(meta.score) ?? 0,
    correctCount: asFiniteNumber(meta.correctCount) ?? 0,
    totalQuestions: asFiniteNumber(meta.totalQuestions) ?? 0,
    mode: typeof meta.mode === "string" ? meta.mode : fallbackMode,
    streak: asFiniteNumber(meta.streak),
    rank: asFiniteNumber(meta.rank),
    setName: typeof meta.setName === "string" ? meta.setName : undefined,
    date,
  };
}

async function persistGeneratedCard(
  asset: ContentAsset,
  result: { imagePath: string; imageUrl: string },
): Promise<ContentAsset> {
  const metadata = { ...(asset.metadata as Record<string, unknown> | null), imageUrl: result.imageUrl };
  const [updated] = await db.update(contentAssets).set({
    imagePath: result.imagePath,
    metadata,
  }).where(eq(contentAssets.id, asset.id)).returning();
  return updated ?? { ...asset, imagePath: result.imagePath, metadata };
}

/**
 * Re-render a stored asset when the PNG is missing (typical after EACCES on
 * `/app/public` or a container recycle that dropped an ephemeral write).
 */
export async function ensureAssetImage(
  asset: ContentAsset,
  options: { force?: boolean } = {},
): Promise<ContentAsset> {
  const meta = (asset.metadata || {}) as Record<string, unknown>;
  const imageUrl = typeof meta.imageUrl === "string" ? meta.imageUrl : undefined;
  if (!options.force && imageFileReady(asset.imagePath, imageUrl)) {
    return asset;
  }

  const username = asset.userId ? await getUsername(asset.userId) : "Player";
  const date = typeof meta.date === "string" ? meta.date : new Date().toISOString().slice(0, 10);

  if (asset.assetType === "STREAK_BADGE") {
    const streak = typeof meta.streak === "number" ? meta.streak : 0;
    const result = await generateStreakBadge(username, streak, date, asset.id);
    return persistGeneratedCard(asset, result);
  }

  const fallbackMode = asset.assetType === "DAILY5_RANK_CARD" ? "daily5" : "solo";
  const result = await generateScoreCard(scoreCardInputFromMetadata(username, meta, fallbackMode), asset.id);
  return persistGeneratedCard(asset, result);
}

export async function onMatchFinished(event: MatchFinishedEvent): Promise<{ assetId: string; imageUrl: string } | null> {
  try {
    const sourceEventId = `match_${event.matchId}`;
    const date = new Date().toISOString().slice(0, 10);

    const existing = await db.select({ id: contentAssets.id })
      .from(contentAssets)
      .where(and(
        eq(contentAssets.assetType, "SCORE_CARD"),
        eq(contentAssets.userId, event.userId),
        eq(contentAssets.sourceEventId, sourceEventId),
      )).limit(1);

    if (existing.length > 0) {
      const [row] = await db.select()
        .from(contentAssets).where(eq(contentAssets.id, existing[0].id)).limit(1);
      if (!row) return null;
      const ready = await ensureAssetImage(row);
      return { assetId: ready.id, imageUrl: (ready.metadata as any)?.imageUrl || "" };
    }

    const username = await getUsername(event.userId);
    const [asset] = await db.insert(contentAssets).values({
      assetType: "SCORE_CARD",
      userId: event.userId,
      sourceEventId,
      metadata: {
        score: event.score,
        correctCount: event.correctCount,
        totalQuestions: event.totalQuestions,
        mode: event.mode,
        setName: event.setName,
        streak: event.streak,
        date,
      },
    }).returning();

    const input: ScoreCardInput = {
      username,
      score: event.score,
      correctCount: event.correctCount,
      totalQuestions: event.totalQuestions,
      mode: event.mode,
      streak: event.streak,
      setName: event.setName,
      date,
    };

    const result = await generateScoreCard(input, asset.id);

    await db.update(contentAssets).set({
      imagePath: result.imagePath,
      metadata: { ...(asset.metadata as any), imageUrl: result.imageUrl },
    }).where(eq(contentAssets.id, asset.id));

    console.log(`[ContentFactory] Score card generated: ${asset.id} for user ${event.userId}`);

    if (event.streak && STREAK_MILESTONES.includes(event.streak)) {
      await generateStreakMilestone(event.userId, event.streak, date, `match_streak_${event.matchId}`);
    }

    return { assetId: asset.id, imageUrl: result.imageUrl };
  } catch (err: any) {
    console.error("[ContentFactory] onMatchFinished error:", err?.message);
    return null;
  }
}

export async function onDaily5Finished(event: Daily5FinishedEvent): Promise<{ assetId: string; imageUrl: string } | null> {
  try {
    const sourceEventId = `daily5_${event.challengeId}`;

    const existing = await db.select({ id: contentAssets.id })
      .from(contentAssets)
      .where(and(
        eq(contentAssets.assetType, "DAILY5_RANK_CARD"),
        eq(contentAssets.userId, event.userId),
        eq(contentAssets.sourceEventId, sourceEventId),
      )).limit(1);

    if (existing.length > 0) {
      const [row] = await db.select()
        .from(contentAssets).where(eq(contentAssets.id, existing[0].id)).limit(1);
      if (!row) return null;
      const ready = await ensureAssetImage(row);
      return { assetId: ready.id, imageUrl: (ready.metadata as any)?.imageUrl || "" };
    }

    const username = await getUsername(event.userId);
    const [asset] = await db.insert(contentAssets).values({
      assetType: "DAILY5_RANK_CARD",
      userId: event.userId,
      sourceEventId,
      metadata: {
        score: event.score,
        correctCount: event.correctCount,
        totalQuestions: event.totalQuestions,
        rank: event.rank,
        streak: event.streak,
        date: event.date,
      },
    }).returning();

    const input: ScoreCardInput = {
      username,
      score: event.score,
      correctCount: event.correctCount,
      totalQuestions: event.totalQuestions,
      mode: "daily5",
      streak: event.streak,
      rank: event.rank,
      date: event.date,
    };

    const result = await generateScoreCard(input, asset.id);

    await db.update(contentAssets).set({
      imagePath: result.imagePath,
      metadata: { ...(asset.metadata as any), imageUrl: result.imageUrl },
    }).where(eq(contentAssets.id, asset.id));

    console.log(`[ContentFactory] Daily 5 rank card generated: ${asset.id} for user ${event.userId}`);

    if (event.streak && STREAK_MILESTONES.includes(event.streak)) {
      await generateStreakMilestone(event.userId, event.streak, event.date, `daily5_streak_${event.challengeId}`);
    }

    return { assetId: asset.id, imageUrl: result.imageUrl };
  } catch (err: any) {
    console.error("[ContentFactory] onDaily5Finished error:", err?.message);
    return null;
  }
}

async function generateStreakMilestone(userId: string, streak: number, date: string, sourceEventId: string): Promise<void> {
  try {
    const existing = await db.select({ id: contentAssets.id })
      .from(contentAssets)
      .where(and(
        eq(contentAssets.assetType, "STREAK_BADGE"),
        eq(contentAssets.userId, userId),
        eq(contentAssets.sourceEventId, sourceEventId),
      )).limit(1);

    if (existing.length > 0) return;

    const username = await getUsername(userId);
    const [asset] = await db.insert(contentAssets).values({
      assetType: "STREAK_BADGE",
      userId,
      sourceEventId,
      metadata: { streak, date },
    }).returning();

    const result = await generateStreakBadge(username, streak, date, asset.id);

    await db.update(contentAssets).set({
      imagePath: result.imagePath,
      metadata: { streak, date, imageUrl: result.imageUrl },
    }).where(eq(contentAssets.id, asset.id));

    console.log(`[ContentFactory] Streak badge generated: ${asset.id} for user ${userId} (${streak}-day)`);
  } catch (err: any) {
    console.error("[ContentFactory] Streak badge error:", err?.message);
  }
}
