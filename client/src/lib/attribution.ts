/**
 * First-touch signup attribution (analytics only).
 *
 * On landing we store utm_*, the /r/:code ref param, the landing path (no
 * query), and the external referrer host in localStorage for 30 days. The
 * first tagged touch wins and is never overwritten. A record with no campaign
 * signal (no utm and no ref) may be replaced once by a later tagged touch, so
 * an earlier plain visit does not hide the creator link that brought someone
 * back. sessionStorage keeps the legacy packpts_utm key for compatibility and
 * a copy of the record in case localStorage is unavailable.
 *
 * Every register path sends getSignupAttributionPayload(). OAuth starts call
 * stashAttributionForOAuth() first so the server can keep it in a short-lived
 * httpOnly cookie across the redirect.
 */

export const ATTRIBUTION_STORAGE_KEY = "packpts_attr_v1";
export const LEGACY_UTM_SESSION_KEY = "packpts_utm";
export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
type UtmKey = (typeof UTM_KEYS)[number];

const VALUE_MAX = 100;
const PATH_MAX = 200;
const HOST_MAX = 100;
const REF_RE = /^[A-Za-z0-9_-]{1,20}$/;
const OWN_HOST_RE = /(^|\.)packpts\.com$/i;

export type FirstTouchRecord = {
  v: 1;
  ts: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  landing_path?: string;
  referrer_host?: string;
};

export type SignupAttributionPayload = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referredByCode?: string;
  landingPage?: string;
  referrerHost?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AttributionEnv = {
  search: string;
  pathname: string;
  referrer: string;
  host: string;
  local: StorageLike | null;
  session: StorageLike | null;
  now: number;
};

function safeStorage(get: () => Storage): StorageLike | null {
  try {
    const s = get();
    return s ?? null;
  } catch {
    return null;
  }
}

export function browserAttributionEnv(): AttributionEnv | null {
  if (typeof window === "undefined") return null;
  return {
    search: window.location.search,
    pathname: window.location.pathname,
    referrer: typeof document !== "undefined" ? document.referrer : "",
    host: window.location.host,
    local: safeStorage(() => window.localStorage),
    session: safeStorage(() => window.sessionStorage),
    now: Date.now(),
  };
}

function cleanValue(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.replace(/[\u0000-\u001f\u007f<>"'`\\]/g, "").trim().slice(0, VALUE_MAX).trim();
  return v.length > 0 ? v : undefined;
}

function cleanPath(raw: string): string | undefined {
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  const v = raw.slice(0, PATH_MAX);
  return /^[A-Za-z0-9/_\-.~%]+$/.test(v) ? v : undefined;
}

function referrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host || host.length > HOST_MAX) return undefined;
    if (host === ownHost.split(":")[0].toLowerCase() || OWN_HOST_RE.test(host)) return undefined;
    return host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function hasCampaignSignal(r: FirstTouchRecord): boolean {
  return UTM_KEYS.some((k) => !!r[k]) || !!r.ref;
}

function parseRecord(raw: string | null, now: number): FirstTouchRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as FirstTouchRecord;
    if (!r || r.v !== 1 || typeof r.ts !== "number") return null;
    if (now - r.ts > ATTRIBUTION_TTL_MS || r.ts > now + 60_000) return null;
    return r;
  } catch {
    return null;
  }
}

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readFirstTouch(env: AttributionEnv | null = browserAttributionEnv()): FirstTouchRecord | null {
  if (!env) return null;
  const local = read(env.local, ATTRIBUTION_STORAGE_KEY);
  const fromLocal = parseRecord(local, env.now);
  if (fromLocal) return fromLocal;
  if (local) remove(env.local, ATTRIBUTION_STORAGE_KEY);
  return parseRecord(read(env.session, ATTRIBUTION_STORAGE_KEY), env.now);
}

/** Build the touch for this page load (not yet stored). */
export function touchFromEnv(env: AttributionEnv): FirstTouchRecord {
  const params = new URLSearchParams(env.search);
  const r: FirstTouchRecord = { v: 1, ts: env.now };
  for (const key of UTM_KEYS) {
    const v = cleanValue(params.get(key));
    if (v) r[key as UtmKey] = v;
  }
  const ref = (params.get("ref") ?? "").trim();
  if (REF_RE.test(ref)) r.ref = ref;
  const path = cleanPath(env.pathname);
  if (path) r.landing_path = path;
  const host = referrerHost(env.referrer, env.host);
  if (host) r.referrer_host = host;
  return r;
}

/**
 * Store first-touch attribution. Returns the record now in effect.
 * Also keeps the legacy sessionStorage packpts_utm key (current session UTMs).
 */
export function captureFirstTouch(env: AttributionEnv | null = browserAttributionEnv()): FirstTouchRecord | null {
  if (!env) return null;
  const touch = touchFromEnv(env);

  const legacy: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    if (touch[key]) legacy[key] = touch[key]!;
  }
  if (Object.keys(legacy).length > 0) write(env.session, LEGACY_UTM_SESSION_KEY, JSON.stringify(legacy));

  const existing = readFirstTouch(env);
  if (existing && (hasCampaignSignal(existing) || !hasCampaignSignal(touch))) {
    return existing;
  }
  const serialized = JSON.stringify(touch);
  write(env.local, ATTRIBUTION_STORAGE_KEY, serialized);
  write(env.session, ATTRIBUTION_STORAGE_KEY, serialized);
  return touch;
}

function legacySessionUtm(env: AttributionEnv): Partial<Record<UtmKey, string>> {
  try {
    const raw = read(env.session, LEGACY_UTM_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<UtmKey, string>> = {};
    for (const key of UTM_KEYS) {
      const v = typeof parsed[key] === "string" ? cleanValue(parsed[key] as string) : undefined;
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Body fields for POST /api/auth/register (and the OAuth stash). */
export function getSignupAttributionPayload(
  env: AttributionEnv | null = browserAttributionEnv(),
): SignupAttributionPayload {
  if (!env) return {};
  const record = readFirstTouch(env);
  // First touch wins as a whole; legacy session UTMs only when no record.
  const utm = record && hasCampaignSignal(record) ? record : { ...legacySessionUtm(env), ...(record ?? {}) };
  const out: SignupAttributionPayload = {};
  if (utm.utm_source) out.utmSource = utm.utm_source;
  if (utm.utm_medium) out.utmMedium = utm.utm_medium;
  if (utm.utm_campaign) out.utmCampaign = utm.utm_campaign;
  if (utm.utm_term) out.utmTerm = utm.utm_term;
  if (utm.utm_content) out.utmContent = utm.utm_content;
  if (record?.ref) out.referredByCode = record.ref;
  if (record?.landing_path) out.landingPage = record.landing_path;
  if (record?.referrer_host) out.referrerHost = record.referrer_host;
  return out;
}

/**
 * Before an OAuth redirect: hand the stored attribution to the server so it
 * survives the round trip. Best effort, capped at ~1.5s, never throws.
 */
export async function stashAttributionForOAuth(
  fetchImpl: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined,
  env: AttributionEnv | null = browserAttributionEnv(),
): Promise<void> {
  const payload = getSignupAttributionPayload(env);
  if (!fetchImpl || Object.keys(payload).length === 0) return;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 1500) : null;
  try {
    await fetchImpl("/api/auth/attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
  } catch {
    /* best effort */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Stash attribution, then navigate to the WorkOS start route. */
export async function startWorkosAuth(path = "/api/auth/workos/start"): Promise<void> {
  await stashAttributionForOAuth();
  window.location.href = path;
}
