/**
 * Signup attribution: first-touch marketing fields written once per new user.
 *
 * Values come from the browser (register body, or a short-lived signed cookie
 * set before OAuth). They are untrusted and used only for analytics: every
 * field is sanitized and length-capped here, and nothing reads them for auth,
 * rewards eligibility beyond the existing referral SIGNUP rules, or redirects.
 *
 * Writes are insert-only (ON CONFLICT DO NOTHING) and only called for users
 * created in the same request, so existing users' rows are never changed.
 */
import crypto from "crypto";
import type { Request, Response } from "express";

export type SignupAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  refCode: string | null;
  landingPage: string | null;
  referrerHost: string | null;
};

export const ATTRIBUTION_COOKIE = "pp_attr";
/** Cookie is only needed for the OAuth round trip. */
export const ATTRIBUTION_COOKIE_MAX_AGE_MS = 30 * 60 * 1000;
/** Hard cap on the raw cookie value we will set or parse. */
export const ATTRIBUTION_COOKIE_MAX_BYTES = 1200;
/** Sent to the OAuth callback and Apple handler only. */
export const ATTRIBUTION_COOKIE_PATH = "/api/auth";

const UTM_MAX = 100;
const LANDING_MAX = 200;
const HOST_MAX = 100;
const REF_RE = /^[A-Za-z0-9_-]{1,20}$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/;
const OWN_HOSTS = new Set(["packpts.com", "www.packpts.com"]);

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string") return v;
  }
  return null;
}

/** Printable text only, no control chars or angle brackets, trimmed and capped. */
export function sanitizeUtmValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>"'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, UTM_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeRefCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return REF_RE.test(v) ? v : null;
}

/** Same-site path only: no scheme, no host, no query or hash. */
export function sanitizeLandingPage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  const cut = v.search(/[?#]/);
  if (cut >= 0) v = v.slice(0, cut);
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  if (!/^[A-Za-z0-9/_\-.~%]+$/.test(v)) return null;
  v = v.slice(0, LANDING_MAX);
  return v.length > 0 ? v : null;
}

/** Hostname only (accepts a URL and keeps its host). Our own hosts are dropped. */
export function sanitizeReferrerHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("/") || v.includes(":")) {
    try {
      v = new URL(v.includes("://") ? v : `https://${v}`).hostname;
    } catch {
      return null;
    }
  }
  v = v.replace(/\.$/, "");
  if (v.length > HOST_MAX || !HOST_RE.test(v)) return null;
  if (OWN_HOSTS.has(v) || v.endsWith(".packpts.com") || v === "localhost") return null;
  return v.replace(/^www\./, "");
}

export function hasAnyAttribution(a: SignupAttribution | null | undefined): a is SignupAttribution {
  if (!a) return false;
  return Object.values(a).some((v) => v !== null);
}

/**
 * Accepts camelCase (register body / stash body) and snake_case keys.
 * Returns null when nothing usable is present.
 */
export function sanitizeAttribution(input: unknown): SignupAttribution | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const out: SignupAttribution = {
    utmSource: sanitizeUtmValue(firstString(o.utmSource, o.utm_source)),
    utmMedium: sanitizeUtmValue(firstString(o.utmMedium, o.utm_medium)),
    utmCampaign: sanitizeUtmValue(firstString(o.utmCampaign, o.utm_campaign)),
    utmTerm: sanitizeUtmValue(firstString(o.utmTerm, o.utm_term)),
    utmContent: sanitizeUtmValue(firstString(o.utmContent, o.utm_content)),
    refCode: sanitizeRefCode(firstString(o.referredByCode, o.refCode, o.ref, o.referralSource)),
    landingPage: sanitizeLandingPage(firstString(o.landingPage, o.landing_page, o.landingPath, o.landing_path)),
    referrerHost: sanitizeReferrerHost(firstString(o.referrerHost, o.referrer_host)),
  };
  return hasAnyAttribution(out) ? out : null;
}

/** Field-by-field: primary wins, fallback fills gaps. */
export function mergeAttribution(
  primary: SignupAttribution | null,
  fallback: SignupAttribution | null,
): SignupAttribution | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const out = { ...primary };
  for (const key of Object.keys(out) as (keyof SignupAttribution)[]) {
    if (out[key] === null) out[key] = fallback[key];
  }
  return out;
}

// ── Signed cookie ────────────────────────────────────────────────────────────

function cookieSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length > 0 ? s : null;
}

function sign(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", `pp_attr:${secret}`)
    .update(payload)
    .digest("base64url")
    .slice(0, 32);
}

const COMPACT_KEYS: Record<keyof SignupAttribution, string> = {
  utmSource: "s",
  utmMedium: "m",
  utmCampaign: "c",
  utmTerm: "t",
  utmContent: "n",
  refCode: "r",
  landingPage: "l",
  referrerHost: "h",
};

export function encodeAttributionCookie(a: SignupAttribution, now = Date.now()): string | null {
  const secret = cookieSecret();
  if (!secret) return null;
  const compact: Record<string, string | number> = { i: Math.floor(now / 1000) };
  for (const [key, short] of Object.entries(COMPACT_KEYS)) {
    const v = a[key as keyof SignupAttribution];
    if (v !== null) compact[short] = v;
  }
  const payload = Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
  const value = `${payload}.${sign(payload, secret)}`;
  return value.length <= ATTRIBUTION_COOKIE_MAX_BYTES ? value : null;
}

export function decodeAttributionCookie(value: string | null | undefined, now = Date.now()): SignupAttribution | null {
  const secret = cookieSecret();
  if (!secret || !value || value.length > ATTRIBUTION_COOKIE_MAX_BYTES) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const issued = typeof p.i === "number" ? p.i * 1000 : NaN;
  if (!Number.isFinite(issued) || issued > now + 60_000 || now - issued > ATTRIBUTION_COOKIE_MAX_AGE_MS) return null;
  const expanded: Record<string, unknown> = {};
  for (const [key, short] of Object.entries(COMPACT_KEYS)) expanded[key] = p[short];
  expanded.refCode = p.r;
  return sanitizeAttribution(expanded);
}

export function readCookie(req: Pick<Request, "headers">, name: string): string | null {
  const header = req.headers?.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length > ATTRIBUTION_COOKIE_MAX_BYTES) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: ATTRIBUTION_COOKIE_PATH,
  };
}

export function setAttributionCookie(res: Response, a: SignupAttribution): boolean {
  const value = encodeAttributionCookie(a);
  if (!value) return false;
  res.cookie(ATTRIBUTION_COOKIE, value, { ...cookieOptions(), maxAge: ATTRIBUTION_COOKIE_MAX_AGE_MS });
  return true;
}

export function clearAttributionCookie(res: Response): void {
  res.clearCookie(ATTRIBUTION_COOKIE, cookieOptions());
}

export function readAttributionCookie(req: Pick<Request, "headers">): SignupAttribution | null {
  return decodeAttributionCookie(readCookie(req, ATTRIBUTION_COOKIE));
}

// ── Persistence ──────────────────────────────────────────────────────────────

export type ReferralLinkLite = {
  id: string;
  createdByUserId: string | null;
  expiresAt: Date | string | null;
};

export type AttributionStore = {
  insertUserAttribution(userId: string, a: SignupAttribution): Promise<void>;
  findActiveReferralLink(code: string): Promise<ReferralLinkLite | null>;
  insertReferralSignup(linkId: string, userId: string): Promise<void>;
  grantReferralWelcomeBonus(userId: string, linkId: string): Promise<void>;
};

async function defaultStore(): Promise<AttributionStore> {
  const [{ db, pool }, schema, orm] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
    import("drizzle-orm"),
  ]);
  return {
    async insertUserAttribution(userId, a) {
      await pool.query(
        `INSERT INTO user_attribution (user_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, landing_page)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, a.utmSource, a.utmMedium, a.utmCampaign, a.utmTerm, a.utmContent, a.referrerHost, a.landingPage],
      );
    },
    async findActiveReferralLink(code) {
      const [link] = await db
        .select({
          id: schema.referralLinks.id,
          createdByUserId: schema.referralLinks.createdByUserId,
          expiresAt: schema.referralLinks.expiresAt,
        })
        .from(schema.referralLinks)
        .where(orm.and(orm.eq(schema.referralLinks.code, code), orm.eq(schema.referralLinks.isActive, true)))
        .limit(1);
      return link ?? null;
    },
    async insertReferralSignup(linkId, userId) {
      await db
        .insert(schema.referralAttributions)
        .values({ referralLinkId: linkId, invitedUserId: userId, eventType: "SIGNUP" })
        .onConflictDoNothing();
    },
    async grantReferralWelcomeBonus(userId, linkId) {
      const { grantReferralWelcomeBonus } = await import("../services/referralRewards");
      await grantReferralWelcomeBonus(userId, linkId);
    },
  };
}

let storeOverride: AttributionStore | null = null;
export function setAttributionStoreForTests(store: AttributionStore | null): void {
  storeOverride = store;
}

export type ApplyResult = { attributionWritten: boolean; referralSignup: boolean };

/**
 * Call only for a user created in this request. Never throws: attribution
 * must not fail a signup.
 */
export async function applySignupAttribution(
  userId: string,
  attribution: SignupAttribution | null,
  logTag = "Attribution",
): Promise<ApplyResult> {
  const result: ApplyResult = { attributionWritten: false, referralSignup: false };
  if (!userId || !hasAnyAttribution(attribution)) return result;
  let store: AttributionStore;
  try {
    store = storeOverride ?? (await defaultStore());
  } catch (err) {
    console.error(`[${logTag}] attribution store unavailable (non-fatal):`, (err as Error)?.message);
    return result;
  }
  try {
    await store.insertUserAttribution(userId, attribution);
    result.attributionWritten = true;
  } catch (err) {
    console.error(`[${logTag}] user_attribution insert failed (non-fatal):`, (err as Error)?.message);
  }
  if (attribution.refCode) {
    try {
      const link = await store.findActiveReferralLink(attribution.refCode);
      const expired = link?.expiresAt ? new Date(link.expiresAt).getTime() < Date.now() : false;
      if (link && !expired && link.createdByUserId !== userId) {
        await store.insertReferralSignup(link.id, userId);
        result.referralSignup = true;
        await store.grantReferralWelcomeBonus(userId, link.id);
      }
    } catch (err) {
      console.error(`[${logTag}] referral SIGNUP attribution failed (non-fatal):`, (err as Error)?.message);
    }
  }
  return result;
}

/** Origin must match the request host when the browser sends one. */
export function isSameOriginRequest(req: Pick<Request, "headers" | "get">): boolean {
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || origin.length === 0) return true;
  const host = req.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * For a user created in this request: body fields first, then the OAuth stash
 * cookie; always clears the cookie. Used by POST /api/auth/register.
 */
export async function attributeNewUserFromRequest(
  req: Pick<Request, "headers">,
  res: Response,
  userId: string,
  bodyInput: unknown,
  logTag: string,
): Promise<ApplyResult> {
  const attribution = mergeAttribution(sanitizeAttribution(bodyInput), readAttributionCookie(req));
  clearAttributionCookie(res);
  return applySignupAttribution(userId, attribution, logTag);
}
