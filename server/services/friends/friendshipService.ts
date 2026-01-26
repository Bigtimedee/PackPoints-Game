import { db } from "../../db";
import { friendships, users, type Friendship } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";

export function pairUserIds(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

export async function isAcceptedFriend(userId1: string, userId2: string): Promise<boolean> {
  const { low, high } = pairUserIds(userId1, userId2);
  
  const result = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(
      and(
        eq(friendships.userLow, low),
        eq(friendships.userHigh, high),
        eq(friendships.status, "ACCEPTED")
      )
    )
    .limit(1);
  
  return result.length > 0;
}

export async function getFriendshipById(friendshipId: string): Promise<Friendship | null> {
  const result = await db
    .select()
    .from(friendships)
    .where(eq(friendships.id, friendshipId))
    .limit(1);
  
  return result[0] || null;
}

export async function getFriendship(userId1: string, userId2: string): Promise<Friendship | null> {
  const { low, high } = pairUserIds(userId1, userId2);
  
  const result = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.userLow, low),
        eq(friendships.userHigh, high)
      )
    )
    .limit(1);
  
  return result[0] || null;
}

export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<{ success: boolean; friendship?: Friendship; error?: string }> {
  if (fromUserId === toUserId) {
    return { success: false, error: "Cannot friend yourself" };
  }

  const existing = await getFriendship(fromUserId, toUserId);
  
  if (existing) {
    if (existing.status === "ACCEPTED") {
      return { success: false, error: "Already friends" };
    }
    if (existing.status === "BLOCKED") {
      return { success: false, error: "Cannot send friend request" };
    }
    if (existing.status === "PENDING") {
      if (existing.initiatedBy === fromUserId) {
        return { success: false, error: "Friend request already sent" };
      } else {
        const updated = await acceptFriendRequest(existing.id, toUserId);
        return updated;
      }
    }
    if (existing.status === "DECLINED") {
      const { low, high } = pairUserIds(fromUserId, toUserId);
      const [updated] = await db
        .update(friendships)
        .set({ status: "PENDING", initiatedBy: fromUserId, updatedAt: new Date() })
        .where(eq(friendships.id, existing.id))
        .returning();
      return { success: true, friendship: updated };
    }
  }

  const { low, high } = pairUserIds(fromUserId, toUserId);
  
  const [friendship] = await db
    .insert(friendships)
    .values({
      userLow: low,
      userHigh: high,
      status: "PENDING",
      initiatedBy: fromUserId,
    })
    .returning();
  
  return { success: true, friendship };
}

export async function acceptFriendRequest(friendshipId: string, acceptingUserId: string): Promise<{ success: boolean; friendship?: Friendship; error?: string }> {
  const [existing] = await db
    .select()
    .from(friendships)
    .where(eq(friendships.id, friendshipId))
    .limit(1);
  
  if (!existing) {
    return { success: false, error: "Friend request not found" };
  }
  
  if (existing.status !== "PENDING") {
    return { success: false, error: "Friend request is not pending" };
  }
  
  if (existing.initiatedBy === acceptingUserId) {
    return { success: false, error: "Cannot accept your own friend request" };
  }
  
  const isRecipient = existing.userLow === acceptingUserId || existing.userHigh === acceptingUserId;
  if (!isRecipient) {
    return { success: false, error: "Not authorized to accept this request" };
  }
  
  const [updated] = await db
    .update(friendships)
    .set({ status: "ACCEPTED", updatedAt: new Date() })
    .where(eq(friendships.id, friendshipId))
    .returning();
  
  return { success: true, friendship: updated };
}

export async function declineFriendRequest(friendshipId: string, decliningUserId: string): Promise<{ success: boolean; error?: string }> {
  const [existing] = await db
    .select()
    .from(friendships)
    .where(eq(friendships.id, friendshipId))
    .limit(1);
  
  if (!existing) {
    return { success: false, error: "Friend request not found" };
  }
  
  if (existing.status !== "PENDING") {
    return { success: false, error: "Friend request is not pending" };
  }
  
  const isRecipient = (existing.userLow === decliningUserId || existing.userHigh === decliningUserId) && existing.initiatedBy !== decliningUserId;
  if (!isRecipient) {
    return { success: false, error: "Not authorized to decline this request" };
  }
  
  await db
    .update(friendships)
    .set({ status: "DECLINED", updatedAt: new Date() })
    .where(eq(friendships.id, friendshipId));
  
  return { success: true };
}

export async function blockUser(blockingUserId: string, blockedUserId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await getFriendship(blockingUserId, blockedUserId);
  
  if (existing) {
    await db
      .update(friendships)
      .set({ status: "BLOCKED", initiatedBy: blockingUserId, updatedAt: new Date() })
      .where(eq(friendships.id, existing.id));
  } else {
    const { low, high } = pairUserIds(blockingUserId, blockedUserId);
    await db
      .insert(friendships)
      .values({
        userLow: low,
        userHigh: high,
        status: "BLOCKED",
        initiatedBy: blockingUserId,
      });
  }
  
  return { success: true };
}

export async function removeFriend(userId: string, friendId: string): Promise<{ success: boolean; error?: string }> {
  const existing = await getFriendship(userId, friendId);
  
  if (!existing || existing.status !== "ACCEPTED") {
    return { success: false, error: "Not friends with this user" };
  }
  
  await db
    .delete(friendships)
    .where(eq(friendships.id, existing.id));
  
  return { success: true };
}

export interface FriendWithUser {
  friendshipId: string;
  friendId: string;
  username: string;
  profileImageUrl: string | null;
  status: string;
  initiatedBy: string;
  createdAt: Date | null;
}

export async function getAcceptedFriends(userId: string): Promise<FriendWithUser[]> {
  const result = await db.execute(sql`
    SELECT 
      f.id as friendship_id,
      CASE WHEN f.user_low = ${userId} THEN f.user_high ELSE f.user_low END as friend_id,
      u.username,
      u.profile_image_url,
      f.status,
      f.initiated_by,
      f.created_at
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_low = ${userId} THEN f.user_high ELSE f.user_low END
    WHERE (f.user_low = ${userId} OR f.user_high = ${userId})
      AND f.status = 'ACCEPTED'
    ORDER BY u.username ASC
  `);
  
  return (result.rows || []).map((row: any) => ({
    friendshipId: row.friendship_id,
    friendId: row.friend_id,
    username: row.username,
    profileImageUrl: row.profile_image_url,
    status: row.status,
    initiatedBy: row.initiated_by,
    createdAt: row.created_at,
  }));
}

export async function getPendingFriendRequests(userId: string): Promise<{ incoming: FriendWithUser[]; outgoing: FriendWithUser[] }> {
  const result = await db.execute(sql`
    SELECT 
      f.id as friendship_id,
      CASE WHEN f.user_low = ${userId} THEN f.user_high ELSE f.user_low END as friend_id,
      u.username,
      u.profile_image_url,
      f.status,
      f.initiated_by,
      f.created_at
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_low = ${userId} THEN f.user_high ELSE f.user_low END
    WHERE (f.user_low = ${userId} OR f.user_high = ${userId})
      AND f.status = 'PENDING'
    ORDER BY f.created_at DESC
  `);
  
  const all = (result.rows || []).map((row: any) => ({
    friendshipId: row.friendship_id,
    friendId: row.friend_id,
    username: row.username,
    profileImageUrl: row.profile_image_url,
    status: row.status,
    initiatedBy: row.initiated_by,
    createdAt: row.created_at,
  }));
  
  return {
    incoming: all.filter((f: FriendWithUser) => f.initiatedBy !== userId),
    outgoing: all.filter((f: FriendWithUser) => f.initiatedBy === userId),
  };
}

export async function searchUsersByUsername(prefix: string, excludeUserId?: string, limit: number = 10): Promise<{ userId: string; username: string; profileImageUrl: string | null }[]> {
  if (prefix.length < 3) {
    return [];
  }
  
  const normalizedPrefix = prefix.toLowerCase();
  
  const result = await db.execute(sql`
    SELECT id as user_id, username, profile_image_url
    FROM users
    WHERE username_normalized LIKE ${normalizedPrefix + '%'}
      ${excludeUserId ? sql`AND id != ${excludeUserId}` : sql``}
      AND status = 'ACTIVE'
    ORDER BY username ASC
    LIMIT ${limit}
  `);
  
  return (result.rows || []).map((row: any) => ({
    userId: row.user_id,
    username: row.username,
    profileImageUrl: row.profile_image_url,
  }));
}

export const friendshipService = {
  pairUserIds,
  isAcceptedFriend,
  getFriendship,
  getFriendshipById,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  blockUser,
  removeFriend,
  getAcceptedFriends,
  getPendingFriendRequests,
  searchUsersByUsername,
};
