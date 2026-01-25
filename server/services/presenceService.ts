import { db } from "../db";
import { sql } from "drizzle-orm";

export type PresenceStatus = "ONLINE" | "OFFLINE" | "IN_MATCH" | "SEARCHING";

interface UserPresence {
  userId: string;
  socketId: string | null;
  status: PresenceStatus;
  lastSeenAt: Date;
  updatedAt: Date;
}

class PresenceService {
  async setOnline(userId: string, socketId: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO user_presence (user_id, socket_id, status, last_seen_at, updated_at)
      VALUES (${userId}, ${socketId}, 'ONLINE', NOW(), NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        socket_id = ${socketId},
        status = 'ONLINE',
        last_seen_at = NOW(),
        updated_at = NOW()
    `);
  }

  async setOffline(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE user_presence 
      SET status = 'OFFLINE', socket_id = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }

  async setSearching(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE user_presence 
      SET status = 'SEARCHING', updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }

  async setInMatch(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE user_presence 
      SET status = 'IN_MATCH', updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }

  async updateLastSeen(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE user_presence 
      SET last_seen_at = NOW(), updated_at = NOW()
      WHERE user_id = ${userId}
    `);
  }

  async getPresence(userId: string): Promise<UserPresence | null> {
    const result = await db.execute(sql`
      SELECT user_id, socket_id, status, last_seen_at, updated_at
      FROM user_presence
      WHERE user_id = ${userId}
    `);

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      userId: row.user_id,
      socketId: row.socket_id,
      status: row.status as PresenceStatus,
      lastSeenAt: new Date(row.last_seen_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async getOnlineCount(): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM user_presence
      WHERE status != 'OFFLINE'
    `);

    return parseInt((result.rows[0] as any)?.count || "0", 10);
  }

  async getSearchingCount(): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM user_presence
      WHERE status = 'SEARCHING'
    `);

    return parseInt((result.rows[0] as any)?.count || "0", 10);
  }

  async cleanupStalePresence(staleThresholdMs: number = 120000): Promise<number> {
    const result = await db.execute(sql`
      UPDATE user_presence 
      SET status = 'OFFLINE', socket_id = NULL, updated_at = NOW()
      WHERE status != 'OFFLINE' 
        AND last_seen_at < NOW() - INTERVAL '${sql.raw(staleThresholdMs.toString())} milliseconds'
      RETURNING user_id
    `);

    return result.rows?.length || 0;
  }

  async getPresenceStats(): Promise<{
    online: number;
    searching: number;
    inMatch: number;
    total: number;
  }> {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'ONLINE') as online,
        COUNT(*) FILTER (WHERE status = 'SEARCHING') as searching,
        COUNT(*) FILTER (WHERE status = 'IN_MATCH') as in_match,
        COUNT(*) FILTER (WHERE status != 'OFFLINE') as total
      FROM user_presence
    `);

    const row = result.rows[0] as any;
    return {
      online: parseInt(row?.online || "0", 10),
      searching: parseInt(row?.searching || "0", 10),
      inMatch: parseInt(row?.in_match || "0", 10),
      total: parseInt(row?.total || "0", 10),
    };
  }
}

export const presenceService = new PresenceService();
