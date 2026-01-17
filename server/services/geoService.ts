import crypto from "crypto";
import { db } from "../db";
import { userGeoSession, userGeoProfile, geoRollupsDaily } from "@shared/schema";
import { eq, sql, and, gte, desc } from "drizzle-orm";

const GEO_SALT = process.env.GEO_SALT || crypto.randomBytes(32).toString("hex");
const GEO_TTL_DAYS = parseInt(process.env.GEO_TTL_DAYS || "30", 10);
const HOME_STATE_MIN_DISTINCT_DAYS = parseInt(process.env.HOME_STATE_MIN_DISTINCT_DAYS || "3", 10);
const HOME_STATE_MIN_SESSIONS = parseInt(process.env.HOME_STATE_MIN_SESSIONS || "5", 10);
const IPINFO_TOKEN = process.env.IPINFO_TOKEN;
const GEO_PROVIDER = process.env.GEO_PROVIDER || "ipinfo";
const GEO_TIMEOUT_MS = parseInt(process.env.GEO_TIMEOUT_MS || "3000", 10);

if (!process.env.GEO_SALT) {
  console.warn("[Geo] WARNING: GEO_SALT not configured. Using randomly generated salt which will change on restart. Set GEO_SALT env var for consistent IP hashing.");
}

const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
];

const TIMEZONE_STATE_MAP: Record<string, string[]> = {
  "America/New_York": ["NY", "NJ", "CT", "MA", "RI", "VT", "NH", "ME", "PA", "DE", "MD", "VA", "WV", "NC", "SC", "GA", "FL", "OH", "MI", "IN"],
  "America/Chicago": ["IL", "WI", "MN", "IA", "MO", "AR", "LA", "MS", "AL", "TN", "KY", "KS", "NE", "SD", "ND", "OK", "TX"],
  "America/Denver": ["CO", "WY", "MT", "UT", "NM", "AZ"],
  "America/Los_Angeles": ["CA", "WA", "OR", "NV"],
  "America/Phoenix": ["AZ"],
  "America/Anchorage": ["AK"],
  "Pacific/Honolulu": ["HI"],
};

export interface GeoData {
  country?: string;
  region?: string;
  asn?: string;
  carrierName?: string;
  isVpn?: boolean;
  city?: string;
}

export interface GeoSessionData {
  userId?: string;
  sessionId?: string;
  ipHash?: string;
  userAgent?: string;
  timezone?: string;
  country?: string;
  region?: string;
  asn?: string;
  carrierName?: string;
  isVpn?: boolean;
  source: "http" | "ws";
  geoConfidence: number;
}

export function hashIp(ip: string): string {
  return crypto.createHmac("sha256", GEO_SALT).update(ip).digest("hex");
}

export function normalizeStateCode(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const upper = region.toUpperCase().trim();
  if (US_STATE_CODES.includes(upper)) return upper;
  
  const stateNameMap: Record<string, string> = {
    "CALIFORNIA": "CA", "TEXAS": "TX", "FLORIDA": "FL", "NEW YORK": "NY",
    "PENNSYLVANIA": "PA", "ILLINOIS": "IL", "OHIO": "OH", "GEORGIA": "GA",
    "NORTH CAROLINA": "NC", "MICHIGAN": "MI", "NEW JERSEY": "NJ",
    "VIRGINIA": "VA", "WASHINGTON": "WA", "ARIZONA": "AZ", "MASSACHUSETTS": "MA",
    "TENNESSEE": "TN", "INDIANA": "IN", "MARYLAND": "MD", "MISSOURI": "MO",
    "WISCONSIN": "WI", "COLORADO": "CO", "MINNESOTA": "MN", "SOUTH CAROLINA": "SC",
    "ALABAMA": "AL", "LOUISIANA": "LA", "KENTUCKY": "KY", "OREGON": "OR",
    "OKLAHOMA": "OK", "CONNECTICUT": "CT", "UTAH": "UT", "IOWA": "IA",
    "NEVADA": "NV", "ARKANSAS": "AR", "MISSISSIPPI": "MS", "KANSAS": "KS",
    "NEW MEXICO": "NM", "NEBRASKA": "NE", "IDAHO": "ID", "WEST VIRGINIA": "WV",
    "HAWAII": "HI", "NEW HAMPSHIRE": "NH", "MAINE": "ME", "MONTANA": "MT",
    "RHODE ISLAND": "RI", "DELAWARE": "DE", "SOUTH DAKOTA": "SD",
    "NORTH DAKOTA": "ND", "ALASKA": "AK", "VERMONT": "VT", "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC", "D.C.": "DC",
  };
  
  return stateNameMap[upper] || undefined;
}

export async function resolveGeo(ip: string): Promise<GeoData> {
  if (!IPINFO_TOKEN) {
    console.log("[Geo] No IPINFO_TOKEN configured, skipping geo resolution");
    return {};
  }

  if (GEO_PROVIDER !== "ipinfo") {
    console.log("[Geo] Only ipinfo provider is currently supported");
    return {};
  }

  try {
    const cleanIp = ip.replace(/^::ffff:/, "");
    if (cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp.startsWith("192.168.") || cleanIp.startsWith("10.")) {
      return { country: "US", region: undefined };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);

    try {
      const response = await fetch(`https://ipinfo.io/${cleanIp}?token=${IPINFO_TOKEN}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[Geo] ipinfo.io error: ${response.status}`);
        return {};
      }

      const data = await response.json();
      
      return {
        country: data.country || undefined,
        region: data.country === "US" ? normalizeStateCode(data.region) : data.region,
        asn: data.org || undefined,
        carrierName: data.carrier?.name || undefined,
        isVpn: data.privacy?.vpn || data.privacy?.proxy || data.privacy?.tor || false,
        city: data.city || undefined,
      };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === "AbortError") {
        console.warn("[Geo] ipinfo.io request timed out after", GEO_TIMEOUT_MS, "ms");
      } else {
        throw fetchError;
      }
      return {};
    }
  } catch (error) {
    console.error("[Geo] Failed to resolve geo:", error);
    return {};
  }
}

export function computeConfidence(
  geoData: GeoData,
  timezone?: string,
  existingSameRegion?: boolean
): number {
  let confidence = 50;

  if (geoData.isVpn) {
    confidence -= 30;
  }

  if (existingSameRegion) {
    confidence += 10;
  }

  if (timezone && geoData.region && geoData.country === "US") {
    const matchingStates = TIMEZONE_STATE_MAP[timezone];
    if (matchingStates?.includes(geoData.region)) {
      confidence += 10;
    }
    if (timezone === "Pacific/Honolulu" && geoData.region === "HI") {
      confidence += 15;
    }
  }

  return Math.max(0, Math.min(100, confidence));
}

export async function checkRecentSameRegion(
  ipHash: string,
  region: string | undefined
): Promise<boolean> {
  if (!region) return false;
  
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [existing] = await db
    .select()
    .from(userGeoSession)
    .where(
      and(
        eq(userGeoSession.ipHash, ipHash),
        eq(userGeoSession.region, region),
        gte(userGeoSession.lastSeenAt, oneDayAgo)
      )
    )
    .limit(1);
  
  return !!existing;
}

export async function upsertGeoSession(data: GeoSessionData): Promise<void> {
  const { sessionId, userId, ...rest } = data;
  
  if (sessionId) {
    const [existing] = await db
      .select()
      .from(userGeoSession)
      .where(eq(userGeoSession.sessionId, sessionId))
      .limit(1);
    
    if (existing) {
      await db.update(userGeoSession)
        .set({
          lastSeenAt: new Date(),
          userId: userId || existing.userId,
          ...rest,
        })
        .where(eq(userGeoSession.id, existing.id));
      return;
    }
  }

  await db.insert(userGeoSession).values({
    userId,
    sessionId,
    startedAt: new Date(),
    lastSeenAt: new Date(),
    ...rest,
  });
}

export async function computeHomeState(userId: string): Promise<void> {
  const cutoffDate = new Date(Date.now() - GEO_TTL_DAYS * 24 * 60 * 60 * 1000);
  
  const sessions = await db
    .select()
    .from(userGeoSession)
    .where(
      and(
        eq(userGeoSession.userId, userId),
        gte(userGeoSession.startedAt, cutoffDate)
      )
    );

  if (sessions.length === 0) {
    await db.delete(userGeoProfile).where(eq(userGeoProfile.userId, userId));
    return;
  }

  const regionStats: Record<string, {
    sessions: number;
    distinctDays: Set<string>;
    weightedScore: number;
  }> = {};

  const now = Date.now();
  
  for (const session of sessions) {
    const region = session.region;
    if (!region || session.country !== "US") continue;

    if (!regionStats[region]) {
      regionStats[region] = { sessions: 0, distinctDays: new Set(), weightedScore: 0 };
    }

    regionStats[region].sessions++;
    regionStats[region].distinctDays.add(session.startedAt.toISOString().split("T")[0]);

    const recencyDays = (now - session.startedAt.getTime()) / (24 * 60 * 60 * 1000);
    const weight = Math.exp(-recencyDays / 10);
    regionStats[region].weightedScore += weight * (session.geoConfidence / 100);
  }

  const sortedRegions = Object.entries(regionStats)
    .map(([region, stats]) => ({
      region,
      sessions: stats.sessions,
      distinctDays: stats.distinctDays.size,
      weightedScore: stats.weightedScore,
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const top = sortedRegions[0];
  let homeRegion: string | null = null;
  let confidence = 0;

  if (
    top &&
    top.distinctDays >= HOME_STATE_MIN_DISTINCT_DAYS &&
    top.sessions >= HOME_STATE_MIN_SESSIONS
  ) {
    homeRegion = top.region;
    confidence = Math.min(100, Math.round(
      (top.distinctDays / 7) * 30 +
      (top.sessions / 10) * 30 +
      top.weightedScore * 40
    ));
  }

  const basis = {
    topStates: sortedRegions.slice(0, 3).map(s => ({
      state: s.region,
      sessions: s.sessions,
      days: s.distinctDays,
      score: Math.round(s.weightedScore * 100) / 100,
    })),
    totalSessions: sessions.length,
  };

  await db
    .insert(userGeoProfile)
    .values({
      userId,
      homeCountry: "US",
      homeRegion,
      confidence,
      basis,
      lastComputedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userGeoProfile.userId,
      set: {
        homeCountry: "US",
        homeRegion,
        confidence,
        basis,
        lastComputedAt: new Date(),
      },
    });
}

export async function computeAllHomeStates(): Promise<number> {
  const cutoffDate = new Date(Date.now() - GEO_TTL_DAYS * 24 * 60 * 60 * 1000);
  
  const usersWithSessions = await db
    .selectDistinct({ userId: userGeoSession.userId })
    .from(userGeoSession)
    .where(
      and(
        sql`${userGeoSession.userId} IS NOT NULL`,
        gte(userGeoSession.startedAt, cutoffDate)
      )
    );

  let count = 0;
  for (const row of usersWithSessions) {
    if (row.userId) {
      await computeHomeState(row.userId);
      count++;
    }
  }
  
  console.log(`[Geo] Computed home states for ${count} users`);
  return count;
}

export async function computeDailyRollups(targetDate?: Date): Promise<void> {
  const day = targetDate || new Date();
  day.setUTCHours(0, 0, 0, 0);
  
  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const rollupData = await db
    .select({
      country: userGeoSession.country,
      region: userGeoSession.region,
      activeUsers: sql<number>`COUNT(DISTINCT ${userGeoSession.userId})`.as("active_users"),
      sessions: sql<number>`COUNT(*)`.as("sessions"),
    })
    .from(userGeoSession)
    .where(
      and(
        gte(userGeoSession.startedAt, day),
        sql`${userGeoSession.startedAt} < ${nextDay}`,
        sql`${userGeoSession.country} IS NOT NULL`,
        sql`${userGeoSession.region} IS NOT NULL`
      )
    )
    .groupBy(userGeoSession.country, userGeoSession.region);

  for (const row of rollupData) {
    if (!row.country || !row.region) continue;
    
    await db
      .insert(geoRollupsDaily)
      .values({
        day,
        country: row.country,
        region: row.region,
        activeUsers: row.activeUsers,
        sessions: row.sessions,
        newUsers: 0,
      })
      .onConflictDoNothing();
  }

  console.log(`[Geo] Computed daily rollups for ${day.toISOString().split("T")[0]}: ${rollupData.length} regions`);
}

export async function getGeoStats(windowDays: number = 30): Promise<{
  states: Array<{
    state: string;
    activeUsers: number;
    sessions: number;
    pctOfTotal: number;
  }>;
  total: { users: number; sessions: number };
}> {
  const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  const stats = await db
    .select({
      region: userGeoSession.region,
      activeUsers: sql<number>`COUNT(DISTINCT ${userGeoSession.userId})`.as("active_users"),
      sessions: sql<number>`COUNT(*)`.as("sessions"),
    })
    .from(userGeoSession)
    .where(
      and(
        gte(userGeoSession.startedAt, cutoffDate),
        eq(userGeoSession.country, "US"),
        sql`${userGeoSession.region} IS NOT NULL`
      )
    )
    .groupBy(userGeoSession.region)
    .orderBy(desc(sql`active_users`));

  const totalUsers = stats.reduce((sum, s) => sum + s.activeUsers, 0);
  const totalSessions = stats.reduce((sum, s) => sum + s.sessions, 0);

  return {
    states: stats.map(s => ({
      state: s.region || "Unknown",
      activeUsers: s.activeUsers,
      sessions: s.sessions,
      pctOfTotal: totalUsers > 0 ? Math.round((s.activeUsers / totalUsers) * 10000) / 100 : 0,
    })),
    total: { users: totalUsers, sessions: totalSessions },
  };
}

export async function getCoverageStats(windowDays: number = 30): Promise<{
  statesWithUsers: string[];
  statesWithoutUsers: string[];
  hiCount: number;
  hasHawaiiUsers: boolean;
  caCount: number;
  maCount: number;
}> {
  const { states } = await getGeoStats(windowDays);
  const stateSet = new Set(states.map(s => s.state));
  
  const statesWithUsers = US_STATE_CODES.filter(s => stateSet.has(s));
  const statesWithoutUsers = US_STATE_CODES.filter(s => !stateSet.has(s));
  
  const hiStat = states.find(s => s.state === "HI");
  const caStat = states.find(s => s.state === "CA");
  const maStat = states.find(s => s.state === "MA");

  return {
    statesWithUsers,
    statesWithoutUsers,
    hiCount: hiStat?.activeUsers || 0,
    hasHawaiiUsers: !!hiStat && hiStat.activeUsers > 0,
    caCount: caStat?.activeUsers || 0,
    maCount: maStat?.activeUsers || 0,
  };
}

export async function getUserGeoProfile(userId: string): Promise<{
  profile: typeof userGeoProfile.$inferSelect | null;
  recentSessions: Array<{
    startedAt: Date;
    region: string | null;
    confidence: number;
    source: string;
  }>;
}> {
  const [profile] = await db
    .select()
    .from(userGeoProfile)
    .where(eq(userGeoProfile.userId, userId))
    .limit(1);

  const recentSessions = await db
    .select({
      startedAt: userGeoSession.startedAt,
      region: userGeoSession.region,
      confidence: userGeoSession.geoConfidence,
      source: userGeoSession.source,
    })
    .from(userGeoSession)
    .where(eq(userGeoSession.userId, userId))
    .orderBy(desc(userGeoSession.startedAt))
    .limit(10);

  return {
    profile: profile || null,
    recentSessions,
  };
}

export const geoService = {
  hashIp,
  resolveGeo,
  normalizeStateCode,
  computeConfidence,
  checkRecentSameRegion,
  upsertGeoSession,
  computeHomeState,
  computeAllHomeStates,
  computeDailyRollups,
  getGeoStats,
  getCoverageStats,
  getUserGeoProfile,
};
