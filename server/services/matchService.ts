import { randomUUID } from "crypto";
import { db } from "../db";
import { lobbies, matches, matchParticipants, matchAnswers, baseballCards, MatchStatus, type Lobby, type Match, type MatchParticipant, type GameQuestion, type MatchState, type BaseballCard } from "@shared/schema";
import { eq, and, sql, notInArray } from "drizzle-orm";
import { maybeFinish, cancelMatch as stateMachineCancelMatch, type MatchEndResult } from "./matches/stateMachine";
import { guardCanSubmit, type GuardRejectionReason } from "./matches/guardCanSubmit";
import { cardHasRealImage, getQuarantinedCardIds, quarantineCard, normalizeImageUrl } from "./cards/imageQuality";
import { getOrValidateCardImage } from "./images/imageGate";

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

class MatchService {
  private playerNames: string[] = [];
  private matchStates: Map<string, MatchState> = new Map();
  private playerAnswers: Map<string, Map<string, { answer: string; timestamp: number }>> = new Map();

  async initialize() {
    const cards = await db.select().from(baseballCards);
    this.playerNames = cards.map(c => c.playerName);
  }

  async createLobby(hostId: string, hostUsername: string, totalQuestions: number = 10): Promise<Lobby> {
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

  async joinLobby(joinCode: string, guestId: string, guestUsername: string): Promise<Lobby | null> {
    const lobby = await this.getLobbyByCode(joinCode);
    
    if (!lobby) return null;
    if (lobby.status !== "waiting") return null;
    if (lobby.guestId) return null;
    if (lobby.hostId === guestId) return null;
    
    const guestSecret = generateSecret();
    
    const [updatedLobby] = await db
      .update(lobbies)
      .set({ guestId, guestUsername, guestSecret })
      .where(eq(lobbies.id, lobby.id))
      .returning();
    
    return updatedLobby;
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
    
    const questions = await this.generateQuestions(lobby.totalQuestions);
    
    if (!questions || questions.length === 0) {
      console.error(`[MatchService] startMatch failed: no questions generated for lobby ${lobbyId}. Need verified cards in database.`);
      return { matchState: null, error: "Not enough cards available. Please try again later or contact support." };
    }
    
    console.log(`[MatchService] Generated ${questions.length} questions for lobby ${lobbyId}`);
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const [match] = await db.insert(matches).values({
      lobbyId,
      status: MatchStatus.ACTIVE,
      totalQuestions: questions.length,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername },
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
    
    console.log(`[MatchService] Starting random match for lobby ${lobbyId}, host=${lobby.hostId}, guest=${lobby.guestId}`);
    
    const questions = await this.generateQuestions(lobby.totalQuestions);
    
    if (!questions || questions.length === 0) {
      console.error(`[MatchService] startMatchForRandom failed: no questions generated for lobby ${lobbyId}. Need verified cards.`);
      return { matchState: null, error: "Not enough cards available" };
    }
    
    console.log(`[MatchService] Generated ${questions.length} questions for random match lobby ${lobbyId}`);
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const [match] = await db.insert(matches).values({
      lobbyId,
      status: MatchStatus.ACTIVE,
      totalQuestions: questions.length,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername },
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

  private async generateQuestions(count: number): Promise<GameQuestion[]> {
    const MAX_RETRY_ATTEMPTS = 3;
    const VALIDATION_BATCH_SIZE = 30;
    let attempt = 0;
    
    while (attempt < MAX_RETRY_ATTEMPTS) {
      attempt++;
      
      const quarantinedIds = await getQuarantinedCardIds();
      
      const verifiedCards = await db
        .select()
        .from(baseballCards)
        .where(eq(baseballCards.imageVerified, true));
      
      const preFilteredCards = verifiedCards.filter(card => {
        if (quarantinedIds.has(card.id.toString())) {
          return false;
        }
        
        if (!cardHasRealImage({
          cardId: card.id.toString(),
          imageUrl: card.imageUrl,
          player: card.playerName,
        })) {
          quarantineCard(card.id.toString(), "placeholder_image", card.imageUrl);
          return false;
        }
        
        return true;
      });
      
      const shuffled = [...preFilteredCards].sort(() => Math.random() - 0.5);
      const candidateBatch = shuffled.slice(0, VALIDATION_BATCH_SIZE);
      
      const validatedCards: BaseballCard[] = [];
      for (const card of candidateBatch) {
        if (validatedCards.length >= count) break;
        
        try {
          const sourceUrl = normalizeImageUrl(card.imageUrl);
          if (!sourceUrl) {
            await quarantineCard(card.id.toString(), "invalid_url", card.imageUrl);
            continue;
          }
          
          const validation = await getOrValidateCardImage(card.id.toString(), sourceUrl);
          
          if (validation.status === "ok") {
            validatedCards.push(card);
          } else {
            console.warn(`[MatchService] Card ${card.id} failed image validation: ${validation.status}`);
          }
        } catch (err) {
          console.error(`[MatchService] Error validating card ${card.id}:`, err);
        }
      }
      
      if (validatedCards.length >= count) {
        const selectedCards = validatedCards.slice(0, count);
        console.info(`[MatchService] Questions built with validation`, { count: selectedCards.length, attempt });
        return selectedCards.map(card => this.generateQuestionWithProxiedUrl(card));
      }
      
      console.warn(`[MatchService] Not enough validated cards (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}). Found ${validatedCards.length}, need ${count}`);
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
    
    console.error(`[MatchService] NO_PLAYABLE_CARDS_AVAILABLE after ${MAX_RETRY_ATTEMPTS} attempts`);
    throw new Error("NO_PLAYABLE_CARDS_AVAILABLE");
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
      imageUrl: `/api/images/card/${card.id}`,
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
    
    return {
      card,
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

    const quarantinedIds = await getQuarantinedCardIds();
    const usedCardIds = new Set(matchState.questions.map(q => q.card.id.toString()));

    const verifiedCards = await db
      .select()
      .from(baseballCards)
      .where(eq(baseballCards.imageVerified, true));

    const availableCards = verifiedCards.filter(card => {
      const cardIdStr = card.id.toString();
      if (quarantinedIds.has(cardIdStr)) return false;
      if (usedCardIds.has(cardIdStr)) return false;
      if (!cardHasRealImage({
        cardId: cardIdStr,
        imageUrl: card.imageUrl,
        player: card.playerName,
      })) {
        quarantineCard(cardIdStr, "placeholder_image", card.imageUrl);
        return false;
      }
      return true;
    });

    if (availableCards.length === 0) {
      return { success: false, error: "NO_REAL_IMAGE_CARDS_AVAILABLE" };
    }

    const newCard = availableCards[Math.floor(Math.random() * availableCards.length)];
    const newQuestion = this.generateQuestion(newCard);

    matchState.questions[idx] = newQuestion;

    console.info(`[MatchService] Resynced card at idx ${idx} for match ${matchId}`, {
      oldCardId,
      newCardId: newCard.id.toString(),
    });

    return { success: true, newQuestion };
  }

  getMatchStateForBroadcast(matchId: string): MatchState | undefined {
    return this.matchStates.get(matchId);
  }
}

export const matchService = new MatchService();
