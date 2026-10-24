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
import { existsSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { Pool, PoolClient } from "pg";
import { ctNow } from "./daily5XWatch";

export const IG_GRAPH_VERSION = "v21.0";
const IG_GRAPH_HOST_DEFAULT = "graph.instagram.com";
export const IG_PUBLISH_LIMIT = 50;
export const IG_SLOT_DEFAULTS = { FEED: "11:00", REEL: "18:00", STORY: "20:00" } as const;
const SLOT_ENV = { FEED: "IG_FEED_AT_CT", REEL: "IG_REEL_AT_CT", STORY: "IG_STORY_AT_CT" } as const;
const KINDS = ["FEED", "REEL", "STORY"] as const;

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
    slots.push({ kind: "STORY", file: `story-w2-day${n}.jpg`, utm: `w2-story-d${n}`, at: { date: WEEK2_LATE_DATES[i], hour: 20, minute: 0 } });
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
  createdAt: Date;
  publishedAt: Date | null;
};

export type IgMediaFields = {
  image_url?: string;
  video_url?: string;
  media_type?: "REELS" | "STORIES";
  caption?: string;
};

export interface IgGraph {
  pageInstagramId(): Promise<string>;
  publishingLimit(): Promise<{ usage: number; total: number }>;
  createMedia(fields: IgMediaFields): Promise<string>;
  containerStatus(containerId: string): Promise<IgContainerCode>;
  publishMedia(containerId: string): Promise<string>;
}

export interface IgStore {
  insert(row: Omit<IgQueueRow, "id" | "createdAt" | "publishedAt" | "containerId" | "igMediaId" | "error"> & { error?: string | null }): Promise<IgQueueRow>;
  list(limit?: number): Promise<IgQueueRow[]>;
  get(id: number): Promise<IgQueueRow | null>;
  claimCreate(id: number, statuses: IgStatus[]): Promise<IgQueueRow | null>;
  saveContainer(id: number, containerId: string): Promise<boolean>;
  markPublished(id: number, igMediaId: string, publishedAt: Date): Promise<boolean>;
  markFailed(id: number, error: string): Promise<boolean>;
  markSkipped(id: number, error: string): Promise<boolean>;
  latestPublished(): Promise<IgQueueRow | null>;
  inflight(kind: IgKind): Promise<IgQueueRow | null>;
  dayConsumed(kind: IgKind, dayKey: string): Promise<boolean>;
  nextQueued(kind: IgKind, now: Date, dayKey: string): Promise<IgQueueRow | null>;
  withLock<T>(id: number, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }>;
}

export class IgGraphError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean) {
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

export function redactSecrets(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").slice(0, 500);
}

export function logIg(level: "log" | "error", message: string): void {
  const safe = redactSecrets(message, [env().IG_ACCESS_TOKEN ?? ""]);
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

export function buildIgCaption(input: string): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (/[\u2013\u2014]/.test(text) || /https?:\/\/|www\.|packpts\.com/i.test(text)) {
    throw new IgInputError("copy_rule");
  }
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
  if (kind === "FEED") return isJpeg(fileName, bytes);
  if (kind === "REEL") return video;
  if (video) return true;
  return isJpeg(fileName, bytes);
}

export function graphMediaFields(kind: IgKind, fileName: string, caption: string, publicUrl: string): IgMediaFields {
  if (kind === "FEED") return { image_url: publicUrl, caption };
  if (kind === "REEL") return { media_type: "REELS", video_url: publicUrl, caption };
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

function copyRow(row: IgQueueRow): IgQueueRow {
  return {
    ...row,
    scheduledFor: new Date(row.scheduledFor),
    createdAt: new Date(row.createdAt),
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
  };
}

function dayOf(row: IgQueueRow): string {
  return ctNow(row.scheduledFor).day;
}

export function createMemoryStore(): IgStore {
  const rows: IgQueueRow[] = [];
  let nextId = 1;
  const chains = new Map<number, Promise<unknown>>();

  function find(id: number): IgQueueRow | undefined {
    return rows.find((row) => row.id === id);
  }

  return {
    async insert(input) {
      const row: IgQueueRow = {
        id: nextId++,
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
        createdAt: new Date(),
        publishedAt: null,
      };
      rows.push(row);
      return copyRow(row);
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
      row.status = "failed";
      row.error = error;
      return true;
    },
    async markSkipped(id, error) {
      const row = find(id);
      if (!row || row.igMediaId || row.status === "published") return false;
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
  };
}

function mapPg(row: Record<string, unknown>): IgQueueRow {
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
    createdAt: new Date(String(row.created_at)),
    publishedAt: row.published_at == null ? null : new Date(String(row.published_at)),
  };
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
  published_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ig_post_queue_kind_check CHECK (kind IN ('FEED', 'REEL', 'STORY')),
  CONSTRAINT ig_post_queue_status_check CHECK (status IN ('queued', 'container_created', 'published', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_status_scheduled ON ig_post_queue (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_kind_status ON ig_post_queue (kind, status);
CREATE INDEX IF NOT EXISTS idx_ig_post_queue_published ON ig_post_queue (published_at);
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
      `INSERT INTO ig_post_queue (kind, media_path, caption, scheduled_for, status, approval_hash, utm_content)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6) RETURNING *`,
      [input.kind, input.mediaPath, input.caption, input.scheduledFor, input.approvalHash, input.utmContent],
    );
    return mapPg(result.rows[0]);
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
      `UPDATE ig_post_queue SET status = 'failed', error = $2
       WHERE id = $1 AND ig_media_id IS NULL AND status IN ('queued', 'container_created', 'failed')
       RETURNING id`,
      [id, error],
    );
    return (result.rowCount ?? 0) > 0;
  },
  async markSkipped(id, error) {
    const pool = await pgPool();
    const result = await pool.query(
      `UPDATE ig_post_queue SET status = 'skipped', error = $2
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
};

function currentStore(): IgStore {
  return deps.store ?? pgStore;
}

export async function retryGraph<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const transient = err instanceof IgGraphError ? err.transient : true;
      if (!transient || i === attempts - 1) throw err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
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
    const error = json.error as { message?: string } | undefined;
    const raw = typeof error?.message === "string" ? error.message : `graph_${response.status}`;
    throw new IgGraphError(redactSecrets(raw, [token]), response.status, response.status === 429 || response.status >= 500);
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

async function pollContainer(graph: IgGraph, containerId: string): Promise<IgContainerCode | "TIMEOUT"> {
  const max = deps.pollMax ?? 20;
  for (let i = 0; i < max; i++) {
    const code = await retryGraph(() => graph.containerStatus(containerId));
    if (code !== "IN_PROGRESS") return code;
    if (i === max - 1) return "TIMEOUT";
    await sleep(Math.min(15_000, 2000 * 2 ** Math.min(i, 3)));
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

type PublishOpts = { dryRun?: boolean; allowFailed?: boolean; recheckSkipped?: boolean };

async function publishLocked(id: number, opts: PublishOpts): Promise<IgPublishResult> {
  const store = currentStore();
  let row = await store.get(id);
  if (!row) return { status: "not_found", id };
  if (row.status === "published" || row.igMediaId) return { status: "already_published", id, igMediaId: row.igMediaId };

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

  const fields = graphMediaFields(row.kind, row.mediaPath, row.caption, igPublicMediaUrl(row.mediaPath));
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

  if (!row.containerId) {
    const statuses: IgStatus[] = ["queued", "container_created"];
    if (opts.allowFailed) statuses.push("failed");
    if (opts.recheckSkipped) statuses.push("skipped");
    if (!statuses.includes(row.status)) return { status: row.status, id, error: row.error ?? undefined };
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
  const containerId = row.containerId;
  let code: IgContainerCode | "TIMEOUT";
  try {
    code = await pollContainer(graph, containerId);
  } catch (err) {
    const error = safeError(err);
    await store.markFailed(id, error);
    logIg("error", `post ${id} failed: ${error}`);
    return { status: "failed", id, error };
  }
  if (code === "TIMEOUT" || code === "IN_PROGRESS") return { status: "pending", id };
  if (code === "ERROR" || code === "EXPIRED") {
    const error = `container_${code.toLowerCase()}`;
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
    const igMediaId = await retryGraph(() => graph.publishMedia(containerId));
    const won = await store.markPublished(id, igMediaId, clock());
    if (!won) {
      const again = await store.get(id);
      return { status: "already_published", id, igMediaId: again?.igMediaId ?? igMediaId };
    }
    logIg("log", `published ${fresh.kind} ${fresh.utmContent} media ${igMediaId}`);
    return { status: "published", id, igMediaId };
  } catch (err) {
    const error = safeError(err);
    await store.markFailed(id, error);
    logIg("error", `post ${id} failed: ${error}`);
    return { status: "failed", id, error };
  }
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

export async function enqueueIgPost(input: {
  kind: unknown;
  mediaPath: unknown;
  caption?: unknown;
  scheduledFor: unknown;
  approvalHash: unknown;
  utmContent?: unknown;
}): Promise<IgQueueRow> {
  if (typeof input.approvalHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.approvalHash.trim())) {
    throw new IgInputError("approval_hash_required");
  }
  if (input.kind !== "FEED" && input.kind !== "REEL" && input.kind !== "STORY") throw new IgInputError("bad_kind");
  if (typeof input.mediaPath !== "string") throw new IgInputError("bad_media_path");
  const mediaPath = path.basename(input.mediaPath);
  if (mediaPath !== input.mediaPath || !resolveMediaPath(mediaDir(), mediaPath)) throw new IgInputError("bad_media_path");
  const stem = mediaPath.replace(/\.[^.]+$/, "");
  const utmContent = sanitizeUtmContent(input.utmContent ?? stem);
  if (!utmContent) throw new IgInputError("bad_utm_content");
  const scheduledFor = input.scheduledFor instanceof Date ? input.scheduledFor : new Date(String(input.scheduledFor ?? ""));
  if (Number.isNaN(scheduledFor.getTime())) throw new IgInputError("bad_schedule");
  const caption = buildIgCaption(typeof input.caption === "string" ? input.caption : "");
  const media = await inspectMedia(mediaPath);
  if (!media.ok) throw new IgInputError(media.reason);
  if (media.hash !== input.approvalHash.trim().toLowerCase()) throw new IgInputError("hash_mismatch");
  if (!mediaMatchesKind(input.kind, mediaPath, media.bytes)) throw new IgInputError("media_kind_mismatch");
  return currentStore().insert({
    kind: input.kind,
    mediaPath,
    caption,
    scheduledFor,
    status: "queued",
    approvalHash: media.hash,
    utmContent,
  });
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

async function insertMissingSlots(): Promise<number> {
  const existing = await currentStore().list(200);
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
    inserted += 1;
  }
  return inserted;
}

let seedTask: Promise<number> | null = null;

/** Insert approved slots whose media path is not already queued. Existing rows are not changed. */
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

export async function runIgDaily(now = new Date()): Promise<{ status: string; day?: string; results?: IgPublishResult[] }> {
  const e = env();
  if (!igPublishEnabled(e)) return { status: "disabled" };
  if (!igCredsReady(e)) return { status: "not_armed" };
  const ct = ctNow(now);
  const store = currentStore();
  const results: IgPublishResult[] = [];
  for (const kind of KINDS) {
    const inflight = await store.inflight(kind);
    if (inflight) {
      results.push(await publishIg(inflight.id));
      continue;
    }
    if (ct.minutes < slotMinutes(kind, e)) continue;
    if (await store.dayConsumed(kind, ct.day)) continue;
    const next = await store.nextQueued(kind, now, ct.day);
    if (!next) continue;
    results.push(await publishIg(next.id));
  }
  return { status: "ran", day: ct.day, results };
}

export function startIgPublisher(): void {
  void enqueueApprovedSlots().catch((err) => logIg("error", `seed failed: ${safeError(err)}`));
  if (!igPublishEnabled()) {
    console.log("[IgPublish] disabled (IG_PUBLISH_ENABLED is not true)");
    return;
  }
  if (!igCredsReady()) {
    console.log("[IgPublish] not armed (IG_USER_ID and IG_ACCESS_TOKEN must both be set)");
    return;
  }
  const tick = () => void runIgDaily().catch((err) => logIg("error", safeError(err)));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log(`[IgPublish] started (feed ${env().IG_FEED_AT_CT || IG_SLOT_DEFAULTS.FEED} reel ${env().IG_REEL_AT_CT || IG_SLOT_DEFAULTS.REEL} story ${env().IG_STORY_AT_CT || IG_SLOT_DEFAULTS.STORY} CT)`);
}
