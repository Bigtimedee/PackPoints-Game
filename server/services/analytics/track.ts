/**
 * Analytics Event Spine — fire-and-forget capture (ANALYTICS_PROMPTS.md, Prompt 1).
 *
 * The single most important, most durable thing this company builds: the
 * demand-signal event stream. Its value is a function of time-depth and cannot
 * be backfilled, so capture must NEVER be skipped — but it must also NEVER
 * block, slow, or break gameplay. This module buffers events in memory and
 * flushes them in batches; on any failure it drops the batch and increments a
 * counter rather than throwing into the request path.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { analyticsEvents, type InsertAnalyticsEvent } from "@shared/schema";

const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 500;
const FLAGGED_REFRESH_MS = 5 * 60 * 1000;

let buffer: InsertAnalyticsEvent[] = [];
let dropped = 0;
let started = false;

// Hashes of users whose risk state is not NORMAL — refreshed periodically so
// is_clean can be set at capture with no hot-path query. Empty until first
// refresh (fail-open to clean=true; the rollup layer re-derives authoritatively).
let flaggedHashes = new Set<string>();

async function refreshFlaggedUsers(): Promise<void> {
  try {
    const salt = process.env.SECRET_SALT || process.env.SESSION_SECRET || "packpts-analytics";
    const rows = await db.execute(sql`SELECT user_id FROM user_risk_state WHERE status <> 'NORMAL'`);
    const next = new Set<string>();
    for (const r of (rows.rows as any[])) {
      if (r.user_id) next.add(crypto.createHmac("sha256", salt).update(r.user_id).digest("hex"));
    }
    flaggedHashes = next;
  } catch {
    // keep the previous set on failure
  }
}

/** Hash a user id for PII-free analytics. Returns null for anonymous. */
export function hashUser(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const salt = process.env.SECRET_SALT || process.env.SESSION_SECRET || "packpts-analytics";
  return crypto.createHmac("sha256", salt).update(userId).digest("hex");
}

export interface TrackInput {
  eventType: string;
  userId?: string | null;
  userHash?: string | null; // supply if already hashed
  isClean?: boolean;
  sessionId?: string | null;
  playerKey?: string | null;
  gameSetId?: string | null;
  setName?: string | null;
  sport?: string | null;
  brand?: string | null;
  year?: number | null;
  cardId?: string | null;
  isUserCreatedSet?: boolean | null;
  outcome?: string | null;
  latencyMs?: number | null;
  payload?: Record<string, any> | null;
}

/** Enqueue an analytics event. Never throws. */
export function track(input: TrackInput): void {
  try {
    ensureStarted();
    const userHash = input.userHash ?? hashUser(input.userId);
    const isClean = input.isClean ?? (userHash ? !flaggedHashes.has(userHash) : true);
    buffer.push({
      eventType: input.eventType,
      userHash,
      isClean,
      sessionId: input.sessionId ?? null,
      playerKey: input.playerKey ?? null,
      gameSetId: input.gameSetId ?? null,
      setName: input.setName ?? null,
      sport: input.sport ?? null,
      brand: input.brand ?? null,
      year: input.year ?? null,
      cardId: input.cardId ?? null,
      isUserCreatedSet: input.isUserCreatedSet ?? null,
      outcome: input.outcome ?? null,
      latencyMs: input.latencyMs ?? null,
      payload: input.payload ?? null,
    });
    if (buffer.length >= MAX_BUFFER) void flush();
  } catch {
    dropped++;
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await db.insert(analyticsEvents).values(batch);
  } catch (err) {
    dropped += batch.length;
    console.error(`[Analytics] flush dropped ${batch.length} events:`, (err as any)?.message);
  }
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  timer.unref();
  void refreshFlaggedUsers();
  const rf = setInterval(() => void refreshFlaggedUsers(), FLAGGED_REFRESH_MS);
  rf.unref();
}

export function getAnalyticsDroppedCount(): number {
  return dropped;
}
