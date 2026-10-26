/**
 * Facebook page publisher. Graph calls are mocked. No live database and no token logs.
 */
import { createHash } from "crypto";
import { createServer } from "http";
import { mkdtempSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import path from "path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIgRoutes } from "../routes/igPublish";
import { dryRunFb, fbAbTestBody, runFbDaily } from "../services/fbPublish";
import {
  createMemoryStore,
  ctWallTime,
  runInsightSync,
  setIgDepsForTests,
  type IgStore,
} from "../services/igPublish";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x46, 0x42]);
const VIDEO = Buffer.from("packpts-fb-reel-bytes");
const TOKEN = "page-secret-token";

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fbEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    IG_GRAPH_HOST: "graph.instagram.com",
    FB_PUBLISH_ENABLED: "true",
    FB_PAGE_TOKEN: TOKEN,
    FB_PAGE_ID: "999",
    ...extra,
  };
}

describe("facebook publisher", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fb-pub-"));
  let store: IgStore;

  afterEach(() => setIgDepsForTests(null));

  function use(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) {
    store = createMemoryStore();
    setIgDepsForTests({
      store,
      mediaDir: dir,
      allowlist: new Set([sha(JPEG), sha(VIDEO)]),
      env,
      fetch: fetchImpl,
    });
  }

  async function insert(partial: {
    kind: "PHOTO" | "LINK" | "REEL";
    mediaPath: string;
    scheduledFor: Date;
    testId?: string | null;
    variant?: "A" | "B" | null;
    caption?: string;
    hash?: string;
  }) {
    return store.insert({
      kind: partial.kind,
      mediaPath: partial.mediaPath,
      caption: partial.caption ?? "Can you name all 5?",
      scheduledFor: partial.scheduledFor,
      status: "queued",
      approvalHash: partial.hash ?? (partial.mediaPath.endsWith(".mp4") ? sha(VIDEO) : sha(JPEG)),
      utmContent: "seed",
      utmMedium: partial.kind.toLowerCase(),
      utmCampaign: "w3",
      platform: "fb",
      variant: partial.variant ?? "A",
      testId: partial.testId ?? null,
      trial: false,
    });
  }

  it("dry-runs photo, link, reel, and ab tests without calling Graph", async () => {
    writeFileSync(path.join(dir, "photo.jpg"), JPEG);
    writeFileSync(path.join(dir, "link.jpg"), JPEG);
    writeFileSync(path.join(dir, "reel-a.mp4"), VIDEO);
    writeFileSync(path.join(dir, "reel-b.mp4"), VIDEO);
    let fetches = 0;
    use(fbEnv(), async () => {
      fetches += 1;
      throw new Error("fetch");
    });
    const when = ctWallTime("2026-11-05", 11, 0);
    const photo = await insert({ kind: "PHOTO", mediaPath: "photo.jpg", scheduledFor: ctWallTime("2026-11-05", 7, 30) });
    const link = await insert({ kind: "LINK", mediaPath: "link.jpg", scheduledFor: ctWallTime("2026-11-05", 13, 30), variant: "B" });
    const reelA = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "hook", variant: "A" });
    const reelB = await insert({ kind: "REEL", mediaPath: "reel-b.mp4", scheduledFor: when, testId: "hook", variant: "B" });
    const lone = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "solo", variant: "A" });
    const photoDry = await dryRunFb(photo.id);
    expect(photoDry).toMatchObject({ status: "dry_run", endpoint: "/photos", wouldSkip: false });
    expect(JSON.stringify(photoDry)).not.toContain(TOKEN);
    expect(photoDry.body?.caption).toBe("Can you name all 5?");
    expect(String(photoDry.body?.caption)).not.toMatch(/https?:\/\/|packpts\.com/);
    const linkDry = await dryRunFb(link.id);
    expect(String(linkDry.body?.link)).toContain("https://packpts.com/daily?");
    expect(String(linkDry.body?.link)).toContain("utm_source=facebook");
    expect(String(linkDry.body?.link)).toContain("utm_medium=link");
    expect(String(linkDry.body?.link)).toContain("utm_campaign=w3");
    expect(String(linkDry.body?.link)).toContain(`utm_content=${link.id}-B`);
    const pair = await dryRunFb(reelA.id);
    expect(pair.endpoint).toBe("/ab_tests");
    expect(pair.reels?.map((item) => item.video_state)).toEqual(["DRAFT", "DRAFT"]);
    expect(pair.abTest).toMatchObject({
      optimization_goal: "AVG_TIME_WATCHED",
      duration: 86400,
      control_video_id: `video-${reelA.id}`,
    });
    expect(pair.abTest?.experiment_video_ids).toEqual([`video-${reelA.id}`, `video-${reelB.id}`]);
    const ctaA = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "cta", variant: "A" });
    const ctaB = await insert({ kind: "REEL", mediaPath: "reel-b.mp4", scheduledFor: when, testId: "cta", variant: "B" });
    expect((await dryRunFb(ctaA.id)).abTest?.optimization_goal).toBe("LINK_CLICKS");
    expect(fbAbTestBody([ctaA, ctaB], ["v1", "v2"]).optimization_goal).toBe("LINK_CLICKS");
    const alone = await dryRunFb(lone.id);
    expect(alone.endpoint).toBe("/video_reels");
    expect(alone.reels).toEqual([{ id: lone.id, mediaPath: "reel-a.mp4", video_state: "PUBLISHED" }]);
    for (let n = 0; n < 5; n++) {
      await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "wide", variant: n % 2 === 0 ? "A" : "B" });
    }
    const wide = (await store.list(20)).find((row) => row.testId === "wide")!;
    expect((await dryRunFb(wide.id)).status).toBe("bad_ab_group");
    const skipped = await dryRunFb(photo.id);
    expect(skipped.status).toBe("dry_run");
    await store.insert({
      kind: "PHOTO", mediaPath: "missing.jpg", caption: "Can you name all 5?", scheduledFor: when,
      status: "queued", approvalHash: sha(JPEG), utmContent: "missing", platform: "fb", variant: "A",
    });
    const missing = (await store.list(20)).find((row) => row.mediaPath === "missing.jpg")!;
    expect(await dryRunFb(missing.id)).toMatchObject({ wouldSkip: true, reason: "file_missing" });
    expect(fetches).toBe(0);
  });

  it("stays off without the flag or the page token", async () => {
    let fetches = 0;
    use({ FB_PAGE_ID: "999" }, async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    });
    await insert({ kind: "PHOTO", mediaPath: "photo.jpg", scheduledFor: ctWallTime("2026-10-31", 7, 30) });
    expect((await runFbDaily(ctWallTime("2026-10-31", 7, 30))).status).toBe("disabled");
    use({ FB_PUBLISH_ENABLED: "true", FB_PAGE_ID: "999" }, async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    });
    expect((await runFbDaily(ctWallTime("2026-10-31", 7, 30))).status).toBe("not_armed");
    expect(fetches).toBe(0);
  });

  it("posts a photo and a lone reel on graph.facebook.com and keeps the token out of logs", async () => {
    writeFileSync(path.join(dir, "photo.jpg"), JPEG);
    writeFileSync(path.join(dir, "reel-a.mp4"), VIDEO);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    use(fbEnv(), async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      const body = init?.body;
      if (body instanceof URLSearchParams && body.get("upload_phase") === "START") {
        return new Response(JSON.stringify({ video_id: "vid-1", upload_url: "https://rupload.facebook.com/video" }), { status: 200 });
      }
      if (url.startsWith("https://rupload.facebook.com/")) return new Response("{}", { status: 200 });
      if (url.includes("/photos")) return new Response(JSON.stringify({ id: "photo-9" }), { status: 200 });
      if (url.includes("/video_reels")) return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify({ id: "other" }), { status: 200 });
    });
    const reel = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: ctWallTime("2026-10-31", 11, 0), testId: "solo" });
    const early = await runFbDaily(new Date(ctWallTime("2026-10-31", 11, 0).getTime() - 60_000));
    expect(early.results ?? []).toEqual([]);
    expect(calls).toHaveLength(0);
    const photo = await insert({ kind: "PHOTO", mediaPath: "photo.jpg", scheduledFor: ctWallTime("2026-10-31", 7, 30) });
    const photoRun = await runFbDaily(ctWallTime("2026-10-31", 7, 30));
    expect(photoRun.results).toEqual([{ id: photo.id, status: "published" }]);
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v21.0/999/photos");
    expect(calls[0]?.url).not.toContain("graph.instagram.com");
    const reelRun = await runFbDaily(ctWallTime("2026-10-31", 11, 0));
    expect(reelRun.results).toEqual([{ id: reel.id, status: "published" }]);
    const finish = calls.find((call) => call.init?.body instanceof URLSearchParams && call.init.body.get("upload_phase") === "FINISH");
    expect((finish?.init?.body as URLSearchParams).get("video_state")).toBe("PUBLISHED");
    expect((await store.get(photo.id))?.igMediaId).toBe("photo-9");
    expect((await store.get(reel.id))?.status).toBe("published");
    expect(spy.mock.calls.flat().join(" ")).not.toContain(TOKEN);
    spy.mockRestore();
  });

  it("uploads a same-slot pair as drafts and creates one ab test", async () => {
    writeFileSync(path.join(dir, "reel-a.mp4"), VIDEO);
    writeFileSync(path.join(dir, "reel-b.mp4"), VIDEO);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let videos = 0;
    use(fbEnv(), async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      const body = init?.body;
      if (body instanceof URLSearchParams && body.get("upload_phase") === "START") {
        videos += 1;
        return new Response(JSON.stringify({ video_id: `vid-${videos}`, upload_url: `https://rupload.facebook.com/video-${videos}` }), { status: 200 });
      }
      if (url.startsWith("https://rupload.facebook.com/")) return new Response("{}", { status: 200 });
      if (url.includes("/ab_tests")) return new Response(JSON.stringify({ id: "ab-99" }), { status: 200 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const when = ctWallTime("2026-11-05", 11, 0);
    const reelA = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "hook", variant: "A" });
    const reelB = await insert({ kind: "REEL", mediaPath: "reel-b.mp4", scheduledFor: when, testId: "hook", variant: "B" });
    const ran = await runFbDaily(when);
    expect(ran.results?.map((item) => item.status)).toEqual(["ab_test", "ab_test"]);
    const finishes = calls.filter((call) => call.init?.body instanceof URLSearchParams && call.init.body.get("upload_phase") === "FINISH");
    expect(finishes.map((call) => (call.init?.body as URLSearchParams).get("video_state"))).toEqual(["DRAFT", "DRAFT"]);
    const ab = calls.find((call) => call.url.includes("/ab_tests"));
    expect(ab?.url.startsWith("https://graph.facebook.com/v21.0/999/ab_tests")).toBe(true);
    expect(JSON.parse(String(ab?.init?.body))).toMatchObject({
      optimization_goal: "AVG_TIME_WATCHED",
      duration: 86400,
      control_video_id: "vid-1",
      experiment_video_ids: ["vid-1", "vid-2"],
    });
    expect((await store.get(reelA.id))?.status).toBe("container_created");
    expect((await store.get(reelB.id))?.abTestId).toBe("ab-99");
  });

  it("skips a five-reel group and does not upload", async () => {
    writeFileSync(path.join(dir, "reel-a.mp4"), VIDEO);
    let fetches = 0;
    use(fbEnv(), async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    });
    const when = ctWallTime("2026-11-05", 11, 0);
    const ids: number[] = [];
    for (let n = 0; n < 5; n++) {
      const row = await insert({ kind: "REEL", mediaPath: "reel-a.mp4", scheduledFor: when, testId: "wide", variant: n % 2 === 0 ? "A" : "B" });
      ids.push(row.id);
    }
    const ran = await runFbDaily(when);
    expect(ran.results?.map((item) => item.status)).toEqual(["bad_ab_group", "bad_ab_group", "bad_ab_group", "bad_ab_group", "bad_ab_group"]);
    for (const id of ids) expect((await store.get(id))?.error).toBe("bad_ab_group");
    expect(fetches).toBe(0);
  });

  it("pulls facebook post insights and the ab test after 09:00 CT", async () => {
    const urls: string[] = [];
    use(fbEnv(), async (input) => {
      urls.push(String(input));
      if (String(input).includes("/insights")) {
        return new Response(JSON.stringify({ data: [{ name: "post_impressions", values: [{ value: 8 }] }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "ab-7", winner: "A" }), { status: 200 });
    });
    const row = await store.insert({
      kind: "PHOTO", mediaPath: "photo.jpg", caption: "Photo", scheduledFor: ctWallTime("2026-10-31", 7, 30),
      status: "queued", approvalHash: sha(JPEG), utmContent: "photo", platform: "fb", variant: "A",
      abTestId: "ab-7",
    });
    await store.markPublished(row.id, "fb-post-1", new Date("2026-10-30T12:30:00.000Z"));
    const early = await runInsightSync(new Date("2026-10-31T13:59:00.000Z"));
    expect(early).toEqual({ status: "ran", pulled: 0 });
    const later = await runInsightSync(new Date("2026-10-31T14:00:00.000Z"));
    expect(later.pulled).toBe(1);
    const saved = await store.get(row.id);
    expect(saved?.insights?.fb?.metrics.post_impressions).toBe(8);
    expect(saved?.insights?.abTest?.body).toMatchObject({ id: "ab-7" });
    expect(urls.every((url) => url.startsWith("https://graph.facebook.com/"))).toBe(true);
    expect(urls.some((url) => url.includes("post_impressions"))).toBe(true);
    const again = urls.length;
    await runInsightSync(new Date("2026-10-31T15:00:00.000Z"));
    expect(urls).toHaveLength(again);
  });

  it("requires the QA token on the facebook dry-run route", async () => {
    const app = express();
    app.use(express.json());
    registerIgRoutes(app);
    const previous = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = "fb-qa-token";
    use(fbEnv());
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    try {
      const denied = await fetch(`http://127.0.0.1:${addr.port}/api/qa/fb/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      });
      expect(denied.status).toBe(401);
      const missing = await fetch(`http://127.0.0.1:${addr.port}/api/qa/fb/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": "fb-qa-token" },
        body: JSON.stringify({ id: 1 }),
      });
      expect(missing.status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previous;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
