import { sql } from "drizzle-orm";
import { db } from "../db";
import { TEST_ACCOUNT_SEED_USERNAMES } from "@shared/schema";
import { QA_TEST_USER_ID } from "@shared/qaTestAccount";

/**
 * Migration-safe: adds the column if push has not yet, then flags the seeded
 * accounts. Never unflags anything. Idempotent.
 */
export async function seedTestAccounts(): Promise<number> {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false`);
  const names = [...TEST_ACCOUNT_SEED_USERNAMES].map((n) => n.toLowerCase());
  const res = await db.execute(sql`
    UPDATE users SET is_test_account = true
    WHERE is_test_account = false
      AND (id = ${QA_TEST_USER_ID}
        OR lower(coalesce(username_normalized, username, '')) IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)}))
  `);
  return (res as any).rowCount ?? 0;
}

const CANDIDATE_PATTERN = "(e2e|test|qa)";

/** Read-only inventory for the QA route: flagged accounts, unflagged look-alikes, signup totals. */
export async function testAccountInventory() {
  const flagged = await db.execute(sql`SELECT username, created_at FROM users WHERE is_test_account = true ORDER BY created_at`);
  const candidates = await db.execute(sql`
    SELECT username, created_at FROM users
    WHERE is_test_account = false
      AND (lower(coalesce(username,'')) ~ ${CANDIDATE_PATTERN} OR lower(coalesce(email,'')) ~ ${CANDIDATE_PATTERN}
           OR lower(coalesce(first_name,'')) ~ ${CANDIDATE_PATTERN})
    ORDER BY created_at`);
  const [counts] = (await db.execute(sql`
    SELECT count(*)::int AS all_users, count(*) FILTER (WHERE is_test_account = false)::int AS real_users FROM users`)).rows as any[];
  const pick = (rows: any) => (rows.rows as any[]).map((r) => ({ username: r.username, createdAt: r.created_at }));
  return { flagged: pick(flagged), candidates: pick(candidates), signupCounts: { includingTest: counts.all_users, excludingTest: counts.real_users } };
}
