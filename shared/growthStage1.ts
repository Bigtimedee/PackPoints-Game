/**
 * Stage 1 growth attribution and retention. Pure functions only.
 *
 * Marketing contract (clarified 2026-11-07, America/Chicago):
 *   source:  facebook | instagram | email | tiktok | x | bio
 *   medium:  social | outreach | bio | lifecycle
 *            outreach is B2B. lifecycle is email behavior (sends stay off).
 *   campaign: yymmdd-<setcode>, America/Chicago publication date, at most 16
 *            characters (example 261107-87topps). This fits ig_post_queue
 *            utm_campaign varchar(16). The longer yyyymmdd-set-slug form does
 *            not fit that column and is not rewritten into the short form.
 *   content: lowercase hyphenated post/variant id, no personal data.
 *
 * Raw values are kept (bounded by the existing signup sanitizer, 100 chars).
 * Closed tokens are recognized only as written above. feed/reel/story, w1/w3,
 * ig_daily, and the publisher's `${rowId}-${A|B}` content stay legacy. They
 * are not relabeled as social, a date campaign, or a contract content id.
 * Missing, direct, unrecognized, referrer-only, and referrer-inferred touches
 * stay unattributed. Nothing is assigned to a channel to chase 95%.
 *
 * Retention uses America/Chicago calendar dates (PACKPTS_DAY_TZ), not a
 * rolling 24 hour window. Weeks are Monday–Sunday.
 */
import { addPackptsDays, getPackptsDayKey, isPackptsDayKey, PACKPTS_DAY_TZ } from "./packptsDay";
import { TOPPS_BASEBALL_1987_SET_ID } from "./setDisplayOverride";

export const GROWTH_TIMEZONE = PACKPTS_DAY_TZ;
export const ATTRIBUTION_COVERAGE_TARGET = 0.95;
/** Existing signup sanitizer cap. Wider than the publisher columns. */
export const RAW_UTM_MAX = 100;
/** ig_post_queue.utm_campaign. Not widened in stage 1. */
export const PUBLISHER_CAMPAIGN_MAX = 16;
/** ig_post_queue.utm_content. Not widened in stage 1. */
export const PUBLISHER_CONTENT_MAX = 40;
export const CONTRACT_CAMPAIGN_MAX = 16;
export const CONTRACT_CONTENT_MAX = 64;

export const MARKETING_SOURCES = ["facebook", "instagram", "email", "tiktok", "x", "bio"] as const;
export type MarketingSource = (typeof MARKETING_SOURCES)[number];

export const MARKETING_MEDIUMS = ["social", "outreach", "bio", "lifecycle"] as const;
export type MarketingMedium = (typeof MARKETING_MEDIUMS)[number];

export const LEGACY_MEDIUMS = ["feed", "reel", "story", "photo", "link"] as const;
export type LegacyMedium = (typeof LEGACY_MEDIUMS)[number];

export const LEGACY_CAMPAIGNS = ["w1", "w3", "ig_daily"] as const;
export type LegacyCampaign = (typeof LEGACY_CAMPAIGNS)[number];

export const GROWTH_EVENT_TYPES = ["signup", "first_game_completed", "day1_return", "day7_return"] as const;
export type GrowthEventType = (typeof GROWTH_EVENT_TYPES)[number];

export const GROWTH_PROVIDERS = ["email", "google", "apple", "workos"] as const;
export type GrowthProvider = (typeof GROWTH_PROVIDERS)[number];

const DIRECT_TOKENS = new Set(["direct", "(direct)", "none", "(none)"]);
const CAMPAIGN_RE = /^(\d{2})(\d{2})(\d{2})-([a-z0-9]+)$/;
const CONTENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Publisher trackingUrl writes `${id}-${variant}` and drops the queued content. */
const PUBLISHER_ROW_CONTENT_RE = /^\d+-[ABab]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACKPTS_ORIGIN = "https://packpts.com";

export const STAGE1_DEFINITIONS = {
  timezone: GROWTH_TIMEZONE,
  week: "ISO week, Monday through Sunday, of the signup's America/Chicago calendar date.",
  signup:
    "One server-written signup row per newly registered user, after growth instrumentation started. Returning logins do not write another row. Preexisting users are not backfilled. Staff, bots, and test accounts are not in the cohort.",
  attributable:
    "A signup whose supplied utm_source is one of facebook, instagram, email, tiktok, x, or bio. Medium, campaign, and content are reported separately and do not move a signup into a source. An Instagram referrer with no supplied source is stored for the existing signup report but counted here as inferred_referrer, not as instagram.",
  coverage:
    "attributable divided by signup rows in that week. The 95% figure is a target. This report returns the actual ratio and does not claim the target is met until the observed new-signup cohort reaches it.",
  campaign:
    "A contract campaign matches yymmdd-setcode, length 8 to 16, month 01-12, day 01-31, setcode lowercase letters and digits (example 261107-87topps). Longer forms such as 20261107-1987-topps are stored raw and are not rewritten.",
  content:
    "A contract content id is lowercase hyphenated, 1 to 64 characters, and is not the publisher row form N-A or N-B. The supplied value is stored as received.",
  legacy:
    "Historical publisher values stay in legacy counters: medium feed, reel, story, photo, or link; campaign w1, w3, or ig_daily; content matching the publisher row id and A/B variant. They are not mapped onto the new taxonomy.",
  destination:
    "Allowlisted landing paths are /daily, /daily5, and /sets/<uuid>. /sets/1987-topps is not a route. The playable 1987 Topps Baseball set is /sets/37fd025d-2ae1-4c92-b8ad-133375d0c722. Slug aliases wait for a later stage. External and protocol-relative URLs are rejected.",
  firstGame:
    "first_game_completed is written once when a registered, instrumented user finishes a solo session or a non-flagged Daily 5, or when a head-to-head match reaches completed. Guest rounds are not copied onto the user at claim. The rate numerator is completions on the signup Chicago day or the next Chicago day. The denominator is signups whose next Chicago day has already ended (signup day + 1 is strictly before today). A later first completion is stored but does not enter the rate.",
  d1:
    "day1_return is written once when an authenticated server observation falls on the America/Chicago date exactly one day after the signup date. Same-day activity, including the signup request, is not D1. A visit on day 2 does not backfill D1. The denominator waits until that next date has ended.",
  d7:
    "day7_return uses the same rule on signup date + 7. It does not require D1. The denominator waits until that seventh date has ended.",
  observation:
    "A return observation is GET /api/auth/user, a successful local, WorkOS, or Apple login, a verified mobile Bearer request, or one of the game completions above. The client cannot post these events.",
  baseline:
    "growth_instrumentation.started_at is timestamptz (an absolute instant). users.created_at is timestamp without time zone and is stored and read as a UTC wall clock: new registration rows set created_at to (now() AT TIME ZONE 'UTC'), and comparisons use (created_at AT TIME ZONE 'UTC'). The Chicago cohort day is to_char((that instant) AT TIME ZONE 'America/Chicago'). Neither the database session TimeZone nor the Node process TZ is used. Users created before the baseline get no events.",
  exclusions:
    "Inline signup events are written only for email registration, a new WorkOS user, and a new Sign in with Apple user, in the same transaction as the user row. Reconcile repairs a missing event only when that user is post-baseline, not staff, not a bot, not a test account, and has a local credential, WorkOS id, oauth_provider, or apple_users row. Excluded on purpose: bot opponents, the admin seed, the QA test account, dev POST /api/test/login, seedMockUsers, guest rounds, flagged Daily 5 finishes, and head-to-head forfeits or cancels. iOS play uses the same solo and Daily 5 routes; there is no second mobile completion writer.",
} as const;

export const STAGE1_EXCLUSIONS = [
  "Email, WorkOS, and Sign in with Apple write the signup event in the same database transaction as the new user, before wallet credit or guest claim.",
  "Bot opponents (users.is_bot), the admin seed (users.is_admin), and the QA session account (users.is_test_account) are not signups.",
  "Dev POST /api/test/login and seedMockUsers create user rows with no local credential, WorkOS id, or Apple link. The reconciler does not treat them as signups.",
  "authStorage.upsertUser is not called by a registration route.",
  "Guest solo and guest Daily 5 completions have no user id and are not first_game_completed. Claiming a guest wallet does not copy those rounds.",
  "A flagged Daily 5 finish is not first_game_completed. A later unflagged finish can be.",
  "Head-to-head first_game_completed is only maybeFinish (end reason completed). matchService.forfeitMatch and engine.forfeitMatch are not.",
  "iOS and other mobile clients use POST /api/game/next, POST /api/daily5/finish, and Bearer JWT activity. They do not have a separate completion route.",
] as const;

export const STAGE1_INTEGRATION_GAPS = [
  "ig_post_queue.utm_campaign is varchar(16) and utm_content is varchar(40). Stage 1 does not widen them and does not rewrite queued or published rows.",
  "trackingUrl overwrites utm_content with `${rowId}-${variant}` (uppercase A/B). The queued content value is not what the click carries. Stage 1 stores whatever arrives and does not remap that row id back to a caption id.",
  "Published mediums are the placement (feed, reel, story, photo, link) or the stored utm_medium. Default campaign is w1, and extras have used w3. Those stay legacy.",
  "ig_post_queue has no destination column. A link field added only in local caption JSON is not read by the publisher. This stage does not enqueue, backfill, or edit live posts.",
  "igBioRedirectUrl still sends the bio click to https://packpts.com/ with utm_campaign=ig_daily. The stage 1 bio helper is a copy-ready /daily URL in this report. It is not installed on Instagram, and Story stickers are not changed. Captions are not clickable links.",
  "/sets/1987-topps is not a catalog route. Use /sets/37fd025d-2ae1-4c92-b8ad-133375d0c722 until slug aliases exist.",
  "Lifecycle templates are not sent. source=email and medium=lifecycle are accepted on a signup only. Outreach stays the B2B medium and is not used as a stand-in for lifecycle.",
  "Head-to-head forfeits are not first_game_completed. Only a match that finishes with reason completed is.",
] as const;

export type UnattributedReason =
  | "missing"
  | "direct"
  | "unrecognized"
  | "referrer_only"
  | "legacy"
  | "inferred_referrer";

export type ClassifiedTouch = {
  source: MarketingSource | null;
  medium: MarketingMedium | null;
  campaign: string | null;
  content: string | null;
  legacyMedium: LegacyMedium | null;
  legacyCampaign: LegacyCampaign | null;
  legacyPublisherContent: boolean;
  attributable: boolean;
  reason: UnattributedReason | null;
  destination: string | null;
};

export type RawTouch = {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  referrerHost?: string | null;
  landingPage?: string | null;
  inferred?: boolean;
};

function asToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

function closed<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Contract campaign only. Does not lowercase or shorten a different shape. */
export function classifyContractCampaign(raw: string | null | undefined): string | null {
  const v = asToken(raw);
  if (!v || v.length > CONTRACT_CAMPAIGN_MAX || v !== v.toLowerCase()) return null;
  const m = CAMPAIGN_RE.exec(v);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return v;
}

export function classifyContractContent(raw: string | null | undefined): string | null {
  const v = asToken(raw);
  if (!v || v.length > CONTRACT_CONTENT_MAX || v !== v.toLowerCase()) return null;
  if (PUBLISHER_ROW_CONTENT_RE.test(v)) return null;
  return CONTENT_RE.test(v) ? v : null;
}

export function isPublisherRowContent(raw: string | null | undefined): boolean {
  const v = asToken(raw);
  return v != null && PUBLISHER_ROW_CONTENT_RE.test(v);
}

/**
 * Internal path only. /daily, /daily5, or /sets/<uuid> with nothing after the id.
 * Rejects slugs, open redirects, and protocol-relative paths.
 */
export function classifyDestination(raw: string | null | undefined): string | null {
  const v = asToken(raw);
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.includes("?") || v.includes("#")) {
    return null;
  }
  if (v === "/daily" || v === "/daily5") return v;
  const match = /^\/sets\/([0-9a-f-]{36})$/i.exec(v);
  if (!match || !UUID_RE.test(match[1])) return null;
  return `/sets/${match[1].toLowerCase()}`;
}

export function classifyGrowthTouch(raw: RawTouch): ClassifiedTouch {
  const sourceRaw = asToken(raw.source);
  const mediumRaw = asToken(raw.medium);
  const campaignRaw = asToken(raw.campaign);
  const contentRaw = asToken(raw.content);
  const referrer = asToken(raw.referrerHost);
  const landing = asToken(raw.landingPage);
  const source = closed(sourceRaw, MARKETING_SOURCES);
  const medium = closed(mediumRaw, MARKETING_MEDIUMS);
  const campaign = classifyContractCampaign(campaignRaw);
  const content = classifyContractContent(contentRaw);
  const legacyMedium = medium ? null : closed(mediumRaw, LEGACY_MEDIUMS);
  const legacyCampaign = campaign ? null : closed(campaignRaw, LEGACY_CAMPAIGNS);
  const legacyPublisherContent = isPublisherRowContent(contentRaw);
  const destination = classifyDestination(landing);
  const anyRaw = Boolean(sourceRaw || mediumRaw || campaignRaw || contentRaw);

  let attributable = source != null && raw.inferred !== true;
  let reason: UnattributedReason | null = null;
  if (raw.inferred === true) {
    attributable = false;
    reason = "inferred_referrer";
  } else if (attributable) {
    reason = null;
  } else if (sourceRaw && DIRECT_TOKENS.has(sourceRaw.toLowerCase()) && !mediumRaw && !campaignRaw && !contentRaw) {
    reason = "direct";
  } else if (legacyMedium || legacyCampaign || legacyPublisherContent) {
    reason = "legacy";
  } else if (anyRaw) {
    reason = "unrecognized";
  } else if (referrer) {
    reason = "referrer_only";
  } else if (landing) {
    reason = "direct";
  } else {
    reason = "missing";
  }

  return {
    source: attributable ? source : null,
    medium: attributable ? medium : medium,
    campaign,
    content,
    legacyMedium,
    legacyCampaign,
    legacyPublisherContent,
    attributable,
    reason,
    destination,
  };
}

export type DestinationParams = {
  path: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  ref?: string | null;
};

/**
 * Build a PackPTS URL only when the path is allowlisted and every UTM matches
 * the contract. Returns null instead of emitting a non-contract or external link.
 * Does not read or write the publisher queue.
 */
export function buildStage1DestinationUrl(params: DestinationParams): string | null {
  const path = classifyDestination(params.path);
  const touch = classifyGrowthTouch({
    source: params.source,
    medium: params.medium,
    campaign: params.campaign,
    content: params.content,
    inferred: false,
  });
  if (!path || !touch.attributable || !touch.source || !touch.medium || !touch.campaign || !touch.content) return null;
  const query = new URLSearchParams();
  query.set("utm_source", touch.source);
  query.set("utm_medium", touch.medium);
  query.set("utm_campaign", touch.campaign);
  query.set("utm_content", touch.content);
  const ref = asToken(params.ref);
  if (ref && /^[A-Za-z0-9_-]{1,20}$/.test(ref)) query.set("ref", ref);
  return `${PACKPTS_ORIGIN}${path}?${query.toString()}`;
}

/** Copy-ready generic profile link. Not installed on the live bio. */
export function stage1BioDailyUrl(input?: { source?: "bio" | "instagram"; campaign?: string; content?: string }): string | null {
  return buildStage1DestinationUrl({
    path: "/daily",
    source: input?.source ?? "bio",
    medium: "bio",
    campaign: input?.campaign ?? "261107-daily5",
    content: input?.content ?? "instagram-profile",
  });
}

export const STAGE1_1987_SET_PATH = `/sets/${TOPPS_BASEBALL_1987_SET_ID}`;

export function growthWeekStart(dayKey: string): string {
  if (!isPackptsDayKey(dayKey)) throw new Error("invalid packpts day key");
  const noon = new Date(`${dayKey}T12:00:00.000Z`);
  const dow = noon.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return addPackptsDays(dayKey, offset);
}

/** True once the Chicago date signup+n has ended (that date is strictly before today). */
export function isGrowthWindowMature(signupDay: string, daysAfter: number, today: string): boolean {
  return addPackptsDays(signupDay, daysAfter) < today;
}

export function returnEventFor(signupDay: string, activityDay: string): "day1_return" | "day7_return" | null {
  if (!isPackptsDayKey(signupDay) || !isPackptsDayKey(activityDay)) return null;
  if (activityDay === addPackptsDays(signupDay, 1)) return "day1_return";
  if (activityDay === addPackptsDays(signupDay, 7)) return "day7_return";
  return null;
}

export function growthProvider(raw: string | null | undefined): GrowthProvider | null {
  const v = asToken(raw)?.toLowerCase();
  return v && (GROWTH_PROVIDERS as readonly string[]).includes(v) ? (v as GrowthProvider) : null;
}

export type Stage1User = {
  id: string;
  createdAt: Date;
  isAdmin?: boolean;
  isBot?: boolean;
  isTest?: boolean;
  signupEvent: null | RawTouch & { occurredAt: Date; provider?: string | null };
  firstGameAt?: Date | null;
  day1At?: Date | null;
  day7At?: Date | null;
};

export type GrowthStage1Report = {
  generatedAt: string;
  timezone: typeof GROWTH_TIMEZONE;
  asOfDay: string;
  coverageTarget: number;
  meetsCoverageTarget: boolean;
  coverage: number | null;
  coverageNote: string;
  definitions: typeof STAGE1_DEFINITIONS;
  integrationGaps: readonly string[];
  exclusions: readonly string[];
  lifecycleEmailSends: "off";
  bioHelper: { installed: false; url: string | null; note: string };
  destinations: {
    daily: "/daily";
    set1987ToppsSlug: null;
    set1987ToppsBaseball: string;
    exampleTrackedSetUrl: string | null;
  };
  instrumentationStartedAt: string | null;
  diagnostics: {
    observedNewUsers: number;
    signupEvents: number;
    usersMissingSignupEvent: number;
    signupEventsOutsideCohort: number;
    oneToOne: boolean | null;
    note: string;
  };
  totals: {
    signups: number;
    attributable: number;
    bySource: Record<MarketingSource, number>;
    byMedium: Record<MarketingMedium, number>;
    unattributed: Record<UnattributedReason, number> & { total: number };
    legacyMedium: Record<LegacyMedium, number>;
    legacyCampaign: Record<LegacyCampaign, number>;
    legacyPublisherContent: number;
    byProvider: Record<GrowthProvider | "unknown", number>;
    destinations: { daily: number; daily5: number; set: number; none: number };
  };
  weeks: Array<{
    weekStart: string;
    signups: number;
    attributable: number;
    coverage: number | null;
    meetsCoverageTarget: boolean;
    bySource: Record<MarketingSource, number>;
    byMedium: Record<MarketingMedium, number>;
    unattributed: Record<UnattributedReason, number> & { total: number };
    byCampaign: Array<{ campaign: string; signups: number }>;
    legacyMedium: Record<LegacyMedium, number>;
    legacyCampaign: Record<LegacyCampaign, number>;
    legacyPublisherContent: number;
    firstGame: { recorded: number; inWindow: number; matureDenominator: number; rate: number | null };
    d1: { returned: number; matureDenominator: number; rate: number | null };
    d7: { returned: number; matureDenominator: number; rate: number | null };
  }>;
};

function emptySources(): Record<MarketingSource, number> {
  return { facebook: 0, instagram: 0, email: 0, tiktok: 0, x: 0, bio: 0 };
}

function emptyMediums(): Record<MarketingMedium, number> {
  return { social: 0, outreach: 0, bio: 0, lifecycle: 0 };
}

function emptyReasons(): Record<UnattributedReason, number> & { total: number } {
  return { missing: 0, direct: 0, unrecognized: 0, referrer_only: 0, legacy: 0, inferred_referrer: 0, total: 0 };
}

function emptyLegacyMedium(): Record<LegacyMedium, number> {
  return { feed: 0, reel: 0, story: 0, photo: 0, link: 0 };
}

function emptyLegacyCampaign(): Record<LegacyCampaign, number> {
  return { w1: 0, w3: 0, ig_daily: 0 };
}

function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

function eligible(user: Stage1User, baseline: Date | null): boolean {
  if (!baseline || user.createdAt < baseline) return false;
  if (user.isAdmin || user.isBot || user.isTest) return false;
  return true;
}

export function buildGrowthStage1Report(input: {
  now?: Date;
  baselineStartedAt: Date | null;
  users: Stage1User[];
  signupEventsOutsideCohort?: number;
}): GrowthStage1Report {
  const now = input.now ?? new Date();
  const today = getPackptsDayKey(now);
  const totals = {
    signups: 0,
    attributable: 0,
    bySource: emptySources(),
    byMedium: emptyMediums(),
    unattributed: emptyReasons(),
    legacyMedium: emptyLegacyMedium(),
    legacyCampaign: emptyLegacyCampaign(),
    legacyPublisherContent: 0,
    byProvider: { email: 0, google: 0, apple: 0, workos: 0, unknown: 0 } as Record<GrowthProvider | "unknown", number>,
    destinations: { daily: 0, daily5: 0, set: 0, none: 0 },
  };

  type Bucket = GrowthStage1Report["weeks"][number] & { campaigns: Map<string, number> };
  const weeks = new Map<string, Bucket>();
  const ensureWeek = (day: string): Bucket => {
    const weekStart = growthWeekStart(day);
    const existing = weeks.get(weekStart);
    if (existing) return existing;
    const created: Bucket = {
      weekStart,
      signups: 0,
      attributable: 0,
      coverage: null,
      meetsCoverageTarget: false,
      bySource: emptySources(),
      byMedium: emptyMediums(),
      unattributed: emptyReasons(),
      byCampaign: [],
      legacyMedium: emptyLegacyMedium(),
      legacyCampaign: emptyLegacyCampaign(),
      legacyPublisherContent: 0,
      firstGame: { recorded: 0, inWindow: 0, matureDenominator: 0, rate: null },
      d1: { returned: 0, matureDenominator: 0, rate: null },
      d7: { returned: 0, matureDenominator: 0, rate: null },
      campaigns: new Map(),
    };
    weeks.set(weekStart, created);
    return created;
  };

  let observed = 0;
  let signupEvents = 0;
  let missing = 0;
  let outside = input.signupEventsOutsideCohort ?? 0;
  for (const user of input.users) {
    if (!eligible(user, input.baselineStartedAt)) {
      if (user.signupEvent) outside += 1;
      continue;
    }
    observed += 1;
    if (!user.signupEvent) {
      missing += 1;
      continue;
    }
    signupEvents += 1;
    const signupDay = getPackptsDayKey(user.signupEvent.occurredAt);
    const touch = classifyGrowthTouch(user.signupEvent);
    const week = ensureWeek(signupDay);
    week.signups += 1;
    totals.signups += 1;
    const provider = growthProvider(user.signupEvent.provider);
    totals.byProvider[provider ?? "unknown"] += 1;
    if (touch.attributable && touch.source) {
      week.attributable += 1;
      totals.attributable += 1;
      week.bySource[touch.source] += 1;
      totals.bySource[touch.source] += 1;
      if (touch.medium) {
        week.byMedium[touch.medium] += 1;
        totals.byMedium[touch.medium] += 1;
      }
    } else if (touch.reason) {
      week.unattributed[touch.reason] += 1;
      week.unattributed.total += 1;
      totals.unattributed[touch.reason] += 1;
      totals.unattributed.total += 1;
    }
    if (touch.legacyMedium) {
      week.legacyMedium[touch.legacyMedium] += 1;
      totals.legacyMedium[touch.legacyMedium] += 1;
    }
    if (touch.legacyCampaign) {
      week.legacyCampaign[touch.legacyCampaign] += 1;
      totals.legacyCampaign[touch.legacyCampaign] += 1;
    }
    if (touch.legacyPublisherContent) {
      week.legacyPublisherContent += 1;
      totals.legacyPublisherContent += 1;
    }
    if (touch.campaign) {
      week.campaigns.set(touch.campaign, (week.campaigns.get(touch.campaign) ?? 0) + 1);
    }
    if (touch.destination === "/daily") {
      totals.destinations.daily += 1;
    } else if (touch.destination === "/daily5") {
      totals.destinations.daily5 += 1;
    } else if (touch.destination?.startsWith("/sets/")) {
      totals.destinations.set += 1;
    } else {
      totals.destinations.none += 1;
    }

    const firstAt = user.firstGameAt ?? null;
    if (firstAt) week.firstGame.recorded += 1;
    if (isGrowthWindowMature(signupDay, 1, today)) {
      week.firstGame.matureDenominator += 1;
      if (firstAt && getPackptsDayKey(firstAt) <= addPackptsDays(signupDay, 1)) week.firstGame.inWindow += 1;
    }
    if (isGrowthWindowMature(signupDay, 1, today)) {
      week.d1.matureDenominator += 1;
      if (user.day1At && getPackptsDayKey(user.day1At) === addPackptsDays(signupDay, 1)) week.d1.returned += 1;
    }
    if (isGrowthWindowMature(signupDay, 7, today)) {
      week.d7.matureDenominator += 1;
      if (user.day7At && getPackptsDayKey(user.day7At) === addPackptsDays(signupDay, 7)) week.d7.returned += 1;
    }
  }

  const weekRows = [...weeks.values()]
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .map((week) => {
      const { campaigns, ...rest } = week;
      rest.coverage = rate(rest.attributable, rest.signups);
      rest.meetsCoverageTarget = rest.coverage != null && rest.coverage >= ATTRIBUTION_COVERAGE_TARGET;
      rest.byCampaign = [...campaigns.entries()]
        .map(([campaign, signups]) => ({ campaign, signups }))
        .sort((a, b) => b.signups - a.signups || a.campaign.localeCompare(b.campaign))
        .slice(0, 50);
      rest.firstGame.rate = rate(rest.firstGame.inWindow, rest.firstGame.matureDenominator);
      rest.d1.rate = rate(rest.d1.returned, rest.d1.matureDenominator);
      rest.d7.rate = rate(rest.d7.returned, rest.d7.matureDenominator);
      return rest;
    });

  const coverage = rate(totals.attributable, totals.signups);
  const oneToOne = input.baselineStartedAt ? missing === 0 && outside === 0 && observed === signupEvents : null;

  return {
    generatedAt: now.toISOString(),
    timezone: GROWTH_TIMEZONE,
    asOfDay: today,
    coverageTarget: ATTRIBUTION_COVERAGE_TARGET,
    coverage,
    meetsCoverageTarget: coverage != null && coverage >= ATTRIBUTION_COVERAGE_TARGET,
    coverageNote:
      "Actual share of instrumented new signups with a supplied marketing source. Not a guarantee. Direct, missing, unrecognized, legacy-only, referrer-only, and referrer-inferred signups stay in unattributed.",
    definitions: STAGE1_DEFINITIONS,
    integrationGaps: STAGE1_INTEGRATION_GAPS,
    exclusions: STAGE1_EXCLUSIONS,
    lifecycleEmailSends: "off",
    bioHelper: {
      installed: false,
      url: stage1BioDailyUrl(),
      note: "Copy-ready /daily link for a generic profile. The live Instagram bio redirect is unchanged and still points at / with campaign ig_daily. Story stickers and caption links are not produced here.",
    },
    destinations: {
      daily: "/daily",
      set1987ToppsSlug: null,
      set1987ToppsBaseball: STAGE1_1987_SET_PATH,
      exampleTrackedSetUrl: buildStage1DestinationUrl({
        path: STAGE1_1987_SET_PATH,
        source: "instagram",
        medium: "social",
        campaign: "261107-87topps",
        content: "ig-feed-w3-d4-hook-b",
      }),
    },
    instrumentationStartedAt: input.baselineStartedAt ? input.baselineStartedAt.toISOString() : null,
    diagnostics: {
      observedNewUsers: observed,
      signupEvents,
      usersMissingSignupEvent: missing,
      signupEventsOutsideCohort: outside,
      oneToOne,
      note: input.baselineStartedAt
        ? "1:1 compares non-staff, non-bot, non-test users created at or after instrumentation start with signup events for that same set. Earlier users are excluded and are not given events."
        : "Instrumentation has not started. No lifecycle events are written, and preexisting users are not backfilled.",
    },
    totals,
    weeks: weekRows,
  };
}
