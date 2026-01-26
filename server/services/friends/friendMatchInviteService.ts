import { db } from "../../db";
import { friendMatchInvites, users, lobbies, type FriendMatchInvite } from "@shared/schema";
import { eq, and, sql, gt, lt } from "drizzle-orm";
import { isAcceptedFriend } from "./friendshipService";
import { matchService } from "../matchService";
import { randomUUID } from "crypto";

const INVITE_EXPIRY_MINUTES = 5;
const MAX_INVITES_PER_HOUR = 10;

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let secret = "";
  for (let i = 0; i < 32; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

export interface InviteResult {
  success: boolean;
  invite?: FriendMatchInvite;
  error?: string;
}

export async function createFriendMatchInvite(
  fromUserId: string, 
  toUserId: string, 
  bucket: string = "ANY"
): Promise<InviteResult> {
  if (fromUserId === toUserId) {
    return { success: false, error: "Cannot invite yourself" };
  }

  const areFriends = await isAcceptedFriend(fromUserId, toUserId);
  if (!areFriends) {
    return { success: false, error: "You must be friends to send a match invite" };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentInvitesResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM friend_match_invites
    WHERE from_user_id = ${fromUserId}
      AND created_at > ${hourAgo}
  `);
  const recentCount = Number((recentInvitesResult.rows?.[0] as any)?.count || 0);
  if (recentCount >= MAX_INVITES_PER_HOUR) {
    return { success: false, error: "Rate limit exceeded. Maximum 10 invites per hour." };
  }

  const existingResult = await db
    .select()
    .from(friendMatchInvites)
    .where(
      and(
        eq(friendMatchInvites.fromUserId, fromUserId),
        eq(friendMatchInvites.toUserId, toUserId),
        eq(friendMatchInvites.bucket, bucket),
        eq(friendMatchInvites.status, "PENDING"),
        gt(friendMatchInvites.expiresAt, new Date())
      )
    )
    .limit(1);

  if (existingResult.length > 0) {
    return { success: true, invite: existingResult[0] };
  }

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MINUTES * 60 * 1000);

  const [invite] = await db
    .insert(friendMatchInvites)
    .values({
      fromUserId,
      toUserId,
      bucket,
      mode: "1vFriends",
      status: "PENDING",
      expiresAt,
    })
    .returning();

  return { success: true, invite };
}

export async function cancelFriendMatchInvite(inviteId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  const [invite] = await db
    .select()
    .from(friendMatchInvites)
    .where(eq(friendMatchInvites.id, inviteId))
    .limit(1);

  if (!invite) {
    return { success: false, error: "Invite not found" };
  }

  if (invite.fromUserId !== userId) {
    return { success: false, error: "Not authorized to cancel this invite" };
  }

  if (invite.status !== "PENDING") {
    return { success: false, error: "Invite is not pending" };
  }

  await db
    .update(friendMatchInvites)
    .set({ status: "CANCELLED" })
    .where(eq(friendMatchInvites.id, inviteId));

  return { success: true };
}

export interface RespondResult {
  success: boolean;
  matchId?: string;
  lobbyId?: string;
  hostSecret?: string;
  guestSecret?: string;
  error?: string;
}

export async function respondToFriendMatchInvite(
  inviteId: string, 
  userId: string, 
  action: "ACCEPT" | "DECLINE"
): Promise<RespondResult> {
  const [invite] = await db
    .select()
    .from(friendMatchInvites)
    .where(eq(friendMatchInvites.id, inviteId))
    .limit(1);

  if (!invite) {
    return { success: false, error: "Invite not found" };
  }

  if (invite.toUserId !== userId) {
    return { success: false, error: "Not authorized to respond to this invite" };
  }

  if (invite.status !== "PENDING") {
    return { success: false, error: "Invite is not pending" };
  }

  if (invite.expiresAt < new Date()) {
    await db
      .update(friendMatchInvites)
      .set({ status: "EXPIRED" })
      .where(eq(friendMatchInvites.id, inviteId));
    return { success: false, error: "Invite has expired" };
  }

  if (action === "DECLINE") {
    await db
      .update(friendMatchInvites)
      .set({ status: "DECLINED" })
      .where(eq(friendMatchInvites.id, inviteId));
    return { success: true };
  }

  const [fromUser] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, invite.fromUserId))
    .limit(1);

  const [toUser] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, invite.toUserId))
    .limit(1);

  const lobbyId = randomUUID();
  const joinCode = generateJoinCode();
  const hostSecret = generateSecret();
  const guestSecret = generateSecret();

  await db.insert(lobbies).values({
    id: lobbyId,
    joinCode,
    hostId: invite.fromUserId,
    hostUsername: fromUser?.username || "Player1",
    hostSecret,
    guestId: invite.toUserId,
    guestUsername: toUser?.username || "Player2",
    guestSecret,
    status: "ready",
    mode: "1v1_friend",
    totalQuestions: 10,
    gameSetId: invite.bucket !== "ANY" ? invite.bucket : null,
    createdAt: new Date(),
  });

  const match = await matchService.startMatchForRandom(lobbyId);

  if (!match) {
    return { success: false, error: "Failed to create match" };
  }

  await db
    .update(friendMatchInvites)
    .set({ status: "ACCEPTED", matchId: match.matchId })
    .where(eq(friendMatchInvites.id, inviteId));

  return { 
    success: true, 
    matchId: match.matchId, 
    lobbyId,
    hostSecret,
    guestSecret,
  };
}

export interface InboxInvite {
  inviteId: string;
  fromUserId: string;
  fromUsername: string;
  fromProfileImageUrl: string | null;
  bucket: string;
  expiresAt: Date;
  createdAt: Date | null;
}

export async function getIncomingInvites(userId: string): Promise<InboxInvite[]> {
  const result = await db.execute(sql`
    SELECT 
      i.id as invite_id,
      i.from_user_id,
      u.username as from_username,
      u.profile_image_url as from_profile_image_url,
      i.bucket,
      i.expires_at,
      i.created_at
    FROM friend_match_invites i
    JOIN users u ON u.id = i.from_user_id
    WHERE i.to_user_id = ${userId}
      AND i.status = 'PENDING'
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `);

  return (result.rows || []).map((row: any) => ({
    inviteId: row.invite_id,
    fromUserId: row.from_user_id,
    fromUsername: row.from_username,
    fromProfileImageUrl: row.from_profile_image_url,
    bucket: row.bucket,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function getOutgoingInvites(userId: string): Promise<{ inviteId: string; toUserId: string; toUsername: string; bucket: string; expiresAt: Date }[]> {
  const result = await db.execute(sql`
    SELECT 
      i.id as invite_id,
      i.to_user_id,
      u.username as to_username,
      i.bucket,
      i.expires_at
    FROM friend_match_invites i
    JOIN users u ON u.id = i.to_user_id
    WHERE i.from_user_id = ${userId}
      AND i.status = 'PENDING'
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `);

  return (result.rows || []).map((row: any) => ({
    inviteId: row.invite_id,
    toUserId: row.to_user_id,
    toUsername: row.to_username,
    bucket: row.bucket,
    expiresAt: row.expires_at,
  }));
}

export async function expireOldInvites(): Promise<string[]> {
  const result = await db.execute(sql`
    UPDATE friend_match_invites 
    SET status = 'EXPIRED'
    WHERE status = 'PENDING' AND expires_at < NOW()
    RETURNING to_user_id
  `);

  return (result.rows || []).map((row: any) => row.to_user_id);
}

export const friendMatchInviteService = {
  createFriendMatchInvite,
  cancelFriendMatchInvite,
  respondToFriendMatchInvite,
  getIncomingInvites,
  getOutgoingInvites,
  expireOldInvites,
};
