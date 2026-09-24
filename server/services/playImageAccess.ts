import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  anonDailyRuns,
  dailyChallengeCards,
  dailyChallengeEntries,
  gameSessionsTable,
  matches,
  type GameQuestion,
} from "@shared/schema";
import { storage } from "../storage";
import { resolveAnonPlayer } from "./anonIdentity";
import {
  classifyRevealToken,
  isPlayScope,
  maskTokenMatches,
  revealPlayPath,
  type PlayScope,
} from "./playImageToken";
import type { CardIdGrant, RevealResolution } from "./playImageHttp";

type AuthedRequest = Request & {
  user?: { id?: string; claims?: { sub?: string } };
  session?: { localUserId?: string; guestId?: string };
};

function requestUserId(req: AuthedRequest): string | null {
  return req.user?.claims?.sub || req.session?.localUserId || req.user?.id || null;
}

export async function callerIsAdmin(req: Request): Promise<boolean> {
  const userId = requestUserId(req as AuthedRequest);
  if (!userId) return false;
  const user = await storage.getUser(userId);
  return !!user?.isAdmin;
}

async function callerAnonId(req: Request, res: Response): Promise<string | null> {
  const sessionGuest = (req as AuthedRequest).session?.guestId;
  try {
    const player = await resolveAnonPlayer(req as Parameters<typeof resolveAnonPlayer>[0], res, { create: false });
    if (player?.id) return player.id;
  } catch {
    // Image GETs must not mint a guest.
  }
  return sessionGuest || null;
}

function rowHit(result: { rows?: unknown[] }): boolean {
  return Array.isArray(result.rows) && result.rows.length > 0;
}

async function soloAnswered(cardId: string, userId: string | null, anonId: string | null): Promise<boolean> {
  if (userId) {
    const byUser = await db.execute(sql`
      SELECT 1 FROM game_sessions
      WHERE user_id = ${userId}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(questions) q
          WHERE (q->'card'->>'id' = ${cardId} OR q->'card'->>'playableCardId' = ${cardId})
            AND q->>'answered' = 'true'
        )
      LIMIT 1
    `);
    if (rowHit(byUser)) return true;
  }
  if (anonId) {
    const byGuest = await db.execute(sql`
      SELECT 1 FROM game_sessions
      WHERE guest_session_id = ${anonId}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(questions) q
          WHERE (q->'card'->>'id' = ${cardId} OR q->'card'->>'playableCardId' = ${cardId})
            AND q->>'answered' = 'true'
        )
      LIMIT 1
    `);
    if (rowHit(byGuest)) return true;
  }
  return false;
}

async function dailyAnswered(cardId: string, userId: string | null, anonId: string | null): Promise<boolean> {
  if (userId) {
    const registered = await db.execute(sql`
      SELECT 1
      FROM daily_challenge_entries e
      JOIN daily_challenge_cards c ON c.daily_challenge_id = e.daily_challenge_id
      WHERE e.user_id = ${userId}
        AND c.card_id = ${cardId}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(e.answers, '[]'::jsonb)) a
          WHERE a->>'position' = c.position::text
        )
      LIMIT 1
    `);
    if (rowHit(registered)) return true;
  }
  if (anonId) {
    const guest = await db.execute(sql`
      SELECT 1
      FROM anon_daily_runs r
      JOIN daily_challenge_cards c ON c.daily_challenge_id = r.daily_challenge_id
      WHERE r.anon_player_id = ${anonId}
        AND c.card_id = ${cardId}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(r.answers, '[]'::jsonb)) a
          WHERE a->>'position' = c.position::text
        )
      LIMIT 1
    `);
    if (rowHit(guest)) return true;
  }
  return false;
}

async function matchAnswered(cardId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const hit = await db.execute(sql`
    SELECT 1
    FROM match_answers ma
    JOIN matches m ON m.id = ma.match_id
    WHERE ma.user_id = ${userId}
      AND (
        (m.questions_data::jsonb -> ma.idx -> 'card' ->> 'id') = ${cardId}
        OR (m.questions_data::jsonb -> ma.idx -> 'card' ->> 'playableCardId') = ${cardId}
      )
    LIMIT 1
  `);
  return rowHit(hit);
}

export async function callerHasAcceptedAnswer(req: Request, res: Response, cardId: string): Promise<boolean> {
  const userId = requestUserId(req as AuthedRequest);
  const anonId = userId ? null : await callerAnonId(req, res);
  if (!userId && !anonId) return false;
  try {
    if (await soloAnswered(cardId, userId, anonId)) return true;
    if (await dailyAnswered(cardId, userId, anonId)) return true;
    if (await matchAnswered(cardId, userId)) return true;
  } catch (err) {
    console.error("[PlayImage] answered lookup failed:", err);
    return false;
  }
  return false;
}

export async function authorizeCardId(req: Request, res: Response, cardId: string): Promise<CardIdGrant> {
  if (await callerIsAdmin(req)) return "admin";
  if (await callerHasAcceptedAnswer(req, res, cardId)) return "answered";
  return "denied";
}

function questionCardId(question: GameQuestion | undefined): string | null {
  const card = question?.card as { id?: string; playableCardId?: string } | undefined;
  return card?.playableCardId || card?.id || null;
}

async function loadSoloQuestion(sessionId: string, index: number): Promise<{ cardId: string; answered: boolean } | null> {
  const [row] = await db
    .select({ questions: gameSessionsTable.questions })
    .from(gameSessionsTable)
    .where(eq(gameSessionsTable.id, sessionId))
    .limit(1);
  const questions = (row?.questions || []) as GameQuestion[];
  const question = questions[index] as (GameQuestion & { answered?: boolean }) | undefined;
  const cardId = questionCardId(question);
  if (!cardId) return null;
  return { cardId, answered: question?.answered === true };
}

async function loadDailyCard(challengeId: string, position: number): Promise<string | null> {
  const [exact] = await db
    .select({ cardId: dailyChallengeCards.cardId })
    .from(dailyChallengeCards)
    .where(and(
      eq(dailyChallengeCards.dailyChallengeId, challengeId),
      eq(dailyChallengeCards.position, position),
    ))
    .limit(1);
  return exact?.cardId ?? null;
}

async function entryAnswered(entryId: string, position: number): Promise<{ challengeId: string; answered: boolean } | null> {
  const [entry] = await db
    .select({
      challengeId: dailyChallengeEntries.dailyChallengeId,
      answers: dailyChallengeEntries.answers,
    })
    .from(dailyChallengeEntries)
    .where(eq(dailyChallengeEntries.id, entryId))
    .limit(1);
  if (!entry) return null;
  const answers = (entry.answers || []) as { position: number }[];
  return { challengeId: entry.challengeId, answered: answers.some((answer) => answer.position === position) };
}

async function anonRunAnswered(runId: string, position: number): Promise<{ challengeId: string; answered: boolean } | null> {
  const [run] = await db
    .select({
      challengeId: anonDailyRuns.dailyChallengeId,
      answers: anonDailyRuns.answers,
    })
    .from(anonDailyRuns)
    .where(eq(anonDailyRuns.id, runId))
    .limit(1);
  if (!run) return null;
  const answers = (run.answers || []) as { position: number }[];
  return { challengeId: run.challengeId, answered: answers.some((answer) => answer.position === position) };
}

async function loadMatchQuestion(matchId: string, index: number): Promise<string | null> {
  const [match] = await db
    .select({ questionsData: matches.questionsData })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match?.questionsData) return null;
  try {
    const questions = JSON.parse(match.questionsData) as GameQuestion[];
    return questionCardId(questions[index]);
  } catch {
    return null;
  }
}

async function matchUserAnswered(matchId: string, userId: string, index: number): Promise<boolean> {
  const hit = await db.execute(sql`
    SELECT 1 FROM match_answers
    WHERE match_id = ${matchId} AND user_id = ${userId} AND idx = ${index}
    LIMIT 1
  `);
  return rowHit(hit);
}

export async function resolveMaskCard(
  scope: string,
  sessionId: string,
  index: number,
  token: string,
): Promise<string | null> {
  if (!isPlayScope(scope)) return null;
  const cardId = await cardIdForMask(scope, sessionId, index);
  if (!cardId) return null;
  if (!maskTokenMatches(scope, sessionId, index, cardId, token)) return null;
  return cardId;
}

async function cardIdForMask(scope: PlayScope, sessionId: string, index: number): Promise<string | null> {
  if (scope === "solo") {
    const question = await loadSoloQuestion(sessionId, index);
    return question?.cardId ?? null;
  }
  if (scope === "d5") {
    return loadDailyCard(sessionId, index);
  }
  if (scope === "match") {
    return loadMatchQuestion(sessionId, index);
  }
  return null;
}

export async function resolveRevealCard(
  req: Request,
  scope: PlayScope,
  sessionId: string,
  index: number,
  exp: number,
  token: string,
): Promise<RevealResolution> {
  const loaded = await loadRevealSubject(req, scope, sessionId, index);
  if (!loaded) return { ok: false, reason: "bad" };
  const status = classifyRevealToken({
    scope,
    sessionId,
    index,
    cardId: loaded.cardId,
    exp,
    binder: loaded.binder,
    token,
    otherCardId: loaded.otherCardId,
  });
  if (status !== "valid") return { ok: false, reason: status };
  if (!loaded.answered) return { ok: false, reason: "unanswered" };
  return { ok: true, cardId: loaded.cardId };
}

async function loadRevealSubject(
  req: Request,
  scope: PlayScope,
  sessionId: string,
  index: number,
): Promise<{ cardId: string; binder: string; answered: boolean; otherCardId?: string } | null> {
  if (scope === "solo") {
    const question = await loadSoloQuestion(sessionId, index);
    if (!question) return null;
    return { cardId: question.cardId, binder: sessionId, answered: question.answered };
  }
  if (scope === "d5") {
    const entry = await entryAnswered(sessionId, index);
    if (!entry) return null;
    const cardId = await loadDailyCard(entry.challengeId, index);
    if (!cardId) return null;
    return { cardId, binder: sessionId, answered: entry.answered };
  }
  if (scope === "ad5") {
    const run = await anonRunAnswered(sessionId, index);
    if (!run) return null;
    const cardId = await loadDailyCard(run.challengeId, index);
    if (!cardId) return null;
    return { cardId, binder: sessionId, answered: run.answered };
  }
  const userId = requestUserId(req as AuthedRequest);
  if (!userId) return null;
  const cardId = await loadMatchQuestion(sessionId, index);
  if (!cardId) return null;
  const answered = await matchUserAnswered(sessionId, userId, index);
  return { cardId, binder: userId, answered };
}

export async function mintSoloRevealUrl(sessionId: string, index: number, cardId: string): Promise<string> {
  return revealPlayPath({ scope: "solo", sessionId, index, cardId, binder: sessionId });
}

export async function mintDailyRevealUrl(args: {
  scope: "d5" | "ad5";
  sessionId: string;
  challengeId: string;
  position: number;
}): Promise<string | null> {
  const cardId = await loadDailyCard(args.challengeId, args.position);
  if (!cardId) return null;
  return revealPlayPath({
    scope: args.scope,
    sessionId: args.sessionId,
    index: args.position,
    cardId,
    binder: args.sessionId,
  });
}

export async function mintMatchRevealUrl(matchId: string, userId: string, index: number): Promise<string | null> {
  const cardId = await loadMatchQuestion(matchId, index);
  if (!cardId) return null;
  return revealPlayPath({
    scope: "match",
    sessionId: matchId,
    index,
    cardId,
    binder: userId,
  });
}

export async function registeredDailyEntryId(userId: string, challengeId: string): Promise<string | null> {
  const [entry] = await db
    .select({ id: dailyChallengeEntries.id })
    .from(dailyChallengeEntries)
    .where(sql`${dailyChallengeEntries.userId} = ${userId} AND ${dailyChallengeEntries.dailyChallengeId} = ${challengeId}`)
    .limit(1);
  return entry?.id ?? null;
}

export async function anonDailyRunId(anonPlayerId: string, challengeId: string): Promise<string | null> {
  const [run] = await db
    .select({ id: anonDailyRuns.id })
    .from(anonDailyRuns)
    .where(sql`${anonDailyRuns.anonPlayerId} = ${anonPlayerId} AND ${anonDailyRuns.dailyChallengeId} = ${challengeId}`)
    .limit(1);
  return run?.id ?? null;
}
