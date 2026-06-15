import webPush from "web-push";
import { db } from "../db";
import { pushSubscriptions } from "@shared/schema";
import { eq } from "drizzle-orm";

function configureVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webPush.setVapidDetails("mailto:noreply@packpts.com", publicKey, privateKey);
  return true;
}

const vapidReady = configureVapid();

export async function saveSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent: string | null = null
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh, auth, userAgent, updatedAt: new Date() },
    });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<void> {
  if (!vapidReady) {
    console.warn("[Push] VAPID keys not configured — push skipped for user", userId.substring(0, 8));
    return;
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 86400 }
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — remove it
        await removeSubscription(sub.endpoint);
      } else {
        console.error("[Push] send error:", err.message);
      }
    }
  }
}

export type NotificationType = "streak_at_risk" | "daily5_live" | "match_invite";

export interface NotificationPayload {
  type: NotificationType;
  userId: string;
  extra?: Record<string, unknown>;
}

export async function sendReengagementNotification(opts: NotificationPayload): Promise<void> {
  const { type, userId, extra } = opts;

  let title: string;
  let body: string;
  let url: string;
  let tag: string;

  switch (type) {
    case "streak_at_risk":
      title = "Your streak is at risk!";
      body = `Play today to keep your ${extra?.streakDays ?? ""}-day streak alive.`;
      url = "/play";
      tag = "streak-at-risk";
      break;
    case "daily5_live":
      title = "Daily 5 is live!";
      body = "Five new cards are waiting. Earn bonus PackPTS today.";
      url = "/daily";
      tag = "daily5-live";
      break;
    case "match_invite":
      title = "You've been challenged!";
      body = `${extra?.fromUsername ?? "Someone"} wants to play a 1v1 match.`;
      url = extra?.lobbyCode ? `/lobby/${extra.lobbyCode}` : "/play";
      tag = "match-invite";
      break;
  }

  await sendPushToUser(userId, { title, body, url, tag });
}
