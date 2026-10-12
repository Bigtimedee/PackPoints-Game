import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { qaSessionTokenMatches, qaTestAccountGuard, registerQaSessionRoute, setQaAccountEnsurerForTests } from "../routes/qaSession";
import { QA_TEST_USER_ID, qaBlockedPath } from "@shared/qaTestAccount";

const TOKEN = "unit-test-token-not-real";
let ensured = 0;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use(qaTestAccountGuard);
  registerQaSessionRoute(app);
  app.get("/whoami", (req: any, res) => res.json({ user: req.session.localUserId ?? null }));
  app.post("/api/redeem", (_req, res) => res.json({ redeemed: true }));
  app.post("/api/rebate/payout-request", (_req, res) => res.json({ paid: true }));
  app.post("/api/store/checkout", (_req, res) => res.json({ url: "x" }));
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = makeApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try { return await fn(base); } finally { server.close(); }
}

describe("POST /api/qa/session", () => {
  const prev = process.env.QA_SESSION_TOKEN;
  beforeEach(() => { process.env.QA_SESSION_TOKEN = TOKEN; ensured = 0; setQaAccountEnsurerForTests(async () => { ensured++; }); });
  afterEach(() => { process.env.QA_SESSION_TOKEN = prev; setQaAccountEnsurerForTests(null); });

  it("404 without the token, with a wrong token, with the token in the query, and when unset", async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/api/qa/session`, { method: "POST" })).status).toBe(404);
      expect((await fetch(`${base}/api/qa/session`, { method: "POST", headers: { "X-QA-Token": "wrong" } })).status).toBe(404);
      expect((await fetch(`${base}/api/qa/session?token=${TOKEN}`, { method: "POST" })).status).toBe(404);
      process.env.QA_SESSION_TOKEN = "";
      expect((await fetch(`${base}/api/qa/session`, { method: "POST", headers: { "X-QA-Token": "" } })).status).toBe(404);
    });
    expect(ensured).toBe(0);
  });

  it("signs in only as the fixed QA user, ignoring any user id in body, query or headers", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/api/qa/session?userId=admin-1&user_id=admin-1`, {
        method: "POST",
        headers: { "X-QA-Token": TOKEN, "Content-Type": "application/json", "X-User-Id": "admin-1" },
        body: JSON.stringify({ userId: "admin-1", id: "admin-1", username: "dave", email: "dave@thed10.com" }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.userId).toBe(QA_TEST_USER_ID);
      const cookie = r.headers.get("set-cookie")!.split(";")[0];
      const who = await (await fetch(`${base}/whoami`, { headers: { cookie } })).json();
      expect(who.user).toBe(QA_TEST_USER_ID);
    });
  });

  it("the QA session cannot redeem, request payouts or buy", async () => {
    await withServer(async (base) => {
      const r = await fetch(`${base}/api/qa/session`, { method: "POST", headers: { "X-QA-Token": TOKEN } });
      const cookie = r.headers.get("set-cookie")!.split(";")[0];
      for (const p of ["/api/redeem", "/api/rebate/payout-request", "/api/store/checkout"]) {
        expect((await fetch(`${base}${p}`, { method: "POST", headers: { cookie } })).status).toBe(403);
      }
      // A normal visitor is untouched by the guard.
      expect((await fetch(`${base}/api/redeem`, { method: "POST" })).status).toBe(200);
    });
  });

  it("route source never reads a user id from the request", () => {
    const src = fs.readFileSync(path.join(__dirname, "../routes/qaSession.ts"), "utf8");
    const route = src.slice(src.indexOf("export function registerQaSessionRoute"));
    expect(route).not.toMatch(/req\.(body|query|params)/);
    expect(route).toContain("session.localUserId = QA_TEST_USER_ID");
  });

  it("token compare", () => {
    expect(qaSessionTokenMatches(TOKEN, { QA_SESSION_TOKEN: TOKEN } as any)).toBe(true);
    expect(qaSessionTokenMatches(TOKEN, {} as any)).toBe(false);
    expect(qaSessionTokenMatches(undefined, { QA_SESSION_TOKEN: TOKEN } as any)).toBe(false);
  });
});

describe("QA account exclusions", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  it("money paths are blocked", () => {
    for (const p of ["/api/redeem", "/api/marketplace/redemption/apply", "/api/rebate/payout-request", "/api/store/subscribe", "/api/founders-pass/redeem"]) expect(qaBlockedPath("POST", p)).toBe(true);
    expect(qaBlockedPath("GET", "/api/redeem")).toBe(false);
    expect(qaBlockedPath("POST", "/api/game/start")).toBe(false);
  });
  it("leaderboards, analytics and signup counts exclude the account", () => {
    expect(read("storage.ts")).toContain("<> ${QA_TEST_USER_ID}");
    expect(read("services/daily5Service.ts")).toContain("dce.user_id <> ${QA_TEST_USER_ID}");
    expect(read("services/ratingService.ts")).toContain("ne(playerRatings.userId, QA_TEST_USER_ID)");
    expect(read("services/analytics/track.ts")).toContain("if (isQaTestUser(input.userId)) return;");
    expect(read("services/signupSources.ts")).toContain("WHERE u.id <> '${QA_TEST_USER_ID}'");
  });
  it("seeded account is never admin", () => {
    const src = read("routes/qaSession.ts");
    expect(src).toContain("isAdmin: false");
    expect(src).not.toMatch(/isAdmin:\s*true/);
  });
});
