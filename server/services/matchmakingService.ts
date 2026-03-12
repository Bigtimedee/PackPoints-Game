import { randomUUID } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { lobbies } from "@shared/schema";
import { matchService } from "./matchService";
import { presenceService } from "./presenceService";

export type TicketStatus = "WAITING" | "MATCHED" | "CANCELLED" | "EXPIRED";
export type MatchmakingMode = "1vRandom";

interface QueuedPlayer {
  ticketId: string;
  userId: string;
  username: string;
  joinedAt: number;
  ws: any;
  socketId: string;
  gameSetId: string | null;
  totalQuestions: number;
  mode: MatchmakingMode;
  bucket: string;
}

interface TicketRecord {
  id: string;
  userId: string;
  mode: MatchmakingMode;
  bucket: string;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
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

function computeBucket(gameSetId: string | null): string {
  return gameSetId || "random";
}

const TICKET_EXPIRY_MS = 300000; // 5 minutes

class MatchmakingService {
  private queue: Map<string, QueuedPlayer> = new Map();
  private ticketsByUser: Map<string, string> = new Map(); // userId -> ticketId
  private matchCheckInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startMatchmaking();
    this.startCleanupJob();
  }

  private startMatchmaking() {
    this.matchCheckInterval = setInterval(() => {
      this.tryMatchPlayers();
    }, 1000);
  }

  private startCleanupJob() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleTickets();
    }, 30000); // Run every 30 seconds
  }

  private async cleanupStaleTickets() {
    const now = Date.now();
    const expiredTickets: string[] = [];

    for (const [ticketId, player] of this.queue.entries()) {
      if (now - player.joinedAt > TICKET_EXPIRY_MS) {
        expiredTickets.push(ticketId);
        
        // Notify user their ticket expired
        if (player.ws && player.ws.readyState === 1) {
          player.ws.send(JSON.stringify({
            type: "queue_expired",
            payload: { reason: "Ticket expired after 5 minutes" }
          }));
        }
      }
    }

    for (const ticketId of expiredTickets) {
      const player = this.queue.get(ticketId);
      if (player) {
        this.ticketsByUser.delete(player.userId);
        this.queue.delete(ticketId);
        
        // Update ticket status in database
        await this.updateTicketStatus(ticketId, "EXPIRED");
        
        // Update presence - set back to ONLINE using the stored socketId
        // The user's websocket is still active, they just aren't searching anymore
        await presenceService.setOnline(player.userId, player.socketId);
      }
    }

    if (expiredTickets.length > 0) {
      console.log(`[Matchmaking] Cleaned up ${expiredTickets.length} expired tickets`);
    }
  }

  async joinQueue(userId: string, username: string, ws: any, socketId: string, totalQuestions: number = 10, gameSetId: string | null = null): Promise<{ position: number; ticketId: string }> {
    // Check if user already has a ticket
    const existingTicketId = this.ticketsByUser.get(userId);
    if (existingTicketId && this.queue.has(existingTicketId)) {
      const existing = this.queue.get(existingTicketId)!;
      existing.ws = ws; // Update WebSocket reference
      existing.socketId = socketId; // Update socketId reference
      return { position: this.getQueuePosition(existingTicketId), ticketId: existingTicketId };
    }

    const ticketId = randomUUID();
    const bucket = computeBucket(gameSetId);
    const mode: MatchmakingMode = "1vRandom";

    // Persist ticket to database
    await this.createTicket(ticketId, userId, mode, bucket);

    const player: QueuedPlayer = {
      ticketId,
      userId,
      username,
      joinedAt: Date.now(),
      ws,
      socketId,
      gameSetId,
      totalQuestions,
      mode,
      bucket
    };

    this.queue.set(ticketId, player);
    this.ticketsByUser.set(userId, ticketId);

    console.log(`[Matchmaking] ${username} joined queue. Ticket: ${ticketId.slice(0, 8)}..., Queue size: ${this.queue.size}, Bucket: ${bucket}`);

    // Immediately try to match
    this.tryMatchPlayers();

    return { position: this.queue.size, ticketId };
  }

  async leaveQueue(userId: string): Promise<boolean> {
    const ticketId = this.ticketsByUser.get(userId);
    if (!ticketId) return false;

    const player = this.queue.get(ticketId);
    if (!player) return false;

    this.queue.delete(ticketId);
    this.ticketsByUser.delete(userId);

    // Update ticket status in database
    await this.updateTicketStatus(ticketId, "CANCELLED");

    console.log(`[Matchmaking] User ${userId} left queue. Queue size: ${this.queue.size}`);
    return true;
  }

  isInQueue(userId: string): boolean {
    return this.ticketsByUser.has(userId);
  }

  getQueuePosition(ticketId: string): number {
    const tickets = Array.from(this.queue.keys());
    return tickets.indexOf(ticketId) + 1;
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  getUserTicket(userId: string): QueuedPlayer | null {
    const ticketId = this.ticketsByUser.get(userId);
    if (!ticketId) return null;
    return this.queue.get(ticketId) || null;
  }

  getQueueStats(): { total: number; byBucket: Record<string, number> } {
    const byBucket: Record<string, number> = {};
    for (const player of this.queue.values()) {
      byBucket[player.bucket] = (byBucket[player.bucket] || 0) + 1;
    }
    return { total: this.queue.size, byBucket };
  }

  private async tryMatchPlayers() {
    if (this.queue.size < 2) return;

    // Group players by bucket for matching within same game set preference
    const buckets = new Map<string, QueuedPlayer[]>();
    for (const player of this.queue.values()) {
      const bucket = player.bucket;
      if (!buckets.has(bucket)) {
        buckets.set(bucket, []);
      }
      buckets.get(bucket)!.push(player);
    }

    // Try to match within each bucket first
    for (const [bucket, players] of buckets.entries()) {
      if (players.length >= 2) {
        const [player1, player2] = players.slice(0, 2);
        await this.createMatch(player1, player2);
        return; // Only create one match per cycle
      }
    }

    // If no same-bucket match found, try to match "random" with any player
    const randomPlayers = buckets.get("random") || [];
    if (randomPlayers.length > 0) {
      // Find any other player not in random bucket
      for (const [bucket, players] of buckets.entries()) {
        if (bucket !== "random" && players.length > 0) {
          await this.createMatch(randomPlayers[0], players[0]);
          return;
        }
      }
    }

    // Fallback: match any two players if they've been waiting long enough
    const allPlayers = Array.from(this.queue.values());
    const now = Date.now();
    const waitThreshold = 60000; // 1 minute

    const waitingLong = allPlayers.filter(p => now - p.joinedAt > waitThreshold);
    if (waitingLong.length >= 2 || (waitingLong.length >= 1 && allPlayers.length >= 2)) {
      const player1 = waitingLong[0] || allPlayers[0];
      const player2 = allPlayers.find(p => p.ticketId !== player1.ticketId);
      if (player2) {
        await this.createMatch(player1, player2);
      }
    }
  }

  private async createMatch(player1: QueuedPlayer, player2: QueuedPlayer) {
    // Remove from queue
    this.queue.delete(player1.ticketId);
    this.queue.delete(player2.ticketId);
    this.ticketsByUser.delete(player1.userId);
    this.ticketsByUser.delete(player2.userId);

    // Use the specific game set if one player selected it, otherwise random
    const gameSetId = player1.gameSetId || player2.gameSetId || null;
    const totalQuestions = Math.max(player1.totalQuestions, player2.totalQuestions);

    console.log(`[Matchmaking] Matching ${player1.username} vs ${player2.username}, Bucket: ${player1.bucket}, Questions: ${totalQuestions}`);

    try {
      const joinCode = generateJoinCode();
      const lobbyId = randomUUID();
      const hostSecret = generateSecret();
      const guestSecret = generateSecret();

      await db.insert(lobbies).values({
        id: lobbyId,
        joinCode,
        hostId: player1.userId,
        hostUsername: player1.username,
        hostSecret,
        guestId: player2.userId,
        guestUsername: player2.username,
        guestSecret,
        status: "ready",
        mode: "1v1_random",
        totalQuestions,
        gameSetId,
        createdAt: new Date()
      });

      const result = await matchService.startMatchForRandom(lobbyId);

      if (!result.matchState) {
        console.error(`[MatchmakingService] Failed to start match: ${result.error}`);
        throw new Error(result.error || "Failed to start match");
      }

      const match = result.matchState;

      // Update tickets to MATCHED status
      await Promise.all([
        this.updateTicketStatus(player1.ticketId, "MATCHED"),
        this.updateTicketStatus(player2.ticketId, "MATCHED")
      ]);

      // Update presence to IN_MATCH for both players
      await Promise.all([
        presenceService.setInMatch(player1.userId),
        presenceService.setInMatch(player2.userId)
      ]);

      // Create PvP match record
      await this.createPvpMatch(match.matchId, player1, player2, gameSetId || "random");

      // Notify players
      if (player1.ws && player1.ws.readyState === 1) {
        player1.ws.send(JSON.stringify({
          type: "matched",
          payload: {
            matchId: match.matchId,
            lobbyId,
            opponent: player2.username,
            membershipSecret: hostSecret
          }
        }));
      }

      if (player2.ws && player2.ws.readyState === 1) {
        player2.ws.send(JSON.stringify({
          type: "matched",
          payload: {
            matchId: match.matchId,
            lobbyId,
            opponent: player1.username,
            membershipSecret: guestSecret
          }
        }));
      }

      console.log(`[Matchmaking] Match created: ${match.matchId}`);
    } catch (error) {
      console.error("[Matchmaking] Failed to create match:", error);
      
      // Re-add players to queue on failure
      this.queue.set(player1.ticketId, player1);
      this.queue.set(player2.ticketId, player2);
      this.ticketsByUser.set(player1.userId, player1.ticketId);
      this.ticketsByUser.set(player2.userId, player2.ticketId);
    }
  }

  handleDisconnect(userId: string) {
    this.leaveQueue(userId);
  }

  // Database operations
  private async createTicket(ticketId: string, userId: string, mode: MatchmakingMode, bucket: string): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO matchmaking_tickets (id, user_id, mode, bucket, status, created_at, updated_at)
        VALUES (${ticketId}, ${userId}, ${mode}::matchmaking_mode, ${bucket}, 'WAITING'::ticket_status, NOW(), NOW())
      `);
    } catch (error) {
      console.error("[Matchmaking] Failed to create ticket in DB:", error);
    }
  }

  private async updateTicketStatus(ticketId: string, status: TicketStatus): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE matchmaking_tickets 
        SET status = ${status}::ticket_status, updated_at = NOW()
        WHERE id = ${ticketId}
      `);
    } catch (error) {
      console.error("[Matchmaking] Failed to update ticket status:", error);
    }
  }

  private async createPvpMatch(matchId: string, player1: QueuedPlayer, player2: QueuedPlayer, bucket: string): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO pvp_matches (id, mode, bucket, player1_id, player2_id, player1_ticket_id, player2_ticket_id, status, created_at)
        VALUES (${matchId}, '1vRandom'::matchmaking_mode, ${bucket}, ${player1.userId}, ${player2.userId}, ${player1.ticketId}, ${player2.ticketId}, 'ACTIVE'::pvp_match_status, NOW())
      `);
    } catch (error) {
      console.error("[Matchmaking] Failed to create PvP match record:", error);
    }
  }

  async getActiveTicket(userId: string): Promise<TicketRecord | null> {
    try {
      const result = await db.execute(sql`
        SELECT id, user_id, mode, bucket, status, created_at, updated_at
        FROM matchmaking_tickets
        WHERE user_id = ${userId} AND status = 'WAITING'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as any;
      return {
        id: row.id,
        userId: row.user_id,
        mode: row.mode as MatchmakingMode,
        bucket: row.bucket,
        status: row.status as TicketStatus,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    } catch (error) {
      console.error("[Matchmaking] Failed to get active ticket:", error);
      return null;
    }
  }
}

export const matchmakingService = new MatchmakingService();
