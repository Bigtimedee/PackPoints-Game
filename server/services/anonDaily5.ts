/**
 * Guest Daily 5. Progress lives on `anon_daily_runs`, not `users` and not
 * `daily_challenge_entries`, until the guest registers and claims.
 * An in-progress run can still be answered and finished after the hard gate.
 */
import { createHash } from "crypto";
import type { Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  anonDailyRuns,
  dailyChallengeCards,
} from "@shared/schema";
import { maskedCardImageUrl } from "@shared/maskGeometry";
import { getPackptsDayKey } from "@shared/packptsDay";
import { daily5Service } from "./daily5Service";
import {
  AnonGateError,
  creditAnonGame,
  publicGateFor,
  resolveAnonPlayer,
} from "./anonIdentity";
import { anonStartAllowed } from "@shared/anonGate";

const DAILY5_MAX_POINTS = parseInt(process.env.DAILY5_MAX_POINTS || "250", 10);
const DAILY5_MIN_TIME_MS = parseInt(process.env.DAILY5_MIN_TIME_MS || "15000", 10);

type GateRequest = Parameters<typeof resolveAnonPlayer>[0];

function choiceSeed(challengeId: string, anonId: string, position: number): string {
  const salt = process.env.SECRET_SALT || process.env.GROWTH_AGENT_SECRET_SALT || "packpts-daily5-default-salt-change-me";
  return createHash("sha256").update(`${challengeId}:${anonId}:${position}:${salt}`).digest("hex");
}

function shuffle<T>(arr: T[], seed: string): T[] {
  const result = [...arr];
  let hashIndex = 0;
  const hashBytes = Buffer.from(seed, "hex");
  for (let i = result.length - 1; i > 0; i--) {
    const byte1 = hashBytes[hashIndex % hashBytes.length];
    const byte2 = hashBytes[(hashIndex + 1) % hashBytes.length];
    hashIndex += 2;
    const j = ((byte1 << 8) | byte2) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mapRun(run: typeof anonDailyRuns.$inferSelect) {
  return {
    id: run.id,
    dailyChallengeId: run.dailyChallengeId,
    score: run.score,
    correctCount: run.correctCount,
    completedAt: run.completedAt,
    answers: run.answers ?? [],
  };
}

async function maskedCards(challengeId: string, anonId: string) {
  const cards = await db
    .select()
    .from(dailyChallengeCards)
    .where(eq(dailyChallengeCards.dailyChallengeId, challengeId))
    .orderBy(asc(dailyChallengeCards.position));

  return cards.map((card) => ({
    position: card.position,
    cardId: card.cardId,
    imageUrl: maskedCardImageUrl(card.cardId),
    choices: shuffle((card.choices as string[]) ?? [], choiceSeed(challengeId, anonId, card.position)),
    pointValue: card.pointValue,
    correctAnswer: card.correctAnswer,
  }));
}

export async function findAnonDailyRun(anonPlayerId: string, challengeId: string) {
  const [run] = await db
    .select()
    .from(anonDailyRuns)
    .where(and(eq(anonDailyRuns.anonPlayerId, anonPlayerId), eq(anonDailyRuns.dailyChallengeId, challengeId)))
    .limit(1);
  return run ?? null;
}

/** Attach today's guest entry onto a Daily 5 status payload. Registered callers pass a user id and get null. */
export async function attachAnonDailyStatus(
  req: GateRequest,
  res: Response,
  status: { challenge: { id: string } | null; hasPlayed: boolean; entry: unknown },
  userId?: string,
) {
  if (userId) return null;
  const player = await resolveAnonPlayer(req, res, { create: false });
  const gate = player
    ? publicGateFor(player)
    : publicGateFor({ gamesCompleted: 0, lastPlayDay: null, escrowPoints: 0, softDismissedAt: null });
  if (player && status.challenge) {
    const run = await findAnonDailyRun(player.id, status.challenge.id);
    if (run) {
      status.hasPlayed = !!run.completedAt;
      status.entry = mapRun(run);
    }
  }
  return gate;
}

export async function startAnonDaily5(req: GateRequest, res: Response) {
  const player = await resolveAnonPlayer(req, res, { create: true });
  if (!player) throw new Error("No challenge available today");

  await daily5Service.updateChallengeStatuses();
  const today = getPackptsDayKey();
  const challenge = await daily5Service.getOrCreateTodayChallenge();
  if (!challenge) throw new Error("No challenge available today");
  if (challenge.status !== "ACTIVE") {
    throw new Error(`Challenge is ${challenge.status}, not active`);
  }

  const existing = await findAnonDailyRun(player.id, challenge.id);
  if (existing?.completedAt) {
    throw new Error("You have already completed today's Daily 5");
  }

  const gate = publicGateFor(player, today);
  const inProgress = !!existing && !existing.completedAt;
  if (!anonStartAllowed(gate, inProgress)) {
    throw new AnonGateError(gate);
  }

  let run = existing;
  if (!run) {
    const [created] = await db
      .insert(anonDailyRuns)
      .values({
        anonPlayerId: player.id,
        dailyChallengeId: challenge.id,
        score: 0,
        correctCount: 0,
        answers: [],
      })
      .onConflictDoNothing()
      .returning();
    run = created ?? (await findAnonDailyRun(player.id, challenge.id));
  }
  if (!run) throw new Error("Failed to create entry");

  const cards = await maskedCards(challenge.id, player.id);
  const { kickPreMask } = await import("../masking/preMaskDeal");
  kickPreMask(cards.map((card) => card.cardId), "daily5-start");

  return {
    entry: mapRun(run),
    cards: cards.map(({ correctAnswer: _correct, ...card }) => card),
    setId: challenge.setId ?? null,
    anonGate: gate,
  };
}

export async function answerAnonDaily5(
  req: GateRequest,
  res: Response,
  challengeId: string,
  position: number,
  selectedAnswer: string,
) {
  const player = await resolveAnonPlayer(req, res, { create: false });
  if (!player) throw new Error("No entry found - start the challenge first");

  const run = await findAnonDailyRun(player.id, challengeId);
  if (!run) throw new Error("No entry found - start the challenge first");
  if (run.completedAt) throw new Error("Challenge already completed");

  const answers = (run.answers || []) as { position: number; selected: string; correct: boolean }[];
  if (answers.some((answer) => answer.position === position)) {
    throw new Error(`Position ${position} already answered`);
  }

  const cards = await maskedCards(challengeId, player.id);
  const card = cards.find((item) => item.position === position);
  if (!card) throw new Error(`No card at position ${position}`);

  const correct = selectedAnswer === card.correctAnswer;
  const pointsEarned = correct ? card.pointValue : 0;
  const newAnswers = [...answers, { position, selected: selectedAnswer, correct }];
  const newScore = run.score + pointsEarned;
  const newCorrectCount = run.correctCount + (correct ? 1 : 0);

  await db
    .update(anonDailyRuns)
    .set({ answers: newAnswers, score: newScore, correctCount: newCorrectCount })
    .where(eq(anonDailyRuns.id, run.id));

  return { correct, pointsEarned, score: newScore, correctCount: newCorrectCount };
}

export async function finishAnonDaily5(req: GateRequest, res: Response, challengeId: string) {
  const player = await resolveAnonPlayer(req, res, { create: false });
  if (!player) throw new Error("No entry found");
  const run = await findAnonDailyRun(player.id, challengeId);
  if (!run) throw new Error("No entry found");
  if (run.completedAt && run.gateCounted) throw new Error("Already completed");

  const now = new Date();
  const startedAt = run.startedAt ? new Date(run.startedAt) : now;
  const totalTimeMs = now.getTime() - startedAt.getTime();
  const cappedScore = Math.min(run.score, DAILY5_MAX_POINTS);
  const flagReasons: string[] = [];
  if (totalTimeMs < DAILY5_MIN_TIME_MS) {
    flagReasons.push(`completed_too_fast:${totalTimeMs}ms`);
  }
  const isFlagged = flagReasons.length > 0;
  const pointsForEscrow = isFlagged ? 0 : cappedScore;

  await db
    .update(anonDailyRuns)
    .set({
      completedAt: run.completedAt ?? now,
      timeMs: totalTimeMs,
      score: cappedScore,
      flagged: isFlagged,
      flagReason: isFlagged ? flagReasons.join("; ") : null,
    })
    .where(eq(anonDailyRuns.id, run.id));

  const anonGate = await creditAnonGame(player.id, `daily5:${run.id}`, {
    surface: "daily5",
    points: pointsForEscrow,
    correct: run.correctCount,
    answers: (run.answers ?? []).length || 5,
  });

  await db
    .update(anonDailyRuns)
    .set({ gateCounted: true })
    .where(eq(anonDailyRuns.id, run.id));

  const cards = await db
    .select({ position: dailyChallengeCards.position, correctAnswer: dailyChallengeCards.correctAnswer })
    .from(dailyChallengeCards)
    .where(eq(dailyChallengeCards.dailyChallengeId, challengeId))
    .orderBy(asc(dailyChallengeCards.position));

  return {
    score: cappedScore,
    correctCount: run.correctCount,
    totalTime: totalTimeMs,
    rank: 0,
    flagged: isFlagged,
    correctAnswers: cards.map((card) => ({ position: card.position, correctAnswer: card.correctAnswer })),
    pointsCredited: 0,
    escrowPoints: anonGate?.escrowPoints ?? pointsForEscrow,
    anonGate,
  };
}

export function isAnonGateError(error: unknown): error is AnonGateError {
  return error instanceof AnonGateError;
}
