/**
 * Same-slot IG trial pairs. Selection only, plus the explicit expired-slot release.
 * Graph and the queue are in memory. No live token and no production rows.
 */
import { createHash } from "crypto";
import { createServer } from "http";
import { mkdtempSync, writeFileSync } from "fs";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import path from "path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerIgRoutes } from "../routes/igPublish";
import {
  IG_DAILY_POST_CAP,
  TRIAL_PAIR_LIVE_MS,
  createMemoryStore,
  ctWallTime,
  publishIg,
  runIgDaily,
  selectDueRows,
  setIgDepsForTests,
  type IgGraph,
  type IgMediaFields,
  type IgQueueRow,
} from "../services/igPublish";

const HASH = "ab".repeat(32);
const env = { IG_PUBLISH_ENABLED: "true" } as NodeJS.ProcessEnv;
const VIDEO = Buffer.from("packpts-reel-bytes-v1");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x51, 0x41]);

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function row(id: number, partial: Partial<IgQueueRow> & Pick<IgQueueRow, "kind" | "scheduledFor">): IgQueueRow {
  return {
    id,
    mediaPath: partial.kind === "REEL" ? `m${id}.mp4` : `m${id}.jpg`,
    caption: "Can you name all 5?",
    status: "queued",
    containerId: null,
    igMediaId: null,
    error: null,
    approvalHash: HASH,
    utmContent: `${id}-A`,
    utmMedium: partial.kind.toLowerCase(),
    utmCampaign: "w3",
    platform: "ig",
    variant: null,
    testId: null,
    trial: false,
    insights: null,
    abTestId: null,
    createdAt: partial.scheduledFor,
    publishedAt: null,
    ...partial,
  };
}

function pair(day: string, idA = 49, idB = 50): IgQueueRow[] {
  const at = ctWallTime(day, 13, 30);
  return [
    row(idA, { kind: "REEL", scheduledFor: at, trial: true, variant: "A", testId: "hook", mediaPath: "hook-A.mp4", utmContent: `${idA}-A` }),
    row(idB, { kind: "REEL", scheduledFor: at, trial: true, variant: "B", testId: "hook", mediaPath: "hook-B.mp4", utmContent: `${idB}-B` }),
  ];
}

function ids(rows: IgQueueRow[], now: Date, platform: IgQueueRow["platform"] = "ig"): number[] {
  return selectDueRows(rows, now, platform, env).map((item) => item.id);
}

describe("approved same-slot trial pairs", () => {
  afterEach(() => setIgDepsForTests(null));

  it("selects both live variants and leaves a third row at that minute", () => {
    const day = "2026-11-08";
    const [a, b] = pair(day);
    const extra = row(51, { kind: "REEL", scheduledFor: a.scheduledFor, trial: true, variant: "A", testId: "hook", mediaPath: "hook-extra.mp4" });
    expect(ids([a, b], ctWallTime(day, 13, 29))).toEqual([]);
    expect(ids([a, b], ctWallTime(day, 13, 31))).toEqual([49, 50]);
    expect(ids([a, b, extra], ctWallTime(day, 13, 31))).toEqual([49]);
    const edge = new Date(a.scheduledFor.getTime() + TRIAL_PAIR_LIVE_MS);
    expect(ids([a, b], edge)).toEqual([49, 50]);
    expect(ids([a, b], new Date(edge.getTime() + 1))).toEqual([]);
  });

  it("selects the queued sibling after trial A has published, while the slot is live", () => {
    const day = "2026-11-08";
    const [a, b] = pair(day);
    const published = { ...a, status: "published" as const, igMediaId: "media-49", publishedAt: ctWallTime(day, 13, 34) };
    expect(ids([published, b], ctWallTime(day, 13, 40))).toEqual([50]);
    const edge = new Date(a.scheduledFor.getTime() + TRIAL_PAIR_LIVE_MS);
    expect(ids([published, b], edge)).toEqual([50]);
    const inflight = { ...a, status: "container_created" as const, containerId: "c49" };
    expect(ids([inflight, b], ctWallTime(day, 13, 40))).toEqual([49, 50]);
    expect(ids([inflight, b], ctWallTime(day, 16, 12))).toEqual([49]);
    const failed = { ...a, status: "failed" as const, error: "graph_503" };
    expect(ids([failed, b], ctWallTime(day, 13, 40))).toEqual([]);
  });

  it("keeps ordinary duplicate slots to one row", () => {
    const day = "2026-11-08";
    const at = ctWallTime(day, 18, 0);
    const feed = ctWallTime(day, 11, 0);
    const rows = [
      row(1, { kind: "FEED", scheduledFor: feed }),
      row(2, { kind: "FEED", scheduledFor: feed }),
      row(3, { kind: "REEL", scheduledFor: at, mediaPath: "solo-a.mp4" }),
      row(4, { kind: "REEL", scheduledFor: at, mediaPath: "solo-b.mp4" }),
      row(5, { kind: "STORY", scheduledFor: ctWallTime(day, 21, 0), testId: "poll" }),
      row(6, { kind: "STORY", scheduledFor: ctWallTime(day, 21, 0), testId: "poll" }),
    ];
    expect(ids(rows, ctWallTime(day, 11, 5))).toEqual([1]);
    expect(ids(rows, ctWallTime(day, 18, 1))).toEqual([3]);
    expect(ids(rows, ctWallTime(day, 21, 1))).toEqual([3, 5]);
    const fb = [
      row(7, { kind: "REEL", scheduledFor: ctWallTime(day, 11, 0), platform: "fb", variant: "A", testId: "hook", mediaPath: "fb-a.mp4" }),
      row(8, { kind: "REEL", scheduledFor: ctWallTime(day, 11, 0), platform: "fb", variant: "B", testId: "hook", mediaPath: "fb-b.mp4" }),
    ];
    expect(ids(fb, ctWallTime(day, 11, 1), "fb")).toEqual([7]);
  });

  it("posts the Nov 7-8 lineup of two feeds, both trial variants, and the 6 PM Reel", () => {
    expect(IG_DAILY_POST_CAP).toBe(5);
    const day = "2026-11-07";
    const [a, b] = pair(day);
    const feed11 = row(1, { kind: "FEED", scheduledFor: ctWallTime(day, 11, 0) });
    const feed13 = row(2, { kind: "FEED", scheduledFor: ctWallTime(day, 13, 0) });
    const evening = row(60, { kind: "REEL", scheduledFor: ctWallTime(day, 18, 0), testId: "solo", trial: false, mediaPath: "solo.mp4" });
    const lineup = [feed11, feed13, a, b, evening];
    expect(lineup.some((item) => item.kind === "STORY")).toBe(false);
    expect(ids(lineup, ctWallTime(day, 11, 5))).toEqual([1]);
    const published11 = { ...feed11, status: "published" as const, igMediaId: "feed-11", publishedAt: ctWallTime(day, 11, 2) };
    expect(ids([published11, feed13, a, b, evening], ctWallTime(day, 13, 5))).toEqual([2]);
    const published13 = { ...feed13, status: "published" as const, igMediaId: "feed-13", publishedAt: ctWallTime(day, 13, 5) };
    expect(ids([published11, published13, a, b, evening], ctWallTime(day, 13, 31))).toEqual([49, 50]);
    const publishedA = { ...a, status: "published" as const, igMediaId: "media-49", publishedAt: ctWallTime(day, 13, 34) };
    const publishedB = { ...b, status: "published" as const, igMediaId: "media-50", publishedAt: ctWallTime(day, 13, 36) };
    expect(ids([published11, published13, publishedA, publishedB, evening], ctWallTime(day, 18, 1))).toEqual([60]);
    const backlog = row(12, { kind: "REEL", scheduledFor: ctWallTime("2026-11-06", 18, 0), mediaPath: "older.mp4" });
    expect(ids([published11, published13, publishedA, publishedB, evening, backlog], ctWallTime(day, 18, 1))).toEqual([60]);
  });

  it("posts a five-row day with one 9 PM tease and does not invent a second Story", () => {
    const day = "2026-11-09";
    const [a, b] = pair(day);
    const feed11 = row(1, { kind: "FEED", scheduledFor: ctWallTime(day, 11, 0) });
    const feed13 = row(2, { kind: "FEED", scheduledFor: ctWallTime(day, 13, 0) });
    const tease = row(70, { kind: "STORY", scheduledFor: ctWallTime(day, 21, 0), testId: "tease" });
    const published = (item: IgQueueRow, at: Date, mediaId: string): IgQueueRow => ({
      ...item, status: "published", igMediaId: mediaId, publishedAt: at,
    });
    const ready = [
      published(feed11, ctWallTime(day, 11, 2), "feed-11"),
      published(feed13, ctWallTime(day, 13, 5), "feed-13"),
      published(a, ctWallTime(day, 13, 34), "media-49"),
      published(b, ctWallTime(day, 13, 36), "media-50"),
      tease,
    ];
    expect(ready.filter((item) => item.kind === "STORY")).toHaveLength(1);
    expect(ids(ready, ctWallTime(day, 21, 1))).toEqual([70]);
    const sixth = row(90, { kind: "REEL", scheduledFor: ctWallTime(day, 21, 30), trial: false, mediaPath: "late.mp4" });
    expect(ids([...ready, sixth], ctWallTime(day, 21, 31))).toEqual([70]);
  });

  it("does not auto-start row 50 after the slot expires, including the next day's catch-up", async () => {
    const [a, b] = pair("2026-11-07");
    const published = { ...a, status: "published" as const, igMediaId: "media-49", publishedAt: ctWallTime("2026-11-07", 13, 34) };
    const evening = row(60, { kind: "REEL", scheduledFor: ctWallTime("2026-11-07", 18, 0), testId: "solo", trial: false, mediaPath: "solo.mp4" });
    const older = row(12, { kind: "REEL", scheduledFor: ctWallTime("2026-11-06", 18, 0), mediaPath: "older.mp4" });
    const feed11 = row(1, { kind: "FEED", scheduledFor: ctWallTime("2026-11-07", 11, 0), status: "published", igMediaId: "feed-11", publishedAt: ctWallTime("2026-11-07", 11, 2) });
    const feed13 = row(2, { kind: "FEED", scheduledFor: ctWallTime("2026-11-07", 13, 0), status: "published", igMediaId: "feed-13", publishedAt: ctWallTime("2026-11-07", 13, 5) });
    expect(ids([published, b], ctWallTime("2026-11-07", 16, 12))).toEqual([]);
    expect(ids([feed11, feed13, published, b, evening], ctWallTime("2026-11-07", 18, 1))).toEqual([60]);
    const nov8 = "2026-11-08";
    const tonight = row(80, { kind: "REEL", scheduledFor: ctWallTime(nov8, 18, 0), testId: "solo", trial: false, mediaPath: "nov8.mp4" });
    const nov8Lineup = [
      row(81, { kind: "FEED", scheduledFor: ctWallTime(nov8, 11, 0), status: "published", igMediaId: "f", publishedAt: ctWallTime(nov8, 11, 2) }),
      row(82, { kind: "FEED", scheduledFor: ctWallTime(nov8, 13, 0), status: "published", igMediaId: "g", publishedAt: ctWallTime(nov8, 13, 5) }),
      row(83, { kind: "REEL", scheduledFor: ctWallTime(nov8, 13, 30), status: "published", igMediaId: "h", publishedAt: ctWallTime(nov8, 13, 34), trial: true, variant: "A", testId: "hook", mediaPath: "h.mp4" }),
      row(84, { kind: "REEL", scheduledFor: ctWallTime(nov8, 13, 30), status: "published", igMediaId: "i", publishedAt: ctWallTime(nov8, 13, 36), trial: true, variant: "B", testId: "hook", mediaPath: "i.mp4" }),
      tonight,
    ];
    expect(ids([...nov8Lineup, b, evening, older], ctWallTime(nov8, 18, 1))).toEqual([80]);

    const dir = mkdtempSync(path.join(tmpdir(), "ig-pair-"));
    writeFileSync(path.join(dir, "hook-B.mp4"), VIDEO);
    const store = createMemoryStore();
    const graph = fakeGraph();
    const expiredAt = ctWallTime("2026-11-07", 16, 12);
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set([sha(VIDEO)]),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 2,
      now: () => expiredAt,
    });
    const queued = await store.insert({
      kind: "REEL", mediaPath: "hook-B.mp4", caption: "Trial B", scheduledFor: b.scheduledFor,
      status: "queued", approvalHash: sha(VIDEO), utmContent: "50-B", platform: "ig", variant: "B", testId: "hook", trial: true,
    });
    await store.insert({
      kind: "REEL", mediaPath: "hook-B.mp4", caption: "Trial A", scheduledFor: a.scheduledFor,
      status: "published", approvalHash: sha(VIDEO), utmContent: "49-A", platform: "ig", variant: "A", testId: "hook", trial: true,
    });
    const blocked = await publishIg(queued.id);
    expect(blocked.status).toBe("expired_slot");
    expect(blocked.reason).toBe("expired_trial_pair");
    expect((await store.get(queued.id))?.status).toBe("queued");
    expect(graph.calls).toHaveLength(0);
    const released = await publishIg(queued.id, { releaseExpired: true });
    expect(released.status).toBe("published");
    expect(graph.calls).toHaveLength(1);
    expect((await store.get(queued.id))?.status).toBe("published");
  });

  it("publishes a live pair once under overlapping passes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-pair-race-"));
    writeFileSync(path.join(dir, "hook-A.mp4"), VIDEO);
    writeFileSync(path.join(dir, "hook-B.mp4"), VIDEO);
    const store = createMemoryStore();
    const graph = fakeGraph();
    const day = "2026-11-08";
    const slot = ctWallTime(day, 13, 30);
    const now = ctWallTime(day, 13, 31);
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set([sha(VIDEO)]),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 2,
      now: () => now,
    });
    const a = await store.insert({
      kind: "REEL", mediaPath: "hook-A.mp4", caption: "Trial A", scheduledFor: slot,
      status: "queued", approvalHash: sha(VIDEO), utmContent: "a", platform: "ig", variant: "A", testId: "hook", trial: true,
    });
    const b = await store.insert({
      kind: "REEL", mediaPath: "hook-B.mp4", caption: "Trial B", scheduledFor: slot,
      status: "queued", approvalHash: sha(VIDEO), utmContent: "b", platform: "ig", variant: "B", testId: "hook", trial: true,
    });
    const [first, second] = await Promise.all([runIgDaily(now), runIgDaily(now)]);
    const statuses = [...(first.results ?? []), ...(second.results ?? [])].map((item) => item.status).sort();
    expect(statuses.filter((status) => status === "published")).toHaveLength(2);
    expect(graph.calls).toHaveLength(2);
    expect(graph.calls.every((call) => call.trial_params)).toBe(true);
    expect((await store.get(a.id))?.status).toBe("published");
    expect((await store.get(b.id))?.status).toBe("published");
    expect((await store.get(a.id))?.igMediaId).toBeTruthy();
    expect((await store.get(b.id))?.igMediaId).toBeTruthy();
    const again = await runIgDaily(now);
    expect(again.results).toEqual([]);
    expect(graph.calls).toHaveLength(2);
    const [repeatA, repeatB] = await Promise.all([publishIg(a.id), publishIg(a.id)]);
    expect([repeatA.status, repeatB.status].sort()).toEqual(["already_published", "already_published"]);
    expect(graph.calls).toHaveLength(2);
  });

  it("requires releaseExpired on the QA publish route and does not change the row otherwise", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-pair-route-"));
    writeFileSync(path.join(dir, "hook-B.mp4"), VIDEO);
    writeFileSync(path.join(dir, "feed.jpg"), JPEG);
    const store = createMemoryStore();
    const graph = fakeGraph();
    const slot = ctWallTime("2026-11-07", 13, 30);
    setIgDepsForTests({
      store,
      graph,
      mediaDir: dir,
      allowlist: new Set([sha(VIDEO), sha(JPEG)]),
      env: armedEnv(),
      sleep: async () => {},
      pollMax: 2,
      now: () => ctWallTime("2026-11-07", 16, 12),
    });
    await store.insert({
      kind: "REEL", mediaPath: "hook-B.mp4", caption: "Trial A", scheduledFor: slot,
      status: "published", approvalHash: sha(VIDEO), utmContent: "49-A", variant: "A", testId: "hook", trial: true,
    });
    const queued = await store.insert({
      kind: "REEL", mediaPath: "hook-B.mp4", caption: "Trial B", scheduledFor: slot,
      status: "queued", approvalHash: sha(VIDEO), utmContent: "50-B", variant: "B", testId: "hook", trial: true,
    });
    const app = express();
    app.use(express.json());
    registerIgRoutes(app);
    const previous = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = "ig-qa-token";
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const denied = await fetch(`${base}/api/qa/ig/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": "ig-qa-token" },
        body: JSON.stringify({ id: queued.id }),
      });
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ status: "expired_slot", reason: "expired_trial_pair" });
      expect((await store.get(queued.id))?.status).toBe("queued");
      const allowed = await fetch(`${base}/api/qa/ig/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": "ig-qa-token" },
        body: JSON.stringify({ id: queued.id, releaseExpired: true }),
      });
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).status).toBe("published");
      expect((await store.get(queued.id))?.status).toBe("published");
    } finally {
      if (previous === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previous;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

function armedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IG_PUBLISH_ENABLED: "true",
    IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
    IG_USER_ID: "17890001",
  };
}

function fakeGraph(): IgGraph & { calls: IgMediaFields[] } {
  const calls: IgMediaFields[] = [];
  let n = 0;
  return {
    calls,
    pageInstagramId: async () => "17890001",
    publishingLimit: async () => ({ usage: 0, total: 50 }),
    createMedia: async (fields) => {
      calls.push(fields);
      n += 1;
      return `container-${n}`;
    },
    containerStatus: async () => "FINISHED",
    publishMedia: async () => {
      n += 1;
      return `media-${n}`;
    },
  };
}
