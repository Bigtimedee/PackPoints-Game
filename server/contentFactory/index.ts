import { db } from "../db";
import { contentAssets, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateScoreCard, generateStreakBadge, type ScoreCardInput } from "./generateScoreCard";

const STREAK_MILESTONES = [3, 7, 14, 30];

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
      const meta = await db.select({ metadata: contentAssets.metadata, imagePath: contentAssets.imagePath })
        .from(contentAssets).where(eq(contentAssets.id, existing[0].id)).limit(1);
      return { assetId: existing[0].id, imageUrl: (meta[0]?.metadata as any)?.imageUrl || "" };
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
      const meta = await db.select({ metadata: contentAssets.metadata })
        .from(contentAssets).where(eq(contentAssets.id, existing[0].id)).limit(1);
      return { assetId: existing[0].id, imageUrl: (meta[0]?.metadata as any)?.imageUrl || "" };
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
