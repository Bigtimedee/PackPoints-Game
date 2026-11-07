/**
 * Instagram publisher (Graph API).
 *
 * Off unless IG_PUBLISH_ENABLED=true and IG_ACCESS_TOKEN and IG_USER_ID are
 * set. FB_PAGE_ID is optional. The token is read from the environment at call
 * time and is never written to logs.
 *
 * Graph calls go to IG_GRAPH_HOST (default graph.instagram.com) at
 * IG_GRAPH_VERSION (default v21.0): POST /{ig-user-id}/media and
 * POST /{ig-user-id}/media_publish.
 *
 * Before a container is created, the sha256 of the file Meta will fetch is
 * checked against server/assets/ig/APPROVED.json (hashes only). A miss marks
 * the row skipped. The public route sends those same bytes with no image
 * pipeline. Feed and Story images must already be JPEG. Captions say
 * "Link in bio". Attribution is the /ig redirect, which falls back to
 * utm_content=bio when nothing is published.
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { Pool, PoolClient } from "pg";
import { ctNow } from "./daily5XWatch";

export const IG_GRAPH_VERSION = "v21.0";
const IG_GRAPH_HOST_DEFAULT = "graph.instagram.com";
export const IG_PUBLISH_LIMIT = 50;
/** Sent on Instagram container create when a queued Reel is marked trial. */
export const IG_TRIAL_PARAMS = JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" });
export const IG_SLOT_DEFAULTS = { FEED: "11:00", REEL: "18:00", STORY: "21:00", PHOTO: "07:30", LINK: "13:30" } as const;
/** Extra IG clocks besides the kind default. Story morning and trial Reel afternoon. */
export const IG_EXTRA_SLOTS = { STORY: "07:30", REEL: "13:30" } as const;
const SLOT_ENV = { FEED: "IG_FEED_AT_CT", REEL: "IG_REEL_AT_CT", STORY: "IG_STORY_AT_CT", PHOTO: "IG_PHOTO_AT_CT", LINK: "IG_LINK_AT_CT" } as const;
const EXTRA_ENV = { STORY: "IG_STORY_AM_AT_CT", REEL: "IG_REEL_TRIAL_AT_CT" } as const;
const KINDS = ["FEED", "REEL", "STORY", "PHOTO", "LINK"] as const;
/** Content week 2 day 1 is 2026-10-29. Week 3 day 1 is Friday 2026-11-06. */
const CONTENT_WEEK2_DAY1_UTC = Date.UTC(2026, 9, 29);
const CONTENT_WEEK3_DAY1_UTC = Date.UTC(2026, 10, 6);
const STORY_MORNING_TESTS = new Set(["am", "morning", "s1"]);
const STORY_EVENING_TESTS = new Set(["answer", "evening", "pm", "s5", "poll"]);

export type IgQueueSlot = {
  kind: IgKind;
  file: string;
  utm: string;
  /** Days after the boot CT midnight. Week 1 only. */
  day?: number;
  /** Absolute America/Chicago wall time. Week 2. */
  at?: { date: string; hour: number; minute: number };
};

const WEEK2_FEED_DATES = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"] as const;
const WEEK2_LATE_DATES = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"] as const;

function week2Slots(): IgQueueSlot[] {
  const slots: IgQueueSlot[] = [];
  for (let n = 1; n <= 7; n++) {
    const i = n - 1;
    slots.push({ kind: "FEED", file: `feed-w2-day${n}.jpg`, utm: `w2-feed-d${n}`, at: { date: WEEK2_FEED_DATES[i], hour: 11, minute: 0 } });
    slots.push({ kind: "REEL", file: `reel-w2-day${n}.mp4`, utm: `w2-reel-d${n}`, at: { date: WEEK2_LATE_DATES[i], hour: 18, minute: 0 } });
    slots.push({ kind: "STORY", file: `story-w2-day${n}.jpg`, utm: `w2-story-d${n}`, at: { date: WEEK2_LATE_DATES[i], hour: 21, minute: 0 } });
  }
  return slots;
}

/** Approved feed JPEGs, Reel MP4s, and Story JPEGs. PNGs are not queued. */
export const IG_QUEUE_SLOTS: IgQueueSlot[] = [
  { kind: "FEED", file: "d5-post-1080-B2-4x5.jpg", utm: "feed-d1", day: 0 },
  { kind: "FEED", file: "d5-post-1080-B2-1987-topps-football-4x5.jpg", utm: "feed-d2", day: 1 },
  { kind: "FEED", file: "d5-post-1080-B2-1989-topps-4x5.jpg", utm: "feed-d3", day: 2 },
  { kind: "FEED", file: "d5-post-1080-B2-1994-topps-football-4x5.jpg", utm: "feed-d4", day: 3 },
  { kind: "FEED", file: "d5-post-1080-B2-2022-panini-chronicles-football-v2-4x5.jpg", utm: "feed-d5", day: 4 },
  { kind: "FEED", file: "d5-post-1080-B2-2024-basketball-v2-4x5.jpg", utm: "feed-d6", day: 5 },
  { kind: "REEL", file: "reel-day1-A.mp4", utm: "reel-d1", day: 0 },
  { kind: "REEL", file: "reel-day2.mp4", utm: "reel-d2", day: 1 },
  { kind: "REEL", file: "reel-day3.mp4", utm: "reel-d3", day: 2 },
  { kind: "REEL", file: "reel-day4.mp4", utm: "reel-d4", day: 3 },
  { kind: "REEL", file: "reel-day5.mp4", utm: "reel-d5", day: 4 },
  { kind: "REEL", file: "reel-day6.mp4", utm: "reel-d6", day: 5 },
  { kind: "REEL", file: "reel-day7.mp4", utm: "reel-d7", day: 6 },
  { kind: "STORY", file: "story-day1-A.jpg", utm: "story-d1", day: 0 },
  { kind: "STORY", file: "story-day2.jpg", utm: "story-d2", day: 1 },
  { kind: "STORY", file: "story-day3.jpg", utm: "story-d3", day: 2 },
  { kind: "STORY", file: "story-day4.jpg", utm: "story-d4", day: 3 },
  { kind: "STORY", file: "story-day5.jpg", utm: "story-d5", day: 4 },
  { kind: "STORY", file: "story-day6.jpg", utm: "story-d6", day: 5 },
  { kind: "STORY", file: "story-day7.jpg", utm: "story-d7", day: 6 },
  ...week2Slots(),
];
const CHECK_EVERY_MS = 5 * 60 * 1000;
const CHECK_ASSET_CANDIDATES = [
  "check-asset.mjs",
  "scripts/check-asset.mjs",
  "server/assets/ig/check-asset.mjs",
  "social-gate/check-asset.mjs",
];

export type IgKind = (typeof KINDS)[number];
export type IgStatus = "queued" | "container_created" | "published" | "failed" | "skipped";
export type IgContainerCode = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export type IgPlatform = "ig" | "fb";
export type IgVariant = "A" | "B";
export type IgInsights = {
  daily?: { day: string; pulledAt: string; metrics: Record<string, number | string | null>; error?: string };
  story20h?: { pulledAt: string; metrics: Record<string, number | string | null>; error?: string };
  fb?: { day: string; pulledAt: string; metrics: Record<string, number | string | null>; error?: string };
  abTest?: { pulledAt: string; body: Record<string, unknown>; error?: string };
};

export type IgQueueRow = {
  id: number;
  kind: IgKind;
  mediaPath: string;
  caption: string;
  scheduledFor: Date;
  status: IgStatus;
  containerId: string | null;
  igMediaId: string | null;
  error: string | null;
  approvalHash: string;
  utmContent: string;
  utmMedium: string | null;
  utmCampaign: string | null;
  platform: IgPlatform;
  variant: IgVariant | null;
  testId: string | null;
  trial: boolean;
  insights: IgInsights | null;
  abTestId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  /** Central day that holds this row's five-post slot. Null until a publish claims one. */
  capacityDay?: string | null;
};

export type IgQueueInsert = Omit<IgQueueRow, "id" | "createdAt" | "publishedAt" | "containerId" | "igMediaId" | "error" | "utmMedium" | "utmCampaign" | "platform" | "variant" | "testId" | "trial" | "insights" | "abTestId"> & {
  error?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  platform?: IgPlatform;
  variant?: IgVariant | null;
  testId?: string | null;
  trial?: boolean;
  insights?: IgInsights | null;
  abTestId?: string | null;
};

export type IgMediaFields = {
  image_url?: string;
  video_url?: string;
  media_type?: "REELS" | "STORIES";
  caption?: string;
  trial_params?: string;
  share_to_feed?: "true";
};

export interface IgGraph {
  pageInstagramId(): Promise<string>;
  publishingLimit(): Promise<{ usage: number; total: number }>;
  createMedia(fields: IgMediaFields): Promise<string>;
  containerStatus(containerId: string): Promise<IgContainerCode>;
  publishMedia(containerId: string): Promise<string>;
}

export interface IgStore {
  insert(row: IgQueueInsert): Promise<IgQueueRow>;
  rescheduleQueued(id: number, scheduledFor: Date): Promise<boolean>;
  setQueuedUtm(id: number, utmContent: string, utmMedium: string, utmCampaign: string): Promise<boolean>;
  setQueuedCaption(id: number, caption: string): Promise<boolean>;
  setQueuedMedia(id: number, mediaPath: string, approvalHash: string): Promise<boolean>;
  setQueuedTrial(id: number, trial: boolean): Promise<boolean>;
  saveInsights(id: number, insights: IgInsights): Promise<boolean>;
  markAbTest(id: number, videoId: string, abTestId: string): Promise<boolean>;
  list(limit?: number): Promise<IgQueueRow[]>;
  get(id: number): Promise<IgQueueRow | null>;
  claimCreate(id: number, statuses: IgStatus[]): Promise<IgQueueRow | null>;
  saveContainer(id: number, containerId: string): Promise<boolean>;
  /** Drop a container Graph no longer returns so the next create can mint one. */
  clearContainer(id: number): Promise<boolean>;
  markPublished(id: number, igMediaId: string, publishedAt: Date): Promise<boolean>;
  markFailed(id: number, error: string): Promise<boolean>;
  markSkipped(id: number, error: string): Promise<boolean>;
  latestPublished(): Promise<IgQueueRow | null>;
  inflight(kind: IgKind): Promise<IgQueueRow | null>;
  dayConsumed(kind: IgKind, dayKey: string): Promise<boolean>;
  nextQueued(kind: IgKind, now: Date, dayKey: string): Promise<IgQueueRow | null>;
  withLock<T>(id: number, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }>;
  /** Atomically take one of the five account-day slots, or resume the slot this row already holds. */
  claimDaySlot(id: number, accountDay: string): Promise<"claimed" | "resume" | "full" | "missing">;
}

export class IgGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "IgGraphError";
  }
}

export class IgInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IgInputError";
  }
}

type Deps = {
  store?: IgStore | null;
  graph?: IgGraph | null;
  mediaDir?: string | null;
  allowlist?: Set<string> | null;
  allowlistPath?: string | null;
  sleep?: ((ms: number) => Promise<void>) | null;
  env?: NodeJS.ProcessEnv | null;
  pollMax?: number | null;
  fetch?: typeof fetch | null;
  now?: (() => Date) | null;
};

let deps: Deps = {};
let checkAssetMod: { assertApproved?: (hash: string, hashes: string[]) => Promise<unknown> | unknown } | null | undefined;

export function setIgDepsForTests(next: Deps | null): void {
  deps = next ?? {};
  checkAssetMod = undefined;
}

function env(): NodeJS.ProcessEnv {
  return deps.env ?? process.env;
}

function sleep(ms: number): Promise<void> {
  if (deps.sleep) return deps.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clock(): Date {
  return deps.now ? deps.now() : new Date();
}

export function defaultAllowlistPath(): string {
  return path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json");
}

export function mediaDir(): string {
  return deps.mediaDir || env().IG_MEDIA_DIR?.trim() || path.join(process.cwd(), "server", "assets", "ig", "media");
}

export function igPublishEnabled(e = env()): boolean {
  return e.IG_PUBLISH_ENABLED === "true";
}

/** America/Chicago wall time as a UTC instant. 11:00, 18:00, and 20:00 stay unambiguous across the November clock change. */
export function ctWallTime(date: string, hour: number, minute: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || hour > 23 || minute > 59) throw new Error("bad_ct_wall_time");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

export function igGraphHost(e = env()): string {
  const raw = (e.IG_GRAPH_HOST || IG_GRAPH_HOST_DEFAULT).trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(raw) || raw.includes("..") || raw.startsWith(".") || raw.endsWith(".")) {
    return IG_GRAPH_HOST_DEFAULT;
  }
  return raw;
}

export function igGraphVersion(e = env()): string {
  const raw = (e.IG_GRAPH_VERSION || IG_GRAPH_VERSION).trim();
  if (!/^v\d+\.\d+$/.test(raw)) return IG_GRAPH_VERSION;
  return raw;
}

function graphBase(e = env()): string {
  return `https://${igGraphHost(e)}/${igGraphVersion(e)}`;
}

function pageCheckEnabled(e = env()): boolean {
  return Boolean(e.FB_PAGE_ID?.trim()) && igGraphHost(e) === "graph.facebook.com";
}

export function igCredsReady(e = env()): boolean {
  return Boolean(e.IG_ACCESS_TOKEN?.trim() && e.IG_USER_ID?.trim());
}

export function slotMinutes(kind: IgKind, e = env()): number {
  const fallback = IG_SLOT_DEFAULTS[kind];
  const raw = (e[SLOT_ENV[kind]] || fallback).trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return clockMinutes(fallback);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return clockMinutes(fallback);
  return hour * 60 + minute;
}

function clockMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

function readClock(raw: string | undefined, fallback: string): string {
  const text = (raw || fallback).trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function extraSlotMinutes(kind: IgKind, e = env()): number | null {
  if (kind !== "STORY" && kind !== "REEL") return null;
  return clockMinutes(readClock(e[EXTRA_ENV[kind]], IG_EXTRA_SLOTS[kind]));
}

/** The row posts at its own Central clock when that clock is a known slot. An earlier schedule waits for the kind default. */
export function rowSlotMinutes(kind: IgKind, scheduledFor: Date, e = env()): number {
  const scheduled = ctNow(scheduledFor).minutes;
  const primary = slotMinutes(kind, e);
  const extra = extraSlotMinutes(kind, e);
  const known = new Set<number>([7 * 60 + 30, 11 * 60, 13 * 60 + 30, 18 * 60, 20 * 60 + 30, 20 * 60 + 45, 21 * 60, primary]);
  if (extra != null) known.add(extra);
  if (known.has(scheduled)) return scheduled;
  return primary;
}

export function rowIsDue(row: Pick<IgQueueRow, "kind" | "scheduledFor">, now: Date, e = env()): boolean {
  if (row.scheduledFor.getTime() > now.getTime()) return false;
  return ctNow(now).minutes >= rowSlotMinutes(row.kind, row.scheduledFor, e);
}

export function contentDate(week: number, day: number): string {
  if (!Number.isInteger(week) || !Number.isInteger(day) || week < 1 || day < 1) throw new Error("bad_content_date");
  const base = week >= 3 ? CONTENT_WEEK3_DAY1_UTC : CONTENT_WEEK2_DAY1_UTC;
  const offsetDays = week >= 3 ? (week - 3) * 7 + (day - 1) : (week - 2) * 7 + (day - 1);
  const dt = new Date(base + offsetDays * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type ParsedCreative = {
  file: string;
  platform: IgPlatform;
  format: "feed" | "reel" | "story" | "photo" | "link";
  week: number;
  day: number;
  testId: string;
  variant: IgVariant;
};

export function parseCreativeName(file: string): ParsedCreative | null {
  const match = /^(ig|fb)-(feed|reel|story|photo|link)-w(\d+)-d(\d+)-([a-z0-9]+)-([AB])\.(jpg|jpeg|mp4)$/i.exec(file);
  if (!match) return null;
  const variant = match[6].toUpperCase();
  if (variant !== "A" && variant !== "B") return null;
  const format = match[2].toLowerCase() as ParsedCreative["format"];
  return {
    file,
    platform: match[1].toLowerCase() as IgPlatform,
    format,
    week: Number(match[3]),
    day: Number(match[4]),
    testId: match[5].toLowerCase(),
    variant,
  };
}

export function campaignFor(mediaPath: string, utm: string): string {
  const fromUtm = /^w(\d+)-/i.exec(utm);
  if (fromUtm) return `w${fromUtm[1]}`;
  const fromPath = /(?:^|-)w(\d+)(?:-|\.)/i.exec(mediaPath);
  if (fromPath) return `w${fromPath[1]}`;
  return "w1";
}

export function rowUtmContent(id: number, variant: IgVariant | null): string {
  return `${id}-${variant ?? "A"}`;
}

const FORMAT_KIND = { feed: "FEED", reel: "REEL", story: "STORY", photo: "PHOTO", link: "LINK" } as const;

function storyClock(testId: string, tests: string[]): { hour: number; minute: number } {
  const present = new Set(tests);
  if (present.has("tease") && present.has("poll")) {
    if (testId === "tease") return { hour: 20, minute: 45 };
    if (testId === "poll") return { hour: 21, minute: 0 };
  }
  if (testId === "tease" || testId === "poll") return { hour: 21, minute: 0 };
  if (STORY_MORNING_TESTS.has(testId)) return { hour: 7, minute: 30 };
  if (STORY_EVENING_TESTS.has(testId)) return { hour: 21, minute: 0 };
  const unknown = tests.filter((id) => !STORY_MORNING_TESTS.has(id) && !STORY_EVENING_TESTS.has(id) && id !== "tease" && id !== "poll").sort();
  if (unknown.length >= 2 && unknown[0] === testId) return { hour: 7, minute: 30 };
  return { hour: 21, minute: 0 };
}

export type PlannedCreative = {
  file: string;
  platform: IgPlatform;
  kind: IgKind;
  week: number;
  day: number;
  testId: string;
  variant: IgVariant;
  trial: boolean;
  date: string;
  clock: string;
  scheduledFor: string;
  linkInCaption: boolean;
};

/** Plan filename slots. Does not read the database and does not insert rows. */
export function planCreatives(files: string[]): PlannedCreative[] {
  const parsed = files.map((file) => parseCreativeName(file)).filter((item): item is ParsedCreative => item != null);
  return parsed.map((item) => {
    const plan = creativePlan(item, parsed);
    return {
      file: item.file,
      platform: item.platform,
      kind: plan.kind,
      week: item.week,
      day: item.day,
      testId: item.testId,
      variant: item.variant,
      trial: plan.trial,
      date: plan.at.date,
      clock: `${String(plan.at.hour).padStart(2, "0")}:${String(plan.at.minute).padStart(2, "0")}`,
      scheduledFor: ctWallTime(plan.at.date, plan.at.hour, plan.at.minute).toISOString(),
      linkInCaption: item.format === "link",
    };
  }).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.file.localeCompare(b.file));
}

export function plannedScheduleFromDisk(): PlannedCreative[] {
  let names: string[] = [];
  try {
    names = readdirSync(mediaDir()).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
  return planCreatives(names);
}

export function creativePlan(item: ParsedCreative, all: ParsedCreative[]): { kind: IgKind; at: { date: string; hour: number; minute: number }; trial: boolean; campaign: string } {
  const same = all.filter((other) => other.platform === item.platform && other.week === item.week && other.day === item.day && other.format === item.format);
  let hour = 11;
  let minute = 0;
  let trial = false;
  let kind: IgKind = FORMAT_KIND[item.format];
  if (item.format === "photo") {
    if (item.testId === "s4") {
      hour = 18;
    } else {
      hour = 7;
      minute = 30;
    }
  } else if (item.format === "link") {
    hour = 13;
    minute = 30;
    kind = "PHOTO";
  } else if (item.format === "reel") {
    const pair = same.some((other) => other.testId === item.testId && other.variant !== item.variant);
    if (item.platform === "ig" && pair) {
      hour = 13;
      minute = 30;
      trial = true;
    } else if (item.platform === "fb" && pair) {
      hour = 11;
    } else if (item.platform === "fb") {
      hour = 20;
      minute = 30;
    } else {
      hour = 18;
    }
  } else if (item.format === "story") {
    const clock = storyClock(item.testId, [...new Set(same.map((other) => other.testId))]);
    hour = clock.hour;
    minute = clock.minute;
  }
  return {
    kind,
    at: { date: contentDate(item.week, item.day), hour, minute },
    trial,
    campaign: `w${item.week}`,
  };
}

/** Advisory lock key for the FEED kind; queue ids are positive so this cannot collide. */
const FEED_KIND_LOCK_ID = -1;
/** Two FEED posts never go out closer than this. */
export const FEED_SPACING_MS = 30 * 60 * 1000;
/** A FEED row this late is skipped as missed instead of doubling up with a later slot. */
export const FEED_MISS_AFTER_MS = 45 * 60 * 1000;
export const FEED_MISSED_ERROR = "missed_slot";

/** Queued FEED rows whose time has passed by more than FEED_MISS_AFTER_MS. */
export function missedFeedRows(rows: IgQueueRow[], now: Date, platform: IgPlatform, e = env()): IgQueueRow[] {
  const today = ctNow(now).day;
  const mine = rows.filter((row) => row.platform === platform && row.kind === "FEED");
  // A catch-up used today's feed slot on purpose; today's row waits for its own catch-up tomorrow, as before.
  const catchupDone = mine.some((row) => row.status !== "queued" && row.publishedAt != null && ctNow(row.publishedAt).day === today && ctNow(row.scheduledFor).day < today);
  if (catchupDone) return [];
  return mine.filter((row) => row.status === "queued" && feedIsMissed(row, now, e));
}

/** When the row was actually due: its scheduled day at the slot rowIsDue waits for. */
export function feedDueAt(row: Pick<IgQueueRow, "kind" | "scheduledFor">, e = env()): Date {
  const minutes = rowSlotMinutes(row.kind, row.scheduledFor, e);
  const slot = ctWallTime(ctNow(row.scheduledFor).day, Math.floor(minutes / 60), minutes % 60);
  return slot.getTime() > row.scheduledFor.getTime() ? slot : row.scheduledFor;
}

/** Same-day FEED rows more than 45 min past their slot are missed. Earlier-day rows keep the existing one-per-day catch-up. */
export function feedIsMissed(row: Pick<IgQueueRow, "kind" | "scheduledFor">, now: Date, e = env()): boolean {
  if (ctNow(row.scheduledFor).day !== ctNow(now).day) return false;
  return now.getTime() - feedDueAt(row, e).getTime() > FEED_MISS_AFTER_MS;
}

/** True when a FEED post went out, or is mid-publish, within FEED_SPACING_MS of now. */
export function feedRecentlyPosted(rows: IgQueueRow[], now: Date, platform: IgPlatform, exceptId?: number): boolean {
  return rows.some((row) => {
    if (row.platform !== platform || row.kind !== "FEED" || row.id === exceptId) return false;
    if (row.status === "container_created") return true;
    if (row.status !== "published" || !row.publishedAt) return false;
    return Math.abs(now.getTime() - row.publishedAt.getTime()) < FEED_SPACING_MS;
  });
}

/**
 * A same-slot trial sibling may still start this long after the clock.
 * The cron is every 5 minutes, and the Nov 7 trial A container did not publish until 4 minutes past 1:30.
 * 45 minutes is the same lateness already used for a missed feed: enough for that tick plus container setup,
 * and short enough that a deploy hours later cannot treat the closed 1:30 slot as still open.
 */
export const TRIAL_PAIR_LIVE_MS = FEED_MISS_AFTER_MS;

/**
 * Approved IG trial pair: both rows are trial Reels, opposite variants, same test,
 * same Central minute, and each already carries an approval hash. Nothing else shares a minute.
 */
export function approvedTrialPartner(row: IgQueueRow, rows: readonly IgQueueRow[]): IgQueueRow | null {
  if (row.platform !== "ig" || row.kind !== "REEL" || row.trial !== true) return null;
  if (row.variant !== "A" && row.variant !== "B") return null;
  if (!row.testId || !/^[a-f0-9]{64}$/i.test(row.approvalHash)) return null;
  const slot = ctNow(row.scheduledFor);
  const partners = rows.filter((other) => {
    if (other.id === row.id || other.platform !== "ig" || other.kind !== "REEL" || other.trial !== true) return false;
    if (!other.testId || other.testId !== row.testId || other.variant === row.variant) return false;
    if (other.variant !== "A" && other.variant !== "B") return false;
    if (!/^[a-f0-9]{64}$/i.test(other.approvalHash)) return false;
    const otherSlot = ctNow(other.scheduledFor);
    return otherSlot.day === slot.day && otherSlot.minutes === slot.minutes;
  });
  return partners.length === 1 ? partners[0] : null;
}

/** True while a queued pair member may still start. A container already created is finished separately. */
export function trialPairLive(row: Pick<IgQueueRow, "scheduledFor">, now: Date): boolean {
  const late = now.getTime() - row.scheduledFor.getTime();
  return late >= 0 && late <= TRIAL_PAIR_LIVE_MS;
}

/**
 * Pair-shaped trial Reel: variant A or B, a test id, and an approval hash.
 * After the live window this shape stays blocked even when no unique partner is visible.
 * A lone trial Reel with no test id is not pair-shaped and keeps the older rules.
 */
export function isPairShapedTrial(row: Pick<IgQueueRow, "platform" | "kind" | "trial" | "variant" | "testId" | "approvalHash">): boolean {
  return row.platform === "ig"
    && row.kind === "REEL"
    && row.trial === true
    && (row.variant === "A" || row.variant === "B")
    && Boolean(row.testId)
    && /^[a-f0-9]{64}$/i.test(row.approvalHash);
}

/**
 * Closed pair-shaped trial row. The peer list cannot reopen it: a missing, duplicated,
 * or not-yet-loaded partner still leaves the row blocked. A container already created
 * is finished by the slot it claimed, not by this gate.
 */
export function trialPairExpired(row: IgQueueRow, _rows: readonly IgQueueRow[], now: Date): boolean {
  if (row.status === "container_created" || row.status === "published") return false;
  if (!isPairShapedTrial(row)) return false;
  return !trialPairLive(row, now);
}

export function igAccountDay(now: Date): string {
  return ctNow(now).day;
}

/** Fits in a Postgres int advisory-lock key. */
export function igAccountDayKey(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return 0;
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
}

/** At most one FEED per pass, never within FEED_SPACING_MS of another, never a missed row. */
function guardFeed(chosen: IgQueueRow[], rows: IgQueueRow[], now: Date, platform: IgPlatform, e: NodeJS.ProcessEnv): IgQueueRow[] {
  const out: IgQueueRow[] = [];
  let feedTaken = false;
  for (const row of chosen) {
    if (row.kind !== "FEED") { out.push(row); continue; }
    if (row.status === "container_created") {
      if (!feedTaken) { out.push(row); feedTaken = true; }
      continue;
    }
    if (feedTaken) continue;
    if (feedIsMissed(row, now, e)) continue;
    if (feedRecentlyPosted(rows, now, platform, row.id)) continue;
    out.push(row);
    feedTaken = true;
  }
  return out;
}

/** Actual posts on one Central account day, counting each variant. Kind mix is whatever the queue approved. */
export const IG_DAILY_POST_CAP = 5;

function occupiesAccountDay(row: IgQueueRow, today: string): boolean {
  if (row.platform !== "ig") return false;
  if (row.capacityDay) return row.capacityDay === today && (row.status === "published" || row.status === "container_created");
  return row.status === "published" && row.publishedAt != null && ctNow(row.publishedAt).day === today;
}

function applyIgDailyCap(chosen: IgQueueRow[], rows: IgQueueRow[], now: Date, platform: IgPlatform): IgQueueRow[] {
  if (platform !== "ig") return chosen;
  const today = ctNow(now).day;
  const actual = rows.filter((row) => occupiesAccountDay(row, today));
  const slottedInflight = chosen.filter((row) => row.status === "container_created" && row.capacityDay === today);
  const starting = chosen
    .filter((row) => !(row.status === "container_created" && row.capacityDay === today))
    .sort((a, b) => {
      const aToday = ctNow(a.scheduledFor).day === today ? 0 : 1;
      const bToday = ctNow(b.scheduledFor).day === today ? 0 : 1;
      return aToday - bToday || a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id - b.id;
    });
  let room = IG_DAILY_POST_CAP - actual.length;
  const kept = slottedInflight.slice(0, IG_DAILY_POST_CAP);
  for (const row of starting) {
    if (room <= 0) break;
    kept.push(row);
    room -= 1;
  }
  const order = new Map(chosen.map((row, index) => [row.id, index]));
  return kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function selectDueRows(rows: IgQueueRow[], now: Date, platform: IgPlatform, e = env()): IgQueueRow[] {
  const chosen = guardFeed(selectDueRowsRaw(rows, now, platform, e), rows, now, platform, e);
  return applyIgDailyCap(chosen, rows, now, platform);
}

function selectDueRowsRaw(rows: IgQueueRow[], now: Date, platform: IgPlatform, e = env()): IgQueueRow[] {
  const mine = rows.filter((row) => row.platform === platform);
  const today = ctNow(now).day;
  // Failed and skipped rows still occupy a seat in an approved full day.
  // Dropping them made the day look short and let an older Reel catch up, which then
  // consumed the kind and displaced the 6 PM Reel.
  const lineupToday = mine.filter((row) => ctNow(row.scheduledFor).day === today);
  const blockBacklog = lineupToday.length >= IG_DAILY_POST_CAP;
  const chosen: IgQueueRow[] = [];
  for (const kind of KINDS) {
    const ofKind = mine.filter((row) => row.kind === kind);
    const inflights = ofKind
      .filter((row) => row.status === "container_created")
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id - b.id);
    if (inflights.length && platform === "ig") {
      const picked = new Set<number>();
      chosen.push(inflights[0]);
      picked.add(inflights[0].id);
      for (const extra of inflights.slice(1)) {
        if (!approvedTrialPartner(extra, ofKind) || picked.has(extra.id)) continue;
        chosen.push(extra);
        picked.add(extra.id);
      }
      for (const held of inflights) {
        const partner = approvedTrialPartner(held, ofKind);
        if (!partner || picked.has(partner.id) || partner.status !== "queued") continue;
        if (!rowIsDue(partner, now, e) || !trialPairLive(partner, now)) continue;
        chosen.push(partner);
        picked.add(partner.id);
      }
      continue;
    }
    const ready = ofKind
      .filter((row) => row.status === "queued" && rowIsDue(row, now, e) && !trialPairExpired(row, ofKind, now))
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id - b.id);
    const catchupDone = ofKind.some((row) => row.status !== "queued" && row.publishedAt != null && ctNow(row.publishedAt).day === today && ctNow(row.scheduledFor).day < today);
    if (catchupDone) continue;
    const catchups = ready.filter((row) => ctNow(row.scheduledFor).day < today);
    if (catchups.length && !blockBacklog) {
      chosen.push(catchups[0]);
      continue;
    }
    const consumed = new Set(
      ofKind.filter((row) => row.status !== "queued" && ctNow(row.scheduledFor).day === today).map((row) => ctNow(row.scheduledFor).minutes),
    );
    const pairOpened = new Set<string>();
    for (const row of ready) {
      if (ctNow(row.scheduledFor).day !== today) continue;
      const minute = ctNow(row.scheduledFor).minutes;
      if (consumed.has(minute)) {
        const partner = approvedTrialPartner(row, ofKind);
        const pairKey = partner ? `${partner.testId}|${minute}` : "";
        const partnerCounted = partner != null && (
          chosen.some((item) => item.id === partner.id)
          || (partner.status === "published" && ctNow(partner.scheduledFor).minutes === minute)
          || partner.status === "container_created"
        );
        if (!partner || !partnerCounted || !trialPairLive(row, now) || pairOpened.has(pairKey)) continue;
        chosen.push(row);
        pairOpened.add(pairKey);
        continue;
      }
      chosen.push(row);
      consumed.add(minute);
    }
  }
  return chosen;
}

export function redactSecrets(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").slice(0, 500);
}

export function logIg(level: "log" | "error", message: string): void {
  const safe = redactSecrets(message, [env().IG_ACCESS_TOKEN ?? "", env().FB_PAGE_TOKEN ?? ""]);
  console[level](`[IgPublish] ${safe}`);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readAllowlistFile(file: string): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw)) return new Set();
    const set = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string" || !/^[a-f0-9]{64}$/i.test(item)) return new Set();
      set.add(item.toLowerCase());
    }
    return set;
  } catch {
    return new Set();
  }
}

async function currentAllowlist(): Promise<Set<string>> {
  if (deps.allowlist) return deps.allowlist;
  return readAllowlistFile(deps.allowlistPath || defaultAllowlistPath());
}

async function extraApprovalGate(hash: string, allowlist: ReadonlySet<string>): Promise<boolean> {
  if (checkAssetMod === undefined) {
    checkAssetMod = null;
    for (const rel of CHECK_ASSET_CANDIDATES) {
      const file = path.resolve(process.cwd(), rel);
      if (!existsSync(file)) continue;
      try {
        const mod = await import(pathToFileURL(file).href) as { assertApproved?: (hash: string, hashes: string[]) => unknown };
        if (typeof mod.assertApproved === "function") {
          checkAssetMod = mod;
          break;
        }
      } catch {
        checkAssetMod = null;
      }
    }
  }
  if (!checkAssetMod?.assertApproved) return true;
  try {
    const result = await checkAssetMod.assertApproved(hash, [...allowlist]);
    return result !== false;
  } catch {
    return false;
  }
}

/** True only when the hash is on the allowlist. check-asset.mjs can reject, never approve an unlisted hash. */
export async function hashIsApproved(hash: string, allowlist: ReadonlySet<string>): Promise<boolean> {
  const normalized = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized) || !allowlist.has(normalized)) return false;
  return extraApprovalGate(normalized, allowlist);
}

export function sanitizeUtmContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(text)) return null;
  return text;
}

export function normalizeCaptionLines(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const COMMISSION_SHARE_RE = /\d+(?:\.\d+)?\s*(?:%|percent\b)|\b\d+\s*\/\s*\d+\s+split\b|\b70\s*\/\s*30\b|\bcommission\b/i;

export function buildIgCaption(input: string): string {
  const text = normalizeCaptionLines(input);
  if (/[\u2013\u2014]/.test(text) || /https?:\/\/|www\.|packpts\.com/i.test(text)) {
    throw new IgInputError("copy_rule");
  }
  // Never disclose the commission share or any split in social copy (Dave, 2026-10-31).
  if (COMMISSION_SHARE_RE.test(text)) throw new IgInputError("copy_rule");
  const caption = /link in bio/i.test(text) ? text : (text ? `${text} Link in bio.` : "Link in bio.");
  if (caption.length > 2200) throw new IgInputError("caption_too_long");
  if (/[\u2013\u2014]/.test(caption) || /https?:\/\/|www\.|packpts\.com/i.test(caption)) {
    throw new IgInputError("copy_rule");
  }
  return caption;
}

export function igPublicMediaUrl(fileName: string): string {
  return `https://packpts.com/social/ig/${encodeURIComponent(fileName)}`;
}

export function igBioRedirectUrl(utmContent: string): string {
  const query = new URLSearchParams({
    utm_source: "instagram",
    utm_medium: "social",
    utm_campaign: "ig_daily",
    utm_content: utmContent,
  });
  return `https://packpts.com/?${query.toString()}`;
}

export function isVideoName(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".mp4" || ext === ".mov";
}

export function contentTypeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  return "application/octet-stream";
}

function isJpeg(fileName: string, bytes: Buffer): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (ext === ".jpg" || ext === ".jpeg") && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

export function mediaMatchesKind(kind: IgKind, fileName: string, bytes: Buffer): boolean {
  const video = isVideoName(fileName);
  if (kind === "FEED" || kind === "PHOTO" || kind === "LINK") return isJpeg(fileName, bytes);
  if (kind === "REEL") return video;
  if (video) return true;
  return isJpeg(fileName, bytes);
}

export function graphMediaFields(kind: IgKind, fileName: string, caption: string, publicUrl: string, opts?: { trial?: boolean }): IgMediaFields {
  if (kind === "REEL") {
    const fields: IgMediaFields = { media_type: "REELS", video_url: publicUrl, caption };
    // Trial Reels cannot share to feed, so only non-trial Reels set share_to_feed.
    if (opts?.trial) fields.trial_params = IG_TRIAL_PARAMS;
    else fields.share_to_feed = "true";
    return fields;
  }
  if (kind === "FEED" || kind === "PHOTO" || kind === "LINK") return { image_url: publicUrl, caption };
  if (isVideoName(fileName)) return { media_type: "STORIES", video_url: publicUrl };
  return { media_type: "STORIES", image_url: publicUrl };
}

export function resolveMediaPath(dir: string, name: string): string | null {
  if (!name || name !== path.basename(name) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const root = path.resolve(dir);
  const full = path.resolve(root, name);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export type InspectedMedia =
  | { ok: true; bytes: Buffer; hash: string; contentType: string }
  | { ok: false; reason: "bad_media_path" | "file_missing" | "hash_not_approved" };

export async function inspectMedia(name: string): Promise<InspectedMedia> {
  const full = resolveMediaPath(mediaDir(), name);
  if (!full) return { ok: false, reason: "bad_media_path" };
  let bytes: Buffer;
  try {
    bytes = readFileSync(full);
  } catch {
    return { ok: false, reason: "file_missing" };
  }
  const hash = sha256Hex(bytes);
  if (!(await hashIsApproved(hash, await currentAllowlist()))) {
    return { ok: false, reason: "hash_not_approved" };
  }
  return { ok: true, bytes, hash, contentType: contentTypeFor(name) };
}

function withDefaults(input: IgQueueInsert): IgQueueRow {
  return {
    id: 0,
    kind: input.kind,
    mediaPath: input.mediaPath,
    caption: input.caption,
    scheduledFor: new Date(input.scheduledFor),
    status: input.status,
    containerId: null,
    igMediaId: null,
    error: input.error ?? null,
    approvalHash: input.approvalHash,
    utmContent: input.utmContent,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    platform: input.platform ?? "ig",
    variant: input.variant ?? null,
    testId: input.testId ?? null,
    trial: input.trial === true,
    insights: input.insights ?? null,
    abTestId: input.abTestId ?? null,
    createdAt: new Date(),
    publishedAt: null,
    capacityDay: null,
  };
}

function copyRow(row: IgQueueRow): IgQueueRow {
  return {
    ...row,
    scheduledFor: new Date(row.scheduledFor),
    createdAt: new Date(row.createdAt),
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    insights: row.insights ? { ...row.insights } : null,
  };
}

function dayOf(row: IgQueueRow): string {
  return ctNow(row.scheduledFor).day;
}

export function createMemoryStore(): IgStore {
  const rows: IgQueueRow[] = [];
  let nextId = 1;
  const chains = new Map<number, Promise<unknown>>();
  const dayChains = new Map<string, Promise<unknown>>();
  const slots = new Map<string, Map<number, number>>();
  const slotByPost = new Map<number, { day: string; slot: number }>();

  function releaseSlot(id: number): void {
    const held = slotByPost.get(id);
    if (!held) return;
    slots.get(held.day)?.delete(held.slot);
    slotByPost.delete(id);
    const row = rows.find((item) => item.id === id);
    if (row) row.capacityDay = null;
  }

  async function withDayLock<T>(day: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = dayChains.get(day) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prev.then(() => gate, () => gate);
    dayChains.set(day, tail);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function find(id: number): IgQueueRow | undefined {
    return rows.find((row) => row.id === id);
  }

  return {
    async insert(input) {
      const row = withDefaults(input);
      row.id = nextId++;
      rows.push(row);
      return copyRow(row);
    },
    async rescheduleQueued(id, scheduledFor) {
      const row = find(id);
      if (!row || row.status !== "queued") return false;
      row.scheduledFor = new Date(scheduledFor);
      return true;
    },
    async setQueuedUtm(id, utmContent, utmMedium, utmCampaign) {
      const row = find(id);
      if (!row || row.status !== "queued") return false;
      row.utmContent = utmContent;
      row.utmMedium = utmMedium;
      row.utmCampaign = utmCampaign;
      return true;
    },
    async setQueuedCaption(id, caption) {
      const row = find(id);
      if (!row || row.status !== "queued") return false;
      row.caption = caption;
      return true;
    },
    async setQueuedMedia(id, mediaPath, approvalHash) {
      const row = find(id);
      if (!row || row.status !== "queued") return false;
      row.mediaPath = mediaPath;
      row.approvalHash = approvalHash;
      return true;
    },
    async setQueuedTrial(id, trial) {
      const row = find(id);
      if (!row || row.status !== "queued" || row.kind !== "REEL") return false;
      row.trial = trial;
      return true;
    },
    async saveInsights(id, insights) {
      const row = find(id);
      if (!row) return false;
      row.insights = insights;
      return true;
    },
    async markAbTest(id, videoId, abTestId) {
      const row = find(id);
      if (!row || row.status !== "queued") return false;
      row.status = "container_created";
      row.igMediaId = videoId;
      row.abTestId = abTestId;
      row.error = null;
      return true;
    },
    async list(limit = 100) {
      return rows.slice().sort((a, b) => b.id - a.id).slice(0, limit).map(copyRow);
    },
    async get(id) {
      const row = find(id);
      return row ? copyRow(row) : null;
    },
    async claimCreate(id, statuses) {
      const row = find(id);
      if (!row || row.containerId || row.igMediaId || !statuses.includes(row.status)) return null;
      row.status = "container_created";
      row.error = null;
      return copyRow(row);
    },
    async saveContainer(id, containerId) {
      const row = find(id);
      if (!row || row.containerId || row.igMediaId || row.status !== "container_created") return false;
      row.containerId = containerId;
      return true;
    },
    async clearContainer(id) {
      const row = find(id);
      if (!row || !row.containerId || row.igMediaId || row.status !== "container_created") return false;
      row.containerId = null;
      row.error = null;
      return true;
    },
    async markPublished(id, igMediaId, publishedAt) {
      const row = find(id);
      if (!row || row.igMediaId || row.status === "published") return false;
      row.status = "published";
      row.igMediaId = igMediaId;
      row.publishedAt = new Date(publishedAt);
      row.error = null;
      return true;
    },
    async markFailed(id, error) {
      const row = find(id);
      if (!row || row.igMediaId || row.status === "published" || row.status === "skipped") return false;
      releaseSlot(id);
      row.status = "failed";
      row.error = error;
      return true;
    },
    async markSkipped(id, error) {
      const row = find(id);
      if (!row || row.igMediaId || row.status === "published") return false;
      releaseSlot(id);
      row.status = "skipped";
      row.error = error;
      return true;
    },
    async latestPublished() {
      const published = rows.filter((row) => row.status === "published");
      published.sort((a, b) => {
        const at = (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0);
        return at !== 0 ? at : a.id - b.id;
      });
      const row = published[published.length - 1];
      return row ? copyRow(row) : null;
    },
    async inflight(kind) {
      const row = rows
        .filter((item) => item.kind === kind && item.status === "container_created")
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id - b.id)[0];
      return row ? copyRow(row) : null;
    },
    async dayConsumed(kind, dayKey) {
      return rows.some((row) => {
        if (row.kind !== kind || row.status === "queued") return false;
        if (dayOf(row) === dayKey) return true;
        return row.publishedAt != null && ctNow(row.publishedAt).day === dayKey;
      });
    },
    async nextQueued(kind, now, _dayKey) {
      const row = rows
        .filter((item) => item.kind === kind && item.status === "queued" && item.scheduledFor.getTime() <= now.getTime())
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.id - b.id)[0];
      return row ? copyRow(row) : null;
    },
    async withLock(id, fn) {
      const prev = chains.get(id) ?? Promise.resolve();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const tail = prev.then(() => gate, () => gate);
      chains.set(id, tail);
      await prev.catch(() => undefined);
      try {
        return { ok: true as const, value: await fn() };
      } finally {
        release();
      }
    },
    async claimDaySlot(id, accountDay) {
      return withDayLock(accountDay, () => {
        const row = find(id);
        if (!row) return "missing" as const;
        const held = slotByPost.get(id);
        if (held) {
          row.capacityDay = held.day;
          return "resume" as const;
        }
        const book = slots.get(accountDay) ?? new Map<number, number>();
        const legacy = rows.filter((item) =>
          item.id !== id
          && item.platform === "ig"
          && !item.capacityDay
          && item.status === "published"
          && item.publishedAt != null
          && ctNow(item.publishedAt).day === accountDay
        ).length;
        if (book.size + legacy >= IG_DAILY_POST_CAP) return "full" as const;
        let slot = 1;
        while (book.has(slot)) slot += 1;
        if (slot > IG_DAILY_POST_CAP) return "full" as const;
        book.set(slot, id);
        slots.set(accountDay, book);
        slotByPost.set(id, { day: accountDay, slot });
        row.capacityDay = accountDay;
        return "claimed" as const;
      });
    },
  };
}

function asInsights(value: unknown): IgInsights | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as IgInsights;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as IgInsights;
  return null;
}

function mapPg(row: Record<string, unknown>): IgQueueRow {
  const variant = row.variant == null ? null : String(row.variant);
  return {
    id: Number(row.id),
    kind: row.kind as IgKind,
    mediaPath: String(row.media_path),
    caption: String(row.caption),
    scheduledFor: new Date(String(row.scheduled_for)),
    status: row.status as IgStatus,
    containerId: row.container_id == null ? null : String(row.container_id),
    igMediaId: row.ig_media_id == null ? null : String(row.ig_media_id),
    error: row.error == null ? null : String(row.error),
    approvalHash: String(row.approval_hash),
    utmContent: String(row.utm_content),
    utmMedium: row.utm_medium == null ? null : String(row.utm_medium),
    utmCampaign: row.utm_campaign == null ? null : String(row.utm_campaign),
    platform: row.platform === "fb" ? "fb" : "ig",
    variant: variant === "A" || variant === "B" ? variant : null,
    testId: row.test_id == null ? null : String(row.test_id),
    trial: row.trial === true || row.trial === "t" || row.trial === "true",
    insights: asInsights(row.insights),
    abTestId: row.ab_test_id == null ? null : String(row.ab_test_id),
    createdAt: new Date(String(row.created_at)),
    publishedAt: row.published_at == null ? null : new Date(String(row.published_at)),
    capacityDay: capacityDayText(row.capacity_day),
  };
}

function capacityDayText(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
}

const ENSURE_IG_POST_QUEUE_SQL = `
CREATE TABLE IF NOT EXISTS ig_post_queue (
  id serial PRIMARY KEY,
  kind varchar(8) NOT NULL,
  media_path varchar(255) NOT NULL,
  caption text NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'queued',
  container_id varchar(64),
  ig_media_id varchar(64),
  error text,
  approval_hash varchar(64) NOT NULL,
  utm_content varchar(40) NOT NULL,
  utm_medium varchar(16),
  utm_campaign varchar(16),
  platform varchar(2) NOT NULL DEFAULT 'ig',
  variant varchar(1),
  test_id varchar(40),
  trial boolean NOT NULL DEFAULT false,
  insights jsonb,
  ab_test_id varchar(64),
  published_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ig_post_queue_kind_check CHECK (kind IN ('FEED', 'REEL', 'STORY', 'PHOTO', 'LINK')),
  CONSTRAINT ig_post_queue_status_check CHECK (status IN ('queued', 'container_created', 'published', 'failed', 'skipped')),
  CONSTRAINT ig_post_queue_platform_check CHECK (platform IN ('ig', 'fb')),
  CONSTRAINT ig_post_queue_variant_check CHECK (variant IS NULL OR variant IN ('A', 'B'))
);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS utm_medium varchar(16);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS utm_campaign varchar(16);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS platform varchar(2) NOT NULL DEFAULT 'ig';
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS variant varchar(1);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS test_id varchar(40);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS trial boolean NOT NULL DEFAULT false;
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS insights jsonb;
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS ab_test_id varchar(64);
ALTER TABLE ig_post_queue DROP CONSTRAINT IF EXISTS ig_post_queue_kind_check;
ALTER TABLE ig_post_queue ADD CONSTRAINT ig_post_queue_kind_check CHECK (kind IN ('FEED', 'REEL', 'STORY', 'PHOTO', 'LINK'));
ALTER TABLE ig_post_queue DROP CONSTRAINT IF EXISTS ig_post_queue_platform_check;
ALTER TABLE ig_post_queue ADD CONSTRAINT ig_post_queue_platform_check CHECK (platform IN ('ig', 'fb'));
ALTER TABLE ig_post_queue DROP CONSTRAINT IF EXISTS ig_post_queue_variant_check;
ALTER TABLE ig_post_queue ADD CONSTRAINT ig_post_queue_variant_check CHECK (variant IS NULL OR variant IN ('A', 'B'));
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_status_scheduled ON ig_post_queue (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_kind_status ON ig_post_queue (kind, status);
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_published ON ig_post_queue (published_at);
ALTER TABLE ig_post_queue ADD COLUMN IF NOT EXISTS capacity_day date;
CREATE TABLE IF NOT EXISTS ig_publish_day_slot (
  platform varchar(2) NOT NULL DEFAULT 'ig',
  account_day date NOT NULL,
  slot integer NOT NULL,
  post_id integer NOT NULL UNIQUE REFERENCES ig_post_queue(id),
  PRIMARY KEY (platform, account_day, slot),
  CONSTRAINT ig_publish_day_slot_range CHECK (slot BETWEEN 1 AND 5),
  CONSTRAINT ig_publish_day_slot_platform CHECK (platform IN ('ig', 'fb'))
);
`;

let ensureTask: Promise<void> | null = null;

async function pgPool(): Promise<Pool> {
  const { pool } = await import("../db");
  if (!ensureTask) {
    ensureTask = pool.query(ENSURE_IG_POST_QUEUE_SQL).then(() => undefined, (err: unknown) => {
      ensureTask = null;
      throw err;
    });
  }
  await ensureTask;
  return pool;
}

export const pgStore: IgStore = {
  async insert(input) {
    const pool = await pgPool();
    const result = await pool.query(
      `INSERT INTO ig_post_queue (
         kind, media_path, caption, scheduled_for, status, approval_hash, utm_content,
         utm_medium, utm_campaign, platform, variant, test_id, trial
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        input.kind,
        input.mediaPath,
        input.caption,
        input.scheduledFor,
        input.approvalHash,
        input.utmContent,
        input.utmMedium ?? null,
        input.utmCampaign ?? null,
        input.platform ?? "ig",
        input.variant ?? null,
        input.testId ?? null,
        input.trial === true,
      ],
    );
    return mapPg(result.rows[0]);
  },
  async rescheduleQueued(id, scheduledFor) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET scheduled_for = $2 WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id, scheduledFor],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async setQueuedUtm(id, utmContent, utmMedium, utmCampaign) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET utm_content = $2, utm_medium = $3, utm_campaign = $4
       WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id, utmContent, utmMedium, utmCampaign],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async setQueuedCaption(id, caption) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET caption = $2 WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id, caption],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async setQueuedMedia(id, mediaPath, approvalHash) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET media_path = $2, approval_hash = $3
       WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id, mediaPath, approvalHash],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async setQueuedTrial(id, trial) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET trial = $2
       WHERE id = $1 AND status = 'queued' AND kind = 'REEL'
       RETURNING id`,
      [id, trial],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async saveInsights(id, insights) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET insights = $2::jsonb WHERE id = $1 RETURNING id`,
      [id, JSON.stringify(insights)],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async markAbTest(id, videoId, abTestId) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue
       SET status = 'container_created', ig_media_id = $2, ab_test_id = $3, error = NULL
       WHERE id = $1 AND status = 'queued'
       RETURNING id`,
      [id, videoId, abTestId],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async list(limit = 100) {
    const pool = await pgPool();
    const result = await pool.query(`SELECT * FROM ig_post_queue ORDER BY id DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => mapPg(row));
  },
  async get(id) {
    const pool = await pgPool();
    const result = await pool.query(`SELECT * FROM ig_post_queue WHERE id = $1`, [id]);
    return result.rows[0] ? mapPg(result.rows[0]) : null;
  },
  async claimCreate(id, statuses) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET status = 'container_created', error = NULL
       WHERE id = $1 AND container_id IS NULL AND ig_media_id IS NULL AND status = ANY($2::varchar[])
       RETURNING *`,
      [id, statuses],
    );
    return result.rows[0] ? mapPg(result.rows[0]) : null;
  },
  async saveContainer(id, containerId) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET container_id = $2, status = 'container_created'
       WHERE id = $1 AND container_id IS NULL AND ig_media_id IS NULL AND status = 'container_created'
       RETURNING id`,
      [id, containerId],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async clearContainer(id) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET container_id = NULL, error = NULL
       WHERE id = $1 AND container_id IS NOT NULL AND ig_media_id IS NULL AND status = 'container_created'
       RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async markPublished(id, igMediaId, publishedAt) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET status = 'published', ig_media_id = $2, published_at = $3, error = NULL
       WHERE id = $1 AND ig_media_id IS NULL AND status <> 'published'
       RETURNING id`,
      [id, igMediaId, publishedAt],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async markFailed(id, error) {
    const pool = await pgPool();
    const result = await pool.query(
      `WITH released AS (
         DELETE FROM ig_publish_day_slot WHERE post_id = $1
       )
       UPDATE ig_post_queue SET status = 'failed', error = $2, capacity_day = NULL
       WHERE id = $1 AND ig_media_id IS NULL AND status IN ('queued', 'container_created', 'failed')
       RETURNING id`,
      [id, error],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async markSkipped(id, error) {
    const pool = await pgPool();
    const result = await pool.query(
      `WITH released AS (
         DELETE FROM ig_publish_day_slot WHERE post_id = $1
       )
       UPDATE ig_post_queue SET status = 'skipped', error = $2, capacity_day = NULL
       WHERE id = $1 AND ig_media_id IS NULL AND status <> 'published'
       RETURNING id`,
      [id, error],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async latestPublished() {
    const pool = await pgPool();
    const result = await pool.query(
      `SELECT * FROM ig_post_queue WHERE status = 'published'
       ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1`,
    );
    return result.rows[0] ? mapPg(result.rows[0]) : null;
  },
  async inflight(kind) {
    const pool = await pgPool();
    const result = await pool.query(
      `SELECT * FROM ig_post_queue WHERE kind = $1 AND status = 'container_created'
       ORDER BY scheduled_for ASC, id ASC LIMIT 1`,
      [kind],
    );
    return result.rows[0] ? mapPg(result.rows[0]) : null;
  },
  async dayConsumed(kind, dayKey) {
    const pool = await pgPool();
    const result = await pool.query(
      `SELECT 1 FROM ig_post_queue
       WHERE kind = $1 AND status <> 'queued'
         AND (
           (scheduled_for AT TIME ZONE 'America/Chicago')::date = $2::date
           OR (published_at AT TIME ZONE 'America/Chicago')::date = $2::date
         )
       LIMIT 1`,
      [kind, dayKey],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async nextQueued(kind, now, _dayKey) {
    const pool = await pgPool();
    const result = await pool.query(
      `SELECT * FROM ig_post_queue
       WHERE kind = $1 AND status = 'queued' AND scheduled_for <= $2
       ORDER BY scheduled_for ASC, id ASC LIMIT 1`,
      [kind, now],
    );
    return result.rows[0] ? mapPg(result.rows[0]) : null;
  },
  async withLock(id, fn) {
    const pool = await pgPool();
    const client: PoolClient = await pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(81021, $1::int) AS locked", [id]);
      locked = result.rows[0]?.locked === true;
      if (!locked) return { ok: false };
      return { ok: true, value: await fn() };
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(81021, $1::int)", [id]).catch(() => undefined);
      client.release();
    }
  },
  async claimDaySlot(id, accountDay) {
    const key = igAccountDayKey(accountDay);
    if (!key) return "missing";
    const pool = await pgPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(81022, $1::int)", [key]);
      const row = await client.query(`SELECT id, platform FROM ig_post_queue WHERE id = $1`, [id]);
      if (!row.rows[0]) {
        await client.query("COMMIT");
        return "missing";
      }
      const held = await client.query(
        `SELECT account_day FROM ig_publish_day_slot WHERE post_id = $1`,
        [id],
      );
      if (held.rows[0]) {
        await client.query(
          `UPDATE ig_post_queue SET capacity_day = $2 WHERE id = $1 AND capacity_day IS NULL`,
          [id, held.rows[0].account_day],
        );
        await client.query("COMMIT");
        return "resume";
      }
      const occupied = await client.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT post_id AS id FROM ig_publish_day_slot
           WHERE platform = 'ig' AND account_day = $1::date
           UNION
           SELECT id FROM ig_post_queue
           WHERE platform = 'ig' AND capacity_day IS NULL AND status = 'published'
             AND (published_at AT TIME ZONE 'America/Chicago')::date = $1::date
             AND id <> $2
         ) occupied`,
        [accountDay, id],
      );
      if (Number(occupied.rows[0]?.n ?? 0) >= IG_DAILY_POST_CAP) {
        await client.query("COMMIT");
        return "full";
      }
      const inserted = await client.query(
        `INSERT INTO ig_publish_day_slot (platform, account_day, slot, post_id)
         SELECT 'ig', $1::date, s.n, $2
         FROM generate_series(1, $3::int) AS s(n)
         WHERE NOT EXISTS (
           SELECT 1 FROM ig_publish_day_slot
           WHERE platform = 'ig' AND account_day = $1::date AND slot = s.n
         )
         ORDER BY s.n
         LIMIT 1
         ON CONFLICT (post_id) DO NOTHING
         RETURNING slot`,
        [accountDay, id, IG_DAILY_POST_CAP],
      );
      if (!inserted.rows[0]) {
        await client.query("COMMIT");
        return "full";
      }
      await client.query(
        `UPDATE ig_post_queue SET capacity_day = $2::date WHERE id = $1`,
        [id, accountDay],
      );
      await client.query("COMMIT");
      return "claimed";
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};

function currentStore(): IgStore {
  return deps.store ?? pgStore;
}

export function queueStore(): IgStore {
  return currentStore();
}

export function publisherFetch(): typeof fetch {
  return deps.fetch ?? fetch;
}

export function publisherEnv(): NodeJS.ProcessEnv {
  return env();
}

export async function graphJson(url: string, init: RequestInit, token: string): Promise<Record<string, unknown>> {
  return graphRequest(url, init, token);
}

const MEDIA_PUBLISH_NOT_READY_ATTEMPTS = 5;
const MEDIA_PUBLISH_NOT_READY_WAIT_MS = 15_000;
/** Code 24 on a fresh container: retry, then one replacement. Meta: 1–2 tries, then a new id. */
const CONTAINER_MISSING_ATTEMPTS = 3;

/**
 * media_publish HTTP 400 "Media ID is not available" (9007 / 2207027).
 * Graph marks it non-transient, but it happens when a container just turned FINISHED.
 */
export function isMediaPublishNotReady(err: unknown): boolean {
  if (!(err instanceof IgGraphError) || err.status !== 400) return false;
  if (err.code === 9007 || err.subcode === 2207027) return true;
  return /media id is not available/i.test(err.message);
}

/**
 * HTTP 400 code 24, subcode 2207008 (or 2207006).
 * The OAuth message is "The requested resource does not exist".
 * Meta's error guide calls 2207008 temporary: retry, then create a new container.
 * Story container reads return this while the media builder is not visible yet.
 */
export function isContainerMissing(err: unknown): boolean {
  if (!(err instanceof IgGraphError) || err.status !== 400) return false;
  if (err.code === 24 || err.subcode === 2207008 || err.subcode === 2207006) return true;
  return /requested resource does not exist/i.test(err.message)
    || /media builder with creation id/i.test(err.message)
    || /does not exist or has been expired/i.test(err.message)
    || /unsupported get request/i.test(err.message);
}

export async function retryGraph<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let transientTries = 0;
  let notReadyTries = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (isMediaPublishNotReady(err)) {
        notReadyTries += 1;
        if (notReadyTries >= MEDIA_PUBLISH_NOT_READY_ATTEMPTS) throw err;
        await sleep(MEDIA_PUBLISH_NOT_READY_WAIT_MS);
        continue;
      }
      const transient = err instanceof IgGraphError ? err.transient : true;
      if (!transient || transientTries >= attempts - 1) throw err;
      await sleep(1000 * 2 ** transientTries);
      transientTries += 1;
    }
  }
}

/** Same container, a few times. Code 24 is not the 9007 "not ready" retry. */
async function publishMediaReady(graph: IgGraph, containerId: string): Promise<string> {
  let missing = 0;
  for (;;) {
    try {
      return await retryGraph(() => graph.publishMedia(containerId));
    } catch (err) {
      if (!isContainerMissing(err)) throw err;
      missing += 1;
      if (missing >= CONTAINER_MISSING_ATTEMPTS) throw err;
      await sleep(MEDIA_PUBLISH_NOT_READY_WAIT_MS);
    }
  }
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "graph_error";
  return redactSecrets(message, [env().IG_ACCESS_TOKEN ?? ""]);
}

async function graphRequest(url: string, init: RequestInit, token: string): Promise<Record<string, unknown>> {
  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch {
    throw new IgGraphError("graph_network", 0, true);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const error = json.error as { message?: string; code?: unknown; error_subcode?: unknown } | undefined;
    const raw = typeof error?.message === "string" ? error.message : `graph_${response.status}`;
    const code = typeof error?.code === "number" ? error.code : undefined;
    const subcode = typeof error?.error_subcode === "number" ? error.error_subcode : undefined;
    const message = redactSecrets(raw, [token]);
    const notReady = response.status === 400
      && url.includes("/media_publish")
      && (code === 9007 || subcode === 2207027 || /media id is not available/i.test(message));
    throw new IgGraphError(
      message,
      response.status,
      notReady || response.status === 429 || response.status >= 500,
      code,
      subcode,
    );
  }
  return json;
}

function mustConfig(): { token: string; userId: string; pageId: string } {
  const e = env();
  const token = e.IG_ACCESS_TOKEN?.trim() ?? "";
  const userId = e.IG_USER_ID?.trim() ?? "";
  const pageId = e.FB_PAGE_ID?.trim() ?? "";
  if (!token || !userId) throw new IgGraphError("credentials_missing", 0, false);
  return { token, userId, pageId };
}

export function defaultGraph(): IgGraph {
  return {
    async pageInstagramId() {
      const { token, pageId } = mustConfig();
      if (!pageId) throw new IgGraphError("page_not_configured", 0, false);
      const url = `https://graph.facebook.com/${igGraphVersion()}/${encodeURIComponent(pageId)}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`;
      const json = await graphRequest(url, { method: "GET" }, token);
      const account = json.instagram_business_account as { id?: string } | undefined;
      return account?.id ? String(account.id) : "";
    },
    async publishingLimit() {
      const { token, userId } = mustConfig();
      const url = `${graphBase()}/${encodeURIComponent(userId)}/content_publishing_limit?access_token=${encodeURIComponent(token)}`;
      const json = await graphRequest(url, { method: "GET" }, token);
      const data = Array.isArray(json.data) ? json.data[0] as { quota_usage?: number; config?: { quota_total?: number } } : undefined;
      const usage = Number(data?.quota_usage);
      const total = Number(data?.config?.quota_total ?? IG_PUBLISH_LIMIT);
      if (!Number.isFinite(usage) || !Number.isFinite(total)) throw new IgGraphError("limit_unreadable", 502, true);
      return { usage, total };
    },
    async createMedia(fields) {
      const { token, userId } = mustConfig();
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) {
        if (value) params.set(key, value);
      }
      params.set("access_token", token);
      const json = await graphRequest(
        `${graphBase()}/${encodeURIComponent(userId)}/media`,
        { method: "POST", body: params },
        token,
      );
      if (!json.id) throw new IgGraphError("container_missing", 502, false);
      return String(json.id);
    },
    async containerStatus(containerId) {
      const { token } = mustConfig();
      const url = `${graphBase()}/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(token)}`;
      const json = await graphRequest(url, { method: "GET" }, token);
      const code = String(json.status_code ?? "");
      if (code === "FINISHED" || code === "IN_PROGRESS" || code === "PUBLISHED" || code === "ERROR" || code === "EXPIRED") {
        return code;
      }
      throw new IgGraphError("status_unknown", 502, true);
    },
    async publishMedia(containerId) {
      const { token, userId } = mustConfig();
      const params = new URLSearchParams({ creation_id: containerId, access_token: token });
      const json = await graphRequest(
        `${graphBase()}/${encodeURIComponent(userId)}/media_publish`,
        { method: "POST", body: params },
        token,
      );
      if (!json.id) throw new IgGraphError("media_missing", 502, false);
      return String(json.id);
    },
  };
}

function currentGraph(): IgGraph {
  return deps.graph ?? defaultGraph();
}

async function pollContainer(graph: IgGraph, containerId: string): Promise<IgContainerCode | "TIMEOUT" | "MISSING"> {
  const max = deps.pollMax ?? 20;
  const missingMax = Math.min(CONTAINER_MISSING_ATTEMPTS, max);
  let missingTries = 0;
  for (let i = 0; i < max; i++) {
    try {
      const code = await retryGraph(() => graph.containerStatus(containerId));
      if (code !== "IN_PROGRESS") return code;
    } catch (err) {
      if (!isContainerMissing(err)) throw err;
      missingTries += 1;
      if (missingTries >= missingMax) return "MISSING";
    }
    if (i === max - 1) return "TIMEOUT";
    const wait = missingTries > 0
      ? MEDIA_PUBLISH_NOT_READY_WAIT_MS
      : Math.min(15_000, 2000 * 2 ** Math.min(i, 3));
    await sleep(wait);
  }
  return "TIMEOUT";
}

export type IgPublishResult = {
  status: string;
  id?: number;
  error?: string;
  igMediaId?: string | null;
  reason?: string;
  usage?: number;
  total?: number;
  wouldSkip?: boolean;
  kind?: IgKind;
  caption?: string;
  utmContent?: string;
  publicUrl?: string;
  hash?: string;
  graph?: IgMediaFields;
};

type PublishOpts = { dryRun?: boolean; allowFailed?: boolean; recheckSkipped?: boolean; releaseExpired?: boolean };

async function reserveIgCapacity(row: IgQueueRow): Promise<IgPublishResult | null> {
  if (row.platform !== "ig" || row.capacityDay) return null;
  const slot = await currentStore().claimDaySlot(row.id, igAccountDay(clock()));
  if (slot === "claimed" || slot === "resume") {
    const fresh = await currentStore().get(row.id);
    if (fresh?.capacityDay) row.capacityDay = fresh.capacityDay;
    return null;
  }
  if (slot === "missing") return { status: "not_found", id: row.id };
  return { status: "cap_full", id: row.id, reason: "daily_cap" };
}

async function publishLocked(id: number, opts: PublishOpts): Promise<IgPublishResult> {
  const store = currentStore();
  let row = await store.get(id);
  if (!row) return { status: "not_found", id };
  if (row.status === "published" || row.igMediaId) return { status: "already_published", id, igMediaId: row.igMediaId };
  if (row.platform === "fb") return { status: "wrong_platform", id };
  // Pair-shaped rows past the live window stay blocked with an empty peer list.
  // releaseExpired overrides that gate only. It does not grant a sixth post.
  if (!opts.releaseExpired && row.status !== "container_created" && trialPairExpired(row, [], clock())) {
    return { status: "expired_slot", id, wouldSkip: true, reason: "expired_trial_pair" };
  }

  const media = await inspectMedia(row.mediaPath);
  if (!media.ok || media.hash !== row.approvalHash.toLowerCase()) {
    const reason = !media.ok ? media.reason : "hash_not_approved";
    if (opts.dryRun) return { status: "dry_run", id, wouldSkip: true, reason };
    await store.markSkipped(id, reason);
    return { status: "skipped", id, error: reason };
  }
  if (!mediaMatchesKind(row.kind, row.mediaPath, media.bytes)) {
    if (opts.dryRun) return { status: "dry_run", id, wouldSkip: true, reason: "media_kind_mismatch" };
    await store.markSkipped(id, "media_kind_mismatch");
    return { status: "skipped", id, error: "media_kind_mismatch" };
  }

  const fields = graphMediaFields(row.kind, row.mediaPath, row.caption, igPublicMediaUrl(row.mediaPath), {
    trial: row.trial === true && row.kind === "REEL",
  });
  if (opts.dryRun) {
    return {
      status: "dry_run",
      id,
      wouldSkip: false,
      kind: row.kind,
      caption: row.caption,
      utmContent: row.utmContent,
      publicUrl: igPublicMediaUrl(row.mediaPath),
      hash: media.hash,
      graph: fields,
    };
  }

  const e = env();
  if (!igPublishEnabled(e)) return { status: "disabled", id };
  if (!igCredsReady(e)) return { status: "not_armed", id };

  const graph = currentGraph();
  try {
    const limit = await retryGraph(() => graph.publishingLimit());
    if (limit.usage >= limit.total || limit.usage >= IG_PUBLISH_LIMIT) {
      return { status: "limit", id, usage: limit.usage, total: limit.total };
    }
  } catch (err) {
    return { status: "limit_unknown", id, error: safeError(err) };
  }

  if (pageCheckEnabled(e)) {
    let linked = "";
    try {
      linked = await retryGraph(() => graph.pageInstagramId());
    } catch (err) {
      return { status: "wrong_account", id, error: safeError(err) };
    }
    if (linked !== e.IG_USER_ID?.trim()) return { status: "wrong_account", id };
  }

  // One replacement. A dead Story container must not mint a new id on every cron tick.
  for (let containerAttempt = 0; containerAttempt < 2; containerAttempt++) {
    if (!row.containerId) {
      const statuses: IgStatus[] = ["queued", "container_created"];
      if (opts.allowFailed) statuses.push("failed");
      if (opts.recheckSkipped) statuses.push("skipped");
      if (!statuses.includes(row.status)) return { status: row.status, id, error: row.error ?? undefined };
      const blocked = await reserveIgCapacity(row);
      if (blocked) return blocked;
      const claimed = await store.claimCreate(id, statuses);
      if (!claimed) {
        row = await store.get(id);
        if (!row) return { status: "not_found", id };
        if (row.status === "published" || row.igMediaId) return { status: "already_published", id, igMediaId: row.igMediaId };
        if (!row.containerId) return { status: "in_progress", id };
      } else {
        row = claimed;
        try {
          const containerId = await retryGraph(() => graph.createMedia(fields));
          const saved = await store.saveContainer(id, containerId);
          if (!saved) {
            const again = await store.get(id);
            if (!again?.containerId) return { status: "in_progress", id };
            row = again;
          } else {
            row = { ...row, containerId, status: "container_created" };
          }
        } catch (err) {
          const error = safeError(err);
          await store.markFailed(id, error);
          logIg("error", `post ${id} failed: ${error}`);
          return { status: "failed", id, error };
        }
      }
    }

    if (!row.containerId) return { status: "in_progress", id };
    const blocked = await reserveIgCapacity(row);
    if (blocked) return blocked;
    const containerId = row.containerId;
    let code: IgContainerCode | "TIMEOUT" | "MISSING";
    try {
      code = await pollContainer(graph, containerId);
    } catch (err) {
      const error = safeError(err);
      await store.markFailed(id, error);
      logIg("error", `post ${id} failed: ${error}`);
      return { status: "failed", id, error };
    }
    if (code === "TIMEOUT" || code === "IN_PROGRESS") return { status: "pending", id };
    if (code === "ERROR") {
      const error = "container_error";
      await store.markFailed(id, error);
      logIg("error", `post ${id} failed: ${error}`);
      return { status: "failed", id, error };
    }
    if (code === "EXPIRED") {
      if (containerAttempt === 0 && await store.clearContainer(id)) {
        const again = await store.get(id);
        if (!again) return { status: "not_found", id };
        row = again;
        logIg("error", `post ${id} container expired, creating a new one`);
        continue;
      }
      const error = "container_expired";
      await store.markFailed(id, error);
      logIg("error", `post ${id} failed: ${error}`);
      return { status: "failed", id, error };
    }
    if (code === "PUBLISHED") {
      await store.markPublished(id, row.igMediaId ?? `published:${containerId}`, clock());
      return { status: "already_published", id, igMediaId: row.igMediaId };
    }

    const fresh = await store.get(id);
    if (!fresh) return { status: "not_found", id };
    if (fresh.status === "published" || fresh.igMediaId) return { status: "already_published", id, igMediaId: fresh.igMediaId };
    try {
      const igMediaId = await publishMediaReady(graph, containerId);
      const won = await store.markPublished(id, igMediaId, clock());
      if (!won) {
        const again = await store.get(id);
        return { status: "already_published", id, igMediaId: again?.igMediaId ?? igMediaId };
      }
      logIg("log", `published ${fresh.kind} ${fresh.utmContent} media ${igMediaId}`);
      return { status: "published", id, igMediaId };
    } catch (err) {
      const error = safeError(err);
      // Keep the container id. The next pass publishes it instead of creating another.
      if (isMediaPublishNotReady(err)) {
        logIg("error", `post ${id} media id not available: ${error}`);
        return { status: "pending", id, error };
      }
      // Code 24 on this id: Meta says create a new container. One replacement, then stop.
      if (isContainerMissing(err) && containerAttempt === 0 && await store.clearContainer(id)) {
        const again = await store.get(id);
        if (!again) return { status: "not_found", id };
        row = again;
        logIg("error", `post ${id} container missing, creating a new one`);
        continue;
      }
      await store.markFailed(id, error);
      logIg("error", `post ${id} failed: ${error}`);
      return { status: "failed", id, error };
    }
  }
  return { status: "failed", id, error: "container_missing" };
}

export async function publishIg(id: number, opts: PublishOpts = {}): Promise<IgPublishResult> {
  const locked = await currentStore().withLock(id, () => publishLocked(id, opts));
  if (!locked.ok) return { status: "in_progress", id };
  return locked.value;
}

export async function listQueue(): Promise<IgQueueRow[]> {
  if (!deps.store) {
    try {
      await enqueueApprovedSlots();
    } catch (err) {
      logIg("error", `seed failed: ${safeError(err)}`);
    }
  }
  return currentStore().list(100);
}

export function trackingUrl(row: Pick<IgQueueRow, "id" | "platform" | "kind" | "variant" | "utmMedium" | "utmCampaign"> & { mediaPath?: string }): string {
  const source = row.platform === "fb" ? "facebook" : "instagram";
  const medium = (row.utmMedium || row.kind).toLowerCase();
  const campaign = row.utmCampaign || "w1";
  const query = new URLSearchParams({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    utm_content: rowUtmContent(row.id, row.variant),
  });
  const pathName = row.kind === "LINK" || /^fb-link-/i.test(row.mediaPath ?? "") ? "/daily" : "/";
  return `https://packpts.com${pathName}?${query.toString()}`;
}

function fbCaption(input: string): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (/[\u2013\u2014]/.test(text) || /https?:\/\/|www\.|packpts\.com/i.test(text)) throw new IgInputError("copy_rule");
  if (text.length > 2200) throw new IgInputError("caption_too_long");
  return text || "Can you name all 5?";
}

/** Rewrite caption and/or media on a queued row. Posted rows are left unchanged. */
export const IG_PULLED_ERROR = "pulled_by_qa";

/** Pull one queued row so it can never publish. Status becomes skipped; media is untouched. */
export async function skipQueuedRow(id: number): Promise<IgQueueRow> {
  if (!Number.isInteger(id) || id <= 0) throw new IgInputError("bad_id");
  const store = currentStore();
  const locked = await store.withLock(id, async () => {
    const row = await store.get(id);
    if (!row) throw new IgInputError("not_found");
    if (row.status !== "queued") throw new IgInputError("not_queued");
    if (!(await store.markSkipped(id, IG_PULLED_ERROR))) throw new IgInputError("not_queued");
    const fresh = await store.get(id);
    if (!fresh) throw new IgInputError("not_found");
    return fresh;
  });
  if (!locked.ok) throw new IgInputError("not_queued");
  return locked.value;
}

export async function updateQueuedRow(id: number, input: { caption?: unknown; mediaPath?: unknown; trial?: unknown; skip?: unknown }): Promise<IgQueueRow> {
  if (!Number.isInteger(id) || id <= 0) throw new IgInputError("bad_id");
  if (input.skip !== undefined) {
    if (input.skip !== true) throw new IgInputError("bad_skip");
    if (input.caption !== undefined || input.mediaPath !== undefined || input.trial !== undefined) throw new IgInputError("bad_patch");
    return skipQueuedRow(id);
  }
  const hasCaption = input.caption !== undefined;
  const hasMedia = input.mediaPath !== undefined;
  const hasTrial = input.trial !== undefined;
  if (!hasCaption && !hasMedia && !hasTrial) throw new IgInputError("bad_patch");
  if (hasTrial && typeof input.trial !== "boolean") throw new IgInputError("bad_trial");
  if (hasCaption && typeof input.caption !== "string") throw new IgInputError("bad_caption");
  if (hasMedia && (typeof input.mediaPath !== "string" || !input.mediaPath.trim())) throw new IgInputError("bad_media_path");
  const store = currentStore();
  const row = await store.get(id);
  if (!row) throw new IgInputError("not_found");
  if (row.status !== "queued") throw new IgInputError("not_queued");
  if (hasTrial && input.trial === true && (row.kind !== "REEL" || row.platform !== "ig")) throw new IgInputError("trial_reel_only");
  const linkInCaption = row.kind === "LINK" || /^fb-link-/i.test(row.mediaPath);
  const nextCaption = !hasCaption
    ? null
    : linkInCaption
      ? linkCaption(input.caption as string, trackingUrl(row))
      : row.platform === "fb"
        ? fbCaption(input.caption as string)
        : buildIgCaption(input.caption as string);
  let nextMedia: { path: string; hash: string } | null = null;
  if (hasMedia) {
    const mediaPath = path.basename(input.mediaPath as string);
    if (mediaPath !== input.mediaPath) throw new IgInputError("bad_media_path");
    const media = await inspectMedia(mediaPath);
    if (!media.ok) throw new IgInputError(media.reason);
    if (!mediaMatchesKind(row.kind, mediaPath, media.bytes)) throw new IgInputError("media_kind_mismatch");
    nextMedia = { path: mediaPath, hash: media.hash };
  }
  if (nextCaption != null && !(await store.setQueuedCaption(id, nextCaption))) throw new IgInputError("not_queued");
  if (nextMedia && !(await store.setQueuedMedia(id, nextMedia.path, nextMedia.hash))) throw new IgInputError("not_queued");
  if (hasTrial && !(await store.setQueuedTrial(id, input.trial as boolean))) throw new IgInputError("not_queued");
  const fresh = await store.get(id);
  if (!fresh) throw new IgInputError("not_found");
  return fresh;
}

export function linkCaption(base: string, url: string): string {
  const text = base.replace(/\s*Link in bio\.?/i, "").replace(/\s+/g, " ").trim() || "Can you name all 5?";
  if (/[\u2013\u2014]/.test(text) || /[\u2013\u2014]/.test(url)) throw new IgInputError("copy_rule");
  const caption = `${text} ${url}`;
  if (caption.length > 2200) throw new IgInputError("caption_too_long");
  return caption;
}

export async function enqueueIgPost(input: {
  kind: unknown;
  mediaPath: unknown;
  caption?: unknown;
  scheduledFor: unknown;
  approvalHash: unknown;
  utmContent?: unknown;
  platform?: IgPlatform;
  variant?: IgVariant | null;
  testId?: string | null;
  trial?: boolean;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}): Promise<IgQueueRow> {
  if (typeof input.approvalHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.approvalHash.trim())) {
    throw new IgInputError("approval_hash_required");
  }
  if (!KINDS.includes(input.kind as IgKind)) throw new IgInputError("bad_kind");
  const kind = input.kind as IgKind;
  if (typeof input.mediaPath !== "string") throw new IgInputError("bad_media_path");
  const mediaPath = path.basename(input.mediaPath);
  if (mediaPath !== input.mediaPath || !resolveMediaPath(mediaDir(), mediaPath)) throw new IgInputError("bad_media_path");
  const platform: IgPlatform = input.platform === "fb" ? "fb" : "ig";
  const variant = input.variant === "A" || input.variant === "B" ? input.variant : null;
  const stem = mediaPath.replace(/\.[^.]+$/, "");
  const utmContent = sanitizeUtmContent(input.utmContent ?? stem);
  if (!utmContent) throw new IgInputError("bad_utm_content");
  const scheduledFor = input.scheduledFor instanceof Date ? input.scheduledFor : new Date(String(input.scheduledFor ?? ""));
  if (Number.isNaN(scheduledFor.getTime())) throw new IgInputError("bad_schedule");
  const rawCaption = typeof input.caption === "string" ? input.caption : "";
  const caption = platform === "fb" ? fbCaption(rawCaption) : buildIgCaption(rawCaption);
  const media = await inspectMedia(mediaPath);
  if (!media.ok) throw new IgInputError(media.reason);
  if (media.hash !== input.approvalHash.trim().toLowerCase()) throw new IgInputError("hash_mismatch");
  if (!mediaMatchesKind(kind, mediaPath, media.bytes)) throw new IgInputError("media_kind_mismatch");
  const store = currentStore();
  const inserted = await store.insert({
    kind,
    mediaPath,
    caption,
    scheduledFor,
    status: "queued",
    approvalHash: media.hash,
    utmContent,
    utmMedium: input.utmMedium ?? kind.toLowerCase(),
    utmCampaign: input.utmCampaign ?? campaignFor(mediaPath, utmContent),
    platform,
    variant,
    testId: input.testId ?? null,
    trial: input.trial === true,
  });
  const content = rowUtmContent(inserted.id, inserted.variant);
  if (inserted.utmContent !== content) {
    await store.setQueuedUtm(inserted.id, content, inserted.utmMedium ?? kind.toLowerCase(), inserted.utmCampaign ?? "w1");
  }
  return (await store.get(inserted.id)) ?? inserted;
}

export async function igBioTarget(override: unknown): Promise<string> {
  if (typeof override === "string" && override.trim()) {
    const content = sanitizeUtmContent(override);
    if (!content) throw new IgInputError("bad_utm_content");
    return igBioRedirectUrl(content);
  }
  try {
    const latest = await currentStore().latestPublished();
    return igBioRedirectUrl(latest?.utmContent ?? "bio");
  } catch (err) {
    logIg("error", `bio lookup failed: ${safeError(err)}`);
    return igBioRedirectUrl("bio");
  }
}

function slotWhen(slot: IgQueueSlot, origin: Date): Date {
  if (slot.at) return ctWallTime(slot.at.date, slot.at.hour, slot.at.minute);
  return new Date(origin.getTime() + (slot.day ?? 0) * 86_400_000 + slotMinutes(slot.kind) * 60_000);
}

export async function queueParsedCreatives(): Promise<number> {
  let names: string[] = [];
  try {
    names = readdirSync(mediaDir()).filter((name) => !name.startsWith("."));
  } catch {
    return 0;
  }
  const parsed = names.map((name) => parseCreativeName(name)).filter((item): item is ParsedCreative => item != null);
  const existing = await currentStore().list(500);
  const have = new Set(existing.map((row) => row.mediaPath));
  let inserted = 0;
  for (const item of parsed) {
    if (have.has(item.file)) continue;
    const plan = creativePlan(item, parsed);
    const media = await inspectMedia(item.file);
    if (!media.ok) continue;
    try {
      const row = await enqueueIgPost({
        kind: plan.kind,
        mediaPath: item.file,
        caption: "Can you name all 5?",
        scheduledFor: ctWallTime(plan.at.date, plan.at.hour, plan.at.minute),
        approvalHash: media.hash,
        utmContent: `${plan.campaign}-${item.format}`,
        platform: item.platform,
        variant: item.variant,
        testId: item.testId,
        trial: plan.trial,
        utmMedium: item.format === "link" ? "link" : plan.kind.toLowerCase(),
        utmCampaign: plan.campaign,
      });
      if (item.format === "link") {
        await currentStore().setQueuedCaption(row.id, linkCaption("Can you name all 5?", trackingUrl(row)));
      }
      have.add(item.file);
      inserted += 1;
    } catch (err) {
      logIg("error", `seed ${item.file} failed: ${safeError(err)}`);
    }
  }
  return inserted;
}

/** Queued Story rows at 20:00 CT move to 21:00 CT. Trial flags are left as set. Posted rows are not updated. */
export async function migrateQueuedRows(store = currentStore()): Promise<{ stories: number[]; utm: number[]; trials: number[] }> {
  const stories: number[] = [];
  const utm: number[] = [];
  const trials: number[] = [];
  for (const row of await store.list(500)) {
    if (row.status !== "queued") continue;
    if (row.kind === "STORY" && ctNow(row.scheduledFor).minutes === 20 * 60) {
      const moved = ctWallTime(ctNow(row.scheduledFor).day, 21, 0);
      if (await store.rescheduleQueued(row.id, moved)) stories.push(row.id);
    }
    const content = rowUtmContent(row.id, row.variant);
    const medium = row.utmMedium || row.kind.toLowerCase();
    const campaign = row.utmCampaign || campaignFor(row.mediaPath, row.utmContent);
    if (row.utmContent !== content || row.utmMedium !== medium || row.utmCampaign !== campaign) {
      if (await store.setQueuedUtm(row.id, content, medium, campaign)) utm.push(row.id);
    }
    // Trial is set per row (seed plan or QA PATCH); startup no longer forces w1/w2 Reels to trial.
  }
  for (const row of await store.list(500)) {
    const linkInCaption = row.kind === "LINK" || (row.platform === "fb" && /^fb-link-/i.test(row.mediaPath));
    if (row.status !== "queued" || !linkInCaption || row.caption.includes("https://")) continue;
    await store.setQueuedCaption(row.id, linkCaption(row.caption, trackingUrl(row)));
  }
  return { stories, utm, trials };
}

async function insertMissingSlots(): Promise<number> {
  await migrateQueuedRows();
  const existing = await currentStore().list(500);
  const have = new Set(existing.map((row) => row.mediaPath));
  const origin = ctNow(new Date()).midnightUtc;
  let inserted = 0;
  for (const slot of IG_QUEUE_SLOTS) {
    if (have.has(slot.file)) continue;
    const media = await inspectMedia(slot.file);
    if (!media.ok) throw new IgInputError(media.reason);
    await enqueueIgPost({
      kind: slot.kind,
      mediaPath: slot.file,
      caption: "Can you name all 5?",
      scheduledFor: slotWhen(slot, origin),
      approvalHash: media.hash,
      utmContent: slot.utm,
    });
    have.add(slot.file);
    inserted += 1;
  }
  // Week 3 files are approved media only. Boot does not insert them: a queued
  // row would publish the placeholder caption when its clock arrives.
  await migrateQueuedRows();
  return inserted;
}

let seedTask: Promise<number> | null = null;

/** Insert missing week 1 and week 2 slots. Existing rows are not changed. Parsed week 3 files are left on disk. */
export function enqueueApprovedSlots(): Promise<number> {
  if (deps.store) return insertMissingSlots();
  if (!seedTask) {
    seedTask = seedPg().then((result) => {
      if (result === null) seedTask = null;
      return result ?? 0;
    }, (err: unknown) => {
      seedTask = null;
      throw err;
    });
  }
  return seedTask;
}

async function seedPg(): Promise<number | null> {
  const pool = await pgPool();
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(81021, 20) AS locked");
    locked = result.rows[0]?.locked === true;
    if (!locked) return null;
    return await insertMissingSlots();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(81021, 20)").catch(() => undefined);
    client.release();
  }
}

export function fbGraphBase(e = env()): string {
  return `https://graph.facebook.com/${igGraphVersion(e)}`;
}

export function insightsDue(now: Date, e = env()): boolean {
  return ctNow(now).minutes >= clockMinutes(readClock(e.IG_INSIGHTS_AT_CT, "09:00"));
}

const IG_COMMON_METRICS = ["reach", "views", "saved", "shares", "total_interactions", "profile_visits"];
const IG_REEL_METRICS = ["ig_reels_avg_watch_time"];
const IG_STORY_METRICS = ["navigation"];
const FB_POST_METRICS = ["post_impressions", "post_impressions_unique", "post_clicks"];

function metricValue(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value == null) return null;
  return JSON.stringify(value);
}

async function pullMetricBag(url: string, token: string): Promise<{ metrics: Record<string, number | string | null>; error?: string }> {
  try {
    const json = await graphRequest(url, { method: "GET" }, token);
    const metrics: Record<string, number | string | null> = {};
    const data = Array.isArray(json.data) ? json.data : [];
    for (const item of data) {
      const row = item as { name?: string; values?: Array<{ value?: unknown }> };
      if (!row.name) continue;
      metrics[row.name] = metricValue(row.values?.[0]?.value);
    }
    return { metrics };
  } catch (err) {
    return { metrics: {}, error: safeError(err) };
  }
}

export async function runInsightSync(now = new Date()): Promise<{ status: string; pulled: number }> {
  const e = env();
  const igToken = e.IG_ACCESS_TOKEN?.trim() ?? "";
  const fbToken = e.FB_PAGE_TOKEN?.trim() ?? "";
  if (!igToken && !fbToken) return { status: "not_armed", pulled: 0 };
  const store = currentStore();
  const today = ctNow(now).day;
  let pulled = 0;
  for (const row of await store.list(500)) {
    let next: IgInsights = row.insights ? { ...row.insights } : {};
    let changed = false;
    if (row.platform === "ig" && igToken && row.status === "published" && row.igMediaId) {
      const age = row.publishedAt ? now.getTime() - row.publishedAt.getTime() : 0;
      if (row.kind === "STORY" && row.publishedAt && !next.story20h && age >= 20 * 3_600_000 && age < 24 * 3_600_000) {
        const result = await pullMetricBag(
          `${graphBase(e)}/${encodeURIComponent(row.igMediaId)}/insights?metric=${encodeURIComponent([...IG_COMMON_METRICS, ...IG_STORY_METRICS].join(","))}&access_token=${encodeURIComponent(igToken)}`,
          igToken,
        );
        next = { ...next, story20h: { pulledAt: now.toISOString(), metrics: result.metrics, error: result.error } };
        changed = true;
      }
      if (insightsDue(now, e) && next.daily?.day !== today) {
        // Reels reject profile_visits, which fails the whole insights call.
        const names = row.kind === "REEL" ? IG_COMMON_METRICS.filter((m) => m !== "profile_visits") : [...IG_COMMON_METRICS];
        if (row.kind === "REEL") names.push(...IG_REEL_METRICS);
        if (row.kind === "STORY") names.push(...IG_STORY_METRICS);
        const result = await pullMetricBag(
          `${graphBase(e)}/${encodeURIComponent(row.igMediaId)}/insights?metric=${encodeURIComponent(names.join(","))}&access_token=${encodeURIComponent(igToken)}`,
          igToken,
        );
        next = { ...next, daily: { day: today, pulledAt: now.toISOString(), metrics: result.metrics, error: result.error } };
        changed = true;
      }
    }
    if (row.platform === "fb" && fbToken && insightsDue(now, e)) {
      if (row.status === "published" && row.igMediaId && next.fb?.day !== today) {
        const result = await pullMetricBag(
          `${fbGraphBase(e)}/${encodeURIComponent(row.igMediaId)}/insights?metric=${encodeURIComponent(FB_POST_METRICS.join(","))}&access_token=${encodeURIComponent(fbToken)}`,
          fbToken,
        );
        next = { ...next, fb: { day: today, pulledAt: now.toISOString(), metrics: result.metrics, error: result.error } };
        changed = true;
      }
      const abPulledToday = Boolean(next.abTest?.pulledAt && ctNow(new Date(next.abTest.pulledAt)).day === today);
      if (row.abTestId && !abPulledToday) {
        try {
          const body = await graphRequest(
            `${fbGraphBase(e)}/${encodeURIComponent(row.abTestId)}?access_token=${encodeURIComponent(fbToken)}`,
            { method: "GET" },
            fbToken,
          );
          next = { ...next, abTest: { pulledAt: now.toISOString(), body } };
        } catch (err) {
          next = { ...next, abTest: { pulledAt: now.toISOString(), body: {}, error: safeError(err) } };
        }
        changed = true;
      }
    }
    if (!changed) continue;
    await store.saveInsights(row.id, next);
    pulled += 1;
  }
  return { status: "ran", pulled };
}

export async function runIgDaily(now = new Date()): Promise<{ status: string; day?: string; results?: IgPublishResult[] }> {
  const e = env();
  if (!igPublishEnabled(e)) return { status: "disabled" };
  if (!igCredsReady(e)) return { status: "not_armed" };
  const store = currentStore();
  const rows = await store.list(500);
  for (const row of missedFeedRows(rows, now, "ig", e)) {
    if (await store.markSkipped(row.id, FEED_MISSED_ERROR)) logIg("error", `post ${row.id} FEED missed its slot by more than 45 min, skipped`);
  }
  const due = selectDueRows(rows, now, "ig", e);
  const results: IgPublishResult[] = [];
  for (const row of due) {
    if (row.kind === "FEED" && row.status === "queued") {
      // Re-check spacing under one FEED-wide lock so two passes or two instances cannot both post a feed.
      const locked = await store.withLock(FEED_KIND_LOCK_ID, async () => {
        if (feedRecentlyPosted(await store.list(500), now, "ig", row.id)) return { status: "deferred", id: row.id } satisfies IgPublishResult;
        return publishIg(row.id);
      });
      results.push(locked.ok ? locked.value : { status: "in_progress", id: row.id });
      continue;
    }
    results.push(await publishIg(row.id));
  }
  return { status: "ran", day: ctNow(now).day, results };
}

export function startIgPublisher(): void {
  void enqueueApprovedSlots().catch((err) => logIg("error", `seed failed: ${safeError(err)}`));
  let igRunning = false;
  const tick = () => {
    if (!igRunning) {
      igRunning = true;
      void runIgDaily().catch((err) => logIg("error", safeError(err))).finally(() => { igRunning = false; });
    }
    void runInsightSync().catch((err) => logIg("error", safeError(err)));
    void import("./fbPublish").then((mod) => mod.runFbDaily()).catch((err) => logIg("error", safeError(err)));
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
  if (!igPublishEnabled()) {
    console.log("[IgPublish] disabled (IG_PUBLISH_ENABLED is not true)");
    return;
  }
  if (!igCredsReady()) {
    console.log("[IgPublish] not armed (IG_USER_ID and IG_ACCESS_TOKEN must both be set)");
    return;
  }
  console.log(`[IgPublish] started (feed ${env().IG_FEED_AT_CT || IG_SLOT_DEFAULTS.FEED} reel ${env().IG_REEL_AT_CT || IG_SLOT_DEFAULTS.REEL} story ${env().IG_STORY_AT_CT || IG_SLOT_DEFAULTS.STORY} story morning ${env().IG_STORY_AM_AT_CT || IG_EXTRA_SLOTS.STORY} trial reel ${env().IG_REEL_TRIAL_AT_CT || IG_EXTRA_SLOTS.REEL} CT)`);
}
