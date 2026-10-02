import { db } from "../../db";
import {
  contentAssets,
  dailyChallengeEntries,
  growthSignals,
  streakState,
} from "@shared/schema";
import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";

export type GrowthSignalInput = {
  signalKey: string;
  source: "INTERNAL" | "EXTERNAL";
  signalType:
    | "DAILY5_MOMENT"
    | "SHAREABLE_ASSET"
    | "STREAK_MILESTONE"
    | "LEADERBOARD_MOMENT"
    | "TREND"
    | "ANNIVERSARY"
    | "COLLECTOR_DEBATE"
    | "EDITORIAL";
  title: string;
  score: number;
  payload?: Record<string, unknown>;
  assetPath?: string | null;
  observedAt?: Date;
  expiresAt?: Date | null;
};

export type RankedGrowthSignal = GrowthSignalInput & {
  id?: string;
};

export function rankSignals<T extends Pick<GrowthSignalInput, "score">>(
  signals: T[],
  limit = 12,
): T[] {
  return [...signals]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

async function upsertSignal(signal: GrowthSignalInput): Promise<void> {
  await db
    .insert(growthSignals)
    .values({
      signalKey: signal.signalKey,
      source: signal.source,
      signalType: signal.signalType,
      title: signal.title,
      score: signal.score,
      payload: signal.payload ?? {},
      assetPath: signal.assetPath ?? null,
      observedAt: signal.observedAt ?? new Date(),
      expiresAt: signal.expiresAt ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: growthSignals.signalKey,
      set: {
        source: signal.source,
        signalType: signal.signalType,
        title: signal.title,
        score: signal.score,
        payload: signal.payload ?? {},
        assetPath: signal.assetPath ?? null,
        observedAt: signal.observedAt ?? new Date(),
        expiresAt: signal.expiresAt ?? null,
        updatedAt: new Date(),
      },
    });
}

function assetSignalType(assetType: string): GrowthSignalInput["signalType"] {
  if (assetType === "STREAK_BADGE") return "STREAK_MILESTONE";
  if (assetType === "LEADERBOARD_SPOTLIGHT" || assetType === "DAILY5_RANK_CARD") {
    return "LEADERBOARD_MOMENT";
  }
  return "SHAREABLE_ASSET";
}

function assetScore(assetType: string): number {
  switch (assetType) {
    case "LEADERBOARD_SPOTLIGHT":
      return 95;
    case "DAILY5_RANK_CARD":
      return 92;
    case "STREAK_BADGE":
      return 90;
    case "SCORE_CARD":
      return 86;
    case "MAKER_SHARE_CARD":
      return 76;
    default:
      return 60;
  }
}

/**
 * LISTEN
 *
 * Convert real PackPTS product activity into ranked growth signals.
 *
 * This intentionally does not scrape social platforms. External trend inputs
 * enter through the admin endpoint and are stored as EXTERNAL signals. That
 * keeps the agent compliant and keeps every factual content claim traceable.
 */
export async function collectGrowthSignals(
  now = new Date(),
  lookbackHours = 24,
): Promise<RankedGrowthSignal[]> {
  const cutoff = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const expiresAt = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const internal: GrowthSignalInput[] = [];

  const [daily] = await db
    .select({
      completions: sql<number>`cast(count(*) as int)`,
      avgScore: sql<number>`cast(coalesce(avg(${dailyChallengeEntries.score}), 0) as float)`,
      bestScore: sql<number>`cast(coalesce(max(${dailyChallengeEntries.score}), 0) as int)`,
    })
    .from(dailyChallengeEntries)
    .where(
      and(
        isNotNull(dailyChallengeEntries.completedAt),
        gte(dailyChallengeEntries.completedAt, cutoff),
      ),
    );

  if ((daily?.completions ?? 0) > 0) {
    internal.push({
      signalKey: `daily5:${now.toISOString().slice(0, 10)}`,
      source: "INTERNAL",
      signalType: "DAILY5_MOMENT",
      title: `Daily 5 drew ${daily.completions} completed runs in the last ${lookbackHours} hours`,
      score: Math.min(94, 55 + daily.completions * 2),
      payload: {
        completions: daily.completions,
        averageScore: Number(daily.avgScore ?? 0),
        bestScore: daily.bestScore ?? 0,
        lookbackHours,
      },
      observedAt: now,
      expiresAt,
    });
  }

  const assets = await db
    .select()
    .from(contentAssets)
    .where(
      and(
        gte(contentAssets.createdAt, cutoff),
        or(isNotNull(contentAssets.imagePath), isNotNull(contentAssets.videoPath)),
      ),
    )
    .orderBy(desc(contentAssets.createdAt))
    .limit(30);

  for (const asset of assets) {
    const path = asset.videoPath || asset.imagePath;
    if (!path) continue;
    internal.push({
      signalKey: `asset:${asset.id}`,
      source: "INTERNAL",
      signalType: assetSignalType(asset.assetType),
      title: `PackPTS ${asset.assetType.toLowerCase().replaceAll("_", " ")} ready for distribution`,
      score: assetScore(asset.assetType),
      payload: {
        contentAssetId: asset.id,
        assetType: asset.assetType,
        userId: asset.userId,
        sourceEventId: asset.sourceEventId,
        metadata: asset.metadata ?? {},
        imagePath: asset.imagePath,
        videoPath: asset.videoPath,
      },
      assetPath: path,
      observedAt: asset.createdAt ?? now,
      expiresAt,
    });
  }

  const streaks = await db
    .select({
      userId: streakState.userId,
      currentDays: streakState.currentDays,
      longestDays: streakState.longestDays,
      updatedAt: streakState.updatedAt,
    })
    .from(streakState)
    .where(gte(streakState.currentDays, 7))
    .orderBy(desc(streakState.currentDays))
    .limit(10);

  for (const streak of streaks) {
    const milestone = streak.currentDays >= 30 ? 30 : streak.currentDays >= 14 ? 14 : 7;
    internal.push({
      signalKey: `streak:${streak.userId}:${milestone}`,
      source: "INTERNAL",
      signalType: "STREAK_MILESTONE",
      title: `A PackPTS player reached a ${streak.currentDays} day streak`,
      score: Math.min(96, 70 + streak.currentDays),
      payload: {
        userId: streak.userId,
        currentDays: streak.currentDays,
        longestDays: streak.longestDays,
        privacyRule: "Do not name the player unless an approved public asset already contains the public username.",
      },
      observedAt: streak.updatedAt ?? now,
      expiresAt,
    });
  }

  for (const signal of rankSignals(internal, 30)) {
    await upsertSignal(signal);
  }

  const rows = await db
    .select()
    .from(growthSignals)
    .where(
      or(
        sql`${growthSignals.expiresAt} is null`,
        gte(growthSignals.expiresAt, now),
      ),
    )
    .orderBy(desc(growthSignals.score), desc(growthSignals.observedAt))
    .limit(40);

  return rows.map((row) => ({
    id: row.id,
    signalKey: row.signalKey,
    source: row.source as GrowthSignalInput["source"],
    signalType: row.signalType as GrowthSignalInput["signalType"],
    title: row.title,
    score: row.score,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    assetPath: row.assetPath,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
  }));
}

export async function addExternalGrowthSignal(input: {
  signalType: GrowthSignalInput["signalType"];
  title: string;
  score?: number;
  payload?: Record<string, unknown>;
  assetPath?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  const signalKey = `external:${Buffer.from(input.title).toString("base64url").slice(0, 80)}`;
  await upsertSignal({
    signalKey,
    source: "EXTERNAL",
    signalType: input.signalType,
    title: input.title,
    score: Math.max(0, Math.min(100, input.score ?? 70)),
    payload: input.payload ?? {},
    assetPath: input.assetPath ?? null,
    observedAt: new Date(),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
  });
}
