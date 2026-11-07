/**
 * Stage 1 attribution, deduped lifecycle events, and the protected aggregate.
 * No live database. Publisher queue columns are asserted unchanged.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFile } from "fs/promises";
import path from "path";
import express from "express";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPackptsDayKey } from "@shared/packptsDay";
import {
  buildGrowthStage1Report,
  buildStage1DestinationUrl,
  classifyContractCampaign,
  classifyGrowthTouch,
  isGrowthWindowMature,
  returnEventFor,
  stage1BioDailyUrl,
  STAGE1_1987_SET_PATH,
  type Stage1User,
} from "@shared/growthStage1";
import { growthInstrumentation, growthLifecycleEvents, igPostQueue } from "@shared/schema";
import {
  GROWTH_EVENT_INSERT_SQL,
  CHECKED_ACTIVITY_MAX,
  GROWTH_SIGNUP_INSERT_SQL,
  noteGrowthActivity,
  noteGrowthGameCompleted,
  recordGrowthSignup,
  setGrowthQueryableForTests,
  type GrowthQueryable,
} from "../services/growthStage1";
import { registerGrowthStage1Routes, setGrowthStage1AdminLookupForTests, setGrowthStage1LoaderForTests } from "../routes/growthStage1Qa";

const BASELINE = new Date("2026-10-01T05:00:00.000Z");
const SECRET_USER = "user-secret-9f3a";
const SECRET_EMAIL = "person@example.com";

function atCt(day: string, hour: number, minute = 0): Date {
  // November is CST (UTC-6). Date.UTC rolls hour 23+6 onto the next UTC morning.
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour + 6, minute));
}

function user(partial: Partial<Stage1User> & Pick<Stage1User, "id" | "createdAt">): Stage1User {
  return { signupEvent: null, ...partial };
}

describe("marketing contract classification", () => {
  it("accepts the clarified campaign and content sizes and does not remap lookalikes", () => {
    expect("261107-87topps".length).toBeLessThanOrEqual(16);
    expect(classifyContractCampaign("261107-87topps")).toBe("261107-87topps");
    expect(classifyContractCampaign("261107-daily5")).toBe("261107-daily5");
    expect("20261107-1987-topps".length).toBe(19);
    expect(classifyContractCampaign("20261107-1987-topps")).toBeNull();
    expect(classifyContractCampaign("261107-87Topps")).toBeNull();
    expect(classifyContractCampaign("261199-87topps")).toBeNull();
    expect(classifyContractCampaign("w3")).toBeNull();

    const supplied = classifyGrowthTouch({
      source: "Instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "ig-feed-w3-d4-hook-b",
      landingPage: STAGE1_1987_SET_PATH,
    });
    expect(supplied).toMatchObject({
      source: "instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "ig-feed-w3-d4-hook-b",
      attributable: true,
      reason: null,
      destination: STAGE1_1987_SET_PATH,
    });
    expect("ig-feed-w3-d4-hook-b".length).toBeLessThanOrEqual(40);

    expect(classifyGrowthTouch({ source: "fb", medium: "social", campaign: "261107-87topps", content: "post-a" })).toMatchObject({
      attributable: false,
      reason: "unrecognized",
      source: null,
    });
    expect(classifyGrowthTouch({ source: "facebook", medium: "feed", campaign: "w3", content: "42-A" })).toMatchObject({
      attributable: true,
      source: "facebook",
      medium: null,
      campaign: null,
      content: null,
      legacyMedium: "feed",
      legacyCampaign: "w3",
      legacyPublisherContent: true,
    });
    expect(classifyGrowthTouch({ medium: "reel", campaign: "ig_daily" })).toMatchObject({
      attributable: false,
      reason: "legacy",
      legacyMedium: "reel",
      legacyCampaign: "ig_daily",
    });
    expect(classifyGrowthTouch({ source: "email", medium: "lifecycle", campaign: "261107-daily5", content: "no-game-24h" })).toMatchObject({
      source: "email",
      medium: "lifecycle",
      attributable: true,
    });
    expect(classifyGrowthTouch({ source: "email", medium: "outreach", campaign: "261107-shops", content: "batch-a" }).medium).toBe("outreach");
    expect(classifyGrowthTouch({
      source: "instagram",
      medium: "social",
      content: "bio",
      referrerHost: "l.instagram.com",
      inferred: true,
    })).toMatchObject({ attributable: false, reason: "inferred_referrer", source: null });
    expect(classifyGrowthTouch({ landingPage: "/daily" })).toMatchObject({ attributable: false, reason: "direct" });
    expect(classifyGrowthTouch({})).toMatchObject({ attributable: false, reason: "missing" });
    expect(classifyGrowthTouch({ referrerHost: "google.com" })).toMatchObject({ attributable: false, reason: "referrer_only" });
    expect(classifyGrowthTouch({ source: "direct" })).toMatchObject({ attributable: false, reason: "direct" });
    expect(classifyGrowthTouch({ content: SECRET_EMAIL })).toMatchObject({ attributable: false, reason: "unrecognized", content: null });
  });

  it("allowlists /daily and set uuids and rejects the slug, open redirects, and non-contract tags", () => {
    expect(buildStage1DestinationUrl({
      path: STAGE1_1987_SET_PATH,
      source: "instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "ig-feed-w3-d4-hook-b",
    })).toBe(`https://packpts.com${STAGE1_1987_SET_PATH}?utm_source=instagram&utm_medium=social&utm_campaign=261107-87topps&utm_content=ig-feed-w3-d4-hook-b`);
    expect(stage1BioDailyUrl()).toMatch(/^https:\/\/packpts\.com\/daily\?/);
    expect(buildStage1DestinationUrl({
      path: "/sets/1987-topps",
      source: "instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "post-a",
    })).toBeNull();
    expect(buildStage1DestinationUrl({
      path: "https://evil.example/daily",
      source: "instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "post-a",
    })).toBeNull();
    expect(buildStage1DestinationUrl({
      path: "/daily",
      source: "instagram",
      medium: "feed",
      campaign: "w3",
      content: "42-A",
    })).toBeNull();
    expect(buildStage1DestinationUrl({
      path: "//evil.example",
      source: "bio",
      medium: "bio",
      campaign: "261107-daily5",
      content: "instagram-profile",
    })).toBeNull();
  });
});

describe("retention boundaries", () => {
  it("uses the next Chicago calendar day, not 24 hours, and does not backfill", () => {
    const late = atCt("2026-11-07", 23, 50);
    const afterMidnight = atCt("2026-11-08", 0, 10);
    expect(getPackptsDayKey(late)).toBe("2026-11-07");
    expect(getPackptsDayKey(afterMidnight)).toBe("2026-11-08");
    expect(returnEventFor("2026-11-07", "2026-11-08")).toBe("day1_return");
    expect(returnEventFor(getPackptsDayKey(late), getPackptsDayKey(afterMidnight))).toBe("day1_return");

    const early = atCt("2026-11-08", 0, 10);
    const sameNight = atCt("2026-11-08", 23, 0);
    expect(getPackptsDayKey(early)).toBe("2026-11-08");
    expect(getPackptsDayKey(sameNight)).toBe("2026-11-08");
    expect(returnEventFor("2026-11-08", "2026-11-08")).toBeNull();

    expect(returnEventFor("2026-11-07", "2026-11-09")).toBeNull();
    expect(returnEventFor("2026-11-01", "2026-11-08")).toBe("day7_return");
    expect(returnEventFor("2026-11-01", "2026-11-07")).toBeNull();
    expect(isGrowthWindowMature("2026-11-08", 1, "2026-11-10")).toBe(true);
    expect(isGrowthWindowMature("2026-11-09", 1, "2026-11-10")).toBe(false);
    expect(isGrowthWindowMature("2026-11-01", 7, "2026-11-10")).toBe(true);
    expect(isGrowthWindowMature("2026-11-04", 7, "2026-11-10")).toBe(false);
  });

  it("keeps immature signups out of the denominator and does not count a late first game in the rate", () => {
    const now = atCt("2026-11-10", 12);
    const report = buildGrowthStage1Report({
      now,
      baselineStartedAt: BASELINE,
      users: [
        user({
          id: "mature-played",
          createdAt: atCt("2026-11-03", 12),
          signupEvent: { occurredAt: atCt("2026-11-03", 12), source: "facebook", medium: "social", campaign: "261107-87topps", content: "post-a", landingPage: "/daily" },
          firstGameAt: atCt("2026-11-03", 18),
          day1At: atCt("2026-11-04", 9),
        }),
        user({
          id: "mature-late",
          createdAt: atCt("2026-11-03", 15),
          signupEvent: { occurredAt: atCt("2026-11-03", 15), source: "email", medium: "lifecycle", campaign: "261107-daily5", content: "no-game-24h" },
          firstGameAt: atCt("2026-11-12", 12),
        }),
        user({
          id: "d7",
          createdAt: atCt("2026-11-01", 12),
          signupEvent: { occurredAt: atCt("2026-11-01", 12), source: "x", medium: "social", campaign: "261101-daily5", content: "post-1" },
          day7At: atCt("2026-11-08", 12),
        }),
        user({
          id: "d7-miss",
          createdAt: atCt("2026-11-01", 13),
          signupEvent: { occurredAt: atCt("2026-11-01", 13), source: "tiktok", medium: "social", campaign: "261101-daily5", content: "post-2" },
          day7At: atCt("2026-11-09", 12),
        }),
        user({
          id: "immature",
          createdAt: atCt("2026-11-09", 12),
          signupEvent: { occurredAt: atCt("2026-11-09", 12), source: "bio", medium: "bio", campaign: "261109-daily5", content: "instagram-profile" },
          day1At: atCt("2026-11-10", 8),
          firstGameAt: atCt("2026-11-09", 13),
        }),
        user({
          id: "inferred",
          createdAt: atCt("2026-11-03", 16),
          signupEvent: { occurredAt: atCt("2026-11-03", 16), source: "instagram", medium: "social", content: "bio", inferred: true, referrerHost: "instagram.com" },
        }),
        user({
          id: "legacy",
          createdAt: atCt("2026-11-03", 17),
          signupEvent: { occurredAt: atCt("2026-11-03", 17), medium: "story", campaign: "w3", content: "7-B" },
        }),
        user({
          id: "long-campaign",
          createdAt: atCt("2026-11-03", 18),
          signupEvent: { occurredAt: atCt("2026-11-03", 18), source: "instagram", medium: "social", campaign: "20261107-1987-topps", content: SECRET_EMAIL, landingPage: "/sets/1987-topps" },
        }),
        user({
          id: "preexisting",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          signupEvent: null,
        }),
        user({
          id: "staff",
          createdAt: atCt("2026-11-03", 19),
          isAdmin: true,
          signupEvent: { occurredAt: atCt("2026-11-03", 19), source: "facebook", medium: "social", campaign: "261107-87topps", content: "post-a" },
        }),
        user({
          id: SECRET_USER,
          createdAt: atCt("2026-11-02", 12),
          signupEvent: null,
        }),
      ],
    });

    expect(report.timezone).toBe("America/Chicago");
    expect(report.lifecycleEmailSends).toBe("off");
    expect(report.bioHelper.installed).toBe(false);
    expect(report.destinations.set1987ToppsSlug).toBeNull();
    expect(report.destinations.set1987ToppsBaseball).toBe(STAGE1_1987_SET_PATH);
    expect(report.meetsCoverageTarget).toBe(false);
    expect(report.coverage).toBeLessThan(0.95);
    expect(report.totals.bySource).toMatchObject({ facebook: 1, instagram: 1, email: 1, tiktok: 1, x: 1, bio: 1 });
    expect(report.totals.byMedium.lifecycle).toBe(1);
    expect(report.totals.byMedium.outreach).toBe(0);
    expect(report.totals.unattributed.inferred_referrer).toBe(1);
    expect(report.totals.unattributed.legacy).toBe(1);
    expect(report.totals.unattributed.total + report.totals.attributable).toBe(report.totals.signups);
    expect(report.totals.legacyCampaign.w3).toBe(1);
    expect(report.totals.legacyMedium.story).toBe(1);
    expect(report.totals.legacyPublisherContent).toBe(1);
    expect(report.totals.destinations.daily).toBe(1);
    expect(report.totals.destinations.none).toBeGreaterThan(0);
    const campaigns = report.weeks.flatMap((week) => week.byCampaign.map((row) => row.campaign));
    expect(campaigns).toContain("261107-87topps");
    expect(campaigns).not.toContain("20261107-1987-topps");
    expect(campaigns).not.toContain("w3");

    const played = report.weeks.find((week) => week.weekStart === "2026-11-02");
    expect(played?.firstGame).toMatchObject({ recorded: 2, inWindow: 1, matureDenominator: 5 });
    expect(played?.firstGame.rate).toBe(1 / 5);
    expect(played?.d1).toMatchObject({ returned: 1, matureDenominator: 5 });

    const d7 = report.weeks.find((week) => week.d7.matureDenominator > 0);
    expect(d7?.d7).toMatchObject({ returned: 1, matureDenominator: 2, rate: 0.5 });

    const immature = report.weeks.find((week) => week.weekStart === "2026-11-09");
    expect(immature?.d1).toMatchObject({ returned: 0, matureDenominator: 0, rate: null });
    expect(immature?.signups).toBe(1);

    expect(report.diagnostics.usersMissingSignupEvent).toBe(1);
    expect(report.diagnostics.signupEventsOutsideCohort).toBe(1);
    expect(report.diagnostics.oneToOne).toBe(false);
    const body = JSON.stringify(report);
    expect(body).not.toContain(SECRET_USER);
    expect(body).not.toContain(SECRET_EMAIL);
    expect(body).not.toContain("user-secret");
  });
});

describe("signup event dedupe", () => {
  function store(): GrowthQueryable & { events: string[] } {
    const events: string[] = [];
    let chain = Promise.resolve();
    const queryable: GrowthQueryable & { events: string[] } = {
      events,
      async query(sql, params = []) {
        if (sql.includes("INSERT INTO growth_lifecycle_events")) {
          const id = String(params[0]);
          if (id === "old" || id === "staff") return { rows: [], rowCount: 0 };
          const signupInsert = sql.includes("AT TIME ZONE 'UTC'");
          const eventType = signupInsert ? "signup" : String(params[1]);
          if (!signupInsert && !events.includes(`${id}:signup`)) return { rows: [], rowCount: 0 };
          const key = `${id}:${eventType}`;
          const run = chain.then(() => {
            if (events.includes(key)) return { rows: [], rowCount: 0 };
            events.push(key);
            return { rows: [{ id: `evt-${events.length}` }], rowCount: 1 };
          });
          chain = run.then(() => undefined, () => undefined);
          return run;
        }
        if (sql.includes("AS has_event")) {
          const id = String(params[0]);
          return { rows: [{ has_event: events.includes(`${id}:signup`), should: id !== "old" && id !== "staff" }] };
        }
        if (sql.includes("activity_day")) {
          const id = String(params[0]);
          const signup = events.find((key) => key === `${id}:signup`);
          const at = params[1] instanceof Date ? params[1] : new Date();
          return { rows: signup ? [{ cohort_day: "2026-11-07", activity_day: getPackptsDayKey(at) }] : [] };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    return queryable;
  }

  it("inserts one signup for a new user and ignores retries, logins of old or staff users, and concurrent calls", async () => {
    expect(GROWTH_SIGNUP_INSERT_SQL).toContain("ON CONFLICT (user_id, event_type) DO NOTHING");
    expect(GROWTH_SIGNUP_INSERT_SQL).toContain("AT TIME ZONE 'UTC'");
    expect(GROWTH_SIGNUP_INSERT_SQL).toContain("AT TIME ZONE 'America/Chicago'");
    expect(GROWTH_EVENT_INSERT_SQL).toContain("ON CONFLICT (user_id, event_type) DO NOTHING");
    const db = store();
    setGrowthQueryableForTests(db);
    const first = await recordGrowthSignup("new-user", {
      source: "instagram",
      medium: "social",
      campaign: "261107-87topps",
      content: "ig-feed-w3-d4-hook-b",
      landingPage: STAGE1_1987_SET_PATH,
    }, "google");
    const retry = await recordGrowthSignup("new-user", { source: "facebook", medium: "social", campaign: "261107-other1", content: "post-b" }, "google");
    expect(first.inserted).toBe(true);
    expect(retry.inserted).toBe(false);
    expect(db.events.filter((key) => key.startsWith("new-user:"))).toEqual(["new-user:signup"]);

    expect((await recordGrowthSignup("old", { source: "facebook" }, "email")).inserted).toBe(false);
    expect((await recordGrowthSignup("staff", { source: "facebook" }, "email")).inserted).toBe(false);
    expect(db.events.some((key) => key.startsWith("old:") || key.startsWith("staff:"))).toBe(false);

    const raced = await Promise.all(Array.from({ length: 8 }, () => recordGrowthSignup("race-user", { source: "x", medium: "social", campaign: "261107-daily5", content: "post-1" }, "workos")));
    expect(raced.filter((row) => row.inserted)).toHaveLength(1);
    expect(db.events.filter((key) => key.startsWith("race-user:"))).toEqual(["race-user:signup"]);
  });

  it("records first completion and the exact return day once, and not a guest or a same-day revisit", async () => {
    const db = store();
    setGrowthQueryableForTests(db);
    await recordGrowthSignup("player", { source: "email", medium: "lifecycle", campaign: "261107-daily5", content: "welcome" }, "email");
    await noteGrowthGameCompleted(null);
    await noteGrowthGameCompleted("guest-never-signed-up");
    await noteGrowthGameCompleted("player", atCt("2026-11-07", 16));
    await noteGrowthGameCompleted("player", atCt("2026-11-08", 16));
    await noteGrowthActivity("player", atCt("2026-11-07", 18));
    await noteGrowthActivity("player", atCt("2026-11-08", 0, 10));
    await noteGrowthActivity("player", atCt("2026-11-08", 20));
    await noteGrowthActivity("player", atCt("2026-11-09", 12));
    await noteGrowthActivity("player", atCt("2026-11-14", 12));
    await noteGrowthActivity("player", atCt("2026-11-14", 18));
    expect(db.events.filter((key) => key.startsWith("player:")).sort()).toEqual([
      "player:day1_return",
      "player:day7_return",
      "player:first_game_completed",
      "player:signup",
    ]);
    expect(db.events.some((key) => key.startsWith("guest-never-signed-up:"))).toBe(false);
  });
});

describe("GET /api/qa/growth/stage1", () => {
  const TOKEN = "stage1-qa-token";
  const previous = process.env.COVER_QA_TOKEN;
  let base = "";
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    setGrowthStage1LoaderForTests(async () => buildGrowthStage1Report({
      now: atCt("2026-11-10", 12),
      baselineStartedAt: BASELINE,
      users: [user({
        id: SECRET_USER,
        createdAt: atCt("2026-11-03", 12),
        signupEvent: {
          occurredAt: atCt("2026-11-03", 12),
          source: "newsletter",
          medium: "social",
          campaign: "261107-87topps",
          content: SECRET_EMAIL,
        },
      })],
    }));
    setGrowthStage1AdminLookupForTests(async (id) => id === "admin-1");
    const app = express();
    app.use((req, _res, next) => {
      const actor = req.get("x-test-user");
      (req as express.Request & { session?: { localUserId?: string } }).session = actor ? { localUserId: actor } : {};
      next();
    });
    registerGrowthStage1Routes(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setGrowthStage1LoaderForTests(null);
    setGrowthStage1AdminLookupForTests(null);
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await new Promise((resolve) => server.close(resolve));
  });

  it("rejects missing and wrong tokens and a query token, and returns counts to QA or admin", async () => {
    expect((await fetch(`${base}/api/qa/growth/stage1`)).status).toBe(401);
    expect((await fetch(`${base}/api/qa/growth/stage1`, { headers: { "X-QA-Token": "nope" } })).status).toBe(401);
    expect((await fetch(`${base}/api/qa/growth/stage1?token=${TOKEN}`)).status).toBe(401);

    const qa = await fetch(`${base}/api/qa/growth/stage1`, { headers: { "X-QA-Token": TOKEN } });
    expect(qa.status).toBe(200);
    const body = await qa.json();
    expect(body.timezone).toBe("America/Chicago");
    expect(body.totals.bySource.instagram).toBe(0);
    expect(body.totals.unattributed.unrecognized).toBe(1);

    const member = await fetch(`${base}/api/qa/growth/stage1`, { headers: { "x-test-user": "member-1" } });
    expect(member.status).toBe(401);
    const admin = await fetch(`${base}/api/qa/growth/stage1`, { headers: { "x-test-user": "admin-1" } });
    expect(admin.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(SECRET_EMAIL);
    expect(JSON.stringify(body)).not.toContain(SECRET_USER);
    expect(body.integrationGaps.join("\n")).toMatch(/varchar\(16\)|utm_campaign is varchar\(16\)|not widened/);
    expect(body.bioHelper.installed).toBe(false);
  });
});

describe("stage 1 stays off the publisher and on every registration path", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => readFile(path.join(root, file), "utf8");

  it("keeps the queue column sizes and declares the new tables for drizzle push", async () => {
    const schema = await read("shared/schema.ts");
    expect(schema).toContain('utmCampaign: varchar("utm_campaign", { length: 16 })');
    expect(schema).toContain('utmContent: varchar("utm_content", { length: 40 })');
    expect(getTableConfig(igPostQueue).name).toBe("ig_post_queue");
    expect(getTableConfig(growthLifecycleEvents).name).toBe("growth_lifecycle_events");
    expect(getTableConfig(growthInstrumentation).name).toBe("growth_instrumentation");
    const unique = getTableConfig(growthLifecycleEvents).indexes.find((index) => index.config.name === "uq_growth_lifecycle_user_event");
    expect(unique?.config.unique).toBe(true);

    const publisher = await read("server/services/igPublish.ts");
    expect(publisher).toContain("rowUtmContent(row.id, row.variant)");
    expect(publisher).not.toContain("buildStage1DestinationUrl");
    expect(publisher).not.toContain("growth_lifecycle_events");
  });

  it("wires signup, completion, and return on the server and not on login-as-signup", async () => {
    const attribution = await read("server/lib/signupAttribution.ts");
    expect(attribution).toContain("recordGrowthSignup");
    const routes = await read("server/routes.ts");
    const login = routes.slice(routes.indexOf('app.post("/api/auth/local-login"'), routes.indexOf('app.get("/api/guest/pending-points"'));
    expect(login).not.toContain("recordGrowthSignup");
    expect(login).not.toContain("applySignupAttribution");
    expect(login).toContain("noteGrowthActivity");
    expect(routes).toContain("noteGrowthGameCompleted");
    const workos = await read("server/services/workosAuth.ts");
    expect(workos).toContain('applySignupAttribution(newUser.id, stashedAttribution, "WorkOS"');
    expect(workos).toContain("readSessionAttribution");
    const apple = await read("server/routes/ios.routes.ts");
    expect(apple).toContain('"apple"');
    expect(apple).toContain("noteGrowthActivity");
    const claim = await read("server/services/anonIdentity.ts");
    expect(claim).not.toContain("recordGrowthSignup");
    expect(claim).not.toContain("noteGrowthGameCompleted");
    const app = await read("client/src/App.tsx");
    expect(app).not.toContain("/api/qa/growth/stage1");
  });
});
