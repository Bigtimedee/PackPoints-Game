/**
 * GET /api/qa/signups — token guard, bucket reconciliation, CT day bucketing.
 * Fixture rows only. No live database and no user data.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readdir, readFile } from "fs/promises";
import path from "path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPackptsDays, getPackptsDayKey } from "@shared/packptsDay";
import {
  SIGNUP_DAILY_DAYS,
  SIGNUP_SOURCE_GAPS,
  SIGNUP_SOURCE_SQL,
  buildSignupReport,
  mapSignupSourceRow,
  sanitizeUtmSource,
  signupSourceBucket,
  sumAuthProviders,
  sumCounts,
  type SignupSourceRow,
} from "../services/signupSources";
import { registerSignupQaRoutes, setSignupSourceLoaderForTests } from "../routes/signupQa";

const TOKEN = "test-qa-signups-token";
const previousToken = process.env.COVER_QA_TOKEN;

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

function row(partial: Partial<SignupSourceRow> & Pick<SignupSourceRow, "createdAt">): SignupSourceRow {
  return {
    isAdmin: false,
    isBot: false,
    hasWorkos: false,
    hasApple: false,
    hasEmail: true,
    hasAttributionRow: false,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    referrer: null,
    referralPurpose: null,
    ...partial,
  };
}

function sumExcluded(excluded: { staffAdmin: number; bots: number }): number {
  return excluded.staffAdmin + excluded.bots;
}

describe("signup source buckets", () => {
  const at = new Date("2026-09-20T18:00:00.000Z");

  it("maps first-touch fields onto stable buckets", () => {
    expect(signupSourceBucket(row({ createdAt: at, utmSource: "share", utmMedium: "beatme", utmCampaign: "daily5", hasAttributionRow: true }))).toBe("beat_me_link");
    expect(signupSourceBucket(row({ createdAt: at, referralPurpose: "DAILY5_CHALLENGE" }))).toBe("beat_me_link");
    expect(signupSourceBucket(row({ createdAt: at, utmSource: "share", utmMedium: "play_sets", utmCampaign: "integrated", hasAttributionRow: true }))).toBe("share_card");
    expect(signupSourceBucket(row({ createdAt: at, referralPurpose: "SCORE_SHARE" }))).toBe("share_card");
    expect(signupSourceBucket(row({ createdAt: at, referralPurpose: "INVITE" }))).toBe("referral");
    expect(signupSourceBucket(row({ createdAt: at, utmSource: "Reddit", hasAttributionRow: true }))).toBe("reddit");
    expect(signupSourceBucket(row({ createdAt: at, hasAttributionRow: true, referrer: "https://www.ebay.com/itm/1" }))).toBe("ebay");
    expect(signupSourceBucket(row({ createdAt: at, hasAttributionRow: true, referrer: "https://t.co/abc" }))).toBe("x");
    expect(signupSourceBucket(row({ createdAt: at, hasAttributionRow: true, utmCampaign: "spring" }))).toBe("unknown");
    expect(signupSourceBucket(row({ createdAt: at, hasAttributionRow: true, referrer: "https://example.com/in" }))).toBe("unknown");
    expect(signupSourceBucket(row({ createdAt: at, hasAttributionRow: true }))).toBe("direct");
    expect(signupSourceBucket(row({ createdAt: at }))).toBe("unattributed");
  });

  it("does not let a crafted utm_source become a residual bucket or keep an email", () => {
    expect(sanitizeUtmSource("unattributed")).toBe("utm_unattributed");
    expect(sanitizeUtmSource("unknown")).toBe("utm_unknown");
    expect(sanitizeUtmSource("person@example.com")).toBe("person_example_com");
    expect(signupSourceBucket(row({ createdAt: at, utmSource: "person@example.com", hasAttributionRow: true }))).toBe("person_example_com");
  });

  it("prefers beat-me over a referral invite on the same user", () => {
    expect(signupSourceBucket(row({
      createdAt: at,
      utmMedium: "beatme",
      referralPurpose: "INVITE",
      hasAttributionRow: true,
    }))).toBe("beat_me_link");
  });
});

describe("signup report reconciliation and CT days", () => {
  const now = new Date("2026-09-27T04:30:00.000Z");

  it("uses the Chicago calendar day, not the UTC date, around the CDT boundary", () => {
    expect(getPackptsDayKey(now)).toBe("2026-09-26");
    expect(getPackptsDayKey(new Date("2026-09-27T05:00:00.000Z"))).toBe("2026-09-27");
  });

  it("reconciles buckets to totals and keeps staff, admin, and bots in excluded", () => {
    const report = buildSignupReport([
      row({ createdAt: new Date("2026-09-27T04:00:00.000Z") }),
      row({ createdAt: new Date("2026-09-26T18:00:00.000Z"), utmSource: "reddit", hasAttributionRow: true, hasEmail: true }),
      row({ createdAt: new Date("2026-09-25T16:00:00.000Z"), utmSource: "share", utmMedium: "beatme", hasAttributionRow: true }),
      row({ createdAt: new Date("2026-09-22T12:00:00.000Z"), referralPurpose: "INVITE", hasWorkos: true, hasEmail: false }),
      row({ createdAt: new Date("2026-09-10T12:00:00.000Z"), utmSource: "share", utmMedium: "play_sets", hasAttributionRow: true, hasApple: true, hasEmail: false }),
      row({ createdAt: new Date("2026-08-01T12:00:00.000Z"), hasAttributionRow: true, referrer: "https://x.com/packpts", hasEmail: false }),
      row({ createdAt: new Date("2026-09-26T20:00:00.000Z"), isAdmin: true, isBot: true, hasEmail: true }),
      row({ createdAt: new Date("2026-09-21T12:00:00.000Z"), isBot: true, hasEmail: false }),
      row({ createdAt: null, hasEmail: true }),
    ], now);

    expect(report.timezone).toBe("America/Chicago");
    expect(report.generatedAt).toBe(now.toISOString());
    expect(report.totals.excluded.allTime.test).toBeNull();
    expect(report.totals.excluded.allTime.qa).toBeNull();
    expect(report.totals.excluded.allTime.staffAdmin).toBe(1);
    expect(report.totals.excluded.allTime.bots).toBe(1);
    expect(report.totals.excluded.last24h.staffAdmin).toBe(1);
    expect(report.totals.excluded.last7d.bots).toBe(1);
    expect(sumExcluded(report.totals.excluded.allTime)).toBe(2);

    expect(report.totals.allTime).toBe(7);
    expect(sumCounts(report.bySource.allTime)).toBe(report.totals.allTime);
    expect(sumCounts(report.bySource.last24h)).toBe(report.totals.last24h);
    expect(sumCounts(report.bySource.last7d)).toBe(report.totals.last7d);
    expect(report.bySource.allTime.unattributed).toBe(2);
    expect(report.bySource.allTime.reddit).toBe(1);
    expect(report.bySource.allTime.beat_me_link).toBe(1);
    expect(report.bySource.allTime.referral).toBe(1);
    expect(report.bySource.allTime.share_card).toBe(1);
    expect(report.bySource.allTime.x).toBe(1);

    expect(report.totals.last24h).toBe(2);
    expect(report.totals.last7d).toBe(4);
    expect(sumAuthProviders(report.authProviders.allTime)).toBe(report.totals.allTime);
    expect(sumAuthProviders(report.authProviders.last24h)).toBe(report.totals.last24h);
    expect(sumAuthProviders(report.authProviders.last7d)).toBe(report.totals.last7d);
    expect(report.authProviders.allTime.apple).toBe(1);
    expect(report.authProviders.allTime.workos).toBe(1);
    expect(report.authProviders.allTime).not.toHaveProperty("google");

    expect(report.daily).toHaveLength(SIGNUP_DAILY_DAYS);
    expect(report.daily[0].day).toBe(addPackptsDays("2026-09-26", -(SIGNUP_DAILY_DAYS - 1)));
    expect(report.daily[report.daily.length - 1].day).toBe("2026-09-26");
    for (const day of report.daily) {
      expect(sumCounts(day.bySource)).toBe(day.signups);
      if (day.signups === 0) expect(day.topSource).toBeNull();
    }
    const today = report.daily.find((day) => day.day === "2026-09-26");
    expect(today?.signups).toBe(2);
    expect(today?.bySource.unattributed).toBe(1);
    expect(today?.bySource.reddit).toBe(1);
    expect(JSON.stringify(report)).not.toContain("example.com");
    expect(JSON.stringify(report)).not.toContain("@");
  });

  it("buckets a CST instant onto the Chicago date, not the UTC date", () => {
    const winter = new Date("2026-01-15T12:00:00.000Z");
    const latePrevious = new Date("2026-01-15T05:30:00.000Z");
    const earlyToday = new Date("2026-01-15T06:30:00.000Z");
    expect(getPackptsDayKey(latePrevious)).toBe("2026-01-14");
    expect(latePrevious.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(getPackptsDayKey(earlyToday)).toBe("2026-01-15");

    const report = buildSignupReport([
      row({ createdAt: latePrevious, utmSource: "newsletter", hasAttributionRow: true }),
      row({ createdAt: earlyToday }),
    ], winter);

    expect(report.daily).toHaveLength(14);
    expect(report.daily[0].day).toBe("2026-01-02");
    expect(report.daily[13].day).toBe("2026-01-15");
    expect(report.daily.find((day) => day.day === "2026-01-14")?.bySource.newsletter).toBe(1);
    expect(report.daily.find((day) => day.day === "2026-01-15")?.bySource.unattributed).toBe(1);
    expect(report.daily.find((day) => day.day === "2026-01-15")?.bySource.newsletter).toBeUndefined();
  });
});

describe("signup source SQL", () => {
  it("does not select email, username, or user id", () => {
    const sql = SIGNUP_SOURCE_SQL.toLowerCase();
    expect(sql).not.toMatch(/\bemail\b/);
    expect(sql).not.toContain("username");
    expect(sql).not.toContain("first_name");
    expect(sql).not.toContain("u.id,");
    expect(sql).toContain("user_attribution");
    expect(sql).toContain("referral_attributions");
    expect(sql).toContain("apple_users");
    expect(sql).toContain("local_credentials");
  });

  it("maps database flags without copying a raw referrer into a bucket name", () => {
    const mapped = mapSignupSourceRow({
      created_at: "2026-09-26T18:00:00.000Z",
      is_admin: false,
      is_bot: "f",
      has_workos: true,
      has_apple: false,
      has_email: false,
      has_attribution: true,
      utm_source: "  Google  ",
      utm_medium: null,
      utm_campaign: null,
      referrer: "https://secret.example/path?email=person@example.com",
      referral_purpose: "INVITE",
    });
    expect(mapped.hasWorkos).toBe(true);
    expect(mapped.utmSource).toBe("Google");
    expect(signupSourceBucket(mapped)).toBe("referral");
    expect(mapped.createdAt?.toISOString()).toBe("2026-09-26T18:00:00.000Z");
  });
});

describe("GET /api/qa/signups", () => {
  const app = express();
  registerSignupQaRoutes(app);
  const server = createServer(app);
  let base = "";

  const fixture: SignupSourceRow[] = [
    row({ createdAt: new Date("2026-09-26T18:00:00.000Z"), utmSource: "reddit", hasAttributionRow: true }),
    row({ createdAt: new Date("2026-09-26T12:00:00.000Z"), isAdmin: true }),
  ];

  beforeAll(async () => {
    setToken(TOKEN);
    setSignupSourceLoaderForTests(async () => fixture);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    setSignupSourceLoaderForTests(null);
    setToken(previousToken);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("returns 401 without a session and without the token", async () => {
    const missing = await fetch(`${base}/api/qa/signups`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toContain("no-store");
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await fetch(`${base}/api/qa/signups`, { headers: { "X-QA-Token": "nope" } });
    expect(wrong.status).toBe(401);

    const queryOnly = await fetch(`${base}/api/qa/signups?token=${TOKEN}`);
    expect(queryOnly.status).toBe(401);
    const queryBody = JSON.stringify(await queryOnly.json());
    expect(queryBody).not.toContain(TOKEN);

    setToken(undefined);
    const unset = await fetch(`${base}/api/qa/signups`, { headers: { "X-QA-Token": TOKEN } });
    expect(unset.status).toBe(401);
    setToken(TOKEN);

    setToken("  ");
    const blank = await fetch(`${base}/api/qa/signups`, { headers: { "X-QA-Token": " " } });
    expect(blank.status).toBe(401);
    setToken(TOKEN);
  });

  it("returns aggregate counts with the header and ignores a query token", async () => {
    const res = await fetch(`${base}/api/qa/signups?token=ignored`, {
      headers: { "X-QA-Token": TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const body = await res.json();
    expect(body.timezone).toBe("America/Chicago");
    expect(body.totals.allTime).toBe(1);
    expect(body.totals.excluded.allTime.staffAdmin).toBe(1);
    expect(sumCounts(body.bySource.allTime)).toBe(body.totals.allTime);
    expect(body.bySource.allTime.reddit).toBe(1);
    expect(body.bySource.allTime.unattributed).toBe(0);
    expect(body.gaps).toEqual([...SIGNUP_SOURCE_GAPS]);
    expect(JSON.stringify(body)).not.toContain("token");
    expect(body.exclusionRule).toContain("is_admin");
    expect(body.exclusionRule).toContain("test and qa are null");
  });

  it("returns 500 without a database error payload when the loader fails", async () => {
    setSignupSourceLoaderForTests(async () => {
      throw Object.assign(new Error("relation users email secret@example.com"), { code: "42P01" });
    });
    const res = await fetch(`${base}/api/qa/signups`, { headers: { "X-QA-Token": TOKEN } });
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to load signup counts" });
    setSignupSourceLoaderForTests(async () => fixture);
  });
});

describe("signup route stays out of the client bundle", () => {
  it("is registered on the server and is not referenced under client/", async () => {
    const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
    const route = await readFile(new URL("../routes/signupQa.ts", import.meta.url), "utf8");
    expect(routes).toContain("registerSignupQaRoutes");
    expect(route).toContain('"/api/qa/signups"');
    expect(route).toContain("coverQaHeaderMatches");
    expect(route).not.toMatch(/req\.query/);

    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../client");
    const files = await listSourceFiles(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toContain("/api/qa/signups");
    }
  });
});

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|html|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
