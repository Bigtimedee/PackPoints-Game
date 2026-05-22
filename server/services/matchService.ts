import { randomUUID } from "crypto";
import { db } from "../db";
import { lobbies, matches, matchParticipants, matchAnswers, baseballCards, playableCards, matchCardQueue, MatchStatus, type Lobby, type Match, type MatchParticipant, type GameQuestion, type MatchState, type BaseballCard, type PlayableCard } from "@shared/schema";
import { eq, and, sql, notInArray, inArray } from "drizzle-orm";
import { maybeFinish, cancelMatch as stateMachineCancelMatch, type MatchEndResult } from "./matches/stateMachine";
import { guardCanSubmit, type GuardRejectionReason } from "./matches/guardCanSubmit";
import { cardHasRealImage, getQuarantinedCardIds, quarantineCard, normalizeImageUrl, analyzeCardImageContent } from "./cards/imageQuality";
import { getOrValidateCardImage } from "./images/imageGate";
import { logCardDelivery } from "./telemetry/cardDelivery";

export type AnswerAckStatus = "ACCEPTED" | "REJECTED";
export type AnswerAckReason = GuardRejectionReason | "already_answered";

export interface SubmitAnswerResult {
  ack: {
    status: AnswerAckStatus;
    reason?: AnswerAckReason;
    clientMsgId?: string;
    serverIndex?: number;
    serverStatus?: string;
  };
  correct?: boolean;
  correctAnswer?: string;
  pointsEarned?: number;
  matchState?: MatchState;
  bothAnswered?: boolean;
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

function playableCardToBaseballCard(pc: PlayableCard): BaseballCard {
  return {
    id: pc.id,
    playerName: pc.player || "Unknown",
    team: "Unknown",
    position: "Unknown",
    year: 0,
    setName: pc.set || "Unknown",
    cardNumber: pc.number || "",
    imageUrl: pc.imageUrl || "",
    popularity: 50,
    imageVerified: pc.isPlayable,
    lastImageCheck: pc.lastImageCheck,
    imageFailureCount: pc.imageFailureCount,
    imageLastError: pc.imageLastError,
    isPlayable: pc.isPlayable,
    quarantineStatus: "OK",
    imageReviewStatus: "unreviewed",
    reportCount: 0,
    blockedReason: null,
    updatedAt: null,
  };
}

class MatchService {
  private playerNames: string[] = [];
  private matchStates: Map<string, MatchState> = new Map();
  private playerAnswers: Map<string, Map<string, { answer: string; timestamp: number }>> = new Map();

  async initialize() {
    const cards = await db.select().from(playableCards).where(eq(playableCards.isPlayable, true));
    this.playerNames = cards.map(c => c.player).filter((p): p is string => !!p);
    if (this.playerNames.length === 0) {
      const legacyCards = await db.select().from(baseballCards);
      this.playerNames = legacyCards.map(c => c.playerName);
    }
    console.log(`[MatchService] Loaded ${this.playerNames.length} player names for answer options`);
  }

  async createLobby(hostId: string, hostUsername: string, totalQuestions: number = 10, gameSetId: string | null = null): Promise<Lobby> {
    let joinCode = generateJoinCode();
    let attempts = 0;
    
    while (attempts < 10) {
      const existing = await db.select().from(lobbies).where(eq(lobbies.joinCode, joinCode)).limit(1);
      if (existing.length === 0) break;
      joinCode = generateJoinCode();
      attempts++;
    }
    
    const hostSecret = generateSecret();
    
    const [lobby] = await db.insert(lobbies).values({
      joinCode,
      hostId,
      hostUsername,
      hostSecret,
      status: "waiting",
      mode: "1v1_friend",
      totalQuestions,
      gameSetId,
    }).returning();
    
    return lobby;
  }

  async getLobby(lobbyId: string): Promise<Lobby | undefined> {
    const [lobby] = await db.select().from(lobbies).where(eq(lobbies.id, lobbyId));
    return lobby;
  }

  async getLobbyByCode(joinCode: string): Promise<Lobby | undefined> {
    const [lobby] = await db.select().from(lobbies).where(eq(lobbies.joinCode, joinCode.toUpperCase()));
    return lobby;
  }

  async joinLobby(joinCode: string, guestId: string, guestUsername: string): Promise<{ lobby: Lobby } | { error: string; code: string }> {
    const lobby = await this.getLobbyByCode(joinCode);
    
    if (!lobby) return { error: "Lobby not found. Check your join code and try again.", code: "NOT_FOUND" };
    if (lobby.hostId === guestId) return { error: "You cannot join your own lobby. Share the code with a friend to play against them.", code: "SELF_JOIN" };
    if (lobby.status !== "waiting") return { error: "This lobby is no longer accepting players. The match may have already started.", code: "NOT_WAITING" };
    if (lobby.guestId) return { error: "This lobby is already full. Another player has already joined.", code: "LOBBY_FULL" };
    
    const guestSecret = generateSecret();
    
    const [updatedLobby] = await db
      .update(lobbies)
      .set({ guestId, guestUsername, guestSecret })
      .where(eq(lobbies.id, lobby.id))
      .returning();
    
    return { lobby: updatedLobby };
  }

  async leaveLobby(lobbyId: string, userId: string): Promise<Lobby | null> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) return null;
    
    if (lobby.hostId === userId) {
      await db.delete(lobbies).where(eq(lobbies.id, lobbyId));
      return null;
    } else if (lobby.guestId === userId) {
      const [updatedLobby] = await db
        .update(lobbies)
        .set({ guestId: null, guestUsername: null, guestSecret: null })
        .where(eq(lobbies.id, lobbyId))
        .returning();
      return updatedLobby;
    }
    
    return lobby;
  }

  verifyMembershipSecret(lobby: Lobby, userId: string, secret: string): boolean {
    if (lobby.hostId === userId && lobby.hostSecret === secret) return true;
    if (lobby.guestId === userId && lobby.guestSecret === secret) return true;
    return false;
  }

  async forfeitMatch(matchId: string, forfeitingUserId: string): Promise<{ matchState: MatchState | null; matchEnd?: MatchEndResult }> {
    const matchState = await this.getMatchStateWithFallback(matchId);
    if (!matchState) {
      console.error(`[MatchService] forfeitMatch: match ${matchId} not found`);
      return { matchState: null };
    }
    if (matchState.status !== MatchStatus.ACTIVE) return { matchState: null };
    
    const winner = matchState.participants.find(p => p.userId !== forfeitingUserId);
    matchState.status = MatchStatus.FINISHED;
    matchState.winner = winner?.username;
    matchState.endReason = "forfeit";
    
    await db.update(matches).set({ status: MatchStatus.FINISHED, finishedAt: new Date(), endReason: "forfeit" }).where(eq(matches.id, matchId));
    await db.update(lobbies).set({ status: "completed" }).where(eq(lobbies.id, matchState.lobbyId));
    
    const matchEnd: MatchEndResult = {
      matchId,
      lobbyId: matchState.lobbyId,
      reason: "forfeit",
      status: MatchStatus.FINISHED,
      winner: winner?.username,
      participants: matchState.participants.map(p => ({
        userId: p.userId,
        username: p.username,
        score: p.score,
        correctAnswers: p.correctAnswers,
      })),
    };
    
    return { matchState, matchEnd };
  }

  async startMatch(lobbyId: string, hostId: string): Promise<{ matchState: MatchState | null; error?: string }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) {
      console.error(`[MatchService] startMatch failed: lobby not found ${lobbyId}`);
      return { matchState: null, error: "Lobby not found" };
    }
    if (lobby.hostId !== hostId) {
      console.error(`[MatchService] startMatch failed: not host. hostId=${lobby.hostId}, requesterId=${hostId}`);
      return { matchState: null, error: "Only the host can start the match" };
    }
    if (!lobby.guestId || !lobby.guestUsername) {
      console.error(`[MatchService] startMatch failed: no guest in lobby ${lobbyId}`);
      return { matchState: null, error: "Waiting for a guest to join" };
    }
    if (lobby.status !== "waiting") {
      console.error(`[MatchService] startMatch failed: lobby status is ${lobby.status}, expected waiting`);
      return { matchState: null, error: "Match already started or ended" };
    }
    
    console.log(`[MatchService] Starting match for lobby ${lobbyId}, host=${hostId}, guest=${lobby.guestId}`);
    
    const matchId = randomUUID();
    const questions = await this.generateQuestions(lobby.totalQuestions, matchId, lobby.gameSetId || undefined);
    
    if (!questions || questions.length === 0) {
      console.error(`[MatchService] startMatch failed: no questions generated for lobby ${lobbyId}. Need verified cards in database.`);
      return { matchState: null, error: "Not enough cards available. Please try again later or contact support." };
    }
    
    console.log(`[MatchService] Generated ${questions.length} questions for lobby ${lobbyId} (set: ${lobby.gameSetId || 'all'})`);
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const [match] = await db.insert(matches).values({
      id: matchId,
      lobbyId,
      status: MatchStatus.ACTIVE,
      totalQuestions: questions.length,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername, role: "HOST" },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername, role: "GUEST" },
    ]);
    
    console.log(`[MatchService] Match ${match.id} created with ${questions.length} questions`);
    
    const matchState: MatchState = {
      matchId: match.id,
      lobbyId: lobby.id,
      status: MatchStatus.ACTIVE,
      currentQuestionIndex: 0,
      totalQuestions: questions.length,
      questions,
      participants: [
        { userId: lobby.hostId, username: lobby.hostUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
        { userId: lobby.guestId, username: lobby.guestUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
      ],
    };
    
    this.matchStates.set(match.id, matchState);
    this.playerAnswers.set(match.id, new Map());
    
    return { matchState };
  }

  async startMatchForRandom(lobbyId: string): Promise<{ matchState: MatchState | null; error?: string }> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) {
      console.error(`[MatchService] startMatchForRandom failed: lobby not found ${lobbyId}`);
      return { matchState: null, error: "Lobby not found" };
    }
    if (!lobby.guestId || !lobby.guestUsername) {
      console.error(`[MatchService] startMatchForRandom failed: no guest in lobby ${lobbyId}`);
      return { matchState: null, error: "No guest in lobby" };
    }
    
    console.log(`[MatchService] Starting random match for lobby ${lobbyId}, host=${lobby.hostId}, guest=${lobby.guestId}, set=${lobby.gameSetId || 'all'}`);
    
    const matchId = randomUUID();
    const questions = await this.generateQuestions(lobby.totalQuestions, matchId, lobby.gameSetId || undefined);
    
    if (!questions || questions.length === 0) {
      console.error(`[MatchService] startMatchForRandom failed: no questions generated for lobby ${lobbyId}. Need verified cards.`);
      return { matchState: null, error: "Not enough cards available" };
    }
    
    console.log(`[MatchService] Generated ${questions.length} questions for random match lobby ${lobbyId}`);
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const [match] = await db.insert(matches).values({
      id: matchId,
      lobbyId,
      status: MatchStatus.ACTIVE,
      totalQuestions: questions.length,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername, role: "HOST" },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername, role: "GUEST" },
    ]);
    
    console.log(`[MatchService] Random match ${match.id} created with ${questions.length} questions`);
    
    const matchState: MatchState = {
      matchId: match.id,
      lobbyId: lobby.id,
      status: MatchStatus.ACTIVE,
      currentQuestionIndex: 0,
      totalQuestions: questions.length,
      questions,
      participants: [
        { userId: lobby.hostId, username: lobby.hostUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
        { userId: lobby.guestId, username: lobby.guestUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
      ],
    };
    
    this.matchStates.set(match.id, matchState);
    this.playerAnswers.set(match.id, new Map());
    
    return { matchState };
  }

  private async generateQuestions(count: number, matchId?: string, gameSetId?: string): Promise<GameQuestion[]> {
    const MAX_RETRY_ATTEMPTS = 3;
    const VALIDATION_BATCH_SIZE = Math.max(count * 3, 60);
    const startTime = Date.now();
    let attempt = 0;
    
    while (attempt < MAX_RETRY_ATTEMPTS) {
      attempt++;
      
      const conditions = [
        eq(playableCards.isPlayable, true),
        inArray(playableCards.quarantineStatus, ["OK", "SUSPECT_TRANSIENT"]),
      ];
      
      if (gameSetId) {
        conditions.push(eq(playableCards.gameSetId, gameSetId));
      }
      
      const rawPlayable = await db
        .select()
        .from(playableCards)
        .where(and(...conditions));
      
      console.log(`[MatchService] Card pool: ${rawPlayable.length} playable cards from playable_cards table (set: ${gameSetId || 'all'}, attempt ${attempt})`);
      
      const preFilteredCards = rawPlayable.filter(card => {
        if (!card.imageUrl) return false;
        if (!card.player) return false;
        if (!cardHasRealImage({
          cardId: card.id.toString(),
          imageUrl: card.imageUrl,
          player: card.player,
        })) {
          console.warn(`[MatchService] Card ${card.id} (${card.player}) skipped: placeholder image detected`);
          return false;
        }
        return true;
      });
      
      console.log(`[MatchService] After pre-filter: ${preFilteredCards.length} cards (removed ${rawPlayable.length - preFilteredCards.length})`);
      
      const spareCount = Math.min(10, Math.max(0, preFilteredCards.length - count));
      const targetTotal = count + spareCount;
      
      const shuffled = [...preFilteredCards].sort(() => Math.random() - 0.5);
      const candidateBatch = shuffled.slice(0, VALIDATION_BATCH_SIZE);
      
      const validatedCards: BaseballCard[] = [];
      let invalidCount = 0;
      
      for (const pc of candidateBatch) {
        if (validatedCards.length >= targetTotal) break;
        
        try {
          const sourceUrl = normalizeImageUrl(pc.imageUrl);
          if (!sourceUrl) {
            invalidCount++;
            continue;
          }
          
          const validation = await getOrValidateCardImage(pc.id.toString(), sourceUrl);
          
          if (validation.status === "ok") {
            const contentAnalysis = await analyzeCardImageContent(pc.id.toString(), sourceUrl);
            
            if (contentAnalysis.isPlaceholder && contentAnalysis.confidence >= 60) {
              invalidCount++;
              await logCardDelivery("validate_fail", {
                matchId,
                cardId: pc.id.toString(),
                detail: { reason: "content_placeholder", confidence: contentAnalysis.confidence, reasons: contentAnalysis.reasons },
              });
              console.warn(`[MatchService] Card ${pc.id} failed content analysis (${contentAnalysis.confidence}%): ${contentAnalysis.reasons.join("; ")}`);
              continue;
            }
            
            validatedCards.push(playableCardToBaseballCard(pc));
          } else {
            invalidCount++;
            await logCardDelivery("validate_fail", {
              matchId,
              cardId: pc.id.toString(),
              detail: { reason: validation.status },
            });
            console.warn(`[MatchService] Card ${pc.id} failed image validation: ${validation.status}`);
          }
        } catch (err) {
          invalidCount++;
          console.error(`[MatchService] Error validating card ${pc.id}:`, err);
        }
      }
      
      await logCardDelivery("validate", {
        matchId,
        detail: {
          source: "playable_cards",
          poolSize: rawPlayable.length,
          preFiltered: preFilteredCards.length,
          validCount: validatedCards.length,
          invalidCount,
          duration_ms: Date.now() - startTime,
          attempt,
        },
      });
      
      if (validatedCards.length >= count) {
        const primaryCards = validatedCards.slice(0, count);
        const spareCards = validatedCards.slice(count, count + spareCount);
        
        if (matchId) {
          const queueEntries = [
            ...primaryCards.map((card, idx) => ({
              matchId,
              cardId: card.id.toString(),
              idx,
              isSpare: false,
              usedAsReplacement: false,
              markedBad: false,
            })),
            ...spareCards.map((card, idx) => ({
              matchId,
              cardId: card.id.toString(),
              idx: count + idx,
              isSpare: true,
              usedAsReplacement: false,
              markedBad: false,
            })),
          ];
          
          if (queueEntries.length > 0) {
            await db.insert(matchCardQueue).values(queueEntries);
            await logCardDelivery("build_queue", {
              matchId,
              detail: {
                primaryCount: primaryCards.length,
                spareCount: spareCards.length,
                duration_ms: Date.now() - startTime,
              },
            });
          }
        }
        
        console.info(`[MatchService] Questions built with validation`, { 
          count: primaryCards.length, 
          spares: spareCards.length,
          attempt 
        });
        return primaryCards.map(card => this.generateQuestionWithProxiedUrl(card));
      }
      
      console.warn(`[MatchService] Not enough validated cards (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}). Found ${validatedCards.length}, need ${count}`);
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
    
    await logCardDelivery("prefetch_fail", {
      matchId,
      detail: { attempts: MAX_RETRY_ATTEMPTS },
    });
    
    console.error(`[MatchService] NO_PLAYABLE_CARDS_AVAILABLE after ${MAX_RETRY_ATTEMPTS} attempts`);
    throw new Error("NO_PLAYABLE_CARDS_AVAILABLE");
  }
  
  async replaceCard(matchId: string, questionIdx: number): Promise<GameQuestion | null> {
    const queuedCards = await db
      .select()
      .from(matchCardQueue)
      .where(eq(matchCardQueue.matchId, matchId));
    
    const currentCard = queuedCards.find(c => c.idx === questionIdx && !c.isSpare);
    if (!currentCard) {
      console.error(`[MatchService] No card found at questionIdx ${questionIdx} for match ${matchId}`);
      return null;
    }
    
    const availableSpare = queuedCards.find(c => c.isSpare && !c.usedAsReplacement && !c.markedBad);
    if (!availableSpare) {
      console.warn(`[MatchService] No spare cards available for replacement in match ${matchId}`);
      return null;
    }
    
    await db.update(matchCardQueue)
      .set({ markedBad: true })
      .where(eq(matchCardQueue.id, currentCard.id));
    
    await db.update(matchCardQueue)
      .set({ 
        usedAsReplacement: true,
        idx: questionIdx,
        isSpare: false,
      })
      .where(eq(matchCardQueue.id, availableSpare.id));
    
    let replacementDbCard: BaseballCard | null = null;
    
    const [pcCard] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.id, availableSpare.cardId))
      .limit(1);
    
    if (pcCard) {
      replacementDbCard = playableCardToBaseballCard(pcCard);
    } else {
      const [bcCard] = await db
        .select()
        .from(baseballCards)
        .where(eq(baseballCards.id, availableSpare.cardId))
        .limit(1);
      replacementDbCard = bcCard || null;
    }
    
    if (!replacementDbCard) {
      console.error(`[MatchService] Replacement card ${availableSpare.cardId} not found in database`);
      return null;
    }
    
    await logCardDelivery("replace_card", {
      matchId,
      cardId: availableSpare.cardId,
      detail: {
        questionIdx,
        originalCardId: currentCard.cardId,
        replacementCardId: availableSpare.cardId,
      },
    });
    
    const matchState = this.matchStates.get(matchId);
    if (matchState && matchState.questions[questionIdx]) {
      const newQuestion = this.generateQuestionWithProxiedUrl(replacementDbCard);
      matchState.questions[questionIdx] = newQuestion;
      this.matchStates.set(matchId, matchState);
      return newQuestion;
    }
    
    return this.generateQuestionWithProxiedUrl(replacementDbCard);
  }

  private generateQuestionWithProxiedUrl(card: BaseballCard): GameQuestion {
    const wrongOptions = this.playerNames
      .filter(name => name !== card.playerName)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    
    const options = [card.playerName, ...wrongOptions].sort(() => Math.random() - 0.5);
    const basePoints = 100;
    const pointValue = Math.max(50, basePoints + (100 - card.popularity) * 4);
    
    const proxiedCard = {
      ...card,
      imageUrl: `/api/cards/${card.id}/masked-image`,
    };
    
    return {
      card: proxiedCard,
      options,
      correctAnswer: card.playerName,
      pointValue,
    };
  }

  private generateQuestion(card: BaseballCard): GameQuestion {
    const wrongOptions = this.playerNames
      .filter(name => name !== card.playerName)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    
    const options = [card.playerName, ...wrongOptions].sort(() => Math.random() - 0.5);
    const basePoints = 100;
    const pointValue = Math.max(50, basePoints + (100 - card.popularity) * 4);
    
    const maskedCard = {
      ...card,
      imageUrl: `/api/cards/${card.id}/masked-image`,
    };
    
    return {
      card: maskedCard,
      options,
      correctAnswer: card.playerName,
      pointValue,
    };
  }

  getMatchState(matchId: string): MatchState | undefined {
    return this.matchStates.get(matchId);
  }

  async getMatchStateWithFallback(matchId: string): Promise<MatchState | undefined> {
    const memoryState = this.matchStates.get(matchId);
    if (memoryState) {
      return memoryState;
    }

    console.log(`[MatchService] Match ${matchId} not in memory, attempting database reconstruction`);
    
    const reconstructed = await this.reconstructMatchStateFromDb(matchId);
    if (reconstructed) {
      this.matchStates.set(matchId, reconstructed);
      this.playerAnswers.set(matchId, new Map());
      console.log(`[MatchService] Match ${matchId} reconstructed from database with ${reconstructed.questions.length} questions`);
    }
    
    return reconstructed;
  }

  private async reconstructMatchStateFromDb(matchId: string): Promise<MatchState | undefined> {
    try {
      const [match] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);

      if (!match) {
        console.error(`[MatchService] Match ${matchId} not found in database`);
        return undefined;
      }

      const participants = await db
        .select()
        .from(matchParticipants)
        .where(eq(matchParticipants.matchId, matchId));

      if (participants.length === 0) {
        console.error(`[MatchService] No participants found for match ${matchId}`);
        return undefined;
      }

      let questions: GameQuestion[] = [];
      try {
        if (match.questionsData) {
          questions = JSON.parse(match.questionsData);
        }
      } catch (e) {
        console.error(`[MatchService] Failed to parse questionsData for match ${matchId}:`, e);
        return undefined;
      }

      if (!questions || questions.length === 0) {
        console.error(`[MatchService] Match ${matchId} has no questions in database`);
        return undefined;
      }

      const matchCurrentIndex = match.currentQuestionIndex || 0;
      
      const matchState: MatchState = {
        matchId: match.id,
        lobbyId: match.lobbyId || "",
        status: match.status as typeof MatchStatus[keyof typeof MatchStatus],
        currentQuestionIndex: matchCurrentIndex,
        totalQuestions: match.totalQuestions,
        questions,
        participants: participants.map(p => ({
          userId: p.userId,
          username: p.username,
          score: p.score || 0,
          correctAnswers: p.correctAnswers || 0,
          currentQuestionIndex: p.currentQuestionIndex || 0,
          hasAnsweredCurrent: (p.currentQuestionIndex || 0) >= matchCurrentIndex,
        })),
      };
      
      console.log(`[MatchService] Reconstructed match ${matchId}: matchIndex=${matchCurrentIndex}, participants=[${participants.map(p => `${p.username}:idx=${p.currentQuestionIndex}`).join(', ')}]`);

      return matchState;
    } catch (error) {
      console.error(`[MatchService] Error reconstructing match ${matchId}:`, error);
      return undefined;
    }
  }

  async submitAnswer(matchId: string, userId: string, questionIndex: number, selectedAnswer: string, clientMsgId?: string): Promise<SubmitAnswerResult> {
    const matchState = await this.getMatchStateWithFallback(matchId);
    
    const guardResult = guardCanSubmit(matchState, userId, questionIndex);
    
    if (!guardResult.allowed || !matchState) {
      console.log(`[MatchService] submitAnswer REJECTED: matchId=${matchId}, userId=${userId}, idx=${questionIndex}, reason=${guardResult.reason}, serverIdx=${guardResult.serverIndex}, serverStatus=${guardResult.serverStatus}`);
      return { 
        ack: { 
          status: "REJECTED", 
          reason: guardResult.reason || "match_not_found", 
          clientMsgId,
          serverIndex: guardResult.serverIndex,
          serverStatus: guardResult.serverStatus,
        }
      };
    }
    
    const participant = matchState.participants.find(p => p.userId === userId)!;
    
    const [existingAnswer] = await db
      .select()
      .from(matchAnswers)
      .where(and(
        eq(matchAnswers.matchId, matchId),
        eq(matchAnswers.userId, userId),
        eq(matchAnswers.idx, questionIndex)
      ));
    
    if (existingAnswer) {
      const currentQuestion = matchState.questions[questionIndex];
      const bothAnswered = matchState.participants.every(p => p.hasAnsweredCurrent);
      return { 
        ack: { status: "ACCEPTED", clientMsgId },
        correct: existingAnswer.isCorrect,
        correctAnswer: currentQuestion.correctAnswer,
        pointsEarned: existingAnswer.pointsEarned,
        matchState,
        bothAnswered 
      };
    }
    
    const currentQuestion = matchState.questions[questionIndex];
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
    const pointsEarned = isCorrect ? currentQuestion.pointValue : 0;
    
    try {
      await db.insert(matchAnswers).values({
        matchId,
        userId,
        idx: questionIndex,
        selected: selectedAnswer,
        isCorrect,
        pointsEarned,
        clientMsgId,
      });
    } catch (error: any) {
      if (error.code === '23505') {
        const [existingAnswer] = await db
          .select()
          .from(matchAnswers)
          .where(and(
            eq(matchAnswers.matchId, matchId),
            eq(matchAnswers.userId, userId),
            eq(matchAnswers.idx, questionIndex)
          ));
        
        if (existingAnswer) {
          const bothAnswered = matchState.participants.every(p => p.hasAnsweredCurrent);
          return { 
            ack: { status: "ACCEPTED", clientMsgId },
            correct: existingAnswer.isCorrect,
            correctAnswer: currentQuestion.correctAnswer,
            pointsEarned: existingAnswer.pointsEarned,
            matchState,
            bothAnswered 
          };
        }
      }
      throw error;
    }
    
    participant.score += pointsEarned;
    if (isCorrect) participant.correctAnswers += 1;
    participant.hasAnsweredCurrent = true;
    
    const answers = this.playerAnswers.get(matchId) || new Map();
    answers.set(`${userId}-${questionIndex}`, { answer: selectedAnswer, timestamp: Date.now() });
    this.playerAnswers.set(matchId, answers);
    
    const bothAnswered = matchState.participants.every(p => p.hasAnsweredCurrent);
    
    await db
      .update(matchParticipants)
      .set({
        score: participant.score,
        correctAnswers: participant.correctAnswers,
        currentQuestionIndex: questionIndex,
      })
      .where(and(
        eq(matchParticipants.matchId, matchId),
        eq(matchParticipants.userId, userId)
      ));
    
    return { 
      ack: { status: "ACCEPTED", clientMsgId },
      correct: isCorrect, 
      correctAnswer: currentQuestion.correctAnswer,
      pointsEarned, 
      matchState, 
      bothAnswered 
    };
  }

  async advanceQuestion(matchId: string): Promise<{ matchState: MatchState | null; matchEnd?: MatchEndResult }> {
    const matchState = await this.getMatchStateWithFallback(matchId);
    if (!matchState) {
      console.error(`[MatchService] advanceQuestion: match ${matchId} not found`);
      return { matchState: null };
    }
    
    const nextIndex = matchState.currentQuestionIndex + 1;
    matchState.currentQuestionIndex = nextIndex;
    
    await db.update(matches).set({ currentQuestionIndex: nextIndex }).where(eq(matches.id, matchId));
    
    const matchEnd = await maybeFinish(matchState);
    
    if (matchEnd) {
      return { matchState, matchEnd };
    }
    
    matchState.participants.forEach(p => {
      p.hasAnsweredCurrent = false;
      p.currentQuestionIndex = nextIndex;
    });
    
    return { matchState };
  }

  private determineWinner(matchState: MatchState): string | undefined {
    const sorted = [...matchState.participants].sort((a, b) => b.score - a.score);
    if (sorted.length < 2) return sorted[0]?.username;
    if (sorted[0].score === sorted[1].score) return undefined;
    return sorted[0].username;
  }

  async getMatchParticipants(matchId: string): Promise<MatchParticipant[]> {
    return await db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId));
  }

  async resyncCard(matchId: string, idx: number, userId: string): Promise<{ success: boolean; newQuestion?: GameQuestion; error?: string }> {
    const matchState = this.matchStates.get(matchId);
    if (!matchState) {
      return { success: false, error: "Match not found" };
    }

    const isParticipant = matchState.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      return { success: false, error: "Not a participant" };
    }

    if (idx < 0 || idx >= matchState.questions.length) {
      return { success: false, error: "Invalid question index" };
    }

    const oldQuestion = matchState.questions[idx];
    const oldCardId = oldQuestion.card.id.toString();

    await quarantineCard(oldCardId, "client_image_error", oldQuestion.card.imageUrl);
    
    await logCardDelivery("image_fail", {
      matchId,
      cardId: oldCardId,
      detail: { questionIdx: idx, reason: "client_image_error" },
    });

    const replacedQuestion = await this.replaceCard(matchId, idx);
    if (replacedQuestion) {
      console.info(`[MatchService] Replaced card from queue at idx ${idx} for match ${matchId}`, {
        oldCardId,
        newCardId: replacedQuestion.card.id.toString(),
      });
      return { success: true, newQuestion: replacedQuestion };
    }

    console.warn(`[MatchService] No spare cards in queue, falling back to database fetch for match ${matchId}`);

    const usedCardIds = new Set(matchState.questions.map(q => q.card.id.toString()));

    const fallbackCards = await db
      .select()
      .from(playableCards)
      .where(
        and(
          eq(playableCards.isPlayable, true),
          inArray(playableCards.quarantineStatus, ["OK", "SUSPECT_TRANSIENT"])
        )
      );

    const availableCards = fallbackCards.filter(card => {
      const cardIdStr = card.id.toString();
      if (usedCardIds.has(cardIdStr)) return false;
      if (!card.imageUrl || !card.player) return false;
      if (!cardHasRealImage({
        cardId: cardIdStr,
        imageUrl: card.imageUrl,
        player: card.player,
      })) {
        return false;
      }
      return true;
    }).map(playableCardToBaseballCard);

    if (availableCards.length === 0) {
      return { success: false, error: "NO_REAL_IMAGE_CARDS_AVAILABLE" };
    }

    const newCard = availableCards[Math.floor(Math.random() * availableCards.length)];
    const newQuestion = this.generateQuestionWithProxiedUrl(newCard);

    matchState.questions[idx] = newQuestion;

    console.info(`[MatchService] Resynced card from database at idx ${idx} for match ${matchId}`, {
      oldCardId,
      newCardId: newCard.id.toString(),
    });

    return { success: true, newQuestion };
  }

  getMatchStateForBroadcast(matchId: string): MatchState | undefined {
    return this.matchStates.get(matchId);
  }

  async setLobbyGameSet(lobbyId: string, gameSetId: string, requesterUserId: string, totalQuestions?: number): Promise<Lobby> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.hostId !== requesterUserId) throw new Error("Only the host can change the card set");
    if (lobby.status !== "waiting") throw new Error("Lobby is not in waiting state");

    const [updated] = await db
      .update(lobbies)
      .set(totalQuestions !== undefined ? { gameSetId, totalQuestions } : { gameSetId })
      .where(eq(lobbies.id, lobbyId))
      .returning();
    return updated;
  }

  async resetLobbyForRematch(lobbyId: string): Promise<Lobby> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const [updated] = await db
      .update(lobbies)
      .set({ status: "waiting" })
      .where(eq(lobbies.id, lobbyId))
      .returning();
    return updated;
  }
}

export const matchService = new MatchService();
