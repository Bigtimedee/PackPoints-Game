import { db } from "../../db";
import { matches, matchParticipants, MatchResult, type MatchResultType } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ComputedResult {
  result: MatchResultType;
  winnerUserId: string | null;
  hostCorrect: number;
  guestCorrect: number;
}

export async function computeMatchResult(matchId: string): Promise<ComputedResult | null> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return null;

  const hostId = match.hostUserId;
  const guestId = match.guestUserId;
  if (!hostId || !guestId) return null;

  const participants = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
  
  const host = participants.find(p => p.userId === hostId);
  const guest = participants.find(p => p.userId === guestId);
  
  if (!host || !guest) return null;

  const hostCorrect = host.correctAnswers || 0;
  const guestCorrect = guest.correctAnswers || 0;

  let result: MatchResultType;
  let winnerUserId: string | null = null;

  if (hostCorrect > guestCorrect) {
    result = MatchResult.HOST_WIN;
    winnerUserId = hostId;
  } else if (guestCorrect > hostCorrect) {
    result = MatchResult.GUEST_WIN;
    winnerUserId = guestId;
  } else {
    result = MatchResult.TIE;
    winnerUserId = null;
  }

  return { result, winnerUserId, hostCorrect, guestCorrect };
}

export async function computeAndPersistMatchResult(matchId: string): Promise<ComputedResult | null> {
  const computed = await computeMatchResult(matchId);
  if (!computed) return null;

  await db.update(matches).set({
    result: computed.result,
    winnerUserId: computed.winnerUserId,
    hostCorrect: computed.hostCorrect,
    guestCorrect: computed.guestCorrect,
  }).where(eq(matches.id, matchId));

  return computed;
}

export async function setForfeitResult(matchId: string, forfeitingUserId: string): Promise<ComputedResult | null> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return null;

  const hostId = match.hostUserId;
  const guestId = match.guestUserId;
  if (!hostId || !guestId) return null;

  const participants = await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
  const host = participants.find(p => p.userId === hostId);
  const guest = participants.find(p => p.userId === guestId);
  
  if (!host || !guest) return null;

  const hostCorrect = host.correctAnswers || 0;
  const guestCorrect = guest.correctAnswers || 0;

  let result: MatchResultType;
  let winnerUserId: string | null;

  if (forfeitingUserId === hostId) {
    result = MatchResult.GUEST_WIN;
    winnerUserId = guestId;
  } else {
    result = MatchResult.HOST_WIN;
    winnerUserId = hostId;
  }

  await db.update(matches).set({
    result,
    winnerUserId,
    hostCorrect,
    guestCorrect,
  }).where(eq(matches.id, matchId));

  return { result, winnerUserId, hostCorrect, guestCorrect };
}

export async function setDisconnectResult(matchId: string, disconnectedUserId: string): Promise<ComputedResult | null> {
  return setForfeitResult(matchId, disconnectedUserId);
}
