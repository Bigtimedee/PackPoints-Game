import { randomUUID } from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { lobbies, playerRatings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { matchService } from "../matchService";
import { presenceService } from "../presenceService";

// ELO band config: starts at ±ELO_INITIAL_BAND, expands by ELO_BAND_EXPAND every ELO_EXPAND_EVERY_MS
const ELO_INITIAL_BAND = 100;
const ELO_BAND_EXPAND = 50;       // +50 per interval
const ELO_EXPAND_INTERVAL_S = 30; // expand every 30 seconds
const ELO_MAX_BAND = 500;         // hard cap (effectively any opponent)

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
  const bytes = require('crypto').randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(bytes[i] % chars.length);
  }
  return code;
}

function generateSecret(): string {
  return require('crypto').randomBytes(24).toString('hex');
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

    // Fetch current ELO rating, default 1200 if no record yet
    const [ratingRow] = await db
      .select({ rating: playerRatings.rating })
      .from(playerRatings)
      .where(eq(playerRatings.userId, userId))
      .limit(1);
    const eloRating = ratingRow?.rating ?? 1200;

    await db.execute(sql`
      UPDATE matchmaking_tickets
      SET status = 'CANCELLED'::ticket_status, updated_at = NOW()
      WHERE user_id = ${userId} AND status = 'WAITING'
    `);

    const ticketId = randomUUID();

    await db.execute(sql`
      INSERT INTO matchmaking_tickets (id, user_id, mode, bucket, status, socket_id, elo_rating, last_heartbeat_at, created_at, updated_at)
      VALUES (${ticketId}, ${userId}, ${mode}::matchmaking_mode, ${bucket}, 'WAITING'::ticket_status, ${socketId}, ${eloRating}, NOW(), NOW(), NOW())
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

    const userSocket = this.userSockets.get(userId);
    this.userSockets.delete(userId);

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
        AND bucket = ${ticket.bucket}
        AND last_heartbeat_at > NOW() - INTERVAL '30 seconds'
    `);
    
    const positionResult = await db.execute(sql`
      SELECT COUNT(*) + 1 as position FROM matchmaking_tickets
      WHERE status = 'WAITING' 
        AND bucket = ${ticket.bucket}
        AND created_at < ${ticket.created_at}
        AND last_heartbeat_at > NOW() - INTERVAL '30 seconds'
    `);

    return {
      playersInQueue: Number((countResult.rows?.[0] as any)?.count || 0),
      yourPosition: Number((positionResult.rows?.[0] as any)?.position || 1),
      bucket: ticket.bucket
    };
  }

  async attemptPair(mode: MatchmakingMode = "1vRandom"): Promise<MatchResult | null> {
    try {
      // ELO-banded pairing with expanding band:
      // band = LEAST(ELO_MAX_BAND, ELO_INITIAL_BAND + ELO_BAND_EXPAND * floor(max_wait_seconds / ELO_EXPAND_INTERVAL_S))
      // Uses GREATEST wait time so long-waiting players get broader search
      const pairResult = await db.execute(sql`
        WITH waiting AS (
          SELECT id, user_id, bucket, socket_id,
                 COALESCE(elo_rating, 1200) AS elo_rating,
                 EXTRACT(EPOCH FROM (NOW() - created_at)) AS wait_seconds
          FROM matchmaking_tickets
          WHERE mode = ${mode}::matchmaking_mode
            AND status = 'WAITING'
            AND last_heartbeat_at > NOW() - INTERVAL '30 seconds'
        ),
        pairs AS (
          SELECT
            t1.id AS id1, t1.user_id AS user1, t1.bucket, t1.socket_id AS socket1, t1.elo_rating AS elo1,
            t2.id AS id2, t2.user_id AS user2, t2.socket_id AS socket2, t2.elo_rating AS elo2
          FROM waiting t1
          JOIN waiting t2 ON (
            t1.id < t2.id
            AND t1.bucket = t2.bucket
            AND t1.user_id != t2.user_id
            AND ABS(t1.elo_rating - t2.elo_rating) <=
                LEAST(${ELO_MAX_BAND}, ${ELO_INITIAL_BAND} + ${ELO_BAND_EXPAND} * FLOOR(GREATEST(t1.wait_seconds, t2.wait_seconds) / ${ELO_EXPAND_INTERVAL_S}))
          )
          ORDER BY t1.created_at ASC
          LIMIT 1
        ),
        updated AS (
          UPDATE matchmaking_tickets
          SET status = 'MATCHED'::ticket_status, updated_at = NOW()
          WHERE id IN (SELECT id1 FROM pairs UNION SELECT id2 FROM pairs)
          RETURNING id
        )
        SELECT * FROM pairs
      `);

      if (!pairResult.rows || pairResult.rows.length === 0) {
        return null;
      }

      const pair = pairResult.rows[0] as {
        id1: string; user1: string; bucket: string; socket1: string | null; elo1: number;
        id2: string; user2: string; socket2: string | null; elo2: number;
      };

      const lobbyId = randomUUID();
      const joinCode = generateJoinCode();
      const hostSecret = generateSecret();
      const guestSecret = generateSecret();

      const user1Data = this.userSockets.get(pair.user1);
      const user2Data = this.userSockets.get(pair.user2);
      
      const gameSetId = pair.bucket !== "random" ? pair.bucket : null;
      const totalQuestions = Math.max(user1Data?.totalQuestions || 10, user2Data?.totalQuestions || 10);

      await db.insert(lobbies).values({
        id: lobbyId,
        joinCode,
        hostId: pair.user1,
        hostUsername: user1Data?.username || "Player1",
        hostSecret,
        guestId: pair.user2,
        guestUsername: user2Data?.username || "Player2",
        guestSecret,
        status: "ready",
        mode: "1v1_random",
        totalQuestions,
        gameSetId,
        createdAt: new Date()
      });

      const result = await matchService.startMatchForRandom(lobbyId);
      
      if (!result.matchState) {
        console.error(`[DbQueue] Failed to start match: ${result.error}`);
        await db.execute(sql`
          UPDATE matchmaking_tickets 
          SET status = 'WAITING'::ticket_status, updated_at = NOW()
          WHERE id IN (${pair.id1}, ${pair.id2})
        `);
        throw new Error(result.error || "Failed to start match");
      }

      const match = result.matchState;

      await Promise.all([
        presenceService.setInMatch(pair.user1),
        presenceService.setInMatch(pair.user2)
      ]);

      await this.createPvpMatch(
        match.matchId, 
        pair.id1, pair.user1,
        pair.id2, pair.user2,
        pair.bucket
      );

      const matchResult: MatchResult = {
        matchId: match.matchId,
        lobbyId,
        player1: { userId: pair.user1, secret: hostSecret },
        player2: { userId: pair.user2, secret: guestSecret }
      };

      console.log(`[DbQueue] Match created: ${match.matchId} - ${user1Data?.username || pair.user1} vs ${user2Data?.username || pair.user2}`);

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

      this.userSockets.delete(pair.user1);
      this.userSockets.delete(pair.user2);

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
        AND last_heartbeat_at < NOW() - INTERVAL '30 seconds'
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
