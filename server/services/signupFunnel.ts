/**
 * Signup-growth funnel names and the pure report fold.
 *
 * Client may post signup_view, signup_started, signup_error, and share_view.
 * signup_complete and first_daily5_complete_registered are written only by the
 * server (register, new WorkOS user, new Apple user, first registered Daily 5).
 *
 * Column map on funnel_events (no new columns):
 *   mode = variant | method | reason | audience
 *   path = surface, then a space and the invite ref on signup_complete
 *   utm_* = first-touch attribution when the caller has it
 */
export const FUNNEL_EVENT_TYPE_MAX = 40;

export const SIGNUP_FUNNEL_EVENTS = [
  "signup_view",
  "signup_started",
  "signup_error",
  "signup_complete",
  "first_daily5_complete_registered",
  "share_view",
] as const;

export type SignupFunnelEvent = (typeof SIGNUP_FUNNEL_EVENTS)[number];

/** Events a browser is allowed to record. Completes stay server-side. */
export const CLIENT_SIGNUP_FUNNEL_EVENTS = [
  "signup_view",
  "signup_started",
  "signup_error",
  "share_view",
] as const;

export type ClientSignupFunnelEvent = (typeof CLIENT_SIGNUP_FUNNEL_EVENTS)[number];

export const SIGNUP_METHODS = ["email", "workos", "google", "apple"] as const;
export type SignupMethod = (typeof SIGNUP_METHODS)[number];

const TOKEN_RE = /^[a-z0-9_]{1,20}$/;
const METHOD_SET = new Set<string>(SIGNUP_METHODS);

function utmSourceToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "").slice(0, 100);
  return v.length > 0 ? v : null;
}

const REASON_ALIAS: Record<string, string> = {
  workos_not_configured: "workos_unconfigured",
};

/** Lowercase token that fits funnel_events.mode (varchar 20). */
export function funnelToken(raw: unknown, max = 20): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  const mapped = REASON_ALIAS[cleaned] ?? cleaned;
  const v = mapped.slice(0, max);
  return TOKEN_RE.test(v) ? v : null;
}

export function signupSurfaceToken(raw: unknown): string | null {
  return funnelToken(raw);
}

/** path = surface, or "surface ref" when a signup carried an invite code. */
export function signupFunnelPath(surface: string | null | undefined, ref?: string | null): string | null {
  const s = funnelToken(surface);
  if (!s) return null;
  const code = typeof ref === "string" && /^[A-Za-z0-9_-]{1,20}$/.test(ref.trim()) ? ref.trim() : "";
  return code ? `${s} ${code}` : s;
}

export interface ParsedClientFunnelEvent {
  eventType: ClientSignupFunnelEvent;
  mode: string | null;
  path: string | null;
  utmSource: string | null;
}

/**
 * Accept a browser payload. Returns null when the event or its required
 * dimension is missing or not on the allowlist. Never throws.
 */
export function parseClientFunnelEvent(body: unknown): ParsedClientFunnelEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const event = typeof o.event === "string" ? o.event : "";
  if (!(CLIENT_SIGNUP_FUNNEL_EVENTS as readonly string[]).includes(event)) return null;
  const surface = funnelToken(o.surface);
  const utmSource = utmSourceToken(o.utmSource);

  if (event === "signup_view") {
    const variant = funnelToken(o.variant) ?? "page";
    if (!surface) return null;
    return { eventType: "signup_view", mode: variant, path: surface, utmSource };
  }
  if (event === "signup_started") {
    const method = funnelToken(o.method);
    if (!method || !METHOD_SET.has(method) || !surface) return null;
    return { eventType: "signup_started", mode: method, path: surface, utmSource };
  }
  if (event === "signup_error") {
    const reason = funnelToken(o.reason);
    if (!reason || !surface) return null;
    return { eventType: "signup_error", mode: reason, path: surface, utmSource };
  }
  if (!surface) return null;
  const audience = funnelToken(o.audience);
  return {
    eventType: "share_view",
    mode: audience === "guest" ? "guest" : "registered",
    path: surface,
    utmSource,
  };
}

export interface SignupFunnelSection {
  views: number;
  started: number;
  errors: number;
  completes: number;
  firstDaily5Registered: number;
  shareViews: number;
  viewsBySurface: { surface: string; count: number }[];
  startedByMethod: { method: string; count: number }[];
  errorsByReason: { reason: string; count: number }[];
  completesByMethod: { method: string; count: number }[];
  shareViewsBySurface: { surface: string; audience: string; count: number }[];
  daily: {
    date: string;
    visits: number;
    firstAnswers: number;
    gameCompletes: number;
    signupViews: number;
    signupStarted: number;
    registered: number;
    signupCompletes: number;
    firstDaily5Registered: number;
  }[];
  byUtmSource: {
    source: string;
    visits: number;
    firstAnswers: number;
    gameCompletes: number;
    signupViews: number;
    signupStarted: number;
    completes: number;
    registered: number;
    firstDaily5Registered: number;
  }[];
}

export interface SignupEventGroupRow {
  event_type: string;
  mode: string;
  surface: string;
  source: string;
  n: number;
}

export interface SignupDailyEventRow {
  date: string;
  visits: number;
  first_answers: number;
  game_completes: number;
  signup_views: number;
  signup_started: number;
  signup_completes: number;
  first_daily5: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function bump(map: Map<string, number>, key: string, add: number): void {
  const k = key || "unknown";
  map.set(k, (map.get(k) ?? 0) + add);
}

function pairs(map: Map<string, number>, label: string): { [k: string]: string | number }[] {
  return [...map.entries()]
    .map(([key, count]) => ({ [label]: key, count }))
    .sort((a, b) => (b.count as number) - (a.count as number) || String(a[label]).localeCompare(String(b[label])));
}

interface DayBucket {
  date: string;
  visits: number;
  firstAnswers: number;
  gameCompletes: number;
  signupViews: number;
  signupStarted: number;
  registered: number;
  signupCompletes: number;
  firstDaily5Registered: number;
}

function day(map: Map<string, DayBucket>, date: string): DayBucket {
  let row = map.get(date);
  if (!row) {
    row = {
      date,
      visits: 0,
      firstAnswers: 0,
      gameCompletes: 0,
      signupViews: 0,
      signupStarted: 0,
      registered: 0,
      signupCompletes: 0,
      firstDaily5Registered: 0,
    };
    map.set(date, row);
  }
  return row;
}

interface SourceBucket {
  source: string;
  visits: number;
  firstAnswers: number;
  gameCompletes: number;
  signupViews: number;
  signupStarted: number;
  completes: number;
  registered: number;
  firstDaily5Registered: number;
}

function source(map: Map<string, SourceBucket>, name: string): SourceBucket {
  const key = name || "direct";
  let row = map.get(key);
  if (!row) {
    row = {
      source: key,
      visits: 0,
      firstAnswers: 0,
      gameCompletes: 0,
      signupViews: 0,
      signupStarted: 0,
      completes: 0,
      registered: 0,
      firstDaily5Registered: 0,
    };
    map.set(key, row);
  }
  return row;
}

export function buildSignupFunnelSection(input: {
  events: SignupEventGroupRow[];
  dailyEvents: SignupDailyEventRow[];
  registeredDaily: { date: string; n: number }[];
  registeredBySource: { source: string; n: number }[];
}): SignupFunnelSection {
  const viewsBySurface = new Map<string, number>();
  const startedByMethod = new Map<string, number>();
  const errorsByReason = new Map<string, number>();
  const completesByMethod = new Map<string, number>();
  const shareKey = new Map<string, { surface: string; audience: string; count: number }>();
  const sources = new Map<string, SourceBucket>();
  let views = 0;
  let started = 0;
  let errors = 0;
  let completes = 0;
  let firstDaily5Registered = 0;
  let shareViews = 0;

  for (const row of input.events) {
    const count = n(row.n);
    const src = source(sources, row.source || "direct");
    if (row.event_type === "visit") {
      src.visits += count;
    } else if (row.event_type === "first_answer") {
      src.firstAnswers += count;
    } else if (row.event_type === "game_complete") {
      src.gameCompletes += count;
    } else if (row.event_type === "signup_view") {
      views += count;
      bump(viewsBySurface, row.surface, count);
      src.signupViews += count;
    } else if (row.event_type === "signup_started") {
      started += count;
      bump(startedByMethod, row.mode, count);
      src.signupStarted += count;
    } else if (row.event_type === "signup_error") {
      errors += count;
      bump(errorsByReason, row.mode, count);
    } else if (row.event_type === "signup_complete") {
      completes += count;
      bump(completesByMethod, row.mode, count);
      src.completes += count;
    } else if (row.event_type === "first_daily5_complete_registered") {
      firstDaily5Registered += count;
      src.firstDaily5Registered += count;
    } else if (row.event_type === "share_view") {
      shareViews += count;
      const audience = row.mode === "guest" ? "guest" : "registered";
      const key = `${row.surface || "unknown"}:${audience}`;
      const cur = shareKey.get(key) ?? { surface: row.surface || "unknown", audience, count: 0 };
      cur.count += count;
      shareKey.set(key, cur);
    }
  }

  const days = new Map<string, DayBucket>();
  for (const row of input.dailyEvents) {
    if (!row.date) continue;
    const d = day(days, row.date);
    d.visits += n(row.visits);
    d.firstAnswers += n(row.first_answers);
    d.gameCompletes += n(row.game_completes);
    d.signupViews += n(row.signup_views);
    d.signupStarted += n(row.signup_started);
    d.signupCompletes += n(row.signup_completes);
    d.firstDaily5Registered += n(row.first_daily5);
  }
  for (const row of input.registeredDaily) {
    if (!row.date) continue;
    day(days, row.date).registered += n(row.n);
  }
  for (const row of input.registeredBySource) {
    source(sources, row.source || "direct").registered += n(row.n);
  }

  const byUtmSource = [...sources.values()]
    .filter((s) => s.visits + s.firstAnswers + s.gameCompletes + s.signupViews + s.signupStarted + s.completes + s.registered + s.firstDaily5Registered > 0)
    .sort((a, b) => (b.visits + b.registered) - (a.visits + a.registered) || a.source.localeCompare(b.source))
    .slice(0, 25);

  return {
    views,
    started,
    errors,
    completes,
    firstDaily5Registered,
    shareViews,
    viewsBySurface: pairs(viewsBySurface, "surface") as { surface: string; count: number }[],
    startedByMethod: pairs(startedByMethod, "method") as { method: string; count: number }[],
    errorsByReason: pairs(errorsByReason, "reason") as { reason: string; count: number }[],
    completesByMethod: pairs(completesByMethod, "method") as { method: string; count: number }[],
    shareViewsBySurface: [...shareKey.values()].sort((a, b) => b.count - a.count || a.surface.localeCompare(b.surface)),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byUtmSource,
  };
}
