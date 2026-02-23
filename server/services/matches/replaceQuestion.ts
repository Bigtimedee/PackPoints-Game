import { db } from "../../db";
import {
  matches,
  matchParticipants,
  matchQuestions,
  matchUsedCards,
  matchEvents,
  playableCards,
  MatchStatus,
  type GameQuestion,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { quarantineCard, cardHasRealImage, normalizeImageUrl } from "../cards/imageQuality";
import { getOrValidateCardImage } from "../images/imageGate";

const MAX_REPLACES_PER_IDX = 3;
const COOLDOWN_SECONDS = 3;
const LOW_POOL_THRESHOLD = 20;

export interface ReplaceQuestionResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  newQuestion?: {
    idx: number;
    seedVersion: number;
    card: {
      id: string;
      imageUrl: string;
      team: string;
      year: number;
      setName: string;
      cardNumber: string;
    };
    choices: string[];
    pointValue: number;
    correctAnswer: string;
  };
  matchState?: any;
}

async function logEvent(matchId: string, type: string, payload: object, actorUserId?: string) {
  try {
    await db.insert(matchEvents).values({
      matchId,
      type,
      payload,
      actorUserId: actorUserId || null,
    });
  } catch (e) {
    console.error(`[ReplaceQuestion] Failed to log event: matchId=${matchId}, type=${type}`, e);
  }
}

async function findReplacementCard(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  matchId: string,
  gameSetId: string | null,
  usedCardIds: string[]
): Promise<typeof playableCards.$inferSelect | null> {
  const baseConditions = [
    eq(playableCards.isPlayable, true),
    inArray(playableCards.quarantineStatus, ["OK", "SUSPECT_TRANSIENT"]),
  ];

  const tryFindCard = async (conditions: any[], label: string) => {
    const candidates = await tx
      .select()
      .from(playableCards)
      .where(and(...conditions))
      .orderBy(sql`RANDOM()`)
      .limit(50);

    const usedSet = new Set(usedCardIds);
    const filtered = candidates.filter(c => {
      if (usedSet.has(c.id)) return false;
      if (!c.imageUrl || !c.player) return false;
      if (!cardHasRealImage({ cardId: c.id, imageUrl: c.imageUrl, player: c.player })) {
        quarantineCard(c.id, "placeholder_image", c.imageUrl).catch(() => {});
        return false;
      }
      const normalized = normalizeImageUrl(c.imageUrl);
      if (!normalized) return false;
      return true;
    });

    if (filtered.length > 0 && filtered.length < LOW_POOL_THRESHOLD) {
      console.warn(`[ReplaceQuestion] LOW POOL WARNING: Only ${filtered.length} replacement cards available (${label}, matchId=${matchId})`);
    }

    if (filtered.length === 0) return null;

    for (const card of filtered) {
      try {
        const validation = await getOrValidateCardImage(card.id, normalizeImageUrl(card.imageUrl)!);
        if (validation.status === "ok") {
          return card;
        }
        console.warn(`[ReplaceQuestion] Card ${card.id} failed image validation: ${validation.status}`);
      } catch (e) {
        console.warn(`[ReplaceQuestion] Card ${card.id} validation error:`, e);
      }
    }

    return null;
  };

  if (gameSetId) {
    const card = await tryFindCard([...baseConditions, eq(playableCards.gameSetId, gameSetId)], `set:${gameSetId}`);
    if (card) return card;
    console.log(`[ReplaceQuestion] No card in set ${gameSetId}, falling back to all sets`);
  }

  return tryFindCard(baseConditions, "all_sets");
}

export async function replaceMatchQuestion(
  matchId: string,
  userId: string,
  idx: number,
  seedVersion: number,
  reason: string = "image_load_failed"
): Promise<ReplaceQuestionResult> {
  console.log(`[ReplaceQuestion] Request: matchId=${matchId}, userId=${userId}, idx=${idx}, seedVersion=${seedVersion}, reason=${reason}`);

  return await db.transaction(async (tx) => {
    const [match] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update")
      .limit(1);

    if (!match) {
      return { success: false, error: "Match not found", errorCode: "MATCH_NOT_FOUND" };
    }

    if (match.status !== MatchStatus.ACTIVE && match.status !== MatchStatus.INITIALIZING) {
      return { 
        success: false, 
        error: "Match is not active", 
        errorCode: "MATCH_NOT_ACTIVE" 
      };
    }

    if (match.currentQuestionIndex !== idx) {
      console.log(`[ReplaceQuestion] Stale index: current=${match.currentQuestionIndex}, requested=${idx}`);
      return { 
        success: false, 
        error: "Can only replace current question", 
        errorCode: "STALE_INDEX" 
      };
    }

    const participants = await tx
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, matchId));

    const isParticipant = participants.some(p => p.userId === userId);
    if (!isParticipant) {
      return { 
        success: false, 
        error: "Not a participant", 
        errorCode: "NOT_PARTICIPANT" 
      };
    }

    let currentQuestion = await tx
      .select()
      .from(matchQuestions)
      .where(and(eq(matchQuestions.matchId, matchId), eq(matchQuestions.idx, idx)))
      .limit(1)
      .then(rows => rows[0]);

    if (!currentQuestion) {
      let questions: GameQuestion[] = [];
      try {
        questions = JSON.parse(match.questionsData);
      } catch (e) {
        return { success: false, error: "Invalid match data", errorCode: "INVALID_DATA" };
      }

      if (idx >= questions.length) {
        return { success: false, error: "Invalid question index", errorCode: "INVALID_INDEX" };
      }

      const q = questions[idx];
      const [inserted] = await tx.insert(matchQuestions).values({
        matchId,
        idx,
        cardId: q.card.id,
        correctAnswer: q.correctAnswer,
        choices: JSON.stringify(q.options),
        pointValue: q.pointValue,
        seedVersion: 1,
        replacedCount: 0,
      }).returning();

      currentQuestion = inserted;

      try {
        await tx.insert(matchUsedCards).values({
          matchId,
          cardId: q.card.id,
        }).onConflictDoNothing();
      } catch (e) {
        // Ignore conflict
      }
    }

    if (currentQuestion.seedVersion !== seedVersion) {
      console.log(`[ReplaceQuestion] Stale seedVersion: current=${currentQuestion.seedVersion}, requested=${seedVersion}`);
      return { 
        success: false, 
        error: "Question already replaced, please refresh", 
        errorCode: "STALE_SEED_VERSION" 
      };
    }

    if (currentQuestion.replacedCount >= MAX_REPLACES_PER_IDX) {
      await logEvent(matchId, "REPLACE_DENIED", { userId, idx, reason: "max_replaces_exceeded" }, userId);
      return { 
        success: false, 
        error: `Maximum ${MAX_REPLACES_PER_IDX} replacements reached for this question`, 
        errorCode: "MAX_REPLACES_EXCEEDED" 
      };
    }

    if (currentQuestion.assignedAt) {
      const secondsSinceAssignment = (Date.now() - new Date(currentQuestion.assignedAt).getTime()) / 1000;
      if (secondsSinceAssignment < COOLDOWN_SECONDS) {
        await logEvent(matchId, "REPLACE_DENIED", { userId, idx, reason: "cooldown" }, userId);
        return { 
          success: false, 
          error: `Please wait ${Math.ceil(COOLDOWN_SECONDS - secondsSinceAssignment)} seconds before requesting another replacement`, 
          errorCode: "COOLDOWN" 
        };
      }
    }

    const oldCardId = currentQuestion.cardId;
    if (oldCardId) {
      quarantineCard(oldCardId, `replaced_in_match:${reason}`, null).catch(e => {
        console.error(`[ReplaceQuestion] Failed to quarantine card ${oldCardId}:`, e);
      });
      console.warn(`[ReplaceQuestion] Quarantined card ${oldCardId}: ${reason}`);
    }

    const usedCards = await tx
      .select({ cardId: matchUsedCards.cardId })
      .from(matchUsedCards)
      .where(eq(matchUsedCards.matchId, matchId));
    
    const usedCardIds = usedCards.map(c => c.cardId);

    const gameSetId = match.cardSetId || null;
    const availableCard = await findReplacementCard(tx, matchId, gameSetId, usedCardIds);

    if (!availableCard) {
      await logEvent(matchId, "REPLACE_DENIED", { userId, idx, reason: "no_cards_available", gameSetId }, userId);
      console.error(`[ReplaceQuestion] CRITICAL: No replacement cards available. usedCards=${usedCardIds.length}, gameSetId=${gameSetId}`);
      return { 
        success: false, 
        error: "No replacement cards available", 
        errorCode: "NO_CARDS_AVAILABLE" 
      };
    }

    const playerName = availableCard.player || "Unknown";

    const allPlayerNames = await tx
      .select({ player: playableCards.player })
      .from(playableCards)
      .where(and(
        eq(playableCards.isPlayable, true),
        sql`${playableCards.player} IS NOT NULL`
      ))
      .orderBy(sql`RANDOM()`)
      .limit(200);

    const wrongOptions = allPlayerNames
      .map(c => c.player!)
      .filter(name => name !== playerName)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    const choices = [playerName, ...wrongOptions].sort(() => Math.random() - 0.5);
    const cardPopularity = 50;
    const basePoints = 100;
    const pointValue = Math.max(50, basePoints + (100 - cardPopularity) * 4);

    const newSeedVersion = currentQuestion.seedVersion + 1;
    await tx.update(matchQuestions).set({
      cardId: availableCard.id,
      correctAnswer: playerName,
      choices: JSON.stringify(choices),
      pointValue,
      seedVersion: newSeedVersion,
      replacedCount: currentQuestion.replacedCount + 1,
      assignedAt: new Date(),
    }).where(and(eq(matchQuestions.matchId, matchId), eq(matchQuestions.idx, idx)));

    await tx.insert(matchUsedCards).values({
      matchId,
      cardId: availableCard.id,
    }).onConflictDoNothing();

    let questions: GameQuestion[] = [];
    try {
      questions = JSON.parse(match.questionsData);
    } catch (e) {
      console.error(`[ReplaceQuestion] Failed to parse questionsData`);
    }

    if (idx < questions.length) {
      const proxiedCard = {
        id: availableCard.id,
        playerName,
        team: "Unknown",
        position: "Unknown",
        year: 0,
        setName: availableCard.set || "Unknown",
        cardNumber: availableCard.number || "",
        imageUrl: `/api/images/card/${availableCard.id}`,
        popularity: 50,
        imageVerified: true,
        lastImageCheck: availableCard.lastImageCheck,
        imageFailureCount: availableCard.imageFailureCount,
        imageLastError: availableCard.imageLastError,
      };
      questions[idx] = {
        card: proxiedCard,
        options: choices,
        correctAnswer: playerName,
        pointValue,
      };
      await tx.update(matches).set({
        questionsData: JSON.stringify(questions),
      }).where(eq(matches.id, matchId));
    }

    await tx.insert(matchEvents).values({
      matchId,
      type: "QUESTION_REPLACED",
      payload: {
        userId,
        idx,
        oldCardId: currentQuestion.cardId,
        newCardId: availableCard.id,
        oldSeedVersion: currentQuestion.seedVersion,
        newSeedVersion,
        reason,
        source: "playable_cards",
      },
      actorUserId: userId,
    });

    console.log(`[ReplaceQuestion] Success: matchId=${matchId}, idx=${idx}, oldCard=${currentQuestion.cardId}, newCard=${availableCard.id}, newSeedVersion=${newSeedVersion} (from playable_cards pool)`);

    return {
      success: true,
      newQuestion: {
        idx,
        seedVersion: newSeedVersion,
        card: {
          id: availableCard.id,
          imageUrl: `/api/images/card/${availableCard.id}`,
          team: "Unknown",
          year: 0,
          setName: availableCard.set || "Unknown",
          cardNumber: availableCard.number || "",
        },
        choices,
        pointValue,
        correctAnswer: playerName,
      },
    };
  });
}

export async function getQuestionSeedVersion(matchId: string, idx: number): Promise<number | null> {
  const [question] = await db
    .select({ seedVersion: matchQuestions.seedVersion })
    .from(matchQuestions)
    .where(and(eq(matchQuestions.matchId, matchId), eq(matchQuestions.idx, idx)))
    .limit(1);

  return question?.seedVersion ?? null;
}
