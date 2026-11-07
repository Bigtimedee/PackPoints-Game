/**
 * Real Postgres proof for stage 1 clocks, dedupe, and recovery.
 * Rolls back the timezone cases. The concurrency user is deleted.
 * Skips when DATABASE_URL is unset. CI provides Postgres 16.
 */
import { randomUUID } from "node:crypto";
import { spawnSync as spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GROWTH_SIGNUP_INSERT_SQL,
  ensureGrowthInstrumentation,
  noteGrowthActivity,
  noteGrowthGameCompleted,
  reconcilePostBaselineSignups,
  setGrowthQueryableForTests,
} from "../services/growthStage1";

const hasDb = Boolean(process.env.DATABASE_URL);
const pool = hasDb ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

type Client = pg.PoolClient;

async function withZone<T>(timeZone: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL TIME ZONE '${timeZone}'`);
    setGrowthQueryableForTests(client);
    return await run(client);
  } finally {
    setGrowthQueryableForTests(null);
    await client.query("ROLLBACK");
    client.release();
  }
}

async function cohortFor(client: Client, naiveUtc: string): Promise<string> {
  const result = await client.query(
    `SELECT to_char(($1::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day`,
    [naiveUtc],
  );
  return String(result.rows[0].day);
}

describe.skipIf(!hasDb)("stage 1 postgres clocks and recovery", () => {
  let createdBaseline = false;

  beforeAll(async () => {
    const existing = await pool!.query(`SELECT id FROM growth_instrumentation WHERE id = 'stage1'`);
    if (existing.rows.length === 0) {
      await pool!.query(
        `INSERT INTO growth_instrumentation (id, started_at, note) VALUES ('stage1', now(), 'stage1 pg test')`,
      );
      createdBaseline = true;
    }
  });

  afterAll(async () => {
    if (createdBaseline) {
      await pool!.query(`DELETE FROM growth_lifecycle_events WHERE user_id LIKE 'gst1_%'`);
      await pool!.query(`DELETE FROM users WHERE id LIKE 'gst1_%'`);
      await pool!.query(`DELETE FROM growth_instrumentation WHERE id = 'stage1' AND note = 'stage1 pg test'`);
    } else {
      await pool!.query(`DELETE FROM growth_lifecycle_events WHERE user_id LIKE 'gst1_%'`);
      await pool!.query(`DELETE FROM users WHERE id LIKE 'gst1_%'`);
    }
    await pool!.end();
  });

  it("keeps the Chicago day and the baseline instant stable across session time zones and DST", async () => {
    const cases = [
      ["2026-11-01 04:30:00", "2026-10-31"],
      ["2026-11-01 06:30:00", "2026-11-01"],
      ["2026-11-01 07:30:00", "2026-11-01"],
      ["2026-11-02 05:30:00", "2026-11-01"],
      ["2026-11-02 06:30:00", "2026-11-02"],
      ["2027-03-14 05:30:00", "2027-03-13"],
      ["2027-03-14 06:30:00", "2027-03-14"],
      ["2027-03-14 07:30:00", "2027-03-14"],
      ["2027-03-14 08:30:00", "2027-03-14"],
    ] as const;
    for (const zone of ["UTC", "America/Chicago", "Asia/Tokyo"]) {
      await withZone(zone, async (client) => {
        for (const [naive, day] of cases) {
          expect(await cohortFor(client, naive), `${zone} ${naive}`).toBe(day);
        }
        const shown = await client.query(`SHOW TIME ZONE`);
        expect(String(shown.rows[0].TimeZone ?? shown.rows[0].time_zone)).toBe(zone);
      });
    }
  });

  it("does not let a Chicago or Tokyo session pull a pre-baseline user across the line", async () => {
    for (const zone of ["America/Chicago", "Asia/Tokyo", "UTC"]) {
      await withZone(zone, async (client) => {
        await client.query(
          `INSERT INTO growth_instrumentation (id, started_at, note)
           VALUES ('stage1', '2026-11-07 12:00:00+00', 'tx')
           ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at`,
        );
        const before = `gst1_before_${zone}`;
        const after = `gst1_after_${zone}`;
        await client.query(
          `INSERT INTO users (id, username, email, created_at) VALUES
             ($1, $1, $2, '2026-11-07 11:59:59'),
             ($3, $3, $4, '2026-11-07 12:00:01')`,
          [before, `${before}@example.invalid`, after, `${after}@example.invalid`],
        );
        await client.query(
          `INSERT INTO local_credentials (id, user_id, password_hash) VALUES ($1, $2, 'x'), ($3, $4, 'x')`,
          [`${before}-c`, before, `${after}-c`, after],
        );
        const repaired = await reconcilePostBaselineSignups([before, after]);
        expect(repaired, zone).toBe(1);
        const rows = await client.query(
          `SELECT user_id, cohort_day,
                  occurred_at = ('2026-11-07 12:00:01'::timestamp AT TIME ZONE 'UTC') AS truthful
           FROM growth_lifecycle_events WHERE user_id = ANY($1::varchar[])`,
          [[before, after]],
        );
        expect(rows.rows).toEqual([
          expect.objectContaining({ user_id: after, cohort_day: "2026-11-07", truthful: true }),
        ]);
      });
    }
  });

  it("records D1 and D7 and the first-game window from timestamptz under a non-UTC session", async () => {
    await withZone("America/Chicago", async (client) => {
      await client.query(
        `INSERT INTO growth_instrumentation (id, started_at, note)
         VALUES ('stage1', '2026-10-01 00:00:00+00', 'tx')
         ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at`,
      );
      const id = "gst1_window";
      await client.query(
        `INSERT INTO users (id, username, email, created_at) VALUES ($1, $1, $2, '2026-11-07 23:50:00')`,
        [id, `${id}@example.invalid`],
      );
      await client.query(
        `INSERT INTO local_credentials (id, user_id, password_hash) VALUES ($1, $2, 'x')`,
        [`${id}-c`, id],
      );
      await client.query(GROWTH_SIGNUP_INSERT_SQL, [
        id, "email", "x", "social", "261107-daily5", "post-1", null, "/daily", "/daily", false,
      ]);
      const signup = await client.query(
        `SELECT cohort_day FROM growth_lifecycle_events WHERE user_id = $1 AND event_type = 'signup'`,
        [id],
      );
      expect(signup.rows[0].cohort_day).toBe("2026-11-07");
      await noteGrowthActivity(id, new Date("2026-11-08T05:50:00.000Z"));
      await noteGrowthActivity(id, new Date("2026-11-08T06:10:00.000Z"));
      await noteGrowthActivity(id, new Date("2026-11-14T18:00:00.000Z"));
      await noteGrowthGameCompleted(id, new Date("2026-11-08T05:00:00.000Z"));
      await noteGrowthGameCompleted(id, new Date("2026-11-12T18:00:00.000Z"));
      const events = await client.query(
        `SELECT event_type, to_char(occurred_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day
         FROM growth_lifecycle_events WHERE user_id = $1 ORDER BY event_type`,
        [id],
      );
      expect(events.rows).toEqual([
        { event_type: "day1_return", day: "2026-11-08" },
        { event_type: "day7_return", day: "2026-11-14" },
        { event_type: "first_game_completed", day: "2026-11-07" },
        { event_type: "signup", day: "2026-11-07" },
      ]);
    });
  });

  it("commits the signup event in the same transaction as the user, with the UTC created_at instant", async () => {
    const { storage } = await import("../storage");
    const name = `gst1_tx_${randomUUID().slice(0, 8)}`;
    const user = await storage.createLocalUser(name, `${name}@example.invalid`, "a-long-test-password", {
      provider: "email",
      attribution: { source: "bio", medium: "bio", campaign: "261107-daily5", content: "instagram-profile", landingPage: "/daily" },
    });
    try {
      const row = await pool!.query(
        `SELECT e.cohort_day,
                e.occurred_at = (u.created_at AT TIME ZONE 'UTC') AS truthful,
                e.destination
         FROM growth_lifecycle_events e
         JOIN users u ON u.id = e.user_id
         WHERE e.user_id = $1 AND e.event_type = 'signup'`,
        [user.id],
      );
      expect(row.rows[0].truthful).toBe(true);
      expect(row.rows[0].destination).toBe("/daily");
    } finally {
      await pool!.query(`DELETE FROM local_credentials WHERE user_id = $1`, [user.id]);
      await pool!.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    }
  });

  it("repairs an Instagram guess as unattributed, clips oversized attribution, and skips a credentialless user", async () => {
    const { classifyGrowthTouch } = await import("@shared/growthStage1");
    await withZone("America/Chicago", async (client) => {
      await client.query(
        `INSERT INTO growth_instrumentation (id, started_at, note)
         VALUES ('stage1', '2026-10-01 00:00:00+00', 'tx')
         ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at`,
      );
      const guessed = "gst1_guess";
      const bare = "gst1_bare";
      const hugeSource = "instagram".padEnd(255, "x");
      const hugeLanding = `/${"p".repeat(499)}`;
      await client.query(
        `INSERT INTO users (id, username, email, created_at) VALUES
           ($1, $1, $2, '2026-11-07 18:00:00'),
           ($3, $3, $4, '2026-11-07 18:00:00')`,
        [guessed, `${guessed}@example.invalid`, bare, `${bare}@example.invalid`],
      );
      await client.query(
        `INSERT INTO local_credentials (id, user_id, password_hash) VALUES ($1, $2, 'x')`,
        [`${guessed}-c`, guessed],
      );
      await client.query(
        `INSERT INTO user_attribution (user_id, utm_source, utm_medium, utm_content, landing_page, referrer)
         VALUES ($1, $2, 'social', 'bio', $3, $4)`,
        [guessed, hugeSource, hugeLanding, "l.instagram.com"],
      );
      const repaired = await reconcilePostBaselineSignups([guessed, bare]);
      expect(repaired).toBe(1);
      const row = await client.query(
        `SELECT provenance, inferred, raw_utm_source, length(raw_utm_source) AS source_len,
                length(landing_page) AS landing_len, raw_utm_medium, raw_utm_content
         FROM growth_lifecycle_events WHERE user_id = $1 AND event_type = 'signup'`,
        [guessed],
      );
      expect(row.rows[0].provenance).toBe("recovered");
      expect(row.rows[0].inferred).toBe(false);
      expect(Number(row.rows[0].source_len)).toBe(100);
      expect(Number(row.rows[0].landing_len)).toBe(200);
      expect(row.rows[0].raw_utm_source.startsWith("instagram")).toBe(true);
      const bareEvent = await client.query(
        `SELECT 1 FROM growth_lifecycle_events WHERE user_id = $1`,
        [bare],
      );
      expect(bareEvent.rows).toHaveLength(0);
      const touch = classifyGrowthTouch({
        source: row.rows[0].raw_utm_source,
        medium: row.rows[0].raw_utm_medium,
        content: row.rows[0].raw_utm_content,
        provenance: "recovered",
        inferred: false,
      });
      expect(touch.attributable).toBe(false);
      expect(touch.reason).toBe("recovered_unknown");
      expect(touch.source).toBeNull();
    });
  });

  it("enforces one signup row under concurrent inserts and rejects an unknown event type", async () => {
    const id = `gst1_${randomUUID()}`;
    try {
      await pool!.query(
        `INSERT INTO users (id, username, email, created_at)
         VALUES ($1, $1, $2, (now() AT TIME ZONE 'UTC'))`,
        [id, `${id}@example.invalid`],
      );
      await pool!.query(
        `INSERT INTO local_credentials (id, user_id, password_hash) VALUES ($1, $2, 'x')`,
        [`${id}-c`, id],
      );
      const params = [id, "email", "bio", "bio", "261107-daily5", "instagram-profile", null, "/daily", "/daily", false];
      await Promise.all([
        pool!.query(GROWTH_SIGNUP_INSERT_SQL, params),
        pool!.query(GROWTH_SIGNUP_INSERT_SQL, params),
        pool!.query(GROWTH_SIGNUP_INSERT_SQL, params),
        pool!.query(GROWTH_SIGNUP_INSERT_SQL, params),
      ]);
      const count = await pool!.query(
        `SELECT count(*)::int AS n FROM growth_lifecycle_events WHERE user_id = $1 AND event_type = 'signup'`,
        [id],
      );
      expect(count.rows[0].n).toBe(1);
      await expect(pool!.query(
        `INSERT INTO growth_lifecycle_events (user_id, event_type, occurred_at, cohort_day)
         VALUES ($1, 'not_an_event', now(), '2026-11-07')`,
        [id],
      )).rejects.toThrow(/growth_lifecycle_event_type_check|check constraint/i);
    } finally {
      await pool!.query(`DELETE FROM local_credentials WHERE user_id = $1`, [id]);
      await pool!.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
  });

  it("does not move the baseline when ensure runs again", async () => {
    await withZone("UTC", async (client) => {
      await client.query(
        `INSERT INTO growth_instrumentation (id, started_at, note)
         VALUES ('stage1', '2026-06-01 00:00:00+00', 'hold')
         ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at`,
      );
      await ensureGrowthInstrumentation();
      const row = await client.query(`SELECT started_at FROM growth_instrumentation WHERE id = 'stage1'`);
      expect(new Date(row.rows[0].started_at).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    });
  });

  it("agrees under a non-UTC Node timezone and a non-UTC database session", () => {
    const root = path.resolve(__dirname, "../..");
    const probe = path.join(__dirname, "growthStage1TzProbe.ts");
    for (const tz of ["UTC", "Pacific/Kiritimati", "America/Chicago"]) {
      const result = spawn(process.execPath, ["--import", "tsx", probe], {
        cwd: root,
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      });
      expect(result.status, `${tz}\n${result.stdout}\n${result.stderr}`).toBe(0);
      const body = JSON.parse(result.stdout.trim().split("\n").pop()!);
      expect(body.nodeTz).toBe(tz);
      expect(body.dbTimeZone).toBe("Asia/Tokyo");
      expect(body.cohortDay).toBe("2026-11-07");
      expect(body.sameInstant).toBe(true);
      expect(body.events).toEqual(["day1_return", "signup"]);
    }
  });
});

