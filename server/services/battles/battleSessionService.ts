import { db } from "../../db";
import {
  battleSessions,
  matches,
  type BattleSession,
  BattleSessionStatus,
  MatchResult,
  type MatchResultType,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { matchService } from "../matchService";

export interface CreateSessionArgs {
  lobbyId: string;
  hostUserId: string;
  guestUserId: string;
  firstMatchId: string;
}

export interface StartNextMatchResult {
  matchId: string;
  sequenceNumber: number;
  hostSecret: string;
  guestSecret: string;
}

export interface StartNextMatchError {
  error: string;
}

async function createBattleSession(args: CreateSessionArgs): Promise<BattleSession> {
  const [session] = await db
    .insert(battleSessions)
    .values({
      lobbyId: args.lobbyId,
      hostUserId: args.hostUserId,
      guestUserId: args.guestUserId,
      status: BattleSessionStatus.ACTIVE,
      currentMatchId: args.firstMatchId,
      matchCount: 1,
    })
    .returning();
  return session;
}

async function getBattleSession(sessionId: string): Promise<BattleSession | null> {
  const [row] = await db
    .select()
    .from(battleSessions)
    .where(eq(battleSessions.id, sessionId))
    .limit(1);
  return row || null;
}

async function getActiveSessionForMatch(matchId: string): Promise<BattleSession | null> {
  const result = await db.execute(sql`
    SELECT bs.*
    FROM battle_sessions bs
    JOIN matches m ON m.session_id = bs.id
    WHERE m.id = ${matchId}
      AND bs.status = 'ACTIVE'
    LIMIT 1
  `);
  const row = result.rows?.[0] as any;
  if (!row) return null;
  return {
    id: row.id,
    lobbyId: row.lobby_id,
    hostUserId: row.host_user_id,
    guestUserId: row.guest_user_id,
    status: row.status,
    endReason: row.end_reason,
    endedByUserId: row.ended_by_user_id,
    currentMatchId: row.current_match_id,
    matchCount: row.match_count,
    hostWins: row.host_wins,
    guestWins: row.guest_wins,
    ties: row.ties,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  } as BattleSession;
}

async function recordMatchResult(sessionId: string, result: MatchResultType): Promise<void> {
  if (result === MatchResult.HOST_WIN) {
    await db
      .update(battleSessions)
      .set({ hostWins: sql`${battleSessions.hostWins} + 1` })
      .where(eq(battleSessions.id, sessionId));
  } else if (result === MatchResult.GUEST_WIN) {
    await db
      .update(battleSessions)
      .set({ guestWins: sql`${battleSessions.guestWins} + 1` })
      .where(eq(battleSessions.id, sessionId));
  } else if (result === MatchResult.TIE) {
    await db
      .update(battleSessions)
      .set({ ties: sql`${battleSessions.ties} + 1` })
      .where(eq(battleSessions.id, sessionId));
  }
}

async function startNextMatchInSession(
  sessionId: string
): Promise<StartNextMatchResult | StartNextMatchError> {
  const session = await getBattleSession(sessionId);
  if (!session) {
    return { error: "Session not found" };
  }
  if (session.status !== BattleSessionStatus.ACTIVE) {
    return { error: "Session is no longer active" };
  }

  const lobby = await matchService.getLobby(session.lobbyId);
  if (!lobby) {
    return { error: "Lobby not found for session" };
  }
  if (!lobby.hostSecret || !lobby.guestSecret) {
    return { error: "Lobby missing membership secrets" };
  }

  const nextSeq = session.matchCount + 1;
  const result = await matchService.startMatchForRandom(session.lobbyId, {
    sessionId,
    sequenceNumber: nextSeq,
  });

  if (!result.matchState) {
    return { error: result.error || "Failed to start next match" };
  }

  await db
    .update(battleSessions)
    .set({
      currentMatchId: result.matchState.matchId,
      matchCount: nextSeq,
    })
    .where(eq(battleSessions.id, sessionId));

  return {
    matchId: result.matchState.matchId,
    sequenceNumber: nextSeq,
    hostSecret: lobby.hostSecret,
    guestSecret: lobby.guestSecret,
  };
}

async function endBattleSession(
  sessionId: string,
  reason: string,
  endedByUserId: string | null
): Promise<BattleSession | null> {
  const existing = await getBattleSession(sessionId);
  if (!existing) return null;
  if (existing.status === BattleSessionStatus.ENDED) {
    return existing;
  }
  const [updated] = await db
    .update(battleSessions)
    .set({
      status: BattleSessionStatus.ENDED,
      endReason: reason,
      endedByUserId: endedByUserId ?? undefined,
      endedAt: new Date(),
    })
    .where(
      and(
        eq(battleSessions.id, sessionId),
        eq(battleSessions.status, BattleSessionStatus.ACTIVE)
      )
    )
    .returning();
  return updated || existing;
}

async function isBattleActive(sessionId: string): Promise<boolean> {
  const session = await getBattleSession(sessionId);
  return !!session && session.status === BattleSessionStatus.ACTIVE;
}

export const battleSessionService = {
  createBattleSession,
  getBattleSession,
  getActiveSessionForMatch,
  recordMatchResult,
  startNextMatchInSession,
  endBattleSession,
  isBattleActive,
};
