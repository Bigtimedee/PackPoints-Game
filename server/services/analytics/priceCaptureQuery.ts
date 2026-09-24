/**
 * Pure PriceCapture candidate selection, row mapping, and fetch throttling.
 * No database or CardHedge import, so tests can run without DATABASE_URL.
 *
 * analytics_events.card_id is the question card id. Solo and 1v1 both set
 * that to playable_cards.id (storage.generateQuestionFromPlayableCard and
 * matchService.playableCardToBaseballCard). A CardHedge id is also accepted.
 * Legacy baseball_cards rows have no cardhedge_card_id, so they cannot be
 * priced. Year and sport come from game_sets — playable_cards has no year,
 * and the question card's year is often 0.
 *
 * player_key matches answer_submitted: normalizePlayerKey(name, sport || "baseball").
 */
import { normalizePlayerKey } from "../rewardEngine";

export const PRICE_CAPTURE_MAX_FETCH_DEFAULT = 200;
export const PRICE_CAPTURE_FETCH_CONCURRENCY = 2;
export const PRICE_CAPTURE_FETCH_SPACING_MS = 250;
export const PRICE_CAPTURE_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
export const PRICE_CAPTURE_DB_CACHE_TTL_SECONDS_DEFAULT = 600;

export const RECENT_ANSWER_COUNT_SQL = `
SELECT COUNT(*)::int AS event_count
FROM analytics_events
WHERE event_type = 'answer_submitted'
  AND occurred_at > NOW() - INTERVAL '30 days'
  AND is_clean = true
`.trim();

export const PLAYED_CANDIDATES_SQL = `
SELECT
  pc.player AS player,
  gs.year AS year,
  gs.sport AS sport,
  pc.game_set_id AS game_set_id,
  pc.cardhedge_card_id AS cardhedge_card_id,
  COUNT(*)::int AS plays
FROM analytics_events ae
JOIN LATERAL (
  SELECT p.id, p.player, p.game_set_id, p.cardhedge_card_id
  FROM playable_cards p
  WHERE p.id = ae.card_id OR p.cardhedge_card_id = ae.card_id
  ORDER BY CASE WHEN p.id = ae.card_id THEN 0 ELSE 1 END
  LIMIT 1
) pc ON true
JOIN game_sets gs ON gs.id = pc.game_set_id
WHERE ae.event_type = 'answer_submitted'
  AND ae.occurred_at > NOW() - INTERVAL '30 days'
  AND ae.is_clean = true
  AND pc.player IS NOT NULL AND pc.player <> ''
  AND pc.cardhedge_card_id IS NOT NULL AND pc.cardhedge_card_id <> ''
GROUP BY pc.player, gs.year, gs.sport, pc.game_set_id, pc.cardhedge_card_id
ORDER BY plays DESC, pc.cardhedge_card_id
`.trim();

export const FALLBACK_CANDIDATES_SQL = `
SELECT
  pc.player AS player,
  gs.year AS year,
  gs.sport AS sport,
  pc.game_set_id AS game_set_id,
  pc.cardhedge_card_id AS cardhedge_card_id,
  0 AS plays
FROM playable_cards pc
JOIN game_sets gs ON gs.id = pc.game_set_id
WHERE pc.is_playable = true
  AND gs.is_active = true
  AND pc.player IS NOT NULL AND pc.player <> ''
  AND pc.cardhedge_card_id IS NOT NULL AND pc.cardhedge_card_id <> ''
ORDER BY pc.player, gs.year, pc.cardhedge_card_id
`.trim();

export function readPriceCaptureMaxFetch(envValue: string | undefined): number {
  const n = parseInt(envValue ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return PRICE_CAPTURE_MAX_FETCH_DEFAULT;
  return n;
}

export function readCacheTtlSeconds(envValue: string | undefined): number {
  const n = parseInt(envValue ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return PRICE_CAPTURE_DB_CACHE_TTL_SECONDS_DEFAULT;
  return n;
}

export function limitedSql(query: string, limit: number): string {
  const n = Math.floor(limit);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("price capture limit must be a positive integer");
  }
  return `${query}\nLIMIT ${n}`;
}

export type PriceCaptureSourceRow = {
  player?: string | null;
  year?: number | string | null;
  sport?: string | null;
  game_set_id?: string | null;
  cardhedge_card_id?: string | null;
  payload?: { prices?: Array<{ grade?: string; price?: string }> } | null;
};

export type PriceCaptureCandidate = PriceCaptureSourceRow & {
  plays?: number | string | null;
};

export type PriceCaptureInsert = {
  capturedOn: string;
  playerKey: string;
  cardhedgeCardId: string | null;
  gameSetId: string | null;
  year: number | null;
  rawPriceCents: number;
  source: "cardhedge";
};

export type CacheLookupRow = {
  cardId: string;
  payload: unknown;
  fetchedAt?: Date | string | null;
};

export type CacheUpsertWrite = {
  values: {
    cardId: string;
    rawImagesOnly: false;
    payload: unknown;
    expiresAt: Date;
  };
  update: {
    payload: unknown;
    fetchedAt: Date;
    expiresAt: Date;
  };
};

export function cacheUpsertValues(
  cardId: string,
  payload: unknown,
  now: Date,
  ttlSeconds: number,
): CacheUpsertWrite {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    values: {
      cardId,
      rawImagesOnly: false,
      payload,
      expiresAt,
    },
    update: {
      payload,
      fetchedAt: now,
      expiresAt,
    },
  };
}

export function isCacheRowFresh(
  fetchedAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (fetchedAt == null) return false;
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : Date.parse(String(fetchedAt));
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= PRICE_CAPTURE_CACHE_FRESH_MS;
}

export function asPricePayload(value: unknown): PriceCaptureSourceRow["payload"] {
  if (!value || typeof value !== "object") return null;
  const prices = (value as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) return { prices: [] };
  const parsed: Array<{ grade?: string; price?: string }> = [];
  for (const entry of prices) {
    if (!entry || typeof entry !== "object") continue;
    const grade = "grade" in entry && typeof entry.grade === "string" ? entry.grade : undefined;
    const rawPrice = "price" in entry ? entry.price : undefined;
    const price = typeof rawPrice === "string" || typeof rawPrice === "number"
      ? String(rawPrice)
      : undefined;
    parsed.push({ grade, price });
  }
  return { prices: parsed };
}

export function mapPriceCaptureRow(
  r: PriceCaptureSourceRow,
  day: string,
): PriceCaptureInsert | null {
  const prices = r.payload?.prices || [];
  const raw = prices.find((p) => /^raw$/i.test(p.grade || "")) || prices[0];
  const rawPriceCents = raw?.price ? Math.round(parseFloat(raw.price) * 100) : null;
  if (rawPriceCents == null || Number.isNaN(rawPriceCents)) return null;

  const yearNum = Number(r.year);
  const year = r.year != null && r.year !== "" && Number.isFinite(yearNum) ? yearNum : null;

  return {
    capturedOn: day,
    playerKey: normalizePlayerKey(String(r.player ?? ""), r.sport || "baseball"),
    cardhedgeCardId: r.cardhedge_card_id || null,
    gameSetId: r.game_set_id || null,
    year,
    rawPriceCents,
    source: "cardhedge",
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseCandidateRows(rows: Array<Record<string, unknown>>): PriceCaptureCandidate[] {
  return rows.map((r) => ({
    player: stringOrNull(r.player),
    year: typeof r.year === "number" || typeof r.year === "string" ? r.year : null,
    sport: stringOrNull(r.sport),
    game_set_id: stringOrNull(r.game_set_id),
    cardhedge_card_id: stringOrNull(r.cardhedge_card_id),
    plays: typeof r.plays === "number" || typeof r.plays === "string" ? r.plays : null,
  }));
}

export function actionableCandidates(rows: PriceCaptureCandidate[]): PriceCaptureCandidate[] {
  const seen = new Set<string>();
  const out: PriceCaptureCandidate[] = [];
  for (const row of rows) {
    const id = row.cardhedge_card_id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...row, cardhedge_card_id: id });
  }
  return out;
}

export function chooseCandidateSource(recentAnswerCount: number): "played" | "fallback" {
  return recentAnswerCount > 0 ? "played" : "fallback";
}

export function freshCacheByCardId(
  rows: CacheLookupRow[],
  now: Date,
): Map<string, PriceCaptureSourceRow["payload"]> {
  const map = new Map<string, PriceCaptureSourceRow["payload"]>();
  for (const row of rows) {
    if (!row.cardId || !isCacheRowFresh(row.fetchedAt, now)) continue;
    map.set(row.cardId, asPricePayload(row.payload));
  }
  return map;
}

export async function runThrottled<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  opts: {
    concurrency: number;
    spacingMs: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const spacingMs = Math.max(0, opts.spacingMs);
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let cursor = 0;
  let nextAllowedAt = now();
  let gate: Promise<void> = Promise.resolve();

  function reserveStart(): Promise<void> {
    const ticket = gate.then(async () => {
      const wait = Math.max(0, nextAllowedAt - now());
      if (wait > 0) await sleep(wait);
      nextAllowedAt = now() + spacingMs;
    });
    gate = ticket.then(() => undefined, () => undefined);
    return ticket;
  }

  async function loop(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await reserveStart();
      await worker(items[index]);
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => loop()));
}

export type PriceCaptureSummary = {
  candidates: number;
  cacheHits: number;
  fetched: number;
  noPrice: number;
  failed: number;
  captured: number;
  day: string;
  skipped: boolean;
  firstError: string;
};

export type PriceCapturePorts = {
  isConfigured: () => boolean;
  countRecentAnswers: () => Promise<number>;
  loadPlayedCandidates: (limit: number) => Promise<PriceCaptureCandidate[]>;
  loadFallbackCandidates: (limit: number) => Promise<PriceCaptureCandidate[]>;
  loadCacheRows: (cardIds: string[]) => Promise<CacheLookupRow[]>;
  fetchDetails: (cardhedgeCardId: string) => Promise<unknown>;
  upsertCache: (cardhedgeCardId: string, payload: unknown) => Promise<void>;
  insertPrice: (values: PriceCaptureInsert) => Promise<boolean>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxFetch?: number;
  log?: (line: string) => void;
  error?: (line: string) => void;
};

export function formatPriceCaptureSummary(summary: PriceCaptureSummary): string {
  return `[PriceCapture] candidates=${summary.candidates} cacheHits=${summary.cacheHits} fetched=${summary.fetched} noPrice=${summary.noPrice} failed=${summary.failed} captured=${summary.captured} for ${summary.day}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function emptySummary(day: string, skipped: boolean): PriceCaptureSummary {
  return {
    candidates: 0,
    cacheHits: 0,
    fetched: 0,
    noPrice: 0,
    failed: 0,
    captured: 0,
    day,
    skipped,
    firstError: "",
  };
}

export async function runPriceCapture(ports: PriceCapturePorts): Promise<PriceCaptureSummary> {
  const log = ports.log ?? ((line: string) => console.log(line));
  const error = ports.error ?? ((line: string) => console.error(line));
  const clock = (ports.now ?? (() => new Date()))();
  const day = clock.toISOString().slice(0, 10);
  const maxFetch = ports.maxFetch ?? readPriceCaptureMaxFetch(process.env.PRICE_CAPTURE_MAX_FETCH);

  if (!ports.isConfigured()) {
    log("[PriceCapture] skipped: CardHedge is not configured");
    return emptySummary(day, true);
  }

  const summary = emptySummary(day, false);
  let firstError = "";

  const noteFailure = (err: unknown) => {
    summary.failed++;
    if (!firstError) firstError = errorMessage(err);
  };

  const recentAnswers = await ports.countRecentAnswers();
  const source = chooseCandidateSource(recentAnswers);
  const loaded = source === "played"
    ? await ports.loadPlayedCandidates(maxFetch)
    : await ports.loadFallbackCandidates(maxFetch);
  const pool = actionableCandidates(loaded);
  const attempted = pool.slice(0, maxFetch);
  summary.candidates = pool.length;

  const cache = freshCacheByCardId(
    attempted.length === 0
      ? []
      : await ports.loadCacheRows(attempted.map((row) => row.cardhedge_card_id || "").filter(Boolean)),
    clock,
  );

  const record = async (
    candidate: PriceCaptureCandidate,
    payload: PriceCaptureSourceRow["payload"],
    via: "cache" | "fetch",
    fail: (err: unknown) => void,
  ) => {
    if (via === "cache") summary.cacheHits++;
    else summary.fetched++;
    const mapped = mapPriceCaptureRow({ ...candidate, payload }, day);
    if (!mapped) {
      summary.noPrice++;
      return;
    }
    try {
      const inserted = await ports.insertPrice(mapped);
      if (inserted) summary.captured++;
    } catch (err) {
      fail(err);
    }
  };

  const misses: PriceCaptureCandidate[] = [];
  for (const candidate of attempted) {
    const id = candidate.cardhedge_card_id || "";
    if (cache.has(id)) {
      await record(candidate, cache.get(id) ?? null, "cache", noteFailure);
    } else {
      misses.push(candidate);
    }
  }

  await runThrottled(misses, async (candidate) => {
    const id = candidate.cardhedge_card_id || "";
    let details: unknown = null;
    let rowFailed = false;
    const fail = (err: unknown) => {
      if (rowFailed) return;
      rowFailed = true;
      noteFailure(err);
    };
    try {
      details = await ports.fetchDetails(id);
    } catch (err) {
      fail(err);
      return;
    }
    if (details) {
      try {
        await ports.upsertCache(id, details);
      } catch (err) {
        fail(err);
      }
    }
    await record(candidate, asPricePayload(details), "fetch", fail);
  }, {
    concurrency: PRICE_CAPTURE_FETCH_CONCURRENCY,
    spacingMs: PRICE_CAPTURE_FETCH_SPACING_MS,
    sleep: ports.sleep,
  });

  summary.firstError = firstError;
  if (summary.failed > 0) {
    error(`[PriceCapture] ${summary.failed} rows failed: ${firstError}`);
  }
  log(formatPriceCaptureSummary(summary));
  return summary;
}
