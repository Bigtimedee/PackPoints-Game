/**
 * Aggregate signup counts for GET /api/qa/signups.
 * Counts only. No user ids, names, emails, or raw referrer URLs leave this module.
 * Signup time is users.created_at. Day keys use America/Chicago.
 */

import { addPackptsDays, getPackptsDayKey, PACKPTS_DAY_TZ } from "@shared/packptsDay";

export const SIGNUP_REPORT_TIMEZONE = PACKPTS_DAY_TZ;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const SIGNUP_DAILY_DAYS = 14;

export const SIGNUP_EXCLUSION_RULE =
  "totals, bySource, daily, and authProviders count users where is_admin is false and is_bot is false. totals.excluded reports the rows left out, for the same all-time, rolling 24h, and rolling 7d windows. staffAdmin is users.is_admin (the only staff and admin flag; a row that is also is_bot counts here once). bots is users.is_bot when is_admin is false. test and qa are null: the schema has no column that identifies test or QA accounts, and this report does not guess from username or email. anon_players are not users and are not counted.";

export const SIGNUP_SOURCE_RULE =
  "One bucket per included user, from the first stored touch. Order: utm_medium beatme or the earliest referral SIGNUP whose link purpose is DAILY5_CHALLENGE → beat_me_link; utm_medium play_sets or purpose SCORE_SHARE → share_card; purpose INVITE → referral; otherwise a sanitized utm_source (lowercase, letters, digits, underscore, max 40; the values unattributed and unknown are prefixed utm_ so they cannot fill those residual buckets); otherwise, when a user_attribution row exists, referrer host ebay.com → ebay and x.com, twitter.com, or t.co → x; otherwise an attribution row with no utm_source, no utm_medium, no utm_campaign, and no referrer → direct (a landing page alone is still direct); otherwise an attribution row or an unrecognized referrer → unknown; no attribution row and no SIGNUP referral → unattributed. Each bySource window sums to that window's total. last24h and last7d are rolling from generatedAt. Daily days are America/Chicago calendar dates. Signup time is users.created_at.";

export const SIGNUP_AUTH_PROVIDER_RULE =
  "Counted on the same included users as totals. One method each, so the four counts sum to the window total: apple when an apple_users row exists, else workos when users.workos_user_id is set, else email when a local_credentials row exists, else none. Google is not stored. WorkOS AuthKit may include Google and is still workos.";

export const SIGNUP_WINDOWS = {
  last24h: "created_at in the 24 hours ending at generatedAt, inclusive of the start instant",
  last7d: "created_at in the 7×24 hours ending at generatedAt, inclusive of the start instant",
  daily: "14 America/Chicago dates ending on the CT date of generatedAt, oldest first, zero-filled",
} as const;

export const SIGNUP_SOURCE_GAPS = [
  "Attribution is written only for users created after first-touch capture shipped. Earlier accounts have no user_attribution row and stay unattributed.",
  "The web client stores first touch (utm_*, ref, landing path, external referrer host) in localStorage for 30 days. The first tagged touch wins; a plain visit with no utm and no ref can be replaced once by a later tagged touch. Visitors who clear storage, use another browser or device, or block storage arrive untagged.",
  "Every register path writes user_attribution when any field is present: POST /api/auth/register (/auth page and SignupModal send the stored fields), WorkOS (GET /api/auth/workos/callback reads the pp_attr cookie set by POST /api/auth/attribution before the redirect), and Sign in with Apple (POST /api/auth/apple reads an attribution body object or the pp_attr cookie). Only newly created users are written; logins never change an existing row.",
  "A ref code (from GET /r/:code) records a referral SIGNUP only when the link is active, not expired, and not the new user's own link.",
  "Web Sign in with Apple that returns by a cross-site form POST does not carry the SameSite=Lax pp_attr cookie, so it is attributed only when the client sends the attribution body object.",
  "user_attribution.referrer holds the external referrer host only (no path or query). Our own hosts are dropped.",
  "eBay affiliate clicks and X posts are not copied onto the user at signup. There is no eBay or X column on users. A referrer host of ebay.com, x.com, twitter.com, or t.co is used only when a user_attribution row exists and utm_source is empty.",
  "Google is not a stored sign-in method. user_identities.provider is local or workos, and users.workos_user_id does not record the WorkOS IdP. Google sign-in through AuthKit is counted as workos.",
  "users has is_admin and is_bot. It has no test or QA flag. Test and QA accounts are not inferred from username or email. Development POST /api/test/login and seedMockUsers can insert users with neither flag and no attribution; those rows stay in the registered totals as unattributed.",
] as const;

export type ReferralPurpose = "INVITE" | "DAILY5_CHALLENGE" | "SCORE_SHARE";

export type SignupSourceRow = {
  createdAt: Date | null;
  isAdmin: boolean;
  isBot: boolean;
  hasWorkos: boolean;
  hasApple: boolean;
  hasEmail: boolean;
  hasAttributionRow: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  referralPurpose: ReferralPurpose | null;
};

export type ExcludedBreakdown = {
  staffAdmin: number;
  bots: number;
  test: null;
  qa: null;
};

export type AuthProviderCounts = {
  workos: number;
  email: number;
  apple: number;
  none: number;
};

export type SignupCountReport = {
  generatedAt: string;
  timezone: typeof SIGNUP_REPORT_TIMEZONE;
  exclusionRule: string;
  sourceRule: string;
  authProviderRule: string;
  windows: typeof SIGNUP_WINDOWS;
  totals: {
    allTime: number;
    last24h: number;
    last7d: number;
    excluded: {
      allTime: ExcludedBreakdown;
      last24h: ExcludedBreakdown;
      last7d: ExcludedBreakdown;
    };
  };
  bySource: {
    allTime: Record<string, number>;
    last24h: Record<string, number>;
    last7d: Record<string, number>;
  };
  daily: Array<{
    day: string;
    signups: number;
    topSource: string | null;
    bySource: Record<string, number>;
  }>;
  authProviders: {
    allTime: AuthProviderCounts;
    last24h: AuthProviderCounts;
    last7d: AuthProviderCounts;
  };
  gaps: readonly string[];
};

const RESERVED_UTM = new Set(["unattributed", "unknown"]);

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function sanitizeUtmSource(raw: string | null | undefined): string | null {
  const cleaned = norm(raw)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!cleaned) return null;
  if (RESERVED_UTM.has(cleaned)) return `utm_${cleaned}`;
  return cleaned;
}

function referrerHostBucket(referrer: string | null): string | null {
  const raw = (referrer ?? "").trim();
  if (!raw) return null;
  let host = "";
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host === "ebay.com" || host.endsWith(".ebay.com")) return "ebay";
  if (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com") ||
    host === "t.co"
  ) {
    return "x";
  }
  return null;
}

export function signupSourceBucket(row: SignupSourceRow): string {
  const medium = norm(row.utmMedium);
  const purpose = row.referralPurpose;
  if (medium === "beatme" || purpose === "DAILY5_CHALLENGE") return "beat_me_link";
  if (medium === "play_sets" || purpose === "SCORE_SHARE") return "share_card";
  if (purpose === "INVITE") return "referral";
  const source = sanitizeUtmSource(row.utmSource);
  if (source) return source;
  if (!row.hasAttributionRow && !purpose) return "unattributed";
  const hostBucket = referrerHostBucket(row.referrer);
  if (hostBucket) return hostBucket;
  const campaign = norm(row.utmCampaign);
  const referrer = (row.referrer ?? "").trim();
  if (row.hasAttributionRow && !campaign && !medium && !referrer) return "direct";
  return "unknown";
}

function authProvider(row: SignupSourceRow): keyof AuthProviderCounts {
  if (row.hasApple) return "apple";
  if (row.hasWorkos) return "workos";
  if (row.hasEmail) return "email";
  return "none";
}

function emptyExcluded(): ExcludedBreakdown {
  return { staffAdmin: 0, bots: 0, test: null, qa: null };
}

function emptyProviders(): AuthProviderCounts {
  return { workos: 0, email: 0, apple: 0, none: 0 };
}

function inRollingWindow(createdAt: Date | null, now: Date, windowMs: number): boolean {
  if (!createdAt) return false;
  const t = createdAt.getTime();
  if (Number.isNaN(t)) return false;
  return t <= now.getTime() && t >= now.getTime() - windowMs;
}

function toCountMap(counts: Map<string, number>, keepZeroUnattributed: boolean): Record<string, number> {
  const entries = [...counts.entries()].filter(([key, n]) => n > 0 && key !== "unattributed");
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const unattributed = counts.get("unattributed") ?? 0;
  if (unattributed > 0 || keepZeroUnattributed) entries.push(["unattributed", unattributed]);
  return Object.fromEntries(entries);
}

function topSource(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n <= 0) continue;
    if (best === null || n > bestN || (n === bestN && key < best)) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function buildSignupReport(rows: SignupSourceRow[], now = new Date()): SignupCountReport {
  const allTime = new Map<string, number>();
  const last24h = new Map<string, number>();
  const last7d = new Map<string, number>();
  const excluded = {
    allTime: emptyExcluded(),
    last24h: emptyExcluded(),
    last7d: emptyExcluded(),
  };
  const providers = {
    allTime: emptyProviders(),
    last24h: emptyProviders(),
    last7d: emptyProviders(),
  };

  const today = getPackptsDayKey(now);
  const dayKeys: string[] = [];
  for (let i = SIGNUP_DAILY_DAYS - 1; i >= 0; i -= 1) {
    dayKeys.push(addPackptsDays(today, -i));
  }
  const daySet = new Set(dayKeys);
  const dailyMaps = new Map<string, Map<string, number>>(dayKeys.map((day) => [day, new Map()]));

  let allTimeTotal = 0;
  let last24hTotal = 0;
  let last7dTotal = 0;

  for (const row of rows) {
    const createdAt = row.createdAt && !Number.isNaN(row.createdAt.getTime()) ? row.createdAt : null;
    const within24h = inRollingWindow(createdAt, now, DAY_MS);
    const within7d = inRollingWindow(createdAt, now, 7 * DAY_MS);
    if (row.isAdmin) {
      excluded.allTime.staffAdmin += 1;
      if (within24h) excluded.last24h.staffAdmin += 1;
      if (within7d) excluded.last7d.staffAdmin += 1;
      continue;
    }
    if (row.isBot) {
      excluded.allTime.bots += 1;
      if (within24h) excluded.last24h.bots += 1;
      if (within7d) excluded.last7d.bots += 1;
      continue;
    }

    const bucket = signupSourceBucket(row);
    const provider = authProvider(row);
    allTimeTotal += 1;
    bump(allTime, bucket);
    providers.allTime[provider] += 1;
    if (within24h) {
      last24hTotal += 1;
      bump(last24h, bucket);
      providers.last24h[provider] += 1;
    }
    if (within7d) {
      last7dTotal += 1;
      bump(last7d, bucket);
      providers.last7d[provider] += 1;
    }
    if (createdAt && createdAt.getTime() <= now.getTime()) {
      const day = getPackptsDayKey(createdAt);
      const daily = dailyMaps.get(day);
      if (daySet.has(day) && daily) bump(daily, bucket);
    }
  }

  return {
    generatedAt: now.toISOString(),
    timezone: SIGNUP_REPORT_TIMEZONE,
    exclusionRule: SIGNUP_EXCLUSION_RULE,
    sourceRule: SIGNUP_SOURCE_RULE,
    authProviderRule: SIGNUP_AUTH_PROVIDER_RULE,
    windows: SIGNUP_WINDOWS,
    totals: {
      allTime: allTimeTotal,
      last24h: last24hTotal,
      last7d: last7dTotal,
      excluded,
    },
    bySource: {
      allTime: toCountMap(allTime, true),
      last24h: toCountMap(last24h, true),
      last7d: toCountMap(last7d, true),
    },
    daily: dayKeys.map((day) => {
      const counts = dailyMaps.get(day) ?? new Map<string, number>();
      const bySource = toCountMap(counts, false);
      const signups = Object.values(bySource).reduce((sum, n) => sum + n, 0);
      return { day, signups, topSource: topSource(counts), bySource };
    }),
    authProviders: providers,
    gaps: SIGNUP_SOURCE_GAPS,
  };
}

export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

export function sumAuthProviders(counts: AuthProviderCounts): number {
  return counts.workos + counts.email + counts.apple + counts.none;
}

export const SIGNUP_SOURCE_SQL = `
SELECT
  u.created_at,
  COALESCE(u.is_admin, false) AS is_admin,
  COALESCE(u.is_bot, false) AS is_bot,
  (u.workos_user_id IS NOT NULL) AS has_workos,
  EXISTS (SELECT 1 FROM apple_users au WHERE au.user_id = u.id) AS has_apple,
  EXISTS (SELECT 1 FROM local_credentials lc WHERE lc.user_id = u.id) AS has_email,
  (ua.user_id IS NOT NULL) AS has_attribution,
  ua.utm_source,
  ua.utm_medium,
  ua.utm_campaign,
  ua.referrer,
  (
    SELECT rl.purpose
    FROM referral_attributions rat
    INNER JOIN referral_links rl ON rl.id = rat.referral_link_id
    WHERE rat.invited_user_id = u.id
      AND rat.event_type = 'SIGNUP'
    ORDER BY rat.created_at ASC NULLS LAST
    LIMIT 1
  ) AS referral_purpose
FROM users u
LEFT JOIN user_attribution ua ON ua.user_id = u.id
`.trim();

const PURPOSES = new Set<ReferralPurpose>(["INVITE", "DAILY5_CHALLENGE", "SCORE_SHARE"]);

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function asPurpose(value: unknown): ReferralPurpose | null {
  if (typeof value !== "string") return null;
  return PURPOSES.has(value as ReferralPurpose) ? (value as ReferralPurpose) : null;
}

export function mapSignupSourceRow(row: Record<string, unknown>): SignupSourceRow {
  return {
    createdAt: asDate(row.created_at),
    isAdmin: asBool(row.is_admin),
    isBot: asBool(row.is_bot),
    hasWorkos: asBool(row.has_workos),
    hasApple: asBool(row.has_apple),
    hasEmail: asBool(row.has_email),
    hasAttributionRow: asBool(row.has_attribution),
    utmSource: asText(row.utm_source),
    utmMedium: asText(row.utm_medium),
    utmCampaign: asText(row.utm_campaign),
    referrer: asText(row.referrer),
    referralPurpose: asPurpose(row.referral_purpose),
  };
}
