/**
 * Guest invite codes. The code is not a referral link until the guest
 * registers. Migration re-runs the existing welcome-bonus fraud checks.
 * Reward amounts stay in referralRewards.
 */
import crypto from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { guestInviteBanner } from "@shared/guestInvite";
import { guestInviteExpiry } from "@shared/guestInvite";
import { clampDailyScore } from "@shared/guestInvite";
import {
  anonDailyRuns,
  guestInviteCodes,
  guestInviteRedemptions,
  referralAttributions,
  referralLinks,
  users,
} from "@shared/schema";
import { db } from "../db";
import { evaluateWelcomeBonus } from "./referralProgram";

type MigrateCtx = { ipHash?: string | null; deviceId?: string | null };

function freshCode(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8);
}

async function codeTaken(code: string): Promise<boolean> {
  const [link] = await db.select({ id: referralLinks.id }).from(referralLinks).where(eq(referralLinks.code, code)).limit(1);
  if (link) return true;
  const [guest] = await db.select({ id: guestInviteCodes.id }).from(guestInviteCodes).where(eq(guestInviteCodes.code, code)).limit(1);
  return Boolean(guest);
}

async function allocateCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = freshCode();
    if (!(await codeTaken(code))) return code;
  }
  throw new Error("Could not allocate invite code");
}

async function latestCorrectCount(anonPlayerId: string): Promise<number> {
  const [run] = await db.select({ correctCount: anonDailyRuns.correctCount })
    .from(anonDailyRuns)
    .where(and(eq(anonDailyRuns.anonPlayerId, anonPlayerId), sql`${anonDailyRuns.completedAt} is not null`))
    .orderBy(desc(anonDailyRuns.completedAt))
    .limit(1);
  return clampDailyScore(run?.correctCount ?? 0);
}

export async function getOrCreateGuestInvite(anonPlayerId: string): Promise<{ code: string; correctCount: number } | null> {
  const now = new Date();
  const [existing] = await db.select().from(guestInviteCodes)
    .where(and(eq(guestInviteCodes.anonPlayerId, anonPlayerId), isNull(guestInviteCodes.migratedAt)))
    .orderBy(desc(guestInviteCodes.createdAt))
    .limit(1);
  const score = await latestCorrectCount(anonPlayerId);
  if (existing && existing.expiresAt > now) {
    if (existing.correctCount !== score) {
      await db.update(guestInviteCodes).set({ correctCount: score }).where(eq(guestInviteCodes.id, existing.id));
    }
    return { code: existing.code, correctCount: score };
  }
  const code = await allocateCode();
  await db.insert(guestInviteCodes).values({
    anonPlayerId,
    code,
    correctCount: score,
    expiresAt: guestInviteExpiry(now.getTime()),
  });
  return { code, correctCount: score };
}

export async function guestInvitePreview(code: string): Promise<{ name: string; correctCount: number; line: string } | null> {
  const [row] = await db.select().from(guestInviteCodes).where(eq(guestInviteCodes.code, code)).limit(1);
  if (!row) return null;
  const expired = row.expiresAt <= new Date();
  if (!row.migratedAt && expired) return null;
  let username: string | null = null;
  if (row.migratedUserId) {
    const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, row.migratedUserId)).limit(1);
    username = user?.username ?? null;
  }
  const correctCount = clampDailyScore(row.correctCount);
  return { name: username || "a player", correctCount, line: guestInviteBanner(username, correctCount) };
}

/** Remember a signup against a still-guest code. Points wait for migration. */
export async function redeemGuestInvite(code: string, invitedUserId: string, ctx: MigrateCtx): Promise<"pending" | "missing" | "self"> {
  const [row] = await db.select().from(guestInviteCodes).where(eq(guestInviteCodes.code, code)).limit(1);
  if (!row || row.migratedAt || row.expiresAt <= new Date()) return "missing";
  try {
    await db.insert(guestInviteRedemptions).values({
      guestInviteCodeId: row.id,
      invitedUserId,
      ipHash: ctx.ipHash || null,
      deviceId: ctx.deviceId || null,
    });
  } catch (err: any) {
    if (err?.code !== "23505") throw err;
  }
  return "pending";
}

/**
 * Attach this guest's live codes to the new account and run welcome-bonus
 * fraud checks for friends who already signed up. Idempotent.
 */
export async function migrateGuestInvites(anonPlayerId: string, userId: string, ctx: MigrateCtx = {}): Promise<void> {
  const rows = await db.select().from(guestInviteCodes)
    .where(and(eq(guestInviteCodes.anonPlayerId, anonPlayerId), isNull(guestInviteCodes.migratedAt)));
  const now = new Date();
  for (const row of rows) {
    if (row.expiresAt <= now) continue;
    let [link] = await db.select().from(referralLinks).where(eq(referralLinks.code, row.code)).limit(1);
    if (!link) {
      [link] = await db.insert(referralLinks).values({
        code: row.code,
        createdByUserId: userId,
        purpose: "INVITE",
        destinationPath: "/daily5",
        isActive: true,
      }).returning();
    }
    const redemptions = await db.select().from(guestInviteRedemptions)
      .where(eq(guestInviteRedemptions.guestInviteCodeId, row.id));
    for (const rec of redemptions) {
      if (rec.invitedUserId === userId) continue;
      await db.insert(referralAttributions).values({
        referralLinkId: link.id,
        invitedUserId: rec.invitedUserId,
        eventType: "SIGNUP",
      }).onConflictDoNothing();
      await evaluateWelcomeBonus(rec.invitedUserId, link.id, {
        ipHash: rec.ipHash || ctx.ipHash || null,
        deviceId: rec.deviceId || ctx.deviceId || null,
      });
    }
    await db.update(guestInviteCodes).set({ migratedUserId: userId, migratedAt: now }).where(eq(guestInviteCodes.id, row.id));
  }
}
