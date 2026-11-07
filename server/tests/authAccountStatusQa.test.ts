/**
 * POST /api/qa/auth/account-status — one normalized mailbox, QA token only.
 * Fixture rows. No live database and no address in the response or logs.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readdir, readFile } from "fs/promises";
import path from "path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeEmail } from "../auth/normalizeEmail";
import { ACCOUNT_STATUS_CAP, presentAccountStatus } from "../auth/accountStatus";
import {
  registerAuthAccountStatusQaRoute,
  setAccountStatusFinderForTests,
  type AccountStatusFinder,
} from "../routes/authAccountStatusQa";

const TOKEN = "test-qa-account-status-token";
const previousToken = process.env.COVER_QA_TOKEN;
const MAILBOX = "PlayerD@Example.com";
const ALIAS = "PlayerD+tag@example.org";

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

describe("account status presentation", () => {
  it("normalizes case and plus aliases on a fictional domain", () => {
    expect(normalizeEmail(MAILBOX)).toBe("playerd@example.com");
    expect(normalizeEmail(ALIAS)).toBe("playerd@example.org");
  });

  it("drops addresses and keeps only the safe account fields", () => {
    const report = presentAccountStatus(1, [{
      username: MAILBOX,
      hasLocalCredential: true,
      workosLinked: false,
      provider: "google",
      exactEmailMatch: true,
      loginSelected: false,
    }]);
    expect(report.accounts[0].username).toBeNull();
    expect(JSON.stringify(report)).not.toContain("@");
    expect(JSON.stringify(report)).not.toContain("PlayerD");
  });

  it("returns the count only past the cap", () => {
    const accounts = Array.from({ length: ACCOUNT_STATUS_CAP + 1 }, (_, index) => ({
      username: `player${index}`,
      hasLocalCredential: false,
      workosLinked: false,
      provider: null,
      exactEmailMatch: false,
      loginSelected: false,
    }));
    expect(presentAccountStatus(accounts.length, accounts, "ambiguous")).toEqual({
      matched: ACCOUNT_STATUS_CAP + 1,
      accounts: [],
      loginSelection: "ambiguous",
    });
  });
});

describe("POST /api/qa/auth/account-status", () => {
  const app = express();
  app.use(express.json());
  registerAuthAccountStatusQaRoute(app);
  const server = createServer(app);
  let base = "";
  let calls: Array<{ raw: string; normalized: string }> = [];

  const finder: AccountStatusFinder = async (raw, normalized) => {
    calls.push({ raw, normalized });
    if (normalized.endsWith("@example.org")) {
      return {
        matched: 1,
        loginSelection: "selected" as const,
        accounts: [{
          username: "playerd",
          hasLocalCredential: false,
          workosLinked: true,
          provider: "google" as const,
          exactEmailMatch: true,
          loginSelected: true,
        }],
      };
    }
    return {
      matched: 1,
      loginSelection: "selected" as const,
      accounts: [{
        username: "playerd",
        hasLocalCredential: false,
        workosLinked: true,
        provider: "google" as const,
        exactEmailMatch: true,
        loginSelected: true,
        email: MAILBOX,
        passwordHash: "hash",
        token: "tok",
      } as never],
    };
  };

  beforeAll(async () => {
    setToken(TOKEN);
    setAccountStatusFinderForTests(finder);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    setAccountStatusFinderForTests(null);
    setToken(previousToken);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  async function post(headers: Record<string, string>, body?: unknown, search = "") {
    return fetch(`${base}/api/qa/auth/account-status${search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("rejects missing, wrong, blank, and query-only tokens without reading accounts", async () => {
    calls = [];
    const missing = await post({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toContain("no-store");
    expect(missing.headers.get("x-robots-tag")).toBe("noindex");
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await post({ "X-QA-Token": "nope" }, { email: MAILBOX });
    expect(wrong.status).toBe(401);

    const queryOnly = await post({}, { email: MAILBOX }, `?token=${TOKEN}`);
    expect(queryOnly.status).toBe(401);
    expect(JSON.stringify(await queryOnly.json())).not.toContain(TOKEN);

    setToken(undefined);
    const unset = await post({ "X-QA-Token": TOKEN }, { email: MAILBOX });
    expect(unset.status).toBe(401);
    setToken("  ");
    const blank = await post({ "X-QA-Token": " " }, { email: MAILBOX });
    expect(blank.status).toBe(401);
    setToken(TOKEN);

    expect(calls).toEqual([]);
  });

  it("returns safe fields for one normalized mailbox and does not log the address", async () => {
    calls = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await post({ "X-QA-Token": TOKEN }, { email: `  ${MAILBOX}  ` });
      expect(res.status).toBe(200);
      expect(calls).toEqual([{ raw: MAILBOX, normalized: "playerd@example.com" }]);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["accounts", "loginSelection", "matched"]);
      expect(body.matched).toBe(1);
      expect(body.loginSelection).toBe("selected");
      expect(Object.keys(body.accounts[0]).sort()).toEqual([
        "exactEmailMatch",
        "hasLocalCredential",
        "loginSelected",
        "provider",
        "username",
        "workosLinked",
      ]);
      expect(body.accounts[0]).toEqual({
        username: "playerd",
        hasLocalCredential: false,
        workosLinked: true,
        provider: "google",
        exactEmailMatch: true,
        loginSelected: true,
      });
      const encoded = JSON.stringify(body);
      expect(encoded).not.toContain("@");
      expect(encoded).not.toContain("PlayerD");
      expect(encoded).not.toContain("hash");
      expect(encoded).not.toContain("tok");
      expect(encoded.toLowerCase()).not.toContain("password");
      const logged = [error, log].flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" "))).join("\n");
      expect(logged).not.toContain("PlayerD");
      expect(logged).not.toContain("@");
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("normalizes a plus alias on a fictional domain before lookup", async () => {
    calls = [];
    const res = await post({ "X-QA-Token": TOKEN }, { email: ALIAS });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ raw: ALIAS, normalized: "playerd@example.org" }]);
    const body = await res.json();
    expect(body.accounts[0].hasLocalCredential).toBe(false);
    expect(body.accounts[0].workosLinked).toBe(true);
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("does not query when the body is not a single email", async () => {
    calls = [];
    const missing = await post({ "X-QA-Token": TOKEN }, {});
    const many = await post({ "X-QA-Token": TOKEN }, { email: ["one@example.com", "two@example.com"] });
    expect(missing.status).toBe(400);
    expect(many.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "A valid email is required" });
    expect(calls).toEqual([]);
  });

  it("logs a failure code without the submitted address", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setAccountStatusFinderForTests(async () => {
      throw Object.assign(new Error(MAILBOX), { code: "XX000" });
    });
    try {
      const res = await post({ "X-QA-Token": TOKEN }, { email: MAILBOX });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to read account status" });
      const logged = error.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).toContain("[qa/auth/account-status] failed XX000");
      expect(logged).not.toContain("PlayerD");
      expect(logged).not.toContain("@");
    } finally {
      setAccountStatusFinderForTests(finder);
      error.mockRestore();
    }
  });
});

describe("account status stays private", () => {
  it("is registered on the server and is not referenced under client/", async () => {
    const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
    const route = await readFile(new URL("../routes/authAccountStatusQa.ts", import.meta.url), "utf8");
    const query = await readFile(new URL("../auth/accountStatusQuery.ts", import.meta.url), "utf8");
    expect(routes).toContain("registerAuthAccountStatusQaRoute");
    expect(route).toContain('"/api/qa/auth/account-status"');
    expect(route).toContain("coverQaHeaderMatches");
    expect(route).not.toMatch(/req\.query/);
    expect(query).not.toContain("password_hash");
    expect(query).not.toContain("passwordHash");
    expect(query).toContain("emailNormalized");
    expect(query).toContain("annotateAccountStatus");
    expect(query).not.toContain("passwordHash");

    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../client");
    const files = await listSourceFiles(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toContain("/api/qa/auth/account-status");
    }
  });
});

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listSourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}
