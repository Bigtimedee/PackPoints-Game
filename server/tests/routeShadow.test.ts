import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import path from "path";
import express, { type Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerVersionRoute } from "../lib/versionRoute";
import { markSchemaReady, resetSchemaGateForTests, schemaGateMiddleware } from "../startup/schemaGate";
import { schemaWindowHolds } from "../startup/schemaWindow";
import { mountSchemaWindowSpa, mountSpaStatic } from "../static";

const SERVER_DIR = path.resolve(new URL("..", import.meta.url).pathname);

function walkTs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "tests" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
}

function resolveImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Every verb route under server/ whose full path is outside /api. */
export function listNonApiServerRoutes(): { method: string; path: string; file: string }[] {
  const files: string[] = [];
  walkTs(SERVER_DIR, files);
  const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const mountPrefix = new Map<string, string>();

  for (const [file, text] of sources) {
    const imported = new Map<string, string>();
    for (const match of text.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+)["']/g)) {
      const resolved = resolveImport(file, match[2]);
      if (resolved) imported.set(match[1], resolved);
    }
    for (const match of text.matchAll(/app\.use\(\s*["'](\/[^"']+)["']\s*,\s*(\w+)/g)) {
      const target = imported.get(match[2]);
      if (target) mountPrefix.set(target, match[1]);
    }
  }

  const routes: { method: string; path: string; file: string }[] = [];
  const routeRe = /(?:app|router)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]+)["'`]/g;
  for (const [file, text] of sources) {
    if (file.endsWith(`${path.sep}static.ts`) || file.endsWith(`${path.sep}vite.ts`)) continue;
    const prefix = mountPrefix.get(file) ?? "";
    for (const match of text.matchAll(routeRe)) {
      const full = `${prefix.replace(/\/$/, "")}${match[2]}`;
      if (full === "/api" || full.startsWith("/api/")) continue;
      routes.push({ method: match[1].toUpperCase(), path: full, file: path.relative(SERVER_DIR, file) });
    }
  }
  return routes;
}

function concretePath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    if (name === "token") return "badtoken";
    if (name === "code") return "abc";
    if (name === "listingId") return "x";
    return "x";
  });
}

describe("server routes are not shadowed by the SPA", () => {
  const routes = listNonApiServerRoutes();
  const dir = mkdtempSync(path.join(tmpdir(), "packpts-shadow-"));
  const sentinel = "PACKPTS_INDEX_SENTINEL";
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>${sentinel}</title>`);

  const app = express();
  registerVersionRoute(app);
  app.use(schemaGateMiddleware);
  mountSchemaWindowSpa(app, dir);

  const known = new Map<string, { status: number; location?: string; json?: Record<string, string> }>([
    ["/out/ebay/:listingId", { status: 400, json: { error: "Invalid redirect token" } }],
    ["/out/goldin/:listingId", { status: 400, json: { error: "Invalid redirect token" } }],
    ["/r/:code", { status: 302, location: "/" }],
    ["/p/:token", { status: 302, location: "/waitlist?error=Pass%20is%20invalid" }],
    ["/auth/tiktok/callback", { status: 302, location: "/review/tiktok-sandbox?error=no_code" }],
    ["/wallet", { status: 401, json: { message: "Unauthorized" } }],
  ]);

  for (const route of routes) {
    const shaped = known.get(route.path);
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete" | "all";
    (app[method] as Express["get"])(route.path, (_req, res) => {
      res.setHeader("X-PackPTS-Handler", route.path);
      if (shaped?.location) {
        res.redirect(shaped.status, shaped.location);
        return;
      }
      if (shaped?.json) {
        res.status(shaped.status).json(shaped.json);
        return;
      }
      res.status(204).end();
    });
  }

  mountSpaStatic(app, dir);

  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  async function hit(pathname: string, method = "GET") {
    const res = await fetch(`${base}${pathname}`, { method, redirect: "manual" });
    const text = await res.text();
    return { res, text };
  }

  it("enumerates the non-api routes the schema window must not turn into index.html", () => {
    const paths = routes.map((route) => `${route.method} ${route.path}`).sort();
    expect(paths).toContain("GET /out/ebay/:listingId");
    expect(paths).toContain("GET /out/goldin/:listingId");
    expect(paths).toContain("GET /r/:code");
    expect(paths).toContain("GET /p/:token");
    expect(paths).toContain("GET /auth/tiktok/callback");
    expect(paths).toContain("GET /wallet");
    expect(paths).toContain("POST /wallet/spend");
    expect(paths).toContain("POST /internal/wallet/earn");
    expect(paths).toContain("POST /internal/wallet/adjust");
    expect(paths).toContain("GET /health");
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const route of routes) {
      expect(schemaWindowHolds(concretePath(route.path)), route.path).toBe(true);
    }
    expect(schemaWindowHolds("/generated/share/2026-09-25/x.png")).toBe(true);
    expect(schemaWindowHolds("/webhooks/stripe")).toBe(true);
    expect(schemaWindowHolds("/game/solo")).toBe(false);
  });

  it("returns 503 before the schema is ready and the real handler after, with static mounted", async () => {
    resetSchemaGateForTests();
    const probes = [
      { path: "/out/ebay/x", method: "GET" },
      { path: "/out/goldin/x", method: "GET" },
      { path: "/r/abc", method: "GET" },
      { path: "/p/badtoken", method: "GET" },
      { path: "/auth/tiktok/callback", method: "GET" },
      { path: "/wallet", method: "GET" },
      ...routes.map((route) => ({ path: concretePath(route.path), method: route.method })),
    ];
    for (const probe of probes) {
      const closed = await hit(probe.path, probe.method);
      expect(closed.res.status, probe.path).toBe(503);
      expect(closed.res.headers.get("retry-after")).toBe("2");
      expect(closed.res.headers.get("content-type") || "").toContain("application/json");
      expect(closed.text).not.toContain(sentinel);
      expect(closed.res.headers.get("x-packpts-handler")).toBeNull();
    }

    const shell = await hit("/game/solo");
    expect(shell.res.status).toBe(200);
    expect(shell.res.headers.get("content-type") || "").toContain("text/html");
    expect(shell.text).toContain(sentinel);

    const authPage = await hit("/auth/success");
    expect(authPage.res.status).toBe(503);
    expect(authPage.text).not.toContain(sentinel);

    markSchemaReady();

    const ebay = await hit("/out/ebay/x");
    expect(ebay.res.status).toBe(400);
    expect(ebay.res.headers.get("content-type") || "").toContain("application/json");
    expect(ebay.text).toContain("Invalid redirect token");
    expect(ebay.text).not.toContain(sentinel);

    const goldin = await hit("/out/goldin/x");
    expect(goldin.res.status).toBe(400);
    expect(goldin.text).not.toContain(sentinel);

    const referral = await hit("/r/abc");
    expect(referral.res.status).toBe(302);
    expect(referral.res.headers.get("location")).toBe("/");
    expect(referral.text).not.toContain(sentinel);

    const pass = await hit("/p/badtoken");
    expect(pass.res.status).toBe(302);
    expect(pass.res.headers.get("location") || "").toContain("/waitlist");
    expect(pass.text).not.toContain(sentinel);

    const tiktok = await hit("/auth/tiktok/callback");
    expect(tiktok.res.status).toBe(302);
    expect(tiktok.res.headers.get("location") || "").toContain("/review/tiktok-sandbox");
    expect(tiktok.text).not.toContain(sentinel);

    const wallet = await hit("/wallet");
    expect(wallet.res.status).toBe(401);
    expect(wallet.res.headers.get("content-type") || "").toContain("application/json");
    expect(wallet.text).toContain("Unauthorized");
    expect(wallet.text).not.toContain(sentinel);

    for (const route of routes) {
      const open = await hit(concretePath(route.path), route.method);
      expect(open.res.headers.get("x-packpts-handler"), route.path).toBe(route.path);
      expect(open.text).not.toContain(sentinel);
      if (!open.res.headers.get("location")) {
        expect(open.res.headers.get("content-type") || "", route.path).not.toContain("text/html");
      }
    }

    const authAfter = await hit("/auth/success");
    expect(authAfter.res.status).toBe(200);
    expect(authAfter.text).toContain(sentinel);

    const shellAfter = await hit("/game/solo");
    expect(shellAfter.res.status).toBe(200);
    expect(shellAfter.text).toContain(sentinel);
  });
});
