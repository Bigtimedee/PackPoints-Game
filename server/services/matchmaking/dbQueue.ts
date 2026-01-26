import { randomUUID } from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { lobbies } from "@shared/schema";
import { matchService } from "../matchService";
import { presenceService } from "../presenceService";

export type TicketStatus = "WAITING" | "MATCHED" | "CANCELLED" | "EXPIRED";
export type MatchmakingMode = "1vRandom";

const HEARTBEAT_ALIVE_SECONDS = 30;

interface TicketRow {
  id: string;
  user_id: string;
  mode: string;
  bucket: string;
  status: string;
  socket_id: string | null;
  last_heartbeat_at: Date;
  created_at: Date;
}

interface QueueStats {
  playersInQueue: number;
  yourPosition: number;
  bucket: string;
}

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

export interface MatchResult {
  matchId: string;
  lobbyId: string;
  player1: { userId: string; secret: string };
  player2: { userId: string; secret: string };
}

class DbMatchmakingQueue {
  private statusBroadcastInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private matchCheckInterval: NodeJS.Timeout | null = null;
  
  private userSockets: Map<string, { ws: any; username: string; socketId: string; gameSetId: string | null; totalQuestions: number }> = new Map();
  private onMatchCallback: ((result: MatchResult) => void) | null = null;

  constructor() {
    this.startMatchmaking();
    this.startStatusBroadcasts();
    this.startCleanupJob();
  }

  setMatchCallback(callback: (result: MatchResult) => void) {
    this.onMatchCallback = callback;
  }

  private startMatchmaking() {
    this.matchCheckInterval = setInterval(() => {
      this.attemptPair().catch(err => {
        console.error("[DbQueue] Pairing error:", err);
      });
    }, 500);
  }

  private startStatusBroadcasts() {
    this.statusBroadcastInterval = setInterval(() => {
      this.broadcastQueueStatus().catch(err => {
        console.error("[DbQueue] Status broadcast error:", err);
      });
    }, 3000);
  }

  private startCleanupJob() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleTickets().catch(err => {
        console.error("[DbQueue] Cleanup error:", err);
      });
    }, 10000);
  }

  async joinQueue(
    userId: string, 
    username: string, 
    ws: any, 
    socketId: string, 
    totalQuestions: number = 10, 
    gameSetId: string | null = null
  ): Promise<{ ticketId: string; position: number; queueSize: number }> {
    const mode: MatchmakingMode = "1vRandom";
    const bucket = gameSetId || "random";
    
    await db.execute(sql`
      UPDATE matchmaking_tickets 
      SET status = 'CANCELLED'::ticket_status, updated_at = NOW()
      WHERE user_id = ${userId} AND status = 'WAITING'
    `);

    const ticketId = randomUUID();
    
    await db.execute(sql`
      INSERT INTO matchmaking_tickets (id, user_id, mode, bucket, status, socket_id, last_heartbeat_at, created_at, updated_at)
      VALUES (${ticketId}, ${userId}, ${mode}::matchmaking_mode, ${bucket}, 'WAITING'::ticket_status, ${socketId}, NOW(), NOW(), NOW())
    `);

    this.userSockets.set(userId, { ws, username, socketId, gameSetId, totalQuestions });

    await presenceService.setSearching(userId);

    const stats = await this.getQueueStats(ticketId);
    
    console.log(`[DbQueue] ${username} joined queue. Ticket: ${ticketId.slice(0, 8)}..., Position: ${stats.yourPosition}, Queue: ${stats.playersInQueue}`);

    this.attemptPair().catch(err => console.error("[DbQueue] Immediate pair attempt error:", err));

    return { 
      ticketId, 
      position: stats.yourPosition, 
      queueSize: stats.playersInQueue 
    };
  }

  async leaveQueue(userId: string): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE matchmaking_tickets 
      SET status = 'CANCELLED'::ticket_status, updated_at = NOW()
      WHERE user_id = ${userId} AND status = 'WAITING'
      RETURNING id
    `);

    this.userSockets.delete(userId);

    const userSocket = this.userSockets.get(userId);
    if (userSocket?.socketId) {
      await presenceService.setOnline(userId, userSocket.socketId);
    }

    const cancelled = (result.rows?.length || 0) > 0;
    if (cancelled) {
      console.log(`[DbQueue] User ${userId} left queue`);
    }
    return cancelled;
  }

  async updateHeartbeat(userId: string): Promise<void> {
    await db.execute(sql`
      UPDATE matchmaking_tickets 
      SET last_heartbeat_at = NOW()
      WHERE user_id = ${userId} AND status = 'WAITING'
    `);
  }

  async getQueueStats(ticketId: string): Promise<QueueStats> {
    const ticketResult = await db.execute(sql`
      SELECT bucket, created_at FROM matchmaking_tickets WHERE id = ${ticketId}
    `);
    
    if (!ticketResult.rows || ticketResult.rows.length === 0) {
      return { playersInQueue: 0, yourPosition: 0, bucket: "random" };
    }

    const ticket = ticketResult.rows[0] as { bucket: string; created_at: Date };
    
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM matchmaking_tickets
      WHERE status = 'WAITING' 
        AND last_heartbeat_at > NOW() - INTERVAL '${sql.raw(HEARTBEAT_ALIVE_SECONDS.toString())} seconds'
    `);
    
    const positionResult = await db.execute(sql`
      SELECT COUNT(*) + 1 as position FROM matchmaking_tickets
      WHERE status = 'WAITING' 
        AND created_at < ${ticket.created_at}
        AND last_heartbeat_at > NOW() - INTERVAL '${sql.raw(HEARTBEAT_ALIVE_SECONDS.toString())} seconds'
    `);

    return {
      playersInQueue: Number((countResult.rows?.[0] as any)?.count || 0),
      yourPosition: Number((positionResult.rows?.[0] as any)?.position || 1),
      bucket: ticket.bucket
    };
  }

  async attemptPair(mode: MatchmakingMode = "1vRandom", bucket: string = "random"): Promise<MatchResult | null> {
    try {
      const result = await db.execute(sql`
        SELECT id, user_id, bucket, socket_id 
        FROM matchmaking_tickets
        WHERE mode = ${mode}::matchmaking_mode 
          AND status = 'WAITING'
          AND last_heartbeat_at > NOW() - INTERVAL '${sql.raw(HEARTBEAT_ALIVE_SECONDS.toString())} seconds'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 2
      `);

      if (!result.rows || result.rows.length < 2) {
        return null;
      }

      const ticket1 = result.rows[0] as unknown as TicketRow;
      const ticket2 = result.rows[1] as unknown as TicketRow;

      if (ticket1.user_id === ticket2.user_id) {
        console.warn("[DbQueue] Same user in both tickets, skipping");
        return null;
      }

      const matchId = randomUUID();
      const lobbyId = randomUUID();
      const joinCode = generateJoinCode();
      const hostSecret = generateSecret();
      const guestSecret = generateSecret();

      const user1Data = this.userSockets.get(ticket1.user_id);
      const user2Data = this.userSockets.get(ticket2.user_id);
      
      const gameSetId = user1Data?.gameSetId || user2Data?.gameSetId || null;
      const totalQuestions = Math.max(user1Data?.totalQuestions || 10, user2Data?.totalQuestions || 10);

      await db.execute(sql`
        UPDATE matchmaking_tickets 
        SET status = 'MATCHED'::ticket_status, updated_at = NOW()
        WHERE id IN (${ticket1.id}, ${ticket2.id})
      `);

      await db.insert(lobbies).values({
        id: lobbyId,
        joinCode,
        hostId: ticket1.user_id,
        hostUsername: user1Data?.username || "Player1",
        hostSecret,
        guestId: ticket2.user_id,
        guestUsername: user2Data?.username || "Player2",
        guestSecret,
        status: "ready",
        mode: "1v1_random",
        totalQuestions,
        gameSetId,
        createdAt: new Date()
      });

      const match = await matchService.startMatchForRandom(lobbyId);
      
      if (!match) {
        await db.execute(sql`
          UPDATE matchmaking_tickets 
          SET status = 'WAITING'::ticket_status, updated_at = NOW()
          WHERE id IN (${ticket1.id}, ${ticket2.id})
        `);
        throw new Error("Failed to start match");
      }

      await Promise.all([
        presenceService.setInMatch(ticket1.user_id),
        presenceService.setInMatch(ticket2.user_id)
      ]);

      await this.createPvpMatch(
        match.matchId, 
        ticket1.id, ticket1.user_id,
        ticket2.id, ticket2.user_id,
        ticket1.bucket
      );

      const matchResult: MatchResult = {
        matchId: match.matchId,
        lobbyId,
        player1: { userId: ticket1.user_id, secret: hostSecret },
        player2: { userId: ticket2.user_id, secret: guestSecret }
      };

      console.log(`[DbQueue] Match created: ${match.matchId} - ${user1Data?.username || ticket1.user_id} vs ${user2Data?.username || ticket2.user_id}`);

      if (user1Data?.ws && user1Data.ws.readyState === 1) {
        user1Data.ws.send(JSON.stringify({
          type: "matched",
          payload: {
            matchId: match.matchId,
            lobbyId,
            opponent: user2Data?.username || "Opponent",
            membershipSecret: hostSecret
          }
        }));
      }

      if (user2Data?.ws && user2Data.ws.readyState === 1) {
        user2Data.ws.send(JSON.stringify({
          type: "matched",
          payload: {
            matchId: match.matchId,
            lobbyId,
            opponent: user1Data?.username || "Opponent",
            membershipSecret: guestSecret
          }
        }));
      }

      this.userSockets.delete(ticket1.user_id);
      this.userSockets.delete(ticket2.user_id);

      if (this.onMatchCallback) {
        this.onMatchCallback(matchResult);
      }

      return matchResult;

    } catch (error) {
      console.error("[DbQueue] Pairing error:", error);
      return null;
    }
  }

  private async createPvpMatch(
    matchId: string, 
    ticket1Id: string, player1Id: string,
    ticket2Id: string, player2Id: string,
    bucket: string
  ): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO pvp_matches (id, mode, bucket, player1_id, player2_id, player1_ticket_id, player2_ticket_id, status, created_at)
        VALUES (${matchId}, '1vRandom'::matchmaking_mode, ${bucket}, ${player1Id}, ${player2Id}, ${ticket1Id}, ${ticket2Id}, 'ACTIVE'::pvp_match_status, NOW())
      `);
    } catch (error) {
      console.error("[DbQueue] Failed to create PvP match record:", error);
    }
  }

  private async broadcastQueueStatus(): Promise<void> {
    for (const [userId, userData] of Array.from(this.userSockets.entries())) {
      const ticketResult = await db.execute(sql`
        SELECT id FROM matchmaking_tickets
        WHERE user_id = ${userId} AND status = 'WAITING'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (ticketResult.rows && ticketResult.rows.length > 0) {
        const ticketId = (ticketResult.rows[0] as { id: string }).id;
        const stats = await this.getQueueStats(ticketId);

        if (userData.ws && userData.ws.readyState === 1) {
          userData.ws.send(JSON.stringify({
            type: "search_status",
            payload: stats
          }));
        }
      }
    }
  }

  private async cleanupStaleTickets(): Promise<void> {
    const result = await db.execute(sql`
      UPDATE matchmaking_tickets 
      SET status = 'EXPIRED'::ticket_status, updated_at = NOW()
      WHERE status = 'WAITING' 
        AND last_heartbeat_at < NOW() - INTERVAL '${sql.raw(HEARTBEAT_ALIVE_SECONDS.toString())} seconds'
      RETURNING user_id
    `);

    if (result.rows && result.rows.length > 0) {
      for (const row of result.rows as { user_id: string }[]) {
        const userData = this.userSockets.get(row.user_id);
        if (userData?.ws && userData.ws.readyState === 1) {
          userData.ws.send(JSON.stringify({
            type: "queue_expired",
            payload: { reason: "Connection timed out due to missing heartbeat" }
          }));
        }
        this.userSockets.delete(row.user_id);
      }
      console.log(`[DbQueue] Expired ${result.rows.length} stale tickets`);
    }
  }

  handleDisconnect(userId: string): void {
    this.leaveQueue(userId).catch(err => {
      console.error("[DbQueue] Disconnect cleanup error:", err);
    });
  }

  isInQueue(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  getActiveConnections(): number {
    return this.userSockets.size;
  }
}

export const dbMatchmakingQueue = new DbMatchmakingQueue();
