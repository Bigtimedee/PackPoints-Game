/**
 * Child process for the Postgres timezone proof. The parent sets TZ.
 * All writes roll back. Nothing is committed.
 */
import pg from "pg";
import { noteGrowthActivity, recordGrowthSignup, setGrowthQueryableForTests } from "../services/growthStage1";

const id = `gst1tz_${process.pid}`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL missing");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`SET LOCAL TIME ZONE 'Asia/Tokyo'`);
  setGrowthQueryableForTests(client);
  await client.query(
    `INSERT INTO growth_instrumentation (id, started_at, note)
     VALUES ('stage1', '2026-11-07 12:00:00+00', 'timezone probe')
     ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at`,
  );
  await client.query(
    `INSERT INTO users (id, username, email, created_at, is_admin, is_bot, is_test_account)
     VALUES ($1, $2, $3, '2026-11-07 12:00:01', false, false, false)`,
    [id, id, `${id}@example.invalid`],
  );
  await recordGrowthSignup(id, {
    source: "instagram",
    medium: "social",
    campaign: "261107-87topps",
    content: "post-a",
    landingPage: "/daily",
  }, "email");
  await noteGrowthActivity(id, new Date("2026-11-08T06:10:00.000Z"));
  await noteGrowthActivity(id, new Date("2026-11-08T05:50:00.000Z"));
  const signup = await client.query(
    `SELECT cohort_day,
            occurred_at = ('2026-11-07 12:00:01'::timestamp AT TIME ZONE 'UTC') AS same_instant
     FROM growth_lifecycle_events
     WHERE user_id = $1 AND event_type = 'signup'`,
    [id],
  );
  const events = await client.query(
    `SELECT event_type FROM growth_lifecycle_events WHERE user_id = $1 ORDER BY event_type`,
    [id],
  );
  const zone = await client.query(`SHOW TIME ZONE`);
  console.log(JSON.stringify({
    nodeTz: process.env.TZ ?? null,
    dbTimeZone: zone.rows[0]?.TimeZone ?? zone.rows[0]?.time_zone ?? null,
    cohortDay: signup.rows[0]?.cohort_day ?? null,
    sameInstant: signup.rows[0]?.same_instant === true,
    events: events.rows.map((row: { event_type: string }) => row.event_type),
  }));
  await client.query("ROLLBACK");
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
} finally {
  setGrowthQueryableForTests(null);
  client.release();
  await pool.end();
}
