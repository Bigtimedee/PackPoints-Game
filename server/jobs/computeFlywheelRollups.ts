import { db } from "../db";
import { 
  gameSessionsTable, shareEvents, referralLinks, referralAttributions,
  userGrowthRollups, globalGrowthRollups, users, ledgerEntries
} from "@shared/schema";
import { eq, and, sql, gte, lt, count } from "drizzle-orm";

export async function computeFlywheelRollups(dateStr?: string): Promise<{
  date: string;
  dau: number;
  matches: number;
  daily5Entries: number;
  shares: number;
  invites: number;
  signupsFromInvites: number;
  kFactor: number;
  userRollups: number;
}> {
  const date = dateStr || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  console.log(`[FlywheelRollup] Computing rollups for ${date}`);

  const dayStartStr = dayStart.toISOString();
  const dayEndStr = new Date(dayEnd.getTime() + 1).toISOString();

  const matchesResult = await db.select({
    userId: gameSessionsTable.userId,
    matchCount: sql<number>`count(*)`,
  })
    .from(gameSessionsTable)
    .where(and(
      gte(gameSessionsTable.completedAt, dayStartStr),
      lt(gameSessionsTable.completedAt, dayEndStr),
      eq(gameSessionsTable.status, "completed"),
    ))
    .groupBy(gameSessionsTable.userId);

  const sharesResult = await db.select({
    userId: shareEvents.userId,
    shareCount: sql<number>`count(*)`,
  })
    .from(shareEvents)
    .where(and(
      gte(shareEvents.createdAt, dayStart),
      lt(shareEvents.createdAt, new Date(dayEnd.getTime() + 1)),
    ))
    .groupBy(shareEvents.userId);

  const invitesResult = await db.select({
    userId: referralLinks.createdByUserId,
    inviteCount: sql<number>`count(distinct ${referralAttributions.invitedUserId})`,
  })
    .from(referralAttributions)
    .innerJoin(referralLinks, eq(referralAttributions.referralLinkId, referralLinks.id))
    .where(and(
      gte(referralAttributions.createdAt, dayStart),
      lt(referralAttributions.createdAt, new Date(dayEnd.getTime() + 1)),
    ))
    .groupBy(referralLinks.createdByUserId);

  const signupInvites = await db.select({
    cnt: sql<number>`count(*)`,
  })
    .from(referralAttributions)
    .where(and(
      eq(referralAttributions.eventType, "SIGNUP"),
      gte(referralAttributions.createdAt, dayStart),
      lt(referralAttributions.createdAt, new Date(dayEnd.getTime() + 1)),
    ));

  const activeUsers = new Set<string>();
  matchesResult.forEach(r => { if (r.userId) activeUsers.add(r.userId); });
  sharesResult.forEach(r => activeUsers.add(r.userId));

  const matchMap = new Map(matchesResult.map(r => [r.userId, Number(r.matchCount)]));
  const shareMap = new Map(sharesResult.map(r => [r.userId, Number(r.shareCount)]));
  const inviteMap = new Map(invitesResult.map(r => [r.userId, Number(r.inviteCount)]));

  const allUserIds = new Set(
    Array.from(matchMap.keys())
      .concat(Array.from(shareMap.keys()))
      .concat(Array.from(inviteMap.keys()))
  );

  let userRollupCount = 0;
  for (const userId of Array.from(allUserIds)) {
    if (!userId) continue;
    const values = {
      userId,
      date,
      matchesPlayed: matchMap.get(userId) || 0,
      daily5Played: 0,
      correctAnswers: 0,
      packptsEarned: 0,
      packptsSpent: 0,
      sharesCount: shareMap.get(userId) || 0,
      referralsSent: inviteMap.get(userId) || 0,
      invitedSignups: 0,
    };

    await db.insert(userGrowthRollups)
      .values(values)
      .onConflictDoUpdate({
        target: [userGrowthRollups.userId, userGrowthRollups.date],
        set: {
          matchesPlayed: sql`excluded.matches_played`,
          sharesCount: sql`excluded.shares_count`,
          referralsSent: sql`excluded.referrals_sent`,
        },
      });
    userRollupCount++;
  }

  const totalMatches = Array.from(matchMap.values()).reduce((s, v) => s + v, 0);
  const totalShares = Array.from(shareMap.values()).reduce((s, v) => s + v, 0);
  const totalInvites = Array.from(inviteMap.values()).reduce((s, v) => s + v, 0);
  const totalSignupsFromInvites = Number(signupInvites[0]?.cnt || 0);

  const dau = activeUsers.size;
  const kFactor = dau > 0 && totalInvites > 0
    ? (totalInvites / dau) * (totalSignupsFromInvites / Math.max(totalInvites, 1))
    : 0;

  await db.insert(globalGrowthRollups)
    .values({
      date,
      dau,
      matches: totalMatches,
      daily5Entries: 0,
      shares: totalShares,
      invites: totalInvites,
      signupsFromInvites: totalSignupsFromInvites,
      kFactorEstimate: Math.round(kFactor * 1000) / 1000,
    })
    .onConflictDoUpdate({
      target: [globalGrowthRollups.date],
      set: {
        dau: sql`excluded.dau`,
        matches: sql`excluded.matches`,
        shares: sql`excluded.shares`,
        invites: sql`excluded.invites`,
        signupsFromInvites: sql`excluded.signups_from_invites`,
        kFactorEstimate: sql`excluded.k_factor_estimate`,
      },
    });

  console.log(`[FlywheelRollup] Done for ${date}: DAU=${dau}, matches=${totalMatches}, shares=${totalShares}, invites=${totalInvites}, K=${kFactor.toFixed(3)}, userRollups=${userRollupCount}`);

  return {
    date,
    dau,
    matches: totalMatches,
    daily5Entries: 0,
    shares: totalShares,
    invites: totalInvites,
    signupsFromInvites: totalSignupsFromInvites,
    kFactor,
    userRollups: userRollupCount,
  };
}
