import { randomUUID } from "crypto";
import { db } from "../db";
import { lobbies } from "@shared/schema";
import { matchService } from "./matchService";

interface QueuedPlayer {
  userId: string;
  username: string;
  joinedAt: number;
  ws: any;
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

class MatchmakingService {
  private queue: Map<string, QueuedPlayer> = new Map();
  private matchCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startMatchmaking();
  }

  private startMatchmaking() {
    this.matchCheckInterval = setInterval(() => {
      this.tryMatchPlayers();
    }, 1000);
  }

  async joinQueue(userId: string, username: string, ws: any): Promise<{ position: number }> {
    if (this.queue.has(userId)) {
      return { position: this.getQueuePosition(userId) };
    }

    this.queue.set(userId, {
      userId,
      username,
      joinedAt: Date.now(),
      ws
    });

    console.log(`[Matchmaking] ${username} joined queue. Queue size: ${this.queue.size}`);

    this.tryMatchPlayers();

    return { position: this.queue.size };
  }

  leaveQueue(userId: string): boolean {
    const removed = this.queue.delete(userId);
    if (removed) {
      console.log(`[Matchmaking] User ${userId} left queue. Queue size: ${this.queue.size}`);
    }
    return removed;
  }

  isInQueue(userId: string): boolean {
    return this.queue.has(userId);
  }

  getQueuePosition(userId: string): number {
    const players = Array.from(this.queue.keys());
    return players.indexOf(userId) + 1;
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  private async tryMatchPlayers() {
    if (this.queue.size < 2) return;

    const players = Array.from(this.queue.entries());
    const [player1Entry, player2Entry] = players.slice(0, 2);
    const [player1Id, player1] = player1Entry;
    const [player2Id, player2] = player2Entry;

    this.queue.delete(player1Id);
    this.queue.delete(player2Id);

    console.log(`[Matchmaking] Matching ${player1.username} vs ${player2.username}`);

    try {
      const joinCode = generateJoinCode();
      const lobbyId = randomUUID();
      const hostSecret = generateSecret();
      const guestSecret = generateSecret();

      await db.insert(lobbies).values({
        id: lobbyId,
        joinCode,
        hostId: player1Id,
        hostUsername: player1.username,
        hostSecret,
        guestId: player2Id,
        guestUsername: player2.username,
        guestSecret,
        status: "ready",
        mode: "1v1_random",
        totalQuestions: 5,
        createdAt: new Date()
      });

      const match = await matchService.startMatchForRandom(lobbyId);

      if (!match) {
        throw new Error("Failed to start match");
      }

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
      
      this.queue.set(player1Id, player1);
      this.queue.set(player2Id, player2);
    }
  }

  handleDisconnect(userId: string) {
    this.leaveQueue(userId);
  }
}

export const matchmakingService = new MatchmakingService();
