import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("../services/opsAlert", () => ({ opsAlert: vi.fn(async () => true) }));

const hasDb = !!process.env.DATABASE_URL;
const CT_9AM = new Date("2026-10-20T14:00:00Z"); // 9:00 AM CDT, Tue

describe("Daily 5 X post copy and assets", async () => {
  const m = await import("../services/daily5XPost");
  it("names the set only when an approved image shows it", () => {
    const a = m.buildD5Post("2026-10-19", "352b33d1-c110-4e09-b641-8e3c02a94442", "1989 Topps");
    expect(a.named).toBe(true);
    expect(a.caption).toContain("Today's Daily 5 is 1989 Topps.");
    expect(a.caption).toContain("utm_campaign=d5_20261019&utm_content=daily5_1989_topps");
    const b = m.buildD5Post("2026-10-20", "affd57b8-2b1d-4ea3-9f51-1530d8088e5c", "1988 Topps Baseball");
    expect(b.named).toBe(false);
    expect(b.asset.file).toBe("d5-post-1080-B2.png");
    expect(b.caption).toContain("Today's Daily 5 is up.");
    const c = m.buildD5Post("2026-10-21", m.D5_GENERIC_ART_SET_ID, "1987 Topps");
    expect(c.named).toBe(true);
    for (const x of [a, b, c]) expect(x.caption).not.toMatch(/[\u2013\u2014]/);
  });
  it("vendored images match Design's approved sha256", () => {
    expect(() => m.loadApprovedAsset(m.D5_GENERIC_ASSET)).not.toThrow();
    for (const asset of Object.values(m.D5_SET_ASSETS)) expect(() => m.loadApprovedAsset(asset)).not.toThrow();
    expect(() => m.loadApprovedAsset({ ...m.D5_GENERIC_ASSET, sha256: "0".repeat(64) })).toThrow(/asset_not_approved/);
  });
  it("is off unless DAILY5_X_POST_ENABLED=true", async () => {
    delete process.env.DAILY5_X_POST_ENABLED;
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("disabled");
  });
});

describe.skipIf(!hasDb)("Daily 5 X post dedupe", async () => {
  const m = await import("../services/daily5XPost");
  const { pool } = await import("../db");
  const posts: string[] = [];
  let username = "PlayPackPTS";
  let timeline: string[] = [];
  let failPost = false;
  beforeAll(() => {
    process.env.DAILY5_X_POST_ENABLED = "true";
    m.setD5XDepsForTests({
      deal: async () => ({ setId: "352b33d1-c110-4e09-b641-8e3c02a94442", setName: "1989 Topps" }),
      client: async () => ({
        username: async () => username,
        todaysTexts: async () => timeline,
        post: async (text) => { if (failPost) throw new Error("x_down"); posts.push(text); return `t${posts.length}`; },
      }),
    });
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM daily5_x_posts");
    posts.length = 0; username = "PlayPackPTS"; timeline = []; failPost = false;
  });
  afterAll(() => { delete process.env.DAILY5_X_POST_ENABLED; m.setD5XDepsForTests(null); });

  it("waits for the post time", async () => {
    expect((await m.runDaily5XPost({ now: new Date("2026-10-20T12:30:00Z") })).status).toBe("too_early");
  });

  it("posts once even when several posters race", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => m.runDaily5XPost({ now: CT_9AM })));
    expect(results.filter((r) => r.status === "posted")).toHaveLength(1);
    expect(posts).toHaveLength(1);
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("not_mine");
    expect(await m.claimD5Day("2026-10-20", "box")).toBe(false);
  });

  it("box claim blocks the app", async () => {
    expect(await m.claimD5Day("2026-10-20", "box")).toBe(true);
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("not_mine");
    expect(posts).toHaveLength(0);
  });

  it("skips when today's post is already on X", async () => {
    timeline = ["Can you name all 5? Today's Daily 5 is up."];
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("skipped_existing");
    expect(posts).toHaveLength(0);
  });

  it("refuses the wrong account and alerts", async () => {
    username = "someoneelse";
    const r = await m.runDaily5XPost({ now: CT_9AM });
    expect(r.status).toBe("failed");
    expect(posts).toHaveLength(0);
    const { opsAlert } = await import("../services/opsAlert");
    expect(opsAlert).toHaveBeenCalledWith("d5_x_post_failed", expect.any(String), expect.stringContaining("wrong_account"));
  });

  it("a failed day is retried after the cool-off, at most 3 attempts", async () => {
    failPost = true;
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("failed");
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("not_mine"); // inside the 10 minute cool-off
    await pool.query("UPDATE daily5_x_posts SET claimed_at = now() - interval '11 minutes'");
    failPost = false;
    expect((await m.runDaily5XPost({ now: CT_9AM })).status).toBe("posted");
    const row = await m.d5XPostStatus("2026-10-20");
    expect(row?.attempts).toBe(2);
  });
});
