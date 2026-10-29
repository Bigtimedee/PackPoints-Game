/**
 * Instagram publisher. Graph API is mocked. No live database and no token logs.
 */
import { createHash } from "crypto";
import { createServer } from "http";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import path from "path";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerIgRoutes } from "../routes/igPublish";
import {
  IG_SLOT_DEFAULTS,
  IgGraphError,
  buildIgCaption,
  createMemoryStore,
  defaultGraph,
  IG_TRIAL_PARAMS,
  enqueueApprovedSlots,
  enqueueIgPost,
  graphMediaFields,
  igBioRedirectUrl,
  igBioTarget,
  igCredsReady,
  igGraphHost,
  igGraphVersion,
  logIg,
  mediaMatchesKind,
  migrateQueuedRows,
  parseCreativeName,
  publishIg,
  queueParsedCreatives,
  readAllowlistFile,
  runIgDaily,
  updateQueuedRow,
  runInsightSync,
  setIgDepsForTests,
  slotMinutes,
  creativePlan,
  contentDate,
  ctWallTime,
  planCreatives,
  selectDueRows,
  type IgGraph,
  type IgMediaFields,
  type IgStore,
} from "../services/igPublish";
import { igQueueJson } from "../routes/igPublish";
import { dryRunFb } from "../services/fbPublish";

const TOKEN = "ig-qa-token";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x51, 0x41]);
const VIDEO = Buffer.from("packpts-reel-bytes-v1");
const STORY = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x53, 0x54]);

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function armedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IG_PUBLISH_ENABLED: "true",
    IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
    IG_USER_ID: "17890001",
    FB_PAGE_ID: "111222333",
    ...extra,
  };
}

function fakeGraph(over: Partial<IgGraph> = {}): IgGraph & { calls: IgMediaFields[]; publishes: number } {
  const calls: IgMediaFields[] = [];
  let publishes = 0;
  const graph: IgGraph & { calls: IgMediaFields[]; publishes: number } = {
    calls,
    get publishes() { return publishes; },
    pageInstagramId: async () => "17890001",
    publishingLimit: async () => ({ usage: 0, total: 50 }),
    createMedia: async (fields) => {
      calls.push(fields);
      return "container-1";
    },
    containerStatus: async () => "FINISHED",
    publishMedia: async () => {
      publishes += 1;
      return "media-1";
    },
    ...over,
  };
  return graph;
}

describe("instagram copy, slots, and allowlist", () => {
  it("says link in bio and rejects a raw url or a dash", () => {
    expect(buildIgCaption("Can you name all 5?")).toBe("Can you name all 5? Link in bio.");
    expect(buildIgCaption("Already has a link in bio")).toBe("Already has a link in bio");
    expect(buildIgCaption("")).toBe("Link in bio.");
    expect(buildIgCaption("Line  one.\r\n  Line   two.\n\n\n\nPlay free, link in bio.\n#a  #b  ")).toBe("Line one.\nLine two.\n\nPlay free, link in bio.\n#a #b");
    expect(buildIgCaption("One.\nTwo.")).toBe("One.\nTwo. Link in bio.");
    expect(() => buildIgCaption("Play at https://packpts.com")).toThrow(/copy_rule/);
    expect(() => buildIgCaption("Today\u2019s game \u2014 free")).toThrow(/copy_rule/);
    expect(igBioRedirectUrl("feed-d1")).toBe(
      "https://packpts.com/?utm_source=instagram&utm_medium=social&utm_campaign=ig_daily&utm_content=feed-d1",
    );
  });

  it("defaults feed, reel, and story to 11:00, 18:00, and 21:00 CT", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(IG_SLOT_DEFAULTS).toEqual({ FEED: "11:00", REEL: "18:00", STORY: "21:00", PHOTO: "07:30", LINK: "13:30" });
    expect(slotMinutes("FEED", env)).toBe(11 * 60);
    expect(slotMinutes("REEL", env)).toBe(18 * 60);
    expect(slotMinutes("STORY", env)).toBe(21 * 60);
    expect(slotMinutes("PHOTO", env)).toBe(7 * 60 + 30);
    expect(slotMinutes("LINK", env)).toBe(13 * 60 + 30);
    expect(slotMinutes("FEED", { IG_FEED_AT_CT: "12:30" } as NodeJS.ProcessEnv)).toBe(12 * 60 + 30);
    expect(slotMinutes("FEED", { IG_FEED_AT_CT: "nope" } as NodeJS.ProcessEnv)).toBe(11 * 60);
  });

  it("uses graph.instagram.com and does not require a page id", async () => {
    expect(igGraphHost({} as NodeJS.ProcessEnv)).toBe("graph.instagram.com");
    expect(igGraphVersion({} as NodeJS.ProcessEnv)).toBe("v21.0");
    expect(igGraphHost({ IG_GRAPH_HOST: "graph.facebook.com" } as NodeJS.ProcessEnv)).toBe("graph.facebook.com");
    expect(igGraphVersion({ IG_GRAPH_VERSION: "v22.0" } as NodeJS.ProcessEnv)).toBe("v22.0");
    expect(igCredsReady({ IG_ACCESS_TOKEN: "tok-123456", IG_USER_ID: "99" } as NodeJS.ProcessEnv)).toBe(true);
    expect(igCredsReady({ IG_ACCESS_TOKEN: "tok-123456" } as NodeJS.ProcessEnv)).toBe(false);
    const urls: string[] = [];
    setIgDepsForTests({
      env: {
        IG_ACCESS_TOKEN: "tok-123456",
        IG_USER_ID: "99",
        IG_GRAPH_HOST: "graph.instagram.com",
        IG_GRAPH_VERSION: "v22.0",
      },
      fetch: async (input, init) => {
        urls.push(String(input));
        const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
        expect(String(input)).not.toContain("tok-123456");
        expect(body).toContain("access_token=tok-123456");
        return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
      },
    });
    expect(await defaultGraph().createMedia({ image_url: "https://packpts.com/social/ig/a.jpg", caption: "Link in bio." })).toBe("c1");
    expect(urls).toEqual(["https://graph.instagram.com/v22.0/99/media"]);
    setIgDepsForTests(null);
  });

  it("rejects a png for feed and story images", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(mediaMatchesKind("FEED", "feed.png", png)).toBe(false);
    expect(mediaMatchesKind("STORY", "story.png", png)).toBe(false);
    expect(mediaMatchesKind("STORY", "story-d1.jpg", STORY)).toBe(true);
    expect(mediaMatchesKind("REEL", "reel-d1.mp4", VIDEO)).toBe(true);
  });

  it("mirrors the committed creative hashes and leaves pngs out", () => {
    const dir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const file = path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json");
    const names = readdirSync(dir).filter((name) => !name.startsWith("."));
    expect(names.filter((name) => name.endsWith(".png"))).toEqual([]);
    expect(names.filter((name) => name.endsWith(".jpg"))).toHaveLength(70);
    expect(names.filter((name) => name.endsWith(".mp4"))).toHaveLength(57);
    expect(names.filter((name) => parseCreativeName(name) != null)).toHaveLength(84);
    expect(names).toContain("feed-swap-row6-765.jpg");
    const hashes = names.map((name) => sha(readFileSync(path.join(dir, name))));
    expect(new Set(hashes).size).toBe(127);
    expect(readAllowlistFile(file)).toEqual(new Set(hashes));
  });

  it("ships a hash-only allowlist", () => {
    const file = path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(Array.isArray(raw)).toBe(true);
    expect(readAllowlistFile(file)).toEqual(new Set(raw.map((item: string) => item.toLowerCase())));
    const bad = path.join(tmpdir(), `ig-allow-${process.pid}.json`);
    writeFileSync(bad, JSON.stringify([{ file: "fallback.jpg", sha256: "a".repeat(64) }]));
    expect(readAllowlistFile(bad).size).toBe(0);
  });

  it("builds feed, reel, and story fields without a fallback url", () => {
    expect(graphMediaFields("FEED", "feed-d1.jpg", "Link in bio.", "https://packpts.com/social/ig/feed-d1.jpg")).toEqual({
      image_url: "https://packpts.com/social/ig/feed-d1.jpg",
      caption: "Link in bio.",
    });
    expect(graphMediaFields("REEL", "reel-d1.mp4", "Link in bio.", "https://packpts.com/social/ig/reel-d1.mp4")).toEqual({
      media_type: "REELS",
      video_url: "https://packpts.com/social/ig/reel-d1.mp4",
      caption: "Link in bio.",
      share_to_feed: "true",
    });
    expect(graphMediaFields("STORY", "story-d1.jpg", "Link in bio.", "https://packpts.com/social/ig/story-d1.jpg")).toEqual({
      media_type: "STORIES",
      image_url: "https://packpts.com/social/ig/story-d1.jpg",
    });
    expect(graphMediaFields("STORY", "story-d1.mp4", "Link in bio.", "https://packpts.com/social/ig/story-d1.mp4")).toEqual({
      media_type: "STORIES",
      video_url: "https://packpts.com/social/ig/story-d1.mp4",
    });
    expect(graphMediaFields("REEL", "reel-d1.mp4", "Link in bio.", "https://packpts.com/social/ig/reel-d1.mp4", { trial: true })).toEqual({
      media_type: "REELS",
      video_url: "https://packpts.com/social/ig/reel-d1.mp4",
      caption: "Link in bio.",
      trial_params: JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }),
    });
    expect(graphMediaFields("STORY", "story-d1.jpg", "Link in bio.", "https://packpts.com/social/ig/story-d1.jpg", { trial: true }).trial_params).toBeUndefined();
  });

  it("never logs the access token", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setIgDepsForTests({ env: armedEnv() });
    logIg("error", "failed ig-secret-token-do-not-log access_token=ig-secret-token-do-not-log");
    const line = spy.mock.calls.flat().join(" ");
    expect(line).not.toContain("ig-secret-token-do-not-log");
    expect(line).toContain("[redacted]");
    spy.mockRestore();
    setIgDepsForTests(null);
  });
});

describe("instagram publish", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ig-pub-"));
  let store: IgStore;
  const sleeps: number[] = [];

  beforeAll(() => {
    writeFileSync(path.join(dir, "feed-d1.jpg"), JPEG);
    writeFileSync(path.join(dir, "reel-d1.mp4"), VIDEO);
    writeFileSync(path.join(dir, "story-d1.jpg"), STORY);
    writeFileSync(path.join(dir, "note.txt"), Buffer.from("not-an-image"));
  });

  afterEach(() => {
    setIgDepsForTests(null);
    sleeps.length = 0;
  });

  function use(graph: IgGraph, allowlist = new Set([sha(JPEG), sha(VIDEO), sha(STORY)]), env = armedEnv()) {
    store = createMemoryStore();
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist,
      env,
      sleep: async (ms) => { sleeps.push(ms); },
      pollMax: 3,
    });
  }

  async function queueFeed(when = "2026-10-23T15:00:00.000Z") {
    return enqueueIgPost({
      kind: "FEED",
      mediaPath: "feed-d1.jpg",
      caption: "Can you name all 5?",
      scheduledFor: when,
      approvalHash: sha(JPEG),
      utmContent: "feed-d1",
    });
  }

  it("refuses a queue row whose approval hash is missing or not the file", async () => {
    use(fakeGraph());
    await expect(enqueueIgPost({
      kind: "FEED", mediaPath: "feed-d1.jpg", caption: "Hi", scheduledFor: "2026-10-23T15:00:00.000Z", approvalHash: "",
    })).rejects.toThrow(/approval_hash_required/);
    await expect(enqueueIgPost({
      kind: "FEED", mediaPath: "feed-d1.jpg", caption: "Hi", scheduledFor: "2026-10-23T15:00:00.000Z", approvalHash: "ab".repeat(32),
    })).rejects.toThrow(/hash_mismatch|hash_not_approved/);
    expect(await store.list()).toHaveLength(0);
  });

  it("marks the slot skipped when the hash is not on the allowlist and does not substitute a file", async () => {
    const graph = fakeGraph();
    use(graph);
    const row = await queueFeed();
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set(),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 3,
    });
    const result = await publishIg(row.id);
    expect(result.status).toBe("skipped");
    expect(result.error).toBe("hash_not_approved");
    expect(graph.calls).toHaveLength(0);
    expect(graph.publishes).toBe(0);
    const saved = await store.get(row.id);
    expect(saved?.status).toBe("skipped");
    expect(saved?.mediaPath).toBe("feed-d1.jpg");
    const daily = await runIgDaily(new Date("2026-10-23T16:00:00.000Z"));
    expect(daily.results ?? []).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
  });

  it("publishes a feed once, then does not create another container", async () => {
    const graph = fakeGraph({
      containerStatus: async () => "FINISHED",
    });
    let polls = 0;
    graph.containerStatus = async () => {
      polls += 1;
      return polls === 1 ? "IN_PROGRESS" : "FINISHED";
    };
    use(graph);
    const row = await queueFeed();
    const [first, second] = await Promise.all([publishIg(row.id), publishIg(row.id)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["already_published", "published"]);
    expect(graph.calls).toEqual([{
      image_url: "https://packpts.com/social/ig/feed-d1.jpg",
      caption: "Can you name all 5? Link in bio.",
    }]);
    expect(graph.publishes).toBe(1);
    expect((await store.get(row.id))?.igMediaId).toBe("media-1");
    const again = await publishIg(row.id);
    expect(again.status).toBe("already_published");
    expect(graph.publishes).toBe(1);
  });

  it("sends reel and story media types", async () => {
    const graph = fakeGraph();
    use(graph);
    const reel = await enqueueIgPost({
      kind: "REEL", mediaPath: "reel-d1.mp4", caption: "Tonight's Reel", scheduledFor: "2026-10-23T15:00:00.000Z",
      approvalHash: sha(VIDEO), utmContent: "reel-d1",
    });
    expect((await publishIg(reel.id)).status).toBe("published");
    const story = await enqueueIgPost({
      kind: "STORY", mediaPath: "story-d1.jpg", caption: "Story", scheduledFor: "2026-10-23T15:00:00.000Z",
      approvalHash: sha(STORY), utmContent: "story-d1",
    });
    expect((await publishIg(story.id)).status).toBe("published");
    expect(graph.calls[0]).toMatchObject({ media_type: "REELS", video_url: "https://packpts.com/social/ig/reel-d1.mp4" });
    expect(graph.calls[1]).toEqual({ media_type: "STORIES", image_url: "https://packpts.com/social/ig/story-d1.jpg" });
  });

  it("stops at the 50 post limit without marking the row failed", async () => {
    const graph = fakeGraph({ publishingLimit: async () => ({ usage: 50, total: 50 }) });
    use(graph);
    const row = await queueFeed();
    const result = await publishIg(row.id);
    expect(result.status).toBe("limit");
    expect(graph.calls).toHaveLength(0);
    expect((await store.get(row.id))?.status).toBe("queued");
  });

  it("retries a transient graph error, then marks the post failed and leaves it", async () => {
    let creates = 0;
    const graph = fakeGraph({
      createMedia: async () => {
        creates += 1;
        throw new IgGraphError("graph_503", 503, true);
      },
    });
    use(graph);
    const row = await queueFeed();
    const failed = await publishIg(row.id);
    expect(failed.status).toBe("failed");
    expect(creates).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect((await store.get(row.id))?.status).toBe("failed");
    const daily = await runIgDaily(new Date("2026-10-23T16:00:00.000Z"));
    expect(daily.results ?? []).toHaveLength(0);
    expect(creates).toBe(3);
  });

  it("does not retry a permanent graph error", async () => {
    let creates = 0;
    const graph = fakeGraph({
      createMedia: async () => {
        creates += 1;
        throw new IgGraphError(`bad image ig-secret-token-do-not-log`, 400, false);
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    use(graph);
    const row = await queueFeed();
    const failed = await publishIg(row.id);
    expect(failed.status).toBe("failed");
    expect(creates).toBe(1);
    expect(failed.error).not.toContain("ig-secret-token-do-not-log");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("ig-secret-token-do-not-log");
    spy.mockRestore();
  });

  it("waits for the CT slot and publishes one feed", async () => {
    const graph = fakeGraph();
    use(graph);
    await queueFeed();
    const early = await runIgDaily(new Date("2026-10-23T15:59:00.000Z"));
    expect(early.status).toBe("ran");
    expect(early.results).toEqual([]);
    expect(graph.calls).toHaveLength(0);
    const onTime = await runIgDaily(new Date("2026-10-23T16:00:00.000Z"));
    expect(onTime.results?.map((item) => item.status)).toEqual(["published"]);
    expect(graph.calls).toHaveLength(1);
    const later = await runIgDaily(new Date("2026-10-23T17:00:00.000Z"));
    expect(later.results).toEqual([]);
    expect(graph.publishes).toBe(1);
  });

  it("catches up one missed day and leaves the next day queued", async () => {
    const graph = fakeGraph();
    const at = { now: new Date("2026-10-23T16:00:00.000Z") };
    use(graph);
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set([sha(JPEG), sha(VIDEO), sha(STORY)]),
      env: armedEnv(),
      sleep: async (ms) => { sleeps.push(ms); },
      pollMax: 3,
      now: () => at.now,
    });
    await queueFeed("2026-10-22T16:00:00.000Z");
    await enqueueIgPost({
      kind: "FEED", mediaPath: "feed-d1.jpg", caption: "Can you name all 5?",
      scheduledFor: "2026-10-23T16:00:00.000Z", approvalHash: sha(JPEG), utmContent: "feed-d2",
    });
    const first = await runIgDaily(at.now);
    expect(first.results?.map((item) => item.utmContent ?? item.status)).toEqual(["published"]);
    expect((await store.list()).find((row) => row.mediaPath === "feed-d1.jpg" && row.scheduledFor.toISOString() === "2026-10-22T16:00:00.000Z")?.status).toBe("published");
    at.now = new Date("2026-10-23T17:00:00.000Z");
    const second = await runIgDaily(at.now);
    expect(second.results).toEqual([]);
    expect(graph.publishes).toBe(1);
    at.now = new Date("2026-10-24T16:00:00.000Z");
    const nextDay = await runIgDaily(at.now);
    expect(nextDay.results?.map((item) => item.status)).toEqual(["published"]);
    expect((await store.list()).find((row) => row.mediaPath === "feed-d1.jpg" && row.scheduledFor.toISOString() === "2026-10-23T16:00:00.000Z")?.status).toBe("published");
    expect(graph.publishes).toBe(2);
  });

  it("does not publish a row whose scheduled time is still in the future", async () => {
    const graph = fakeGraph();
    use(graph);
    const row = await queueFeed("2026-10-30T16:00:00.000Z");
    const ran = await runIgDaily(new Date("2026-10-29T17:00:00.000Z"));
    expect(ran.status).toBe("ran");
    expect(ran.results ?? []).toEqual([]);
    expect(graph.calls).toHaveLength(0);
    expect((await store.get(row.id))?.status).toBe("queued");
  });

  it("honors a later feed slot", async () => {
    const graph = fakeGraph();
    use(graph, new Set([sha(JPEG), sha(VIDEO), sha(STORY)]), armedEnv({ IG_FEED_AT_CT: "12:00" }));
    await queueFeed();
    const atEleven = await runIgDaily(new Date("2026-10-23T16:00:00.000Z"));
    expect(atEleven.results).toEqual([]);
    const atNoon = await runIgDaily(new Date("2026-10-23T17:00:00.000Z"));
    expect(atNoon.results?.map((item) => item.status)).toEqual(["published"]);
  });

  it("publishes without FB_PAGE_ID on the Instagram host", async () => {
    let pageChecks = 0;
    const graph = fakeGraph({
      pageInstagramId: async () => {
        pageChecks += 1;
        throw new Error("no page");
      },
    });
    use(graph, new Set([sha(JPEG)]), { ...armedEnv(), FB_PAGE_ID: "" });
    const row = await queueFeed();
    expect((await publishIg(row.id)).status).toBe("published");
    expect(pageChecks).toBe(0);
  });

  it("checks the linked page only on graph.facebook.com", async () => {
    const graph = fakeGraph({ pageInstagramId: async () => "other-account" });
    use(graph, new Set([sha(JPEG)]), armedEnv({ IG_GRAPH_HOST: "graph.facebook.com" }));
    const row = await queueFeed();
    expect((await publishIg(row.id)).status).toBe("wrong_account");
    expect(graph.calls).toHaveLength(0);
  });

  it("does not queue a png story", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(path.join(dir, "story.png"), png);
    const graph = fakeGraph();
    use(graph, new Set([sha(png), sha(JPEG), sha(VIDEO), sha(STORY)]));
    await expect(enqueueIgPost({
      kind: "STORY", mediaPath: "story.png", caption: "Story", scheduledFor: "2026-10-23T15:00:00.000Z",
      approvalHash: sha(png), utmContent: "story-png",
    })).rejects.toThrow(/media_kind_mismatch/);
    expect(await store.list()).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
  });

  it("does nothing when the flag or credentials are missing", async () => {
    const graph = fakeGraph();
    use(graph, new Set([sha(JPEG)]), { ...armedEnv(), IG_PUBLISH_ENABLED: "false" });
    await queueFeed();
    expect((await runIgDaily(new Date("2026-10-23T16:00:00.000Z"))).status).toBe("disabled");
    use(graph, new Set([sha(JPEG)]), { IG_PUBLISH_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect((await runIgDaily(new Date("2026-10-23T16:00:00.000Z"))).status).toBe("not_armed");
    expect(graph.calls).toHaveLength(0);
  });

  it("dry run does not publish or skip", async () => {
    const graph = fakeGraph();
    use(graph);
    const row = await queueFeed();
    const dry = await publishIg(row.id, { dryRun: true });
    expect(dry.status).toBe("dry_run");
    expect(dry.wouldSkip).toBe(false);
    expect(dry.graph?.image_url).toContain("/social/ig/feed-d1.jpg");
    expect(dry.caption).toContain("Link in bio.");
    expect(dry.caption).not.toMatch(/https?:\/\/|packpts\.com/);
    expect((await store.get(row.id))?.status).toBe("queued");
    expect(graph.calls).toHaveLength(0);
  });

  it("posts both story clocks and both reel clocks on the same CT day", async () => {
    const graph = fakeGraph();
    use(graph);
    const morning = ctWallTime("2026-10-31", 7, 30);
    const evening = ctWallTime("2026-10-31", 21, 0);
    const trialAt = ctWallTime("2026-10-31", 13, 30);
    const reelAt = ctWallTime("2026-10-31", 18, 0);
    await enqueueIgPost({
      kind: "STORY", mediaPath: "story-d1.jpg", caption: "Morning", scheduledFor: morning,
      approvalHash: sha(STORY), utmContent: "story-am",
    });
    await enqueueIgPost({
      kind: "STORY", mediaPath: "story-d1.jpg", caption: "Evening", scheduledFor: evening,
      approvalHash: sha(STORY), utmContent: "story-pm",
    });
    const laterStory = await enqueueIgPost({
      kind: "STORY", mediaPath: "story-d1.jpg", caption: "Later", scheduledFor: ctWallTime("2026-11-02", 21, 0),
      approvalHash: sha(STORY), utmContent: "story-later",
    });
    const trial = await enqueueIgPost({
      kind: "REEL", mediaPath: "reel-d1.mp4", caption: "Trial", scheduledFor: trialAt,
      approvalHash: sha(VIDEO), utmContent: "reel-trial", trial: true, variant: "A",
    });
    await enqueueIgPost({
      kind: "REEL", mediaPath: "reel-d1.mp4", caption: "Evening reel", scheduledFor: reelAt,
      approvalHash: sha(VIDEO), utmContent: "reel-eve", trial: false, variant: "B",
    });
    const futureReel = await enqueueIgPost({
      kind: "REEL", mediaPath: "reel-d1.mp4", caption: "Future", scheduledFor: ctWallTime("2026-11-02", 18, 0),
      approvalHash: sha(VIDEO), utmContent: "reel-future",
    });
    const early = await runIgDaily(morning);
    expect(early.results?.map((item) => item.status)).toEqual(["published"]);
    expect((await store.get(laterStory.id))?.status).toBe("queued");
    const atReels = await runIgDaily(reelAt);
    expect(atReels.results?.map((item) => item.status)).toEqual(["published", "published"]);
    const atEvening = await runIgDaily(evening);
    expect(atEvening.results?.map((item) => item.status)).toEqual(["published"]);
    expect(graph.calls.filter((call) => call.media_type === "STORIES")).toHaveLength(2);
    const reels = graph.calls.filter((call) => call.media_type === "REELS");
    expect(reels).toHaveLength(2);
    expect(reels[0]?.trial_params).toBe(JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }));
    expect(reels[1]?.trial_params).toBeUndefined();
    expect((await store.get(trial.id))?.trial).toBe(true);
    expect((await store.get(futureReel.id))?.status).toBe("queued");
    expect((await store.get(laterStory.id))?.status).toBe("queued");
    expect(graph.publishes).toBe(4);
  });
});

describe("instagram http routes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ig-http-"));
  const app = express();
  app.use(express.json());
  registerIgRoutes(app);
  const server = createServer(app);
  let base = "";
  const previous = process.env.COVER_QA_TOKEN;

  beforeAll(async () => {
    writeFileSync(path.join(dir, "feed-d1.jpg"), JPEG);
    writeFileSync(path.join(dir, "other.jpg"), Buffer.concat([JPEG, Buffer.from("other")]));
    process.env.COVER_QA_TOKEN = TOKEN;
    const store = createMemoryStore();
    setIgDepsForTests({
      store,
      graph: fakeGraph(),
      mediaDir: dir,
      allowlist: new Set([sha(JPEG)]),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 2,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    setIgDepsForTests(null);
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("serves approved bytes unchanged and hides an unapproved file", async () => {
    const ok = await fetch(`${base}/social/ig/feed-d1.jpg`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    const body = Buffer.from(await ok.arrayBuffer());
    expect(body.equals(JPEG)).toBe(true);
    const hidden = await fetch(`${base}/social/ig/other.jpg`);
    expect(hidden.status).toBe(404);
    expect(Buffer.from(await hidden.arrayBuffer()).equals(Buffer.concat([JPEG, Buffer.from("other")]))).toBe(false);
    const escape = await fetch(`${base}/social/ig/..%2F..%2Fpackage.json`);
    expect(escape.status).toBe(404);
    const source = readFileSync(path.join(process.cwd(), "server", "routes", "igPublish.ts"), "utf8");
    expect(source).not.toMatch(/sharp|jimp|imagemagick|ffmpeg|pngquant/);
  });

  it("requires the QA token, enqueues, dry-runs, and redirects /ig to the latest post", async () => {
    const denied = await fetch(`${base}/api/qa/ig/queue`);
    expect(denied.status).toBe(401);
    const created = await fetch(`${base}/api/qa/ig/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qa-token": TOKEN },
      body: JSON.stringify({
        kind: "FEED",
        mediaPath: "feed-d1.jpg",
        caption: "Morning feed",
        scheduledFor: "2026-10-23T15:00:00.000Z",
        approvalHash: sha(JPEG),
        utmContent: "feed-d1",
      }),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()).item;
    expect(item.caption).toBe("Morning feed Link in bio.");
    expect(item.caption).not.toMatch(/https?:\/\//);
    const listed = await fetch(`${base}/api/qa/ig/queue`, { headers: { "x-qa-token": TOKEN } });
    expect(listed.status).toBe(200);
    expect((await listed.json()).items.map((entry: { id: number }) => entry.id)).toContain(item.id);
    const dry = await fetch(`${base}/api/qa/ig/dry-run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qa-token": TOKEN },
      body: JSON.stringify({ id: item.id }),
    });
    expect(dry.status).toBe(200);
    expect((await dry.json()).status).toBe("dry_run");
    const published = await fetch(`${base}/api/qa/ig/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qa-token": TOKEN },
      body: JSON.stringify({ id: item.id }),
    });
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe("published");
    const bio = await fetch(`${base}/ig`, { redirect: "manual" });
    expect(bio.status).toBe(302);
    expect(item.utmContent).toBe(`${item.id}-A`);
    expect(item.platform).toBe("ig");
    expect(item.variant).toBeNull();
    expect(item.trial).toBe(false);
    expect(item.insights).toBeNull();
    expect(bio.headers.get("location")).toBe(igBioRedirectUrl(item.utmContent));
    const override = await fetch(`${base}/ig?c=reel-d9`, { redirect: "manual" });
    expect(override.headers.get("location")).toBe(igBioRedirectUrl("reel-d9"));
    const bad = await fetch(`${base}/ig?c=https://evil.example`, { redirect: "manual" });
    expect(bad.status).toBe(400);
  });
});

function ctLabel(d: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

describe("approved creative queue", () => {
  afterEach(() => {
    setIgDepsForTests(null);
  });

  it("queues week 1 and week 2 once and does not retouch an existing media path", async () => {
    const store = createMemoryStore();
    const mediaDir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const allowlist = readAllowlistFile(path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json"));
    const keptAt = new Date("2026-10-23T16:00:00.000Z");
    await store.insert({
      kind: "FEED",
      mediaPath: "d5-post-1080-B2-4x5.jpg",
      caption: "Already posted",
      scheduledFor: keptAt,
      status: "published",
      approvalHash: "ab".repeat(32),
      utmContent: "feed-d1",
    });
    setIgDepsForTests({ store, mediaDir, allowlist, env: {} });
    expect(await enqueueApprovedSlots()).toBe(40);
    const rows = await store.list(100);
    expect(rows).toHaveLength(41);
    const kept = rows.find((row) => row.mediaPath === "d5-post-1080-B2-4x5.jpg");
    expect(kept?.status).toBe("published");
    expect(kept?.caption).toBe("Already posted");
    expect(kept?.utmContent).toBe("feed-d1");
    expect(kept?.scheduledFor.toISOString()).toBe(keptAt.toISOString());
    const fresh = rows.filter((row) => row.mediaPath !== "d5-post-1080-B2-4x5.jpg");
    expect(fresh.every((row) => row.status === "queued")).toBe(true);
    expect(fresh.every((row) => row.caption === "Can you name all 5? Link in bio.")).toBe(true);
    expect(rows.filter((row) => row.kind === "FEED").every((row) => row.mediaPath.endsWith(".jpg"))).toBe(true);
    expect(rows.filter((row) => row.kind === "STORY").every((row) => row.mediaPath.endsWith(".jpg"))).toBe(true);
    expect(rows.filter((row) => row.kind === "REEL").every((row) => row.mediaPath.endsWith(".mp4"))).toBe(true);
    expect(rows.some((row) => row.mediaPath.endsWith(".png"))).toBe(false);
    expect(fresh.every((row) => allowlist.has(row.approvalHash))).toBe(true);
    const feedDates = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    const lateDates = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
    for (let n = 1; n <= 7; n++) {
      const feed = rows.find((row) => row.mediaPath === `feed-w2-day${n}.jpg`)!;
      const reel = rows.find((row) => row.mediaPath === `reel-w2-day${n}.mp4`)!;
      const story = rows.find((row) => row.mediaPath === `story-w2-day${n}.jpg`)!;
      expect(ctLabel(feed.scheduledFor)).toBe(`${feedDates[n - 1]} 11:00`);
      expect(ctLabel(reel.scheduledFor)).toBe(`${lateDates[n - 1]} 18:00`);
      expect(ctLabel(story.scheduledFor)).toBe(`${lateDates[n - 1]} 21:00`);
      expect(feed.utmContent).toBe(`${feed.id}-A`);
      expect(feed.utmCampaign).toBe("w2");
      expect(feed.trial).toBe(false);
      expect(story.trial).toBe(false);
      expect(reel.trial).toBe(false);
      expect(story.utmMedium).toBe("story");
    }
    expect(rows.find((row) => row.mediaPath === "feed-w2-day1.jpg")?.scheduledFor.toISOString()).toBe("2026-10-29T16:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "feed-w2-day7.jpg")?.scheduledFor.toISOString()).toBe("2026-11-04T17:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "reel-w2-day1.mp4")?.scheduledFor.toISOString()).toBe("2026-10-30T23:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "reel-w2-day7.mp4")?.scheduledFor.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "story-w2-day1.jpg")?.scheduledFor.toISOString()).toBe("2026-10-31T02:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "story-w2-day7.jpg")?.scheduledFor.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(rows.some((row) => parseCreativeName(row.mediaPath) != null)).toBe(false);
    expect(rows.some((row) => row.mediaPath === "feed-swap-row6-765.jpg")).toBe(false);
    expect(await enqueueApprovedSlots()).toBe(0);
    expect(await store.list(200)).toHaveLength(41);
    expect((await store.list(200)).find((row) => row.mediaPath === "d5-post-1080-B2-4x5.jpg")?.status).toBe("published");
    expect((await store.list(200)).some((row) => parseCreativeName(row.mediaPath) != null)).toBe(false);
  });

  it("redirects /ig to bio when the queue read throws", async () => {
    const app = express();
    registerIgRoutes(app);
    const store = createMemoryStore();
    store.latestPublished = async () => {
      throw new Error("relation ig_post_queue does not exist");
    };
    setIgDepsForTests({ store, env: {} });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    try {
      expect(await igBioTarget(undefined)).toBe(igBioRedirectUrl("bio"));
      const bio = await fetch(`http://127.0.0.1:${addr.port}/ig`, { redirect: "manual" });
      expect(bio.status).toBe(302);
      expect(bio.headers.get("location")).toBe(igBioRedirectUrl("bio"));
      const bad = await fetch(`http://127.0.0.1:${addr.port}/ig?c=https://evil.example`, { redirect: "manual" });
      expect(bad.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("central time slots and queued migration", () => {
  afterEach(() => setIgDepsForTests(null));

  it("keeps 07:30, 13:30, and 21:00 on the Central wall clock across the clock change", () => {
    expect(ctWallTime("2026-10-31", 7, 30).toISOString()).toBe("2026-10-31T12:30:00.000Z");
    expect(ctWallTime("2026-11-01", 7, 30).toISOString()).toBe("2026-11-01T13:30:00.000Z");
    expect(ctWallTime("2026-10-31", 13, 30).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(ctWallTime("2026-11-01", 13, 30).toISOString()).toBe("2026-11-01T19:30:00.000Z");
    expect(ctWallTime("2026-10-31", 21, 0).toISOString()).toBe("2026-11-01T02:00:00.000Z");
    expect(ctWallTime("2026-11-01", 21, 0).toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(ctWallTime("2026-10-30", 20, 0).toISOString()).toBe("2026-10-31T01:00:00.000Z");
    expect(ctWallTime("2026-11-05", 20, 0).toISOString()).toBe("2026-11-06T02:00:00.000Z");
  });

  it("moves queued 20:00 stories to 21:00 and leaves posted rows alone", async () => {
    const store = createMemoryStore();
    setIgDepsForTests({ store, env: {} });
    const oct30 = ctWallTime("2026-10-30", 20, 0);
    const nov5 = ctWallTime("2026-11-05", 20, 0);
    const hash = "ab".repeat(32);
    const storyA = await store.insert({
      kind: "STORY", mediaPath: "story-w2-day1.jpg", caption: "Queued story", scheduledFor: oct30,
      status: "queued", approvalHash: hash, utmContent: "w2-story-d1",
    });
    const storyB = await store.insert({
      kind: "STORY", mediaPath: "story-w2-day7.jpg", caption: "Queued story", scheduledFor: nov5,
      status: "queued", approvalHash: hash, utmContent: "w2-story-d7",
    });
    const posted = await store.insert({
      kind: "STORY", mediaPath: "story-day1-A.jpg", caption: "Already posted", scheduledFor: oct30,
      status: "published", approvalHash: hash, utmContent: "story-d1",
    });
    const feed = await store.insert({
      kind: "FEED", mediaPath: "feed-w2-day1.jpg", caption: "Queued feed", scheduledFor: oct30,
      status: "queued", approvalHash: hash, utmContent: "w2-feed-d1",
    });
    const link = await store.insert({
      kind: "LINK", mediaPath: "fb-link-w3-d1-daily-A.jpg", caption: "Can you name all 5?", scheduledFor: ctWallTime("2026-11-05", 13, 30),
      status: "queued", approvalHash: hash, utmContent: "daily", platform: "fb", variant: "A", utmMedium: "link", utmCampaign: "w3",
    });
    const photoLink = await store.insert({
      kind: "PHOTO", mediaPath: "fb-link-w3-d1-daily-B.jpg", caption: "Can you name all 5?", scheduledFor: ctWallTime("2026-11-06", 13, 30),
      status: "queued", approvalHash: hash, utmContent: "daily", platform: "fb", variant: "B", utmMedium: "link", utmCampaign: "w3",
    });
    const postedLink = await store.insert({
      kind: "PHOTO", mediaPath: "fb-link-w3-d2-daily-A.jpg", caption: "Posted plain", scheduledFor: ctWallTime("2026-11-06", 13, 30),
      status: "published", approvalHash: hash, utmContent: "posted-link", platform: "fb", variant: "A", utmMedium: "link", utmCampaign: "w3",
    });
    const first = await migrateQueuedRows(store);
    expect(first.stories.sort((a, b) => a - b)).toEqual([storyA.id, storyB.id]);
    expect(first.utm.sort((a, b) => a - b)).toEqual([storyA.id, storyB.id, feed.id, link.id, photoLink.id].sort((a, b) => a - b));
    expect((await store.get(storyA.id))?.scheduledFor.toISOString()).toBe("2026-10-31T02:00:00.000Z");
    expect((await store.get(storyB.id))?.scheduledFor.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect((await store.get(storyA.id))?.utmContent).toBe(`${storyA.id}-A`);
    expect((await store.get(posted.id))?.scheduledFor.toISOString()).toBe(oct30.toISOString());
    expect((await store.get(posted.id))?.utmContent).toBe("story-d1");
    expect((await store.get(posted.id))?.caption).toBe("Already posted");
    expect((await store.get(feed.id))?.scheduledFor.toISOString()).toBe(oct30.toISOString());
    expect((await store.get(feed.id))?.utmContent).toBe(`${feed.id}-A`);
    expect((await store.get(feed.id))?.utmCampaign).toBe("w2");
    const linkRow = await store.get(link.id);
    expect(linkRow?.caption).toContain("https://packpts.com/daily?");
    expect(linkRow?.caption).toContain("utm_source=facebook");
    expect(linkRow?.caption).toContain(`utm_content=${link.id}-A`);
    expect(linkRow?.caption).not.toMatch(/[\u2013\u2014]/);
    const photoLinkRow = await store.get(photoLink.id);
    expect(photoLinkRow?.caption.match(/https:\/\//g)).toHaveLength(1);
    expect(photoLinkRow?.caption).toContain("https://packpts.com/daily?");
    expect(photoLinkRow?.caption).toContain(`utm_content=${photoLink.id}-B`);
    expect((await store.get(postedLink.id))?.caption).toBe("Posted plain");
    const second = await migrateQueuedRows(store);
    expect(second.stories).toEqual([]);
    expect(second.utm).toEqual([]);
    expect((await store.get(posted.id))?.utmContent).toBe("story-d1");
    expect((await store.get(photoLink.id))?.caption.match(/https:\/\//g)).toHaveLength(1);
  });
});

function week3Files(): string[] {
  const stems: Array<[string, string, string, string, string]> = [
    ["fb", "photo", "s1", "A", "jpg"],
    ["fb", "photo", "s4", "A", "jpg"],
    ["fb", "reel", "solo", "A", "mp4"],
    ["fb", "reel", "hook", "A", "mp4"],
    ["fb", "reel", "hook", "B", "mp4"],
    ["fb", "link", "daily", "A", "jpg"],
    ["ig", "reel", "hook", "A", "mp4"],
    ["ig", "reel", "hook", "B", "mp4"],
    ["ig", "reel", "solo", "A", "mp4"],
    ["ig", "feed", "card", "A", "jpg"],
    ["ig", "story", "tease", "A", "jpg"],
    ["ig", "story", "poll", "A", "jpg"],
  ];
  const names: string[] = [];
  for (let day = 1; day <= 7; day++) {
    for (const [platform, format, testId, variant, ext] of stems) {
      names.push(`${platform}-${format}-w3-d${day}-${testId}-${variant}.${ext}`);
    }
  }
  return names;
}

describe("week 3 creative names", () => {
  afterEach(() => setIgDepsForTests(null));

  it("parses the new pattern and leaves the old names alone", () => {
    expect(parseCreativeName("reel-day1-A.mp4")).toBeNull();
    expect(parseCreativeName("feed-w2-day1.jpg")).toBeNull();
    expect(parseCreativeName("d5-post-1080-B2-4x5.jpg")).toBeNull();
    expect(parseCreativeName("ig-reel-w3-d1-hook-A.mp4")).toEqual({
      file: "ig-reel-w3-d1-hook-A.mp4",
      platform: "ig",
      format: "reel",
      week: 3,
      day: 1,
      testId: "hook",
      variant: "A",
    });
    expect(parseCreativeName("IG-REEL-W4-D1-HOOK-B.MP4")).toMatchObject({
      platform: "ig", format: "reel", week: 4, day: 1, testId: "hook", variant: "B",
    });
    expect(parseCreativeName("fb-photo-w3-d2-s1-B.jpg")).toMatchObject({
      platform: "fb", format: "photo", week: 3, day: 2, testId: "s1", variant: "B",
    });
    expect(contentDate(2, 1)).toBe("2026-10-29");
    expect(contentDate(3, 1)).toBe("2026-11-06");
    expect(contentDate(3, 7)).toBe("2026-11-12");
    expect(contentDate(4, 1)).toBe("2026-11-13");
    const hookA = parseCreativeName("ig-reel-w3-d1-hook-A.mp4")!;
    const hookB = parseCreativeName("ig-reel-w3-d1-hook-B.mp4")!;
    const fbA = parseCreativeName("fb-reel-w3-d1-hook-A.mp4")!;
    const fbB = parseCreativeName("fb-reel-w3-d1-hook-B.mp4")!;
    const lone = parseCreativeName("ig-reel-w3-d2-solo-A.mp4")!;
    const tease = parseCreativeName("ig-story-w3-d1-tease-A.jpg")!;
    const poll = parseCreativeName("ig-story-w3-d1-poll-A.jpg")!;
    const photoS1 = parseCreativeName("fb-photo-w3-d1-s1-A.jpg")!;
    const photoS4 = parseCreativeName("fb-photo-w3-d1-s4-A.jpg")!;
    const fbSolo = parseCreativeName("fb-reel-w3-d1-solo-A.mp4")!;
    const link = parseCreativeName("fb-link-w3-d1-daily-A.jpg")!;
    const feed = parseCreativeName("ig-feed-w3-d1-card-A.jpg")!;
    const loneTease = parseCreativeName("ig-story-w3-d2-tease-A.jpg")!;
    expect(creativePlan(hookA, [hookA, hookB])).toMatchObject({ kind: "REEL", trial: true, at: { date: "2026-11-06", hour: 13, minute: 30 }, campaign: "w3" });
    expect(creativePlan(fbA, [fbA, fbB])).toMatchObject({ trial: false, at: { date: "2026-11-06", hour: 11, minute: 0 } });
    expect(creativePlan(lone, [lone])).toMatchObject({ trial: false, at: { date: "2026-11-07", hour: 18, minute: 0 } });
    expect(creativePlan(photoS1, [photoS1]).at).toEqual({ date: "2026-11-06", hour: 7, minute: 30 });
    expect(creativePlan(photoS4, [photoS4]).at).toEqual({ date: "2026-11-06", hour: 18, minute: 0 });
    expect(creativePlan(fbSolo, [fbSolo]).at).toEqual({ date: "2026-11-06", hour: 20, minute: 30 });
    expect(creativePlan(link, [link])).toMatchObject({ kind: "PHOTO", at: { date: "2026-11-06", hour: 13, minute: 30 } });
    expect(creativePlan(feed, [feed]).at).toEqual({ date: "2026-11-06", hour: 11, minute: 0 });
    expect(creativePlan(tease, [tease, poll]).at).toEqual({ date: "2026-11-06", hour: 20, minute: 45 });
    expect(creativePlan(poll, [tease, poll]).at).toEqual({ date: "2026-11-06", hour: 21, minute: 0 });
    expect(creativePlan(loneTease, [loneTease]).at).toEqual({ date: "2026-11-07", hour: 21, minute: 0 });
  });

  it("seeds parsed files and skips old names and unapproved files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-w3-"));
    const names = [
      "ig-reel-w3-d1-hook-A.mp4",
      "ig-reel-w3-d1-hook-B.mp4",
      "ig-story-w3-d1-tease-A.jpg",
      "ig-story-w3-d1-poll-A.jpg",
      "fb-photo-w3-d1-s1-A.jpg",
      "fb-link-w3-d1-daily-A.jpg",
      "fb-reel-w3-d1-hook-A.mp4",
      "fb-reel-w3-d1-hook-B.mp4",
      "ig-reel-w3-d2-solo-A.mp4",
      "reel-day1-A.mp4",
      "feed-w2-day1.jpg",
    ];
    for (const name of names) {
      writeFileSync(path.join(dir, name), name.endsWith(".mp4") ? VIDEO : JPEG);
    }
    writeFileSync(path.join(dir, "ig-story-w3-d1-poll-B.jpg"), Buffer.from([0xff, 0xd8, 0x00, 0x01]));
    const store = createMemoryStore();
    setIgDepsForTests({
      store,
      mediaDir: dir,
      allowlist: new Set([sha(JPEG), sha(VIDEO)]),
      env: {},
    });
    expect(await queueParsedCreatives()).toBe(9);
    const rows = await store.list(20);
    expect(rows.map((row) => row.mediaPath).sort()).toEqual([
      "fb-link-w3-d1-daily-A.jpg",
      "fb-photo-w3-d1-s1-A.jpg",
      "fb-reel-w3-d1-hook-A.mp4",
      "fb-reel-w3-d1-hook-B.mp4",
      "ig-reel-w3-d1-hook-A.mp4",
      "ig-reel-w3-d1-hook-B.mp4",
      "ig-reel-w3-d2-solo-A.mp4",
      "ig-story-w3-d1-poll-A.jpg",
      "ig-story-w3-d1-tease-A.jpg",
    ]);
    const pair = rows.find((row) => row.mediaPath === "ig-reel-w3-d1-hook-B.mp4")!;
    expect(pair.platform).toBe("ig");
    expect(pair.variant).toBe("B");
    expect(pair.testId).toBe("hook");
    expect(pair.trial).toBe(true);
    expect(pair.utmContent).toBe(`${pair.id}-B`);
    expect(pair.scheduledFor.toISOString()).toBe("2026-11-06T19:30:00.000Z");
    expect(rows.find((row) => row.mediaPath === "ig-story-w3-d1-tease-A.jpg")?.scheduledFor.toISOString()).toBe("2026-11-07T02:45:00.000Z");
    expect(rows.find((row) => row.mediaPath === "ig-story-w3-d1-poll-A.jpg")?.scheduledFor.toISOString()).toBe("2026-11-07T03:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "fb-photo-w3-d1-s1-A.jpg")).toMatchObject({
      kind: "PHOTO", platform: "fb",
    });
    expect(rows.find((row) => row.mediaPath === "fb-photo-w3-d1-s1-A.jpg")?.scheduledFor.toISOString()).toBe("2026-11-06T13:30:00.000Z");
    expect(rows.find((row) => row.mediaPath === "fb-reel-w3-d1-hook-A.mp4")).toMatchObject({
      platform: "fb", trial: false, testId: "hook", variant: "A",
    });
    expect(rows.find((row) => row.mediaPath === "fb-reel-w3-d1-hook-A.mp4")?.scheduledFor.toISOString()).toBe("2026-11-06T17:00:00.000Z");
    expect(rows.find((row) => row.mediaPath === "ig-reel-w3-d2-solo-A.mp4")?.scheduledFor.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    const linkRow = rows.find((row) => row.mediaPath === "fb-link-w3-d1-daily-A.jpg")!;
    expect(linkRow.kind).toBe("PHOTO");
    expect(linkRow.scheduledFor.toISOString()).toBe("2026-11-06T19:30:00.000Z");
    expect(linkRow.caption.match(/https:\/\//g)).toHaveLength(1);
    expect(linkRow.caption).toContain("https://packpts.com/daily?");
    expect(linkRow.caption).toContain("utm_medium=link");
    expect(linkRow.caption).not.toMatch(/Link in bio/i);
    const dry = await dryRunFb(linkRow.id);
    expect(dry.endpoint).toBe("/photos");
    expect(dry.body).not.toHaveProperty("link");
    expect(String(dry.body?.caption)).toContain("https://packpts.com/daily?");
    expect(rows.some((row) => row.mediaPath === "reel-day1-A.mp4" || row.mediaPath === "feed-w2-day1.jpg")).toBe(false);
    expect(await queueParsedCreatives()).toBe(0);
  });

  it("plans all 84 week 3 files and posts tease at 20:45 when a poll shares the day", async () => {
    const files = week3Files();
    const plan = planCreatives([...files, "feed-w2-day1.jpg", "notes.txt"]);
    expect(plan).toHaveLength(84);
    expect(plan[0]?.file).toBe("fb-photo-w3-d1-s1-A.jpg");
    const byFile = new Map(plan.map((item) => [item.file, item]));
    expect(byFile.get("fb-photo-w3-d1-s1-A.jpg")).toMatchObject({
      kind: "PHOTO", clock: "07:30", date: "2026-11-06", scheduledFor: "2026-11-06T13:30:00.000Z", trial: false, linkInCaption: false,
    });
    expect(byFile.get("fb-photo-w3-d1-s4-A.jpg")).toMatchObject({
      kind: "PHOTO", clock: "18:00", scheduledFor: "2026-11-07T00:00:00.000Z",
    });
    expect(byFile.get("fb-reel-w3-d1-solo-A.mp4")).toMatchObject({
      kind: "REEL", clock: "20:30", scheduledFor: "2026-11-07T02:30:00.000Z", trial: false,
    });
    expect(byFile.get("fb-reel-w3-d1-hook-A.mp4")).toMatchObject({
      clock: "11:00", scheduledFor: "2026-11-06T17:00:00.000Z", trial: false, variant: "A",
    });
    expect(byFile.get("fb-reel-w3-d1-hook-B.mp4")).toMatchObject({
      clock: "11:00", scheduledFor: "2026-11-06T17:00:00.000Z", trial: false, variant: "B",
    });
    expect(byFile.get("fb-link-w3-d1-daily-A.jpg")).toMatchObject({
      kind: "PHOTO", clock: "13:30", scheduledFor: "2026-11-06T19:30:00.000Z", linkInCaption: true,
    });
    expect(byFile.get("ig-reel-w3-d1-hook-A.mp4")).toMatchObject({
      clock: "13:30", scheduledFor: "2026-11-06T19:30:00.000Z", trial: true,
    });
    expect(byFile.get("ig-reel-w3-d1-solo-A.mp4")).toMatchObject({
      clock: "18:00", scheduledFor: "2026-11-07T00:00:00.000Z", trial: false,
    });
    expect(byFile.get("ig-feed-w3-d1-card-A.jpg")).toMatchObject({
      kind: "FEED", clock: "11:00", scheduledFor: "2026-11-06T17:00:00.000Z",
    });
    expect(byFile.get("ig-story-w3-d1-tease-A.jpg")).toMatchObject({
      clock: "20:45", scheduledFor: "2026-11-07T02:45:00.000Z",
    });
    expect(byFile.get("ig-story-w3-d1-poll-A.jpg")).toMatchObject({
      clock: "21:00", scheduledFor: "2026-11-07T03:00:00.000Z",
    });
    expect(byFile.get("ig-story-w3-d7-poll-A.jpg")).toMatchObject({
      date: "2026-11-12", scheduledFor: "2026-11-13T03:00:00.000Z",
    });
    expect(plan.filter((item) => item.linkInCaption)).toHaveLength(7);
    expect(plan.filter((item) => item.trial)).toHaveLength(14);
    expect(new Set(plan.map((item) => item.day)).size).toBe(7);

    const store = createMemoryStore();
    const hash = "ab".repeat(32);
    const tease = await store.insert({
      kind: "STORY", mediaPath: "ig-story-w3-d1-tease-A.jpg", caption: "Tease",
      scheduledFor: ctWallTime("2026-11-06", 20, 45), status: "queued", approvalHash: hash,
      utmContent: "tease", platform: "ig", variant: "A", testId: "tease",
    });
    const poll = await store.insert({
      kind: "STORY", mediaPath: "ig-story-w3-d1-poll-A.jpg", caption: "Poll",
      scheduledFor: ctWallTime("2026-11-06", 21, 0), status: "queued", approvalHash: hash,
      utmContent: "poll", platform: "ig", variant: "A", testId: "poll",
    });
    const solo = await store.insert({
      kind: "REEL", mediaPath: "fb-reel-w3-d1-solo-A.mp4", caption: "Solo",
      scheduledFor: ctWallTime("2026-11-06", 20, 30), status: "queued", approvalHash: hash,
      utmContent: "solo", platform: "fb", variant: "A", testId: "solo",
    });
    const rows = await store.list(10);
    const quiet = {} as NodeJS.ProcessEnv;
    expect(selectDueRows(rows, ctWallTime("2026-11-06", 18, 0), "fb", quiet).map((row) => row.id)).toEqual([]);
    expect(selectDueRows(rows, ctWallTime("2026-11-06", 20, 30), "fb", quiet).map((row) => row.id)).toEqual([solo.id]);
    expect(selectDueRows(rows, ctWallTime("2026-11-06", 20, 45), "ig", quiet).map((row) => row.id)).toEqual([tease.id]);
    expect(selectDueRows(rows, ctWallTime("2026-11-06", 21, 0), "ig", quiet).map((row) => row.id).sort((a, b) => a - b)).toEqual([tease.id, poll.id].sort((a, b) => a - b));
  });

  it("lists the 84-file plan from the QA route and does not insert rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-w3-plan-"));
    const files = week3Files();
    for (const name of files) writeFileSync(path.join(dir, name), name.endsWith(".mp4") ? VIDEO : JPEG);
    writeFileSync(path.join(dir, "feed-w2-day1.jpg"), JPEG);
    writeFileSync(path.join(dir, ".keep"), Buffer.from("skip"));
    const store = createMemoryStore();
    setIgDepsForTests({ store, mediaDir: dir, allowlist: new Set([sha(JPEG), sha(VIDEO)]), env: {} });
    const app = express();
    app.use(express.json());
    registerIgRoutes(app);
    const previous = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = TOKEN;
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const denied = await fetch(`${base}/api/qa/ig/schedule`);
      expect(denied.status).toBe(401);
      const query = await fetch(`${base}/api/qa/ig/schedule?token=${TOKEN}`);
      expect(query.status).toBe(401);
      const listed = await fetch(`${base}/api/qa/ig/schedule`, { headers: { "x-qa-token": TOKEN } });
      expect(listed.status).toBe(200);
      const body = await listed.json() as { count: number; items: Array<{ file: string; scheduledFor: string; clock: string }> };
      expect(body.count).toBe(84);
      expect(body.items).toHaveLength(84);
      expect(body.items.some((item) => item.file === "feed-w2-day1.jpg" || item.file === ".keep")).toBe(false);
      expect(body.items.find((item) => item.file === "ig-story-w3-d1-tease-A.jpg")?.clock).toBe("20:45");
      expect(body.items.find((item) => item.file === "fb-reel-w3-d1-solo-A.mp4")?.scheduledFor).toBe("2026-11-07T02:30:00.000Z");
      expect(await store.list(200)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previous;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("insight pull", () => {
  afterEach(() => setIgDepsForTests(null));

  it("pulls story metrics at 20 hours and the daily set only after 09:00 CT", async () => {
    const store = createMemoryStore();
    const urls: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setIgDepsForTests({
      store,
      env: armedEnv({ IG_GRAPH_HOST: "graph.instagram.com" }),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response(JSON.stringify({
          data: [
            { name: "reach", values: [{ value: 10 }] },
            { name: "views", values: [{ value: 20 }] },
            { name: "navigation", values: [{ value: 5 }] },
            { name: "ig_reels_avg_watch_time", values: [{ value: 6 }] },
          ],
        }), { status: 200 });
      },
    });
    const hash = "cd".repeat(32);
    const story = await store.insert({
      kind: "STORY", mediaPath: "story-d1.jpg", caption: "Story", scheduledFor: new Date("2026-10-30T16:00:00.000Z"),
      status: "queued", approvalHash: hash, utmContent: "story-old",
    });
    await store.markPublished(story.id, "media-story", new Date("2026-10-30T16:00:00.000Z"));
    const reel = await store.insert({
      kind: "REEL", mediaPath: "reel-d1.mp4", caption: "Reel", scheduledFor: new Date("2026-10-30T23:00:00.000Z"),
      status: "queued", approvalHash: hash, utmContent: "reel-old",
    });
    await store.markPublished(reel.id, "media-reel", new Date("2026-10-30T23:00:00.000Z"));
    const feed = await store.insert({
      kind: "FEED", mediaPath: "feed-d1.jpg", caption: "Feed", scheduledFor: new Date("2026-10-30T16:00:00.000Z"),
      status: "queued", approvalHash: hash, utmContent: "feed-old",
    });
    await store.markPublished(feed.id, "media-feed", new Date("2026-10-30T16:00:00.000Z"));

    const before = await runInsightSync(new Date("2026-10-31T13:59:00.000Z"));
    expect(before).toEqual({ status: "ran", pulled: 1 });
    const earlyStory = await store.get(story.id);
    expect(earlyStory?.insights?.story20h?.metrics.reach).toBe(10);
    expect(earlyStory?.insights?.story20h?.metrics.navigation).toBe(5);
    expect(earlyStory?.insights?.daily).toBeUndefined();
    expect((await store.get(feed.id))?.insights).toBeNull();
    expect(urls.some((url) => url.includes("navigation"))).toBe(true);
    expect(urls.some((url) => url.includes("ig_reels_avg_watch_time"))).toBe(false);
    expect(igQueueJson((await store.get(story.id))!).insights?.story20h?.metrics.reach).toBe(10);

    urls.length = 0;
    const daily = await runInsightSync(new Date("2026-10-31T14:00:00.000Z"));
    expect(daily.pulled).toBe(3);
    expect((await store.get(story.id))?.insights?.daily?.day).toBe("2026-10-31");
    expect((await store.get(feed.id))?.insights?.daily?.metrics.reach).toBe(10);
    expect(urls.filter((url) => url.includes("navigation"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("ig_reels_avg_watch_time"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("ig_reels_avg_watch_time") && url.includes("profile_visits"))).toHaveLength(0);
    expect((await store.get(reel.id))?.insights?.daily?.metrics.reach).toBe(10);
    expect(urls.every((url) => url.startsWith("https://graph.instagram.com/"))).toBe(true);

    const young = await store.insert({
      kind: "STORY", mediaPath: "story-young.jpg", caption: "Young", scheduledFor: new Date("2026-10-31T04:00:00.000Z"),
      status: "queued", approvalHash: hash, utmContent: "story-young",
    });
    await store.markPublished(young.id, "media-young", new Date("2026-10-31T04:00:00.000Z"));
    await runInsightSync(new Date("2026-10-31T14:00:00.000Z"));
    const youngRow = await store.get(young.id);
    expect(youngRow?.insights?.story20h).toBeUndefined();
    expect(youngRow?.insights?.daily?.metrics.reach).toBe(10);
    expect(spy.mock.calls.flat().join(" ")).not.toContain("ig-secret-token-do-not-log");
    spy.mockRestore();
  });
});

describe("queued reel trials and row edits", () => {
  afterEach(() => setIgDepsForTests(null));

  it("leaves trial flags as set on queued reels", async () => {
    const store = createMemoryStore();
    setIgDepsForTests({ store, env: {} });
    const when = new Date("2026-10-27T23:00:00.000Z");
    const hash = "ab".repeat(32);
    const week1 = await store.insert({
      kind: "REEL", mediaPath: "reel-day1-A.mp4", caption: "Keep me", scheduledFor: when,
      status: "queued", approvalHash: hash, utmContent: "reel-d1",
    });
    const week2 = await store.insert({
      kind: "REEL", mediaPath: "reel-w2-day1.mp4", caption: "Week 2", scheduledFor: when,
      status: "queued", approvalHash: hash, utmContent: "w2-reel-d1", utmCampaign: "w2",
    });
    const posted = await store.insert({
      kind: "REEL", mediaPath: "reel-day2.mp4", caption: "Already posted", scheduledFor: when,
      status: "published", approvalHash: hash, utmContent: "reel-d2",
    });
    const story = await store.insert({
      kind: "STORY", mediaPath: "story-day1-A.jpg", caption: "Story", scheduledFor: when,
      status: "queued", approvalHash: hash, utmContent: "story-d1",
    });
    const week3 = await store.insert({
      kind: "REEL", mediaPath: "ig-reel-w3-d2-solo-A.mp4", caption: "Solo", scheduledFor: when,
      status: "queued", approvalHash: hash, utmContent: "w3-reel", utmCampaign: "w3",
    });
    const facebook = await store.insert({
      kind: "REEL", mediaPath: "fb-reel.mp4", caption: "FB", scheduledFor: when,
      status: "queued", approvalHash: hash, utmContent: "w2-reel", utmCampaign: "w2", platform: "fb",
    });
    const first = await migrateQueuedRows(store);
    expect(first.trials).toEqual([]);
    const saved = await store.get(week1.id);
    expect(saved?.trial).toBe(false);
    expect(saved?.caption).toBe("Keep me");
    expect(saved?.scheduledFor.toISOString()).toBe(when.toISOString());
    expect((await store.get(week2.id))?.trial).toBe(false);
    expect((await store.get(posted.id))?.trial).toBe(false);
    expect((await store.get(posted.id))?.caption).toBe("Already posted");
    expect((await store.get(story.id))?.trial).toBe(false);
    expect((await store.get(week3.id))?.trial).toBe(false);
    expect((await store.get(facebook.id))?.trial).toBe(false);
    expect((await migrateQueuedRows(store)).trials).toEqual([]);
  });

  it("sends the trial graduation strategy when a migrated week 1 reel publishes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-trial-"));
    writeFileSync(path.join(dir, "reel-day1-A.mp4"), VIDEO);
    const store = createMemoryStore();
    const graph = fakeGraph();
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set([sha(VIDEO)]),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 2,
    });
    const row = await store.insert({
      kind: "REEL", mediaPath: "reel-day1-A.mp4", caption: "Can you name all 5? Link in bio.",
      scheduledFor: new Date("2026-10-27T23:00:00.000Z"), status: "queued",
      approvalHash: sha(VIDEO), utmContent: "reel-d1", trial: true,
    });
    await migrateQueuedRows(store);
    expect((await publishIg(row.id)).status).toBe("published");
    expect(graph.calls[0]?.trial_params).toBe(IG_TRIAL_PARAMS);
    expect(IG_TRIAL_PARAMS).toBe(JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }));
  });

  it("points a queued feed at the approved row 6 file and refuses posted rows", async () => {
    const mediaDir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const allowlist = readAllowlistFile(path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json"));
    const swapName = "feed-swap-row6-765.jpg";
    const swapHash = sha(readFileSync(path.join(mediaDir, swapName)));
    const oldName = "d5-post-1080-B2-4x5.jpg";
    const oldHash = sha(readFileSync(path.join(mediaDir, oldName)));
    expect(allowlist.has(swapHash)).toBe(true);
    const store = createMemoryStore();
    setIgDepsForTests({ store, mediaDir, allowlist, env: {} });
    const when = new Date("2026-10-23T16:00:00.000Z");
    const queued = await store.insert({
      kind: "FEED", mediaPath: oldName, caption: "Old caption", scheduledFor: when,
      status: "queued", approvalHash: oldHash, utmContent: "feed-d6",
    });
    const captioned = await updateQueuedRow(queued.id, { caption: "Morning feed" });
    expect(captioned.caption).toBe("Morning feed Link in bio.");
    expect(captioned.mediaPath).toBe(oldName);
    expect(captioned.approvalHash).toBe(oldHash);
    const updated = await updateQueuedRow(queued.id, { mediaPath: swapName });
    expect(updated.mediaPath).toBe(swapName);
    expect(updated.approvalHash).toBe(swapHash);
    expect(updated.caption).toBe("Morning feed Link in bio.");
    expect(updated.status).toBe("queued");
    expect(updated.scheduledFor.toISOString()).toBe(when.toISOString());
    const posted = await store.insert({
      kind: "FEED", mediaPath: oldName, caption: "Posted", scheduledFor: when,
      status: "published", approvalHash: oldHash, utmContent: "feed-posted",
    });
    await expect(updateQueuedRow(posted.id, { mediaPath: swapName })).rejects.toThrow(/not_queued/);
    expect((await store.get(posted.id))?.mediaPath).toBe(oldName);
    expect((await store.get(posted.id))?.caption).toBe("Posted");
    const reelHash = sha(readFileSync(path.join(mediaDir, "reel-day1-A.mp4")));
    const reel = await store.insert({
      kind: "REEL", mediaPath: "reel-day1-A.mp4", caption: "Reel", scheduledFor: when,
      status: "queued", approvalHash: reelHash, utmContent: "reel-d1",
    });
    await expect(updateQueuedRow(reel.id, { mediaPath: swapName })).rejects.toThrow(/media_kind_mismatch/);
    expect((await store.get(reel.id))?.mediaPath).toBe("reel-day1-A.mp4");
    const trialReel = await store.insert({
      kind: "REEL", mediaPath: "reel-day1-A.mp4", caption: "Reel", scheduledFor: when,
      status: "queued", approvalHash: reelHash, utmContent: "reel-trial", trial: true,
    });
    expect((await store.get(trialReel.id))?.trial).toBe(true);
    expect((await updateQueuedRow(trialReel.id, { trial: false })).trial).toBe(false);
    expect((await updateQueuedRow(trialReel.id, { trial: true })).trial).toBe(true);
    await expect(updateQueuedRow(trialReel.id, { trial: "no" })).rejects.toThrow(/bad_trial/);
    await expect(updateQueuedRow(queued.id, { trial: true })).rejects.toThrow(/trial_reel_only/);
    await expect(updateQueuedRow(posted.id, { trial: false })).rejects.toThrow(/not_queued/);
    await expect(updateQueuedRow(queued.id, { mediaPath: "../APPROVED.json" })).rejects.toThrow(/bad_media_path/);
    await expect(updateQueuedRow(queued.id, { mediaPath: "missing-feed.jpg" })).rejects.toThrow(/file_missing/);
    const dry = await publishIg(queued.id, { dryRun: true });
    expect(dry.wouldSkip).toBe(false);
    expect(dry.publicUrl).toContain(swapName);
    expect(dry.caption).toContain("Link in bio.");
    expect(dry.caption).not.toMatch(/https?:\/\//);
  });

  it("patches caption and media through the QA route for a queued row only", async () => {
    const mediaDir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const allowlist = readAllowlistFile(path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json"));
    const store = createMemoryStore();
    setIgDepsForTests({ store, graph: fakeGraph(), mediaDir, allowlist, env: armedEnv(), sleep: async () => {}, pollMax: 2 });
    const app = express();
    app.use(express.json());
    registerIgRoutes(app);
    const previous = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = TOKEN;
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const when = "2026-10-23T16:00:00.000Z";
      const oldName = "d5-post-1080-B2-4x5.jpg";
      const created = await fetch(`${base}/api/qa/ig/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify({
          kind: "FEED",
          mediaPath: oldName,
          caption: "Old",
          scheduledFor: when,
          approvalHash: sha(readFileSync(path.join(mediaDir, oldName))),
        }),
      });
      expect(created.status).toBe(201);
      const item = (await created.json()).item;
      const denied = await fetch(`${base}/api/qa/ig/queue/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caption: "Secret" }),
      });
      expect(denied.status).toBe(401);
      const patched = await fetch(`${base}/api/qa/ig/queue/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify({ caption: "Row six swap", mediaPath: "feed-swap-row6-765.jpg", scheduledFor: "2099-01-01T00:00:00.000Z" }),
      });
      expect(patched.status).toBe(200);
      const next = (await patched.json()).item;
      expect(next.caption).toBe("Row six swap Link in bio.");
      expect(next.mediaPath).toBe("feed-swap-row6-765.jpg");
      expect(next.approvalHash).toBe(sha(readFileSync(path.join(mediaDir, "feed-swap-row6-765.jpg"))));
      expect(next.scheduledFor).toBe(when);
      expect(next.status).toBe("queued");
      const published = await fetch(`${base}/api/qa/ig/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify({ id: item.id }),
      });
      expect((await published.json()).status).toBe("published");
      const blocked = await fetch(`${base}/api/qa/ig/queue/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify({ caption: "Too late", mediaPath: oldName }),
      });
      expect(blocked.status).toBe(409);
      expect((await store.get(item.id))?.mediaPath).toBe("feed-swap-row6-765.jpg");
      expect((await store.get(item.id))?.caption).toBe("Row six swap Link in bio.");
    } finally {
      if (previous === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previous;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
