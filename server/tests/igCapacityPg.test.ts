/**
 * Account-day cap against real Postgres. Memory-store tests do not cover
 * receipt deletes, lock order, or a slot move across midnight.
 */
import { createHash } from "crypto";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IgGraphError,
  PUBLISH_UNCERTAIN,
  ctWallTime,
  igAccountDay,
  pgStore,
  publishIg,
  setIgDepsForTests,
  type IgGraph,
} from "../services/igPublish";

const databaseUrl = process.env.IG_CAP_DATABASE_URL || process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const VIDEO = Buffer.from("packpts-reel-bytes-v1");
const hash = createHash("sha256").update(VIDEO).digest("hex");

function graph(over: Partial<IgGraph> = {}): IgGraph & { publishCalls: number } {
  let n = 0;
  const api: IgGraph & { publishCalls: number } = {
    publishCalls: 0,
    pageInstagramId: async () => "17890001",
    publishingLimit: async () => ({ usage: 0, total: 50 }),
    createMedia: async () => {
      n += 1;
      return `container-${n}`;
    },
    containerStatus: async () => "FINISHED",
    publishMedia: async () => {
      api.publishCalls += 1;
      n += 1;
      return `media-${n}`;
    },
    ...over,
  };
  return api;
}

async function slotDay(id: number): Promise<string | null> {
  const result = await pool!.query(`SELECT account_day::text AS day FROM ig_publish_day_slot WHERE post_id = $1`, [id]);
  return result.rows[0]?.day ?? null;
}

describe.skipIf(!pool)("instagram capacity on postgres", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ig-cap-pg-"));
  let now = ctWallTime("2026-11-08", 18, 1);

  beforeAll(async () => {
    writeFileSync(path.join(dir, "reel.mp4"), VIDEO);
    await pgStore.get(0);
  });

  beforeEach(async () => {
    await pool!.query(`DELETE FROM ig_publish_day_slot`);
    await pool!.query(`DELETE FROM ig_post_queue`);
    now = ctWallTime("2026-11-08", 18, 1);
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      sleep: async () => {},
      pollMax: 1,
      now: () => now,
    });
  });

  afterAll(async () => {
    setIgDepsForTests(null);
    await pool?.end();
  });

  async function enqueue(caption: string, at: Date) {
    return pgStore.insert({
      kind: "REEL",
      mediaPath: "reel.mp4",
      caption,
      scheduledFor: at,
      status: "queued",
      approvalHash: hash,
      utmContent: caption.slice(0, 40),
      trial: false,
    });
  }

  it("moves an overnight container onto the Chicago publish day and will not publish it when that day is full", async () => {
    const early = ctWallTime("2026-11-08", 0, 10);
    now = early;
    const api = graph();
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 1,
      now: () => now,
    });
    for (let n = 0; n < 5; n += 1) {
      const row = await enqueue(`full-${n}`, ctWallTime("2026-11-08", 10, n));
      expect((await publishIg(row.id)).status).toBe("published");
      expect(await slotDay(row.id)).toBe("2026-11-08");
    }
    now = ctWallTime("2026-11-07", 23, 50);
    const overnight = await enqueue("overnight", ctWallTime("2026-11-07", 18, 0));
    api.containerStatus = async () => "IN_PROGRESS";
    expect((await publishIg(overnight.id)).status).toBe("pending");
    expect(await slotDay(overnight.id)).toBe("2026-11-07");
    expect(igAccountDay(now)).toBe("2026-11-07");
    const callsAtHold = api.publishCalls;
    api.containerStatus = async () => {
      now = early;
      return "FINISHED";
    };
    const blocked = await publishIg(overnight.id);
    expect(blocked.status).toBe("cap_full");
    expect(api.publishCalls).toBe(callsAtHold);
    expect((await pgStore.get(overnight.id))?.status).toBe("container_created");
    expect(await slotDay(overnight.id)).toBe("2026-11-07");
    const sixth = await enqueue("sixth", ctWallTime("2026-11-08", 12, 0));
    now = early;
    expect((await publishIg(sixth.id)).status).toBe("cap_full");
  });

  it("reassigns the overnight slot when today's cap still has room", async () => {
    const early = ctWallTime("2026-11-08", 0, 10);
    now = early;
    const api = graph();
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 1,
      now: () => now,
    });
    for (let n = 0; n < 4; n += 1) {
      const row = await enqueue(`room-${n}`, ctWallTime("2026-11-08", 10, n));
      expect((await publishIg(row.id)).status).toBe("published");
    }
    now = ctWallTime("2026-11-07", 23, 50);
    const overnight = await enqueue("move", ctWallTime("2026-11-07", 18, 0));
    api.containerStatus = async () => "IN_PROGRESS";
    expect((await publishIg(overnight.id)).status).toBe("pending");
    expect(await slotDay(overnight.id)).toBe("2026-11-07");
    api.containerStatus = async () => {
      now = early;
      return "FINISHED";
    };
    expect((await publishIg(overnight.id)).status).toBe("published");
    expect(await slotDay(overnight.id)).toBe("2026-11-08");
    expect((await pgStore.get(overnight.id))?.capacityDay).toBe("2026-11-08");
    const extra = await enqueue("extra", ctWallTime("2026-11-08", 12, 0));
    expect((await publishIg(extra.id)).status).toBe("cap_full");
  });

  it("keeps the slot when media_publish's response is lost and does not publish again", async () => {
    const api = graph();
    let publishCalls = 0;
    let polls = 0;
    api.containerStatus = async () => {
      polls += 1;
      return polls === 1 ? "FINISHED" : "PUBLISHED";
    };
    api.publishMedia = async () => {
      publishCalls += 1;
      throw new IgGraphError("graph_network", 0, true);
    };
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 2,
      now: () => now,
    });
    const row = await enqueue("lost", ctWallTime("2026-11-08", 18, 0));
    const first = await publishIg(row.id);
    expect(first.status).toBe("pending");
    expect(first.reason).toBe(PUBLISH_UNCERTAIN);
    expect(publishCalls).toBe(1);
    expect((await pgStore.get(row.id))?.status).toBe("container_created");
    expect(await slotDay(row.id)).toBe("2026-11-08");
    const second = await publishIg(row.id);
    expect(second.status).toBe("published");
    expect(publishCalls).toBe(1);
    expect(await slotDay(row.id)).toBe("2026-11-08");
  });

  it("keeps the slot when the database write fails after Meta accepts the publish", async () => {
    const api = graph();
    let polls = 0;
    api.containerStatus = async () => {
      polls += 1;
      return polls === 1 ? "FINISHED" : "PUBLISHED";
    };
    let failWrite = true;
    const realMark = pgStore.markPublished.bind(pgStore);
    setIgDepsForTests({
      store: {
        ...pgStore,
        markPublished: async (id, igMediaId, publishedAt) => {
          if (failWrite) {
            failWrite = false;
            throw new Error("db_down");
          }
          return realMark(id, igMediaId, publishedAt);
        },
      },
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 2,
      now: () => now,
    });
    const row = await enqueue("dbfail", ctWallTime("2026-11-08", 18, 0));
    const first = await publishIg(row.id);
    expect(first.status).toBe("pending");
    expect(first.reason).toBe(PUBLISH_UNCERTAIN);
    expect(api.publishCalls).toBe(1);
    expect(await slotDay(row.id)).toBe("2026-11-08");
    const second = await publishIg(row.id);
    expect(second.status).toBe("published");
    expect(api.publishCalls).toBe(1);
    expect((await pgStore.get(row.id))?.igMediaId).toBeTruthy();
  });

  it("does not delete a published receipt when a stale skip loses the race", async () => {
    const api = graph();
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 1,
      now: () => now,
    });
    const row = await enqueue("stale", ctWallTime("2026-11-08", 11, 0));
    expect((await publishIg(row.id)).status).toBe("published");
    expect(await pgStore.markSkipped(row.id, "missed_slot")).toBe(false);
    expect((await pgStore.get(row.id))?.status).toBe("published");
    expect((await pgStore.get(row.id))?.capacityDay).toBe("2026-11-08");
    expect(await slotDay(row.id)).toBe("2026-11-08");

    const queued = await enqueue("race", ctWallTime("2026-11-08", 12, 0));
    await pgStore.claimDaySlot(queued.id, "2026-11-08");
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM ig_post_queue WHERE id = $1 FOR UPDATE`, [queued.id]);
      const skipping = pgStore.markSkipped(queued.id, "missed_slot");
      await client.query(
        `UPDATE ig_post_queue
         SET status = 'published', ig_media_id = 'meta-race', published_at = $2, capacity_day = $3::date
         WHERE id = $1`,
        [queued.id, now, "2026-11-08"],
      );
      await client.query("COMMIT");
      expect(await skipping).toBe(false);
    } finally {
      client.release();
    }
    expect((await pgStore.get(queued.id))?.status).toBe("published");
    expect(await slotDay(queued.id)).toBe("2026-11-08");
  });

  it("lets only one of two concurrent publishes take the last slot", async () => {
    const api = graph();
    setIgDepsForTests({
      mediaDir: dir,
      allowlist: new Set([hash]),
      env: {
        ...process.env,
        IG_PUBLISH_ENABLED: "true",
        IG_ACCESS_TOKEN: "ig-secret-token-do-not-log",
        IG_USER_ID: "17890001",
      },
      graph: api,
      sleep: async () => {},
      pollMax: 1,
      now: () => now,
    });
    for (let n = 0; n < 4; n += 1) {
      const row = await enqueue(`seed-${n}`, ctWallTime("2026-11-08", 10, n));
      expect((await publishIg(row.id)).status).toBe("published");
    }
    const left = await enqueue("left", ctWallTime("2026-11-08", 18, 0));
    const right = await enqueue("right", ctWallTime("2026-11-08", 18, 30));
    const [a, b] = await Promise.all([publishIg(left.id), publishIg(right.id)]);
    expect([a.status, b.status].sort()).toEqual(["cap_full", "published"]);
    const slots = await pool!.query(`SELECT COUNT(*)::int AS n FROM ig_publish_day_slot WHERE account_day = '2026-11-08'`);
    expect(slots.rows[0].n).toBe(5);
  });
});
