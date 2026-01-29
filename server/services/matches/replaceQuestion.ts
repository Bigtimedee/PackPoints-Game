import { db } from "../../db";
import {
  matches,
  matchParticipants,
  matchQuestions,
  matchUsedCards,
  matchEvents,
  baseballCards,
  MatchStatus,
  type GameQuestion,
} from "@shared/schema";
import { eq, and, sql, notInArray } from "drizzle-orm";
import { quarantineCard, cardHasRealImage, getQuarantinedCardIds } from "../cards/imageQuality";

const MAX_REPLACES_PER_IDX = 3;
const COOLDOWN_SECONDS = 3;

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

export async function replaceMatchQuestion(
  matchId: string,
  userId: string,
  idx: number,
  seedVersion: number,
  reason: string = "image_load_failed"
): Promise<ReplaceQuestionResult> {
  console.log(`[ReplaceQuestion] Request: matchId=${matchId}, userId=${userId}, idx=${idx}, seedVersion=${seedVersion}, reason=${reason}`);

  return await db.transaction(async (tx) => {
    // 1) Lock match row FOR UPDATE
    const [match] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update")
      .limit(1);

    if (!match) {
      return { success: false, error: "Match not found", errorCode: "MATCH_NOT_FOUND" };
    }

    // 2) Validate match status
    if (match.status !== MatchStatus.ACTIVE && match.status !== MatchStatus.INITIALIZING) {
      return { 
        success: false, 
        error: "Match is not active", 
        errorCode: "MATCH_NOT_ACTIVE" 
      };
    }

    // 3) Validate idx matches current question
    if (match.currentQuestionIndex !== idx) {
      console.log(`[ReplaceQuestion] Stale index: current=${match.currentQuestionIndex}, requested=${idx}`);
      return { 
        success: false, 
        error: "Can only replace current question", 
        errorCode: "STALE_INDEX" 
      };
    }

    // 4) Validate user is participant
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

    // 5) Get current question from match_questions table or parse from questionsData
    let currentQuestion = await tx
      .select()
      .from(matchQuestions)
      .where(and(eq(matchQuestions.matchId, matchId), eq(matchQuestions.idx, idx)))
      .limit(1)
      .then(rows => rows[0]);

    // If question doesn't exist in match_questions, create it from questionsData
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

      // Also track this card as used
      try {
        await tx.insert(matchUsedCards).values({
          matchId,
          cardId: q.card.id,
        }).onConflictDoNothing();
      } catch (e) {
        // Ignore conflict
      }
    }

    // 6) Validate seedVersion matches
    if (currentQuestion.seedVersion !== seedVersion) {
      console.log(`[ReplaceQuestion] Stale seedVersion: current=${currentQuestion.seedVersion}, requested=${seedVersion}`);
      return { 
        success: false, 
        error: "Question already replaced, please refresh", 
        errorCode: "STALE_SEED_VERSION" 
      };
    }

    // 7) Check replaced count limit
    if (currentQuestion.replacedCount >= MAX_REPLACES_PER_IDX) {
      await logEvent(matchId, "REPLACE_DENIED", { userId, idx, reason: "max_replaces_exceeded" }, userId);
      return { 
        success: false, 
        error: `Maximum ${MAX_REPLACES_PER_IDX} replacements reached for this question`, 
        errorCode: "MAX_REPLACES_EXCEEDED" 
      };
    }

    // 8) Check cooldown
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

    // 9) Quarantine the old card that failed to load
    const oldCardId = currentQuestion.cardId;
    if (oldCardId) {
      // Fire-and-forget quarantine (don't block the transaction)
      quarantineCard(oldCardId, `replaced_in_match:${reason}`, null).catch(e => {
        console.error(`[ReplaceQuestion] Failed to quarantine card ${oldCardId}:`, e);
      });
      console.warn(`[ReplaceQuestion] Quarantined card ${oldCardId}: ${reason}`);
    }

    // 10) Get all used card IDs for this match
    const usedCards = await tx
      .select({ cardId: matchUsedCards.cardId })
      .from(matchUsedCards)
      .where(eq(matchUsedCards.matchId, matchId));
    
    const usedCardIds = usedCards.map(c => c.cardId);

    // 11) Get quarantined card IDs
    const quarantinedIds = await getQuarantinedCardIds();

    // 12) Select a new verified card not already used and not quarantined
    const potentialCards = await tx
      .select()
      .from(baseballCards)
      .where(eq(baseballCards.imageVerified, true))
      .orderBy(sql`RANDOM()`)
      .limit(20);

    // Filter out used cards, quarantined cards, and cards without real images
    const availableCard = potentialCards.find(c => {
      if (usedCardIds.includes(c.id)) return false;
      if (quarantinedIds.has(c.id)) return false;
      if (!cardHasRealImage({ cardId: c.id, imageUrl: c.imageUrl, player: c.playerName })) {
        // Quarantine detected placeholder
        quarantineCard(c.id, "placeholder_image", c.imageUrl).catch(() => {});
        return false;
      }
      return true;
    });

    if (!availableCard) {
      await logEvent(matchId, "REPLACE_DENIED", { userId, idx, reason: "no_cards_available" }, userId);
      return { 
        success: false, 
        error: "No replacement cards available", 
        errorCode: "NO_CARDS_AVAILABLE" 
      };
    }

    // 11) Generate new question choices
    const allPlayerNames = await tx
      .select({ playerName: baseballCards.playerName })
      .from(baseballCards)
      .limit(100);

    const wrongOptions = allPlayerNames
      .map(c => c.playerName)
      .filter(name => name !== availableCard.playerName)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    const choices = [availableCard.playerName, ...wrongOptions].sort(() => Math.random() - 0.5);
    const basePoints = 100;
    const pointValue = Math.max(50, basePoints + (100 - availableCard.popularity) * 4);

    // 12) Update match_questions with new card
    const newSeedVersion = currentQuestion.seedVersion + 1;
    await tx.update(matchQuestions).set({
      cardId: availableCard.id,
      correctAnswer: availableCard.playerName,
      choices: JSON.stringify(choices),
      pointValue,
      seedVersion: newSeedVersion,
      replacedCount: currentQuestion.replacedCount + 1,
      assignedAt: new Date(),
    }).where(and(eq(matchQuestions.matchId, matchId), eq(matchQuestions.idx, idx)));

    // 13) Mark new card as used
    await tx.insert(matchUsedCards).values({
      matchId,
      cardId: availableCard.id,
    }).onConflictDoNothing();

    // 14) Update questionsData in match table (for compatibility)
    let questions: GameQuestion[] = [];
    try {
      questions = JSON.parse(match.questionsData);
    } catch (e) {
      console.error(`[ReplaceQuestion] Failed to parse questionsData`);
    }

    if (idx < questions.length) {
      questions[idx] = {
        card: availableCard,
        options: choices,
        correctAnswer: availableCard.playerName,
        pointValue,
      };
      await tx.update(matches).set({
        questionsData: JSON.stringify(questions),
      }).where(eq(matches.id, matchId));
    }

    // 15) Log replacement event
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
      },
      actorUserId: userId,
    });

    console.log(`[ReplaceQuestion] Success: matchId=${matchId}, idx=${idx}, oldCard=${currentQuestion.cardId}, newCard=${availableCard.id}, newSeedVersion=${newSeedVersion}`);

    return {
      success: true,
      newQuestion: {
        idx,
        seedVersion: newSeedVersion,
        card: {
          id: availableCard.id,
          imageUrl: availableCard.imageUrl,
          team: availableCard.team,
          year: availableCard.year,
          setName: availableCard.setName,
          cardNumber: availableCard.cardNumber,
        },
        choices,
        pointValue,
        correctAnswer: availableCard.playerName,
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
