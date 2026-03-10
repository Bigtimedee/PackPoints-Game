import { db } from "../db";
import { sql } from "drizzle-orm";
import { sendStreakReminderEmail, sendReEngagementEmail } from "./emailService";

const STREAK_REMINDER_MIN_DAYS = 3;
const REENGAGEMENT_LAPSED_DAYS = 3;
const REENGAGEMENT_MAX_DAYS = 30;

export async function sendStreakReminderBatch(): Promise<void> {
  try {
    // Find users with active streaks >= threshold who have NOT played today
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        ss.current_days
      FROM streak_state ss
      JOIN users u ON u.id = ss.user_id
      WHERE
        ss.current_days >= ${STREAK_REMINDER_MIN_DAYS}
        AND u.email IS NOT NULL
        AND u.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM matches m
          WHERE m.user_id = u.id
            AND m.status = 'COMPLETED'
            AND m.created_at >= NOW()::date
        )
      LIMIT 500
    `);

    const rows = result.rows as Array<{
      id: string;
      email: string;
      username: string;
      current_days: number;
    }>;

    let sent = 0;
    for (const row of rows) {
      try {
        const ok = await sendStreakReminderEmail(row.email, row.username, row.current_days);
        if (ok) sent++;
      } catch { /* per-user failure is non-fatal */ }
    }

    if (rows.length > 0) {
      console.log(`[RetentionEmails] Streak reminders: ${sent}/${rows.length} sent`);
    }
  } catch (err) {
    console.error("[RetentionEmails] sendStreakReminderBatch error:", err);
  }
}

export async function sendReEngagementBatch(): Promise<void> {
  try {
    // Find users inactive for 3–30 days who have not received a re-engagement email recently
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.username,
        EXTRACT(DAY FROM NOW() - MAX(m.created_at))::int AS days_since,
        COUNT(ma.id)::int AS total_cards
      FROM users u
      JOIN matches m ON m.user_id = u.id AND m.status = 'COMPLETED'
      LEFT JOIN match_answers ma ON ma.user_id = u.id
      WHERE
        u.email IS NOT NULL
        AND u.status = 'ACTIVE'
      GROUP BY u.id, u.email, u.username
      HAVING
        EXTRACT(DAY FROM NOW() - MAX(m.created_at)) >= ${REENGAGEMENT_LAPSED_DAYS}
        AND EXTRACT(DAY FROM NOW() - MAX(m.created_at)) <= ${REENGAGEMENT_MAX_DAYS}
      LIMIT 500
    `);

    const rows = result.rows as Array<{
      id: string;
      email: string;
      username: string;
      days_since: number;
      total_cards: number;
    }>;

    let sent = 0;
    for (const row of rows) {
      try {
        const ok = await sendReEngagementEmail(
          row.email,
          row.username,
          row.days_since,
          row.total_cards,
        );
        if (ok) sent++;
      } catch { /* per-user failure is non-fatal */ }
    }

    if (rows.length > 0) {
      console.log(`[RetentionEmails] Re-engagement: ${sent}/${rows.length} sent`);
    }
  } catch (err) {
    console.error("[RetentionEmails] sendReEngagementBatch error:", err);
  }
}

export function startRetentionEmailLoops(): void {
  // Streak reminders: run once daily at ~6 PM UTC (18:00)
  const STREAK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const STREAK_INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after startup

  setTimeout(() => {
    sendStreakReminderBatch().catch(err =>
      console.error("[RetentionEmails] Initial streak reminder failed:", err)
    );
    setInterval(() => {
      sendStreakReminderBatch().catch(err =>
        console.error("[RetentionEmails] Streak reminder failed:", err)
      );
    }, STREAK_INTERVAL_MS);
  }, STREAK_INITIAL_DELAY_MS);

  // Re-engagement: run once daily (offset by 30 min to spread load)
  const REENG_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const REENG_INITIAL_DELAY_MS = 32 * 60 * 1000; // 32 min after startup

  setTimeout(() => {
    sendReEngagementBatch().catch(err =>
      console.error("[RetentionEmails] Initial re-engagement failed:", err)
    );
    setInterval(() => {
      sendReEngagementBatch().catch(err =>
        console.error("[RetentionEmails] Re-engagement failed:", err)
      );
    }, REENG_INTERVAL_MS);
  }, REENG_INITIAL_DELAY_MS);

  console.log("[RetentionEmails] Streak reminder and re-engagement loops started");
}
