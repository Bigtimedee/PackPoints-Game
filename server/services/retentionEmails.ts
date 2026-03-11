import { db } from "../db";
import { users, streakState } from "@shared/schema";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { sendStreakReminderEmail, sendReEngagementEmail } from "./emailService";

let lastStreakReminderDate = "";
let lastReEngagementDate = "";

export async function sendStreakReminderBatch(): Promise<void> {
  // Users with streak >= 3 who last played yesterday are at risk of losing it today
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const atRiskUsers = await db
    .select({
      userId: streakState.userId,
      currentDays: streakState.currentDays,
      email: users.email,
      username: users.username,
    })
    .from(streakState)
    .innerJoin(users, eq(streakState.userId, users.id))
    .where(
      and(
        gte(streakState.currentDays, 3),
        eq(streakState.lastActiveLocalDate, yesterdayStr),
        eq(users.status, "ACTIVE"),
        isNotNull(users.email),
      ),
    );

  let sent = 0;
  for (const user of atRiskUsers) {
    if (!user.email || !user.username) continue;
    try {
      await sendStreakReminderEmail(user.email, user.username, user.currentDays);
      sent++;
    } catch (err) {
      console.error("[RetentionEmails] Streak reminder failed for user:", user.userId, err);
    }
  }

  console.log(`[RetentionEmails] Streak reminder batch complete: ${sent}/${atRiskUsers.length} emails sent`);
}

export async function sendReEngagementBatch(): Promise<void> {
  // Users who last played 3–7 days ago — lapsed but not too far gone
  const today = new Date().toISOString().slice(0, 10);

  const threeDaysAgo = new Date();
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
  const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const lapsedUsers = await db
    .select({
      userId: streakState.userId,
      email: users.email,
      username: users.username,
      lastActiveLocalDate: streakState.lastActiveLocalDate,
      correctAnswers: users.correctAnswers,
    })
    .from(streakState)
    .innerJoin(users, eq(streakState.userId, users.id))
    .where(
      and(
        lte(streakState.lastActiveLocalDate, threeDaysAgoStr),
        gte(streakState.lastActiveLocalDate, sevenDaysAgoStr),
        eq(users.status, "ACTIVE"),
        isNotNull(users.email),
      ),
    );

  let sent = 0;
  for (const user of lapsedUsers) {
    if (!user.email || !user.username) continue;
    const lastDate = user.lastActiveLocalDate ?? sevenDaysAgoStr;
    const daysSince = Math.round(
      (new Date(today).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    try {
      await sendReEngagementEmail(user.email, user.username, daysSince, user.correctAnswers ?? 0);
      sent++;
    } catch (err) {
      console.error("[RetentionEmails] Re-engagement failed for user:", user.userId, err);
    }
  }

  console.log(`[RetentionEmails] Re-engagement batch complete: ${sent}/${lapsedUsers.length} emails sent`);
}

export function startRetentionEmailLoops(): void {
  setInterval(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const utcHour = new Date().getUTCHours();

    // Streak reminders at ~20:00 UTC (3 PM ET) — once per day
    if (utcHour === 20 && lastStreakReminderDate !== today) {
      lastStreakReminderDate = today;
      sendStreakReminderBatch().catch(err =>
        console.error("[RetentionEmails] Streak reminder batch error:", err),
      );
    }

    // Re-engagement emails at ~14:00 UTC (9 AM ET) — once per day
    if (utcHour === 14 && lastReEngagementDate !== today) {
      lastReEngagementDate = today;
      sendReEngagementBatch().catch(err =>
        console.error("[RetentionEmails] Re-engagement batch error:", err),
      );
    }
  }, 60 * 60 * 1000); // check every hour

  console.log("[RetentionEmails] Retention email loops started");
}
