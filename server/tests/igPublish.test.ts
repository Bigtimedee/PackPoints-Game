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
  publishIg,
  readAllowlistFile,
  runIgDaily,
  setIgDepsForTests,
  slotMinutes,
  type IgGraph,
  type IgMediaFields,
  type IgStore,
} from "../services/igPublish";

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
    expect(() => buildIgCaption("Play at https://packpts.com")).toThrow(/copy_rule/);
    expect(() => buildIgCaption("Today\u2019s game \u2014 free")).toThrow(/copy_rule/);
    expect(igBioRedirectUrl("feed-d1")).toBe(
      "https://packpts.com/?utm_source=instagram&utm_medium=social&utm_campaign=ig_daily&utm_content=feed-d1",
    );
  });

  it("defaults feed, reel, and story to 11:00, 18:00, and 20:00 CT", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(IG_SLOT_DEFAULTS).toEqual({ FEED: "11:00", REEL: "18:00", STORY: "20:00" });
    expect(slotMinutes("FEED", env)).toBe(11 * 60);
    expect(slotMinutes("REEL", env)).toBe(18 * 60);
    expect(slotMinutes("STORY", env)).toBe(20 * 60);
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

  it("mirrors the 20 committed creative hashes and leaves pngs out", () => {
    const dir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const file = path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json");
    const names = readdirSync(dir).filter((name) => !name.startsWith("."));
    expect(names.filter((name) => name.endsWith(".png"))).toEqual([]);
    expect(names.filter((name) => name.endsWith(".jpg"))).toHaveLength(13);
    expect(names.filter((name) => name.endsWith(".mp4"))).toHaveLength(7);
    const hashes = names.map((name) => sha(readFileSync(path.join(dir, name))));
    expect(new Set(hashes).size).toBe(20);
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
    });
    expect(graphMediaFields("STORY", "story-d1.jpg", "Link in bio.", "https://packpts.com/social/ig/story-d1.jpg")).toEqual({
      media_type: "STORIES",
      image_url: "https://packpts.com/social/ig/story-d1.jpg",
    });
    expect(graphMediaFields("STORY", "story-d1.mp4", "Link in bio.", "https://packpts.com/social/ig/story-d1.mp4")).toEqual({
      media_type: "STORIES",
      video_url: "https://packpts.com/social/ig/story-d1.mp4",
    });
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
    expect((await store.list()).find((row) => row.utmContent === "feed-d1")?.status).toBe("published");
    at.now = new Date("2026-10-23T17:00:00.000Z");
    const second = await runIgDaily(at.now);
    expect(second.results).toEqual([]);
    expect(graph.publishes).toBe(1);
    at.now = new Date("2026-10-24T16:00:00.000Z");
    const nextDay = await runIgDaily(at.now);
    expect(nextDay.results?.map((item) => item.status)).toEqual(["published"]);
    expect((await store.list()).find((row) => row.utmContent === "feed-d2")?.status).toBe("published");
    expect(graph.publishes).toBe(2);
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
    expect(bio.headers.get("location")).toBe(igBioRedirectUrl("feed-d1"));
    const override = await fetch(`${base}/ig?c=reel-d9`, { redirect: "manual" });
    expect(override.headers.get("location")).toBe(igBioRedirectUrl("reel-d9"));
    const bad = await fetch(`${base}/ig?c=https://evil.example`, { redirect: "manual" });
    expect(bad.status).toBe(400);
  });
});

describe("approved creative queue", () => {
  afterEach(() => {
    setIgDepsForTests(null);
  });

  it("queues 20 jpeg and reel rows and does not insert them twice", async () => {
    const store = createMemoryStore();
    const mediaDir = path.join(process.cwd(), "server", "assets", "ig", "media");
    const allowlist = readAllowlistFile(path.join(process.cwd(), "server", "assets", "ig", "APPROVED.json"));
    setIgDepsForTests({ store, mediaDir, allowlist, env: {} });
    expect(await enqueueApprovedSlots()).toBe(20);
    const rows = await store.list(50);
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.status === "queued")).toBe(true);
    expect(rows.filter((row) => row.kind === "FEED").map((row) => row.mediaPath).every((name) => name.endsWith(".jpg"))).toBe(true);
    expect(rows.filter((row) => row.kind === "STORY").map((row) => row.mediaPath).every((name) => name.endsWith(".jpg"))).toBe(true);
    expect(rows.filter((row) => row.kind === "REEL").map((row) => row.mediaPath).every((name) => name.endsWith(".mp4"))).toBe(true);
    expect(rows.some((row) => row.mediaPath.endsWith(".png"))).toBe(false);
    expect(rows.every((row) => row.caption === "Can you name all 5? Link in bio.")).toBe(true);
    expect(rows.every((row) => allowlist.has(row.approvalHash))).toBe(true);
    const utm = rows.map((row) => row.utmContent).sort();
    expect(utm).toEqual([
      "feed-d1", "feed-d2", "feed-d3", "feed-d4", "feed-d5", "feed-d6",
      "reel-d1", "reel-d2", "reel-d3", "reel-d4", "reel-d5", "reel-d6", "reel-d7",
      "story-d1", "story-d2", "story-d3", "story-d4", "story-d5", "story-d6", "story-d7",
    ]);
    expect(await enqueueApprovedSlots()).toBe(0);
    expect(await store.list(50)).toHaveLength(20);
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
