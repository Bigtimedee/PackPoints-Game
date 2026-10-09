/**
 * Signup attribution: sanitization, the signed OAuth stash cookie, and each
 * signup path (register helper, retired-provider shared stash, Sign in with Apple) writing
 * user_attribution for new users only. No live database: the attribution store
 * and auth dependencies are mocked.
 */
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { readFile } from "fs/promises";
import path from "path";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── module mocks (hoisted) ───────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  authenticateWithCode: vi.fn(),
  findIdentity: vi.fn(),
  findUsersByEmail: vi.fn(),
  createIdentity: vi.fn(),
  logAudit: vi.fn(),
  getUser: vi.fn(),
  getUserByUsername: vi.fn(),
  createWorkosUser: vi.fn(),
  jwtVerify: vi.fn(),
  appleSelect: vi.fn(),
  userInsert: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: mocks.getUser,
    getUserByUsername: mocks.getUserByUsername,
    createWorkosUser: mocks.createWorkosUser,
  },
}));

vi.mock("../services/identityService", () => ({
  identityService: {
    findIdentity: mocks.findIdentity,
    findUsersByEmail: mocks.findUsersByEmail,
    createIdentity: mocks.createIdentity,
    logAudit: mocks.logAudit,
    createPendingLinkChallenge: vi.fn(async () => ({ id: "challenge-1" })),
    maskEmail: (e: string) => e,
  },
}));

vi.mock("../services/anonIdentity", () => ({
  claimAnonForUser: vi.fn(async () => ({ credited: 0 })),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: mocks.jwtVerify,
}));

vi.mock("../services/jwtService", () => ({
  issueAccessToken: vi.fn(async () => "access"),
  issueRefreshToken: vi.fn(async () => "refresh"),
  rotateRefreshToken: vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
  jwtMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/rateLimiter", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../db", () => {
  const chain = (result: () => unknown) => {
    const c: any = {};
    for (const m of ["from", "where", "limit", "values", "set", "onConflictDoUpdate", "onConflictDoNothing"]) {
      c[m] = () => c;
    }
    c.returning = async () => result();
    c.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(result()).then(resolve, reject);
    return c;
  };
  return {
    pool: { query: vi.fn() },
    db: {
      select: () => chain(() => mocks.appleSelect()),
      insert: () => chain(() => mocks.userInsert()),
      update: () => chain(() => []),
    },
  };
});

import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_MS,
  ATTRIBUTION_COOKIE_MAX_BYTES,
  applySignupAttribution,
  attributeNewUserFromRequest,
  decodeAttributionCookie,
  encodeAttributionCookie,
  sanitizeAttribution,
  sanitizeLandingPage,
  sanitizeRefCode,
  sanitizeReferrerHost,
  sanitizeUtmValue,
  setAttributionStoreForTests,
  type AttributionStore,
  type ReferralLinkLite,
  type SignupAttribution,
} from "../lib/signupAttribution";
import { registerRetiredProviderRoutes } from "../auth/retiredProvider";
import { registerIosRoutes } from "../routes/ios.routes";
import referralsRouter from "../routes/referrals";
import { signupSourceBucket, type SignupSourceRow } from "../services/signupSources";

// ── fake attribution store ───────────────────────────────────────────────────
type Written = { userId: string; a: SignupAttribution };
let written: Written[] = [];
let referralSignups: Array<{ linkId: string; userId: string }> = [];
let bonuses: Array<{ userId: string; linkId: string }> = [];
let links: Record<string, ReferralLinkLite> = {};

const fakeStore: AttributionStore = {
  async insertUserAttribution(userId, a) {
    if (written.some((w) => w.userId === userId)) return; // ON CONFLICT DO NOTHING
    written.push({ userId, a });
  },
  async findActiveReferralLink(code) {
    return links[code] ?? null;
  },
  async insertReferralSignup(linkId, userId) {
    referralSignups.push({ linkId, userId });
  },
  async grantReferralWelcomeBonus(userId, linkId) {
    bonuses.push({ userId, linkId });
  },
};

const prevSecret = process.env.SESSION_SECRET;
const prevWorkosKey = process.env.WORKOS_API_KEY;
const prevWorkosClient = process.env.WORKOS_CLIENT_ID;
const prevNodeEnv = process.env.NODE_ENV;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-for-attribution";
  process.env.WORKOS_API_KEY = "workos-test-key";
  process.env.WORKOS_CLIENT_ID = "workos-test-client";
  process.env.NODE_ENV = "test";
});

afterAll(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  restore("SESSION_SECRET", prevSecret);
  restore("WORKOS_API_KEY", prevWorkosKey);
  restore("WORKOS_CLIENT_ID", prevWorkosClient);
  restore("NODE_ENV", prevNodeEnv);
});

beforeEach(() => {
  written = [];
  referralSignups = [];
  bonuses = [];
  links = {};
  setAttributionStoreForTests(fakeStore);
  for (const fn of Object.values(mocks)) fn.mockReset();
});

afterEach(() => {
  setAttributionStoreForTests(null);
});

function attr(partial: Partial<SignupAttribution>): SignupAttribution {
  return {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    refCode: null,
    landingPage: null,
    referrerHost: null,
    ...partial,
  };
}

// ── sanitization ─────────────────────────────────────────────────────────────
describe("sanitization", () => {
  it("strips markup and control chars and caps utm values", () => {
    expect(sanitizeUtmValue("  creator_jane  ")).toBe("creator_jane");
    expect(sanitizeUtmValue("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(sanitizeUtmValue("a\u0000b\nc")).toBe("abc");
    expect(sanitizeUtmValue("x".repeat(500))).toHaveLength(100);
    expect(sanitizeUtmValue("   ")).toBeNull();
    expect(sanitizeUtmValue(42)).toBeNull();
    expect(sanitizeUtmValue(["a"])).toBeNull();
  });

  it("accepts only short code-shaped ref codes", () => {
    expect(sanitizeRefCode("Ab3_x-9Z")).toBe("Ab3_x-9Z");
    expect(sanitizeRefCode("x".repeat(21))).toBeNull();
    expect(sanitizeRefCode("abc'; DROP TABLE users;--")).toBeNull();
    expect(sanitizeRefCode("")).toBeNull();
  });

  it("keeps landing pages as same-site paths without query or hash", () => {
    expect(sanitizeLandingPage("/daily")).toBe("/daily");
    expect(sanitizeLandingPage("/daily?utm_source=x&challenge=secret#h")).toBe("/daily");
    expect(sanitizeLandingPage("https://evil.example/x")).toBeNull();
    expect(sanitizeLandingPage("//evil.example/x")).toBeNull();
    expect(sanitizeLandingPage("/\\evil")).toBeNull();
    expect(sanitizeLandingPage("/<img>")).toBeNull();
    expect(sanitizeLandingPage("/" + "a".repeat(400))).toHaveLength(200);
  });

  it("reduces referrers to an external host", () => {
    expect(sanitizeReferrerHost("https://www.tiktok.com/@someone/video/1?x=y")).toBe("tiktok.com");
    expect(sanitizeReferrerHost("t.co")).toBe("t.co");
    expect(sanitizeReferrerHost("https://packpts.com/auth")).toBeNull();
    expect(sanitizeReferrerHost("www.packpts.com")).toBeNull();
    expect(sanitizeReferrerHost("not a host")).toBeNull();
    expect(sanitizeReferrerHost("a".repeat(120) + ".com")).toBeNull();
  });

  it("ignores unrelated body fields such as email and password", () => {
    const out = sanitizeAttribution({
      username: "someone",
      email: "person@example.com",
      password: "hunter2",
      utmMedium: "dm",
    });
    expect(out).toEqual(attr({ utmMedium: "dm" }));
    expect(JSON.stringify(out)).not.toContain("example.com");
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("returns null when no attribution field is usable", () => {
    expect(sanitizeAttribution({})).toBeNull();
    expect(sanitizeAttribution(null)).toBeNull();
    expect(sanitizeAttribution("utm_source=x")).toBeNull();
    expect(sanitizeAttribution([1, 2])).toBeNull();
    expect(sanitizeAttribution({ referredByCode: "bad code!", landingPage: "https://x.test" })).toBeNull();
  });

  it("accepts snake_case keys and the legacy referralSource field", () => {
    expect(sanitizeAttribution({ utm_source: "creator_jane", referralSource: "abc123" })).toEqual(
      attr({ utmSource: "creator_jane", refCode: "abc123" }),
    );
  });
});

// ── persistence ──────────────────────────────────────────────────────────────
describe("applySignupAttribution", () => {
  it("writes a utm_medium-only touch (beatme / play_sets share links)", async () => {
    const a = sanitizeAttribution({ utmMedium: "beatme" });
    const r = await applySignupAttribution("u-medium", a);
    expect(r.attributionWritten).toBe(true);
    expect(written).toEqual([{ userId: "u-medium", a: attr({ utmMedium: "beatme" }) }]);
  });

  it("writes landing page or referrer host alone", async () => {
    await applySignupAttribution("u-landing", sanitizeAttribution({ landingPage: "/sets" }));
    await applySignupAttribution("u-ref", sanitizeAttribution({ referrerHost: "reddit.com" }));
    expect(written.map((w) => w.userId)).toEqual(["u-landing", "u-ref"]);
    expect(written[0].a.landingPage).toBe("/sets");
    expect(written[1].a.referrerHost).toBe("reddit.com");
  });

  it("does nothing without attribution", async () => {
    const r = await applySignupAttribution("u-none", null);
    expect(r).toEqual({ attributionWritten: false, referralSignup: false });
    expect(written).toEqual([]);
  });

  it("hooks a valid ref code into referral SIGNUP and the welcome bonus", async () => {
    links.REF1 = { id: "link-1", createdByUserId: "referrer", expiresAt: null };
    const r = await applySignupAttribution("u-new", sanitizeAttribution({ referredByCode: "REF1" }));
    expect(r.referralSignup).toBe(true);
    expect(referralSignups).toEqual([{ linkId: "link-1", userId: "u-new" }]);
    expect(bonuses).toEqual([{ userId: "u-new", linkId: "link-1" }]);
    expect(written[0].a.refCode).toBe("REF1");
  });

  it("skips self, expired, and unknown ref codes", async () => {
    links.SELF = { id: "link-self", createdByUserId: "u-self", expiresAt: null };
    links.OLD = { id: "link-old", createdByUserId: "x", expiresAt: new Date(Date.now() - 1000) };
    await applySignupAttribution("u-self", sanitizeAttribution({ ref: "SELF" }));
    await applySignupAttribution("u-2", sanitizeAttribution({ ref: "OLD" }));
    await applySignupAttribution("u-3", sanitizeAttribution({ ref: "NOPE" }));
    expect(referralSignups).toEqual([]);
    expect(bonuses).toEqual([]);
  });

  it("never throws when the store fails", async () => {
    setAttributionStoreForTests({
      ...fakeStore,
      async insertUserAttribution() {
        throw new Error("db down");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(applySignupAttribution("u-x", attr({ utmSource: "x" }))).resolves.toEqual({
      attributionWritten: false,
      referralSignup: false,
    });
    spy.mockRestore();
  });

  it("does not replace a row that already exists for the user", async () => {
    await applySignupAttribution("u-dup", attr({ utmSource: "first" }));
    await applySignupAttribution("u-dup", attr({ utmSource: "second" }));
    expect(written).toEqual([{ userId: "u-dup", a: attr({ utmSource: "first" }) }]);
  });
});

// ── signed cookie ────────────────────────────────────────────────────────────
describe("attribution cookie", () => {
  const sample = attr({ utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch", refCode: "R1", landingPage: "/daily" });

  it("round trips and stays under the size cap", () => {
    const value = encodeAttributionCookie(sample)!;
    expect(value.length).toBeLessThanOrEqual(ATTRIBUTION_COOKIE_MAX_BYTES);
    expect(decodeAttributionCookie(value)).toEqual(sample);
  });

  it("caps a maximal payload", () => {
    const big = attr({
      utmSource: "s".repeat(100),
      utmMedium: "m".repeat(100),
      utmCampaign: "c".repeat(100),
      utmTerm: "t".repeat(100),
      utmContent: "n".repeat(100),
      refCode: "r".repeat(20),
      landingPage: "/" + "l".repeat(199),
      referrerHost: "h".repeat(60) + ".com",
    });
    const value = encodeAttributionCookie(big)!;
    expect(value).not.toBeNull();
    expect(value.length).toBeLessThanOrEqual(ATTRIBUTION_COOKIE_MAX_BYTES);
  });

  it("rejects tampered, expired, oversized, and unsigned values", () => {
    const value = encodeAttributionCookie(sample)!;
    const [payload, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ i: Math.floor(Date.now() / 1000), s: "forged" })).toString("base64url");
    expect(decodeAttributionCookie(`${forged}.${mac}`)).toBeNull();
    expect(decodeAttributionCookie(`${payload}.AAAA`)).toBeNull();
    expect(decodeAttributionCookie(payload)).toBeNull();
    expect(decodeAttributionCookie("x".repeat(ATTRIBUTION_COOKIE_MAX_BYTES + 1))).toBeNull();
    const old = encodeAttributionCookie(sample, Date.now() - ATTRIBUTION_COOKIE_MAX_AGE_MS - 5000)!;
    expect(decodeAttributionCookie(old)).toBeNull();
  });
});

// ── HTTP harness ─────────────────────────────────────────────────────────────
type Harness = { server: Server; base: string; session: Record<string, any> };

async function startApp(register: (app: express.Express) => void): Promise<Harness> {
  const app = express();
  app.use(express.json());
  const session: Record<string, any> = {};
  app.use((req: any, _res, next) => {
    req.session = session;
    session.save = (cb: (err?: unknown) => void) => cb();
    req.sessionID = "test-session";
    next();
  });
  register(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}`, session };
}

function setCookies(res: Response): string[] {
  const anyHeaders = res.headers as any;
  return typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
}

function attrCookieFrom(res: Response): string | null {
  for (const c of setCookies(res)) {
    const m = c.match(new RegExp(`^${ATTRIBUTION_COOKIE}=([^;]*)`));
    if (m && m[1]) return m[1];
  }
  return null;
}

function clearsAttrCookie(res: Response): boolean {
  return setCookies(res).some((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=;`) && /Expires=Thu, 01 Jan 1970/i.test(c));
}

// ── stash endpoint + WorkOS callback ────────────────────────────────────────
describe("WorkOS: stash cookie round trip", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApp((app) => registerRetiredProviderRoutes(app));
  });
  afterAll(async () => {
    await new Promise((r) => h.server.close(r));
  });

  async function stash(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${h.base}/api/auth/attribution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("sets a short-lived httpOnly SameSite=Lax cookie scoped to /api/auth", async () => {
    const res = await stash({ utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch", landingPage: "/daily", email: "person@example.com" });
    expect(res.status).toBe(204);
    const cookie = setCookies(res).find((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Max-Age=1800/);
    const value = attrCookieFrom(res)!;
    expect(value.length).toBeLessThanOrEqual(ATTRIBUTION_COOKIE_MAX_BYTES);
    const decoded = decodeAttributionCookie(decodeURIComponent(value));
    expect(decoded).toEqual(attr({ utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch", landingPage: "/daily" }));
    expect(decodeURIComponent(value)).not.toContain("example.com");
  });

  it("caps an oversized body and refuses cross-origin posts", async () => {
    const big = await stash({ utmSource: "x".repeat(5000), utmContent: "y".repeat(5000) });
    expect(big.status).toBe(204);
    expect(attrCookieFrom(big)!.length).toBeLessThanOrEqual(ATTRIBUTION_COOKIE_MAX_BYTES);
    const cross = await stash({ utmSource: "x" }, { Origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    expect(attrCookieFrom(cross)).toBeNull();
  });

  it("clears the cookie when nothing usable is posted", async () => {
    const res = await stash({ landingPage: "https://evil.example" });
    expect(res.status).toBe(204);
    expect(clearsAttrCookie(res)).toBe(true);
  });

  it("retired callback returns 410 and never creates a provider identity", async () => {
    const r = await fetch(`${h.base}/api/auth/workos/callback?code=anything&state=anything`);
    expect(r.status).toBe(410);
    expect(mocks.createWorkosUser).not.toHaveBeenCalled();
    expect(mocks.createIdentity).not.toHaveBeenCalled();
  });
});

// ── Sign in with Apple ───────────────────────────────────────────────────────
describe("Sign in with Apple", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApp((app) => registerIosRoutes(app as any));
  });
  afterAll(async () => {
    await new Promise((r) => h.server.close(r));
  });

  async function apple(body: Record<string, unknown>, cookie?: string) {
    return fetch(`${h.base}/api/auth/apple`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `${ATTRIBUTION_COOKIE}=${cookie}` } : {}) },
      body: JSON.stringify({ identityToken: "header.payload.signature", ...body }),
    });
  }

  function newAppleUser(id: string) {
    mocks.jwtVerify.mockResolvedValue({ payload: { sub: `apple-${id}`, email: `${id}@privaterelay.example` } });
    mocks.appleSelect.mockResolvedValue([]);
    mocks.userInsert.mockResolvedValue([{ id, username: `${id}_1234`, status: "ACTIVE" }]);
  }

  it("writes attribution from a native body object for a new user", async () => {
    newAppleUser("user-apple-native");
    const res = await apple({ attribution: { utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch" } });
    expect(res.status).toBe(200);
    expect(written).toEqual([
      { userId: "user-apple-native", a: attr({ utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch" }) },
    ]);
    expect(clearsAttrCookie(res)).toBe(true);
  });

  it("writes attribution from the web stash cookie for a new user", async () => {
    newAppleUser("user-apple-web");
    const cookie = encodeAttributionCookie(attr({ utmMedium: "play_sets", landingPage: "/play-sets/1" }))!;
    const res = await apple({}, encodeURIComponent(cookie));
    expect(res.status).toBe(200);
    expect(written).toEqual([{ userId: "user-apple-web", a: attr({ utmMedium: "play_sets", landingPage: "/play-sets/1" }) }]);
  });

  it("does not write for a returning Apple user", async () => {
    mocks.jwtVerify.mockResolvedValue({ payload: { sub: "apple-existing" } });
    mocks.appleSelect.mockResolvedValue([{ userId: "user-existing" }]);
    mocks.getUser.mockResolvedValue({ id: "user-existing", username: "old", status: "ACTIVE" });
    const res = await apple({ attribution: { utmSource: "creator_jane" } });
    expect(res.status).toBe(200);
    expect(written).toEqual([]);
  });

  it("never blocks sign-in on a malformed attribution value", async () => {
    newAppleUser("user-apple-bad");
    const res = await apple({ attribution: "not-an-object" });
    expect(res.status).toBe(200);
    expect(written).toEqual([]);
  });
});

// ── register path ────────────────────────────────────────────────────────────
describe("POST /api/auth/register attribution", () => {
  function fakeRes() {
    const cleared: string[] = [];
    return { cleared, res: { clearCookie: (name: string) => cleared.push(name) } as any };
  }

  it("writes body fields (medium only) for the new user", async () => {
    const { res, cleared } = fakeRes();
    await attributeNewUserFromRequest(
      { headers: {} },
      res,
      "user-reg",
      { username: "a", email: "a@example.com", password: "p", utmMedium: "beatme", landingPage: "/daily" },
      "Register",
    );
    expect(written).toEqual([{ userId: "user-reg", a: attr({ utmMedium: "beatme", landingPage: "/daily" }) }]);
    expect(cleared).toEqual([ATTRIBUTION_COOKIE]);
  });

  it("fills gaps from the stash cookie; body wins per field", async () => {
    const cookie = encodeAttributionCookie(attr({ utmSource: "cookie_src", utmCampaign: "from_cookie" }))!;
    const { res } = fakeRes();
    await attributeNewUserFromRequest(
      { headers: { cookie: `other=1; ${ATTRIBUTION_COOKIE}=${encodeURIComponent(cookie)}` } },
      res,
      "user-reg2",
      { utmSource: "body_src" },
      "Register",
    );
    expect(written[0].a).toEqual(attr({ utmSource: "body_src", utmCampaign: "from_cookie" }));
  });

  it("records referral SIGNUP from referredByCode", async () => {
    links.REFR = { id: "link-r", createdByUserId: "referrer", expiresAt: null };
    const { res } = fakeRes();
    await attributeNewUserFromRequest({ headers: {} }, res, "user-reg3", { referredByCode: "REFR" }, "Register");
    expect(referralSignups).toEqual([{ linkId: "link-r", userId: "user-reg3" }]);
  });

  it("is wired into the register handler after the user is created", async () => {
    const src = await readFile(path.resolve(__dirname, "../routes.ts"), "utf8");
    const start = src.indexOf('app.post("/api/auth/register"');
    const end = src.indexOf("app.post(", start + 10);
    const handler = src.slice(start, end);
    expect(handler).toContain("createLocalUser(");
    expect(handler).toContain('attributeNewUserFromRequest(req, res, user.id, req.body, "Register")');
    expect(handler.indexOf("createLocalUser(")).toBeLessThan(handler.indexOf("attributeNewUserFromRequest("));
    expect(handler).not.toContain("req.body.utmSource || req.body.utmCampaign");
  });
});

// ── /r/:code ────────────────────────────────────────────────────────────────
describe("GET /r/:code", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApp((app) => app.use(referralsRouter));
  });
  afterAll(async () => {
    await new Promise((r) => h.server.close(r));
  });

  async function hit(destinationPath: string) {
    mocks.appleSelect.mockResolvedValue([{ id: "l1", code: "R1", destinationPath, isActive: true, expiresAt: null }]);
    const res = await fetch(`${h.base}/r/R1`, { redirect: "manual" });
    return res.headers.get("location");
  }

  it("keeps same-site destinations and appends ref", async () => {
    expect(await hit("/daily")).toBe("/daily?ref=R1");
    expect(await hit("/play-sets/x?utm_medium=play_sets")).toBe("/play-sets/x?utm_medium=play_sets&ref=R1");
  });

  it("never redirects off-site", async () => {
    expect(await hit("https://evil.example/x")).toBe("/?ref=R1");
    expect(await hit("//evil.example/x")).toBe("/?ref=R1");
    expect(await hit("/\\evil.example")).toBe("/?ref=R1");
  });
});

// ── report buckets ───────────────────────────────────────────────────────────
describe("signup report buckets for new rows", () => {
  const base: SignupSourceRow = {
    createdAt: new Date("2026-10-02T18:00:00.000Z"),
    isAdmin: false,
    isBot: false,
    hasWorkos: true,
    hasApple: false,
    hasEmail: false,
    hasAttributionRow: true,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    referrer: null,
    referralPurpose: null,
  };

  it("puts each creator in its own bucket", () => {
    expect(signupSourceBucket({ ...base, utmSource: "creator_jane", utmMedium: "dm", utmCampaign: "launch" })).toBe("creator_jane");
    expect(signupSourceBucket({ ...base, utmSource: "creator_BobCards", utmMedium: "post" })).toBe("creator_bobcards");
  });

  it("treats a tagged medium without a source as unknown, and a landing-only row as direct", () => {
    expect(signupSourceBucket({ ...base, utmMedium: "dm" })).toBe("unknown");
    expect(signupSourceBucket({ ...base, utmMedium: "beatme" })).toBe("beat_me_link");
    expect(signupSourceBucket({ ...base })).toBe("direct");
    expect(signupSourceBucket({ ...base, referrer: "t.co" })).toBe("x");
  });
});
