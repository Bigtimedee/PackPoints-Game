/**
 * growthFlywheel/rollup.ts
 *
 * Computes one day's worth of Growth Flywheel metrics and upserts into:
 *   - global_growth_rollups  (one row per day)
 *   - user_growth_rollups    (one row per user per day)
 *
 * Aggregation sources:
 *   - gameplay_events        → DAU (distinct users with MATCH_END), matches played
 *   - daily_challenge_entries → Daily 5 completions
 *   - share_events           → total shares, invites sent (CHALLENGE_INVITE type)
 *   - referral_links         → invites sent (created that day, purpose=INVITE)
 *   - referral_attributions  → signups / first matches / first purchases from invites
 */

import { db } from "../../db";
import {
  gameplayEvents,
  dailyChallengeEntries,
  shareEvents,
  referralLinks,
  referralAttributions,
  globalGrowthRollups,
  userGrowthRollups,
} from "@shared/schema";
import { eq, and, gte, lt, count, countDistinct, sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the start/end Date objects for a YYYY-MM-DD dayKey (UTC). */
function dayBounds(dayKey: string): { start: Date; end: Date } {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000); // +24 h
  return { start, end };
}

// ── Per-day global aggregations ──────────────────────────────────────────────

async function computeGlobal(dayKey: string) {
  const { start, end } = dayBounds(dayKey);

  // DAU = distinct users who had a MATCH_END event that day
  const [dauRow] = await db
    .select({ dau: countDistinct(gameplayEvents.userId) })
    .from(gameplayEvents)
    .where(
      and(
        eq(gameplayEvents.eventType, "MATCH_END"),
        gte(gameplayEvents.createdAt, start),
        lt(gameplayEvents.createdAt, end),
      ),
    );

  // Matches played = number of MATCH_END events (one per match per user)
  const [matchRow] = await db
    .select({ matchesPlayed: count() })
    .from(gameplayEvents)
    .where(
      and(
        eq(gameplayEvents.eventType, "MATCH_END"),
        gte(gameplayEvents.createdAt, start),
        lt(gameplayEvents.createdAt, end),
      ),
    );

  // Daily 5 completions that day
  const [d5Row] = await db
    .select({ daily5Entries: count() })
    .from(dailyChallengeEntries)
    .where(
      and(
        gte(dailyChallengeEntries.completedAt, start),
        lt(dailyChallengeEntries.completedAt, end),
      ),
    );

  // Total shares
  const [shareRow] = await db
    .select({ sharesTotal: count() })
    .from(shareEvents)
    .where(and(gte(shareEvents.createdAt, start), lt(shareEvents.createdAt, end)));

  // Invites sent = referral links with purpose=INVITE created that day
  const [inviteRow] = await db
    .select({ invitesSent: count() })
    .from(referralLinks)
    .where(
      and(
        eq(referralLinks.purpose, "INVITE"),
        gte(referralLinks.createdAt, start),
        lt(referralLinks.createdAt, end),
      ),
    );

  // Signups, first matches, first purchases from invites (attributions created that day)
  const attrRows = await db
    .select({ eventType: referralAttributions.eventType, cnt: count() })
    .from(referralAttributions)
    .where(
      and(
        gte(referralAttributions.createdAt, start),
        lt(referralAttributions.createdAt, end),
      ),
    )
    .groupBy(referralAttributions.eventType);

  const attrMap = Object.fromEntries(attrRows.map((r) => [r.eventType, Number(r.cnt)]));

  const dau = Number(dauRow?.dau ?? 0);
  const invitesSent = Number(inviteRow?.invitesSent ?? 0);
  const signupsFromInvites = attrMap["SIGNUP"] ?? 0;
  const kFactor = dau > 0 ? signupsFromInvites / dau : null;

  return {
    dayKey,
    dau,
    matchesPlayed: Number(matchRow?.matchesPlayed ?? 0),
    daily5Entries: Number(d5Row?.daily5Entries ?? 0),
    sharesTotal: Number(shareRow?.sharesTotal ?? 0),
    invitesSent,
    signupsFromInvites,
    firstMatchesFromInvites: attrMap["FIRST_MATCH"] ?? 0,
    firstPurchasesFromInvites: attrMap["FIRST_PURCHASE"] ?? 0,
    kFactor,
    computedAt: new Date(),
  };
}

// ── Per-user aggregations ─────────────────────────────────────────────────────

async function computePerUser(dayKey: string) {
  const { start, end } = dayBounds(dayKey);

  // Matches played per user
  const matchRows = await db
    .select({
      userId: gameplayEvents.userId,
      matchesPlayed: count(),
    })
    .from(gameplayEvents)
    .where(
      and(
        eq(gameplayEvents.eventType, "MATCH_END"),
        gte(gameplayEvents.createdAt, start),
        lt(gameplayEvents.createdAt, end),
      ),
    )
    .groupBy(gameplayEvents.userId);

  // Daily 5 entries per user (join to get userId)
  const d5Rows = await db
    .select({
      userId: dailyChallengeEntries.userId,
      daily5Entries: count(),
    })
    .from(dailyChallengeEntries)
    .where(
      and(
        gte(dailyChallengeEntries.completedAt, start),
        lt(dailyChallengeEntries.completedAt, end),
      ),
    )
    .groupBy(dailyChallengeEntries.userId);

  // Shares per user
  const shareRows = await db
    .select({ userId: shareEvents.userId, sharesTotal: count() })
    .from(shareEvents)
    .where(and(gte(shareEvents.createdAt, start), lt(shareEvents.createdAt, end)))
    .groupBy(shareEvents.userId);

  // Invites sent per user (referral links with purpose=INVITE)
  const inviteRows = await db
    .select({ userId: referralLinks.createdByUserId, invitesSent: count() })
    .from(referralLinks)
    .where(
      and(
        eq(referralLinks.purpose, "INVITE"),
        gte(referralLinks.createdAt, start),
        lt(referralLinks.createdAt, end),
      ),
    )
    .groupBy(referralLinks.createdByUserId);

  // Signups from invites per inviting user (join referral_links → referral_attributions)
  const signupRows = await db
    .select({
      userId: referralLinks.createdByUserId,
      signupsFromInvites: count(),
    })
    .from(referralAttributions)
    .innerJoin(referralLinks, eq(referralAttributions.referralLinkId, referralLinks.id))
    .where(
      and(
        eq(referralAttributions.eventType, "SIGNUP"),
        gte(referralAttributions.createdAt, start),
        lt(referralAttributions.createdAt, end),
      ),
    )
    .groupBy(referralLinks.createdByUserId);

  // Merge into a user map
  const userMap = new Map<
    string,
    {
      matchesPlayed: number;
      daily5Entries: number;
      sharesTotal: number;
      invitesSent: number;
      signupsFromInvites: number;
    }
  >();

  const ensure = (uid: string) => {
    if (!userMap.has(uid)) {
      userMap.set(uid, {
        matchesPlayed: 0,
        daily5Entries: 0,
        sharesTotal: 0,
        invitesSent: 0,
        signupsFromInvites: 0,
      });
    }
    return userMap.get(uid)!;
  };

  for (const r of matchRows) ensure(r.userId).matchesPlayed = Number(r.matchesPlayed);
  for (const r of d5Rows) ensure(r.userId).daily5Entries = Number(r.daily5Entries);
  for (const r of shareRows) ensure(r.userId).sharesTotal = Number(r.sharesTotal);
  for (const r of inviteRows) ensure(r.userId).invitesSent = Number(r.invitesSent);
  for (const r of signupRows) ensure(r.userId).signupsFromInvites = Number(r.signupsFromInvites);

  return Array.from(userMap.entries()).map(([userId, vals]) => ({
    userId,
    dayKey,
    ...vals,
    computedAt: new Date(),
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute and upsert growth flywheel rollups for a single day.
 * Idempotent — safe to re-run for the same dayKey.
 */
export async function computeRollup(dayKey: string): Promise<{ dayKey: string; dau: number }> {
  const globalData = await computeGlobal(dayKey);
  const perUserData = await computePerUser(dayKey);

  // Upsert global rollup
  await db
    .insert(globalGrowthRollups)
    .values(globalData)
    .onConflictDoUpdate({
      target: globalGrowthRollups.dayKey,
      set: {
        dau: sql`excluded.dau`,
        matchesPlayed: sql`excluded.matches_played`,
        daily5Entries: sql`excluded.daily5_entries`,
        sharesTotal: sql`excluded.shares_total`,
        invitesSent: sql`excluded.invites_sent`,
        signupsFromInvites: sql`excluded.signups_from_invites`,
        firstMatchesFromInvites: sql`excluded.first_matches_from_invites`,
        firstPurchasesFromInvites: sql`excluded.first_purchases_from_invites`,
        kFactor: sql`excluded.k_factor`,
        computedAt: sql`excluded.computed_at`,
      },
    });

  // Upsert per-user rollups in batches of 100
  const BATCH = 100;
  for (let i = 0; i < perUserData.length; i += BATCH) {
    const batch = perUserData.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    await db
      .insert(userGrowthRollups)
      .values(batch)
      .onConflictDoUpdate({
        target: [userGrowthRollups.userId, userGrowthRollups.dayKey],
        set: {
          matchesPlayed: sql`excluded.matches_played`,
          daily5Entries: sql`excluded.daily5_entries`,
          sharesTotal: sql`excluded.shares_total`,
          invitesSent: sql`excluded.invites_sent`,
          signupsFromInvites: sql`excluded.signups_from_invites`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  return { dayKey, dau: globalData.dau };
}
