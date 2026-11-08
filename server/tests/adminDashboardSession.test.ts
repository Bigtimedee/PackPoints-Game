/**
 * Admin dashboard 401 after a password reset.
 * The session row is deleted, but the browser keeps connect.sid unless the
 * reset response clears it. A later GET /api/admin/dashboard is 401 with no
 * upstream error. The cached shell must not be treated as dashboard data.
 */
import { readFileSync } from "fs";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import { afterAll, describe, expect, it } from "vitest";
import { isAuthenticated } from "../auth/middleware";
import { endBrowserSession, SESSION_COOKIE_NAME } from "../auth/endBrowserSession";
import { completePasswordReset } from "../auth/passwordResetApply";
import { authenticatedAccount, sessionAuthenticatedUserId } from "../auth/sessionIdentity";
import { getSessionCookieOptions } from "../auth/session";

type Account = { id: string; isAdmin: boolean; points: number };

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";

const ADMIN: Account = { id: "admin-1", isAdmin: true, points: 6175 };
const PLAYER: Account = { id: "player-1", isAdmin: false, points: 40 };
const USERS = new Map<string, Account>([ADMIN, PLAYER].map((row) => [row.id, row]));

function dashboardFromRecords(records: Account[]) {
  const players = records.filter((row) => !row.isAdmin);
  return {
    overview: {
      registeredUsersNonStaff: players.length,
      totalPoints: records.reduce((sum, row) => sum + row.points, 0),
    },
  };
}

const REAL_DASHBOARD = dashboardFromRecords([...USERS.values()]);

function cookiePairs(res: globalThis.Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const rows = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return rows.map((row) => row.split(";")[0]).filter((row) => row.includes("="));
}

function sessionsOf(store: session.MemoryStore): Promise<Record<string, { localUserId?: string }>> {
  return new Promise((resolve, reject) => {
    store.all((err, data) => (err ? reject(err) : resolve((data ?? {}) as Record<string, { localUserId?: string }>)));
  });
}

function destroySid(store: session.MemoryStore, sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store.destroy(sid, (err) => (err ? reject(err) : resolve()));
  });
}

describe("admin dashboard session", () => {
  const store = new session.MemoryStore();
  let dashboardDown = false;
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "test-secret-not-production",
    resave: false,
    saveUninitialized: false,
    store,
    cookie: getSessionCookieOptions(),
  }));

  app.post("/login", (req, res) => {
    const id = typeof req.body?.id === "string" ? req.body.id : "";
    if (!USERS.has(id)) return res.status(401).json({ message: "Unauthorized" });
    (req.session as { localUserId?: string }).localUserId = id;
    req.session.save((err) => (err ? res.status(500).json({ error: "save" }) : res.json({ ok: true })));
  });

  app.post("/workos-challenge", (req, res) => {
    (req.session as { workosUserId?: string }).workosUserId = "wos-unproven";
    req.session.save((err) => (err ? res.status(500).json({ error: "save" }) : res.json({ ok: true })));
  });

  app.get("/api/auth/user", async (req, res) => {
    const lookedUp: string[] = [];
    const user = await authenticatedAccount(req, async (id) => {
      lookedUp.push(id);
      return USERS.get(id) ?? null;
    });
    res.setHeader("x-lookups", lookedUp.join(","));
    res.json(user);
  });

  const requireMappedAdmin = (req: Request, res: Response, next: NextFunction) => {
    const userId = sessionAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const account = USERS.get(userId);
    if (!account?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    next();
  };

  app.get("/api/admin/dashboard", isAuthenticated, requireMappedAdmin, (_req, res) => {
    if (dashboardDown) return res.status(500).json({ error: "Failed to get dashboard stats" });
    res.json(dashboardFromRecords([...USERS.values()]));
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const result = await completePasswordReset({
      token: req.body?.token,
      password: req.body?.password,
      getPasswordResetToken: async (token) => (token === "good-token" ? { id: "token-row", userId: ADMIN.id } : null),
      applyPassword: async () => true,
      markPasswordResetTokenUsed: async () => {},
      revokeSessions: async (userId) => {
        const all = await sessionsOf(store);
        await Promise.all(
          Object.entries(all)
            .filter(([, sess]) => sess.localUserId === userId)
            .map(([sid]) => destroySid(store, sid)),
        );
      },
    });
    if (result.status === 200) await endBrowserSession(req, res);
    res.status(result.status).json(result.body);
  });

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  afterAll(() => {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
  });

  async function login(id: string): Promise<string> {
    const res = await fetch(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(200);
    const pair = cookiePairs(res).find((row) => row.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(pair).toBeTruthy();
    return pair!;
  }

  it("returns the real dashboard for an admin and rejects guests, non-admins, and workos-only sessions", async () => {
    expect(REAL_DASHBOARD.overview.registeredUsersNonStaff).toBe(1);
    expect(REAL_DASHBOARD.overview.totalPoints).toBe(6215);

    const guest = await fetch(`${base}/api/admin/dashboard`);
    expect(guest.status).toBe(401);
    const guestBody = await guest.json();
    expect(guestBody).toEqual({ message: "Unauthorized" });
    expect(JSON.stringify(guestBody)).not.toContain("totalPoints");
    expect(await (await fetch(`${base}/api/auth/user`)).json()).toBeNull();

    const adminCookie = await login(ADMIN.id);
    const dash = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: adminCookie } });
    expect(dash.status).toBe(200);
    expect(await dash.json()).toEqual(REAL_DASHBOARD);
    const me = await fetch(`${base}/api/auth/user`, { headers: { cookie: adminCookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual(ADMIN);
    expect(me.headers.get("x-lookups")).toBe(ADMIN.id);

    const playerCookie = await login(PLAYER.id);
    const denied = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: playerCookie } });
    expect(denied.status).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody).toEqual({ message: "Admin access required" });
    expect(JSON.stringify(deniedBody)).not.toContain("overview");
    expect(await (await fetch(`${base}/api/auth/user`, { headers: { cookie: playerCookie } })).json()).toEqual(PLAYER);

    const challenge = await fetch(`${base}/workos-challenge`, { method: "POST" });
    const challengeCookie = cookiePairs(challenge)[0];
    const challengeUser = await fetch(`${base}/api/auth/user`, { headers: { cookie: challengeCookie } });
    expect(await challengeUser.json()).toBeNull();
    expect(challengeUser.headers.get("x-lookups")).toBe("");
    const challengeDash = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: challengeCookie } });
    expect(challengeDash.status).toBe(401);
    expect(await challengeDash.json()).toEqual({ message: "Unauthorized" });
  });

  it("keeps the session when the dashboard query fails, then serves the same numbers after it recovers", async () => {
    const adminCookie = await login(ADMIN.id);
    dashboardDown = true;
    try {
      const failed = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: adminCookie } });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: "Failed to get dashboard stats" });
      expect(await (await fetch(`${base}/api/auth/user`, { headers: { cookie: adminCookie } })).json()).toEqual(ADMIN);
    } finally {
      dashboardDown = false;
    }
    const again = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: adminCookie } });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(REAL_DASHBOARD);
  });

  it("clears this browser after a successful reset and does not resurrect or log out someone else", async () => {
    const phone = await login(ADMIN.id);
    const otherDevice = await login(ADMIN.id);
    const player = await login(PLAYER.id);
    expect(phone).not.toBe(otherDevice);

    const reset = await fetch(`${base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${phone}; packpts_anon=guest-1` },
      body: JSON.stringify({ token: "good-token", password: "new-password-1" }),
    });
    expect(reset.status).toBe(200);
    const setCookies = (reset.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const cleared = setCookies.find((row) => row.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(cleared).toBeTruthy();
    expect(cleared!.toLowerCase()).toContain("expires=thu, 01 jan 1970");
    expect(setCookies.join("\n")).not.toContain("packpts_anon");

    const stored = await sessionsOf(store);
    expect(Object.values(stored).some((sess) => sess.localUserId === ADMIN.id)).toBe(false);
    expect(Object.values(stored).some((sess) => sess.localUserId === PLAYER.id)).toBe(true);

    for (const dead of [phone, otherDevice]) {
      const dash = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: dead } });
      expect(dash.status).toBe(401);
      expect(await dash.json()).toEqual({ message: "Unauthorized" });
      expect(await (await fetch(`${base}/api/auth/user`, { headers: { cookie: dead } })).json()).toBeNull();
    }
    const afterReplay = await sessionsOf(store);
    expect(Object.values(afterReplay).some((sess) => sess.localUserId === ADMIN.id)).toBe(false);
    expect(await (await fetch(`${base}/api/auth/user`, { headers: { cookie: player } })).json()).toEqual(PLAYER);
    expect((await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: player } })).status).toBe(403);
  });

  it("does not end the browser session when the reset is rejected", async () => {
    const adminCookie = await login(ADMIN.id);
    const reset = await fetch(`${base}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ token: "bad-token", password: "new-password-1" }),
    });
    expect(reset.status).toBe(400);
    const setCookies = (reset.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    expect(setCookies.join("\n")).not.toContain("01 jan 1970");
    expect(await (await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: adminCookie } })).json()).toEqual(REAL_DASHBOARD);
  });

  it("does not treat a workos-only or empty id as a login", () => {
    expect(sessionAuthenticatedUserId({ session: { workosUserId: "wos-1" } as { localUserId?: string } })).toBeNull();
    expect(sessionAuthenticatedUserId({ session: { localUserId: "" } })).toBeNull();
    expect(sessionAuthenticatedUserId({
      session: {},
      isAuthenticated: () => false,
      user: { claims: { sub: ADMIN.id } },
    })).toBeNull();
    expect(sessionAuthenticatedUserId({
      session: { localUserId: PLAYER.id },
      isAuthenticated: () => true,
      user: { claims: { sub: ADMIN.id } },
    })).toBe(PLAYER.id);
    expect(sessionAuthenticatedUserId({
      session: {},
      isAuthenticated: () => true,
      user: { claims: { sub: ADMIN.id } },
    })).toBe(ADMIN.id);
  });
});

describe("reset and auth routes on current main", () => {
  const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const authRoutes = readFileSync(new URL("../auth/routes.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../../client/src/pages/admin/dashboard.tsx", import.meta.url), "utf8");

  it("ends the browser session only after a successful reset and still deletes by localUserId", () => {
    const start = routes.indexOf('app.post("/api/auth/reset-password"');
    const handler = routes.slice(start, routes.indexOf("// ========================================\n  // IDENTITY LINKING"));
    expect(handler).toContain("sess->>'localUserId'");
    expect(handler.indexOf("completePasswordReset")).toBeLessThan(handler.indexOf("endBrowserSession"));
    expect(handler).toContain("if (result.status === 200)");
    expect(handler).not.toContain("packpts_anon");
    expect(handler).not.toContain("claimAnonForUser");
    const catchBlock = handler.slice(handler.indexOf("} catch"));
    expect(catchBlock).not.toContain("endBrowserSession");
  });

  it("loads /api/auth/user through the same id the guard accepts", () => {
    expect(authRoutes).toContain("authenticatedAccount");
    expect(authRoutes).not.toContain("getUserByWorkosId");
    expect(authRoutes).not.toContain("session.workosUserId");
    expect(authRoutes).not.toContain("req.session?.workosUserId");
  });

  it("the dashboard page recovers a 401 and still shows a real load failure", () => {
    expect(dashboard).toContain("classifyDashboardFailure");
    expect(dashboard).toContain("Your session ended. Sign in again.");
    expect(dashboard).toContain("Failed to load dashboard data.");
    expect(dashboard).toContain("button-retry-dashboard");
    expect(dashboard).not.toContain("registeredUsersNonStaff: 0");
  });
});
