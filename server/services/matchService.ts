import { randomUUID } from "crypto";
import { db } from "../db";
import { lobbies, matches, matchParticipants, baseballCards, type Lobby, type Match, type MatchParticipant, type GameQuestion, type MatchState, type BaseballCard } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

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

  async forfeitMatch(matchId: string, forfeitingUserId: string): Promise<MatchState | null> {
    const matchState = this.matchStates.get(matchId);
    if (!matchState) return null;
    if (matchState.status !== "active") return null;
    
    const winner = matchState.participants.find(p => p.userId !== forfeitingUserId);
    matchState.status = "completed";
    matchState.winner = winner?.username;
    
    await db.update(matches).set({ status: "completed", completedAt: new Date() }).where(eq(matches.id, matchId));
    await db.update(lobbies).set({ status: "completed" }).where(eq(lobbies.id, matchState.lobbyId));
    
    return matchState;
  }

  async startMatch(lobbyId: string, hostId: string): Promise<MatchState | null> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) return null;
    if (lobby.hostId !== hostId) return null;
    if (!lobby.guestId || !lobby.guestUsername) return null;
    if (lobby.status !== "waiting") return null;
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const questions = await this.generateQuestions(lobby.totalQuestions);
    
    const [match] = await db.insert(matches).values({
      lobbyId,
      status: "active",
      totalQuestions: lobby.totalQuestions,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername },
    ]);
    
    const matchState: MatchState = {
      matchId: match.id,
      lobbyId: lobby.id,
      status: "active",
      currentQuestionIndex: 0,
      totalQuestions: lobby.totalQuestions,
      questions,
      participants: [
        { userId: lobby.hostId, username: lobby.hostUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
        { userId: lobby.guestId, username: lobby.guestUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
      ],
    };
    
    this.matchStates.set(match.id, matchState);
    this.playerAnswers.set(match.id, new Map());
    
    return matchState;
  }

  async startMatchForRandom(lobbyId: string): Promise<MatchState | null> {
    const lobby = await this.getLobby(lobbyId);
    if (!lobby) return null;
    if (!lobby.guestId || !lobby.guestUsername) return null;
    
    await db.update(lobbies).set({ status: "playing" }).where(eq(lobbies.id, lobbyId));
    
    const questions = await this.generateQuestions(lobby.totalQuestions);
    
    const [match] = await db.insert(matches).values({
      lobbyId,
      status: "active",
      totalQuestions: lobby.totalQuestions,
      questionsData: JSON.stringify(questions),
    }).returning();
    
    await db.insert(matchParticipants).values([
      { matchId: match.id, userId: lobby.hostId, username: lobby.hostUsername },
      { matchId: match.id, userId: lobby.guestId, username: lobby.guestUsername },
    ]);
    
    const matchState: MatchState = {
      matchId: match.id,
      lobbyId: lobby.id,
      status: "active",
      currentQuestionIndex: 0,
      totalQuestions: lobby.totalQuestions,
      questions,
      participants: [
        { userId: lobby.hostId, username: lobby.hostUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
        { userId: lobby.guestId, username: lobby.guestUsername, score: 0, correctAnswers: 0, currentQuestionIndex: 0, hasAnsweredCurrent: false },
      ],
    };
    
    this.matchStates.set(match.id, matchState);
    this.playerAnswers.set(match.id, new Map());
    
    return matchState;
  }

  private async generateQuestions(count: number): Promise<GameQuestion[]> {
    const verifiedCards = await db
      .select()
      .from(baseballCards)
      .where(eq(baseballCards.imageVerified, true));
    
    const shuffled = [...verifiedCards].sort(() => Math.random() - 0.5);
    const selectedCards = shuffled.slice(0, Math.min(count, shuffled.length));
    
    return selectedCards.map(card => this.generateQuestion(card));
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

  async submitAnswer(matchId: string, userId: string, questionIndex: number, selectedAnswer: string): Promise<{
    correct: boolean;
    pointsEarned: number;
    matchState: MatchState;
    bothAnswered: boolean;
  } | null> {
    const matchState = this.matchStates.get(matchId);
    if (!matchState) return null;
    if (matchState.status !== "active") return null;
    
    const participant = matchState.participants.find(p => p.userId === userId);
    if (!participant) return null;
    if (participant.hasAnsweredCurrent) return null;
    if (questionIndex !== matchState.currentQuestionIndex) return null;
    
    const currentQuestion = matchState.questions[questionIndex];
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
    const pointsEarned = isCorrect ? currentQuestion.pointValue : 0;
    
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
    
    return { correct: isCorrect, pointsEarned, matchState, bothAnswered };
  }

  async advanceQuestion(matchId: string): Promise<MatchState | null> {
    const matchState = this.matchStates.get(matchId);
    if (!matchState) return null;
    
    const nextIndex = matchState.currentQuestionIndex + 1;
    
    if (nextIndex >= matchState.totalQuestions) {
      matchState.status = "completed";
      const winner = this.determineWinner(matchState);
      matchState.winner = winner;
      
      await db.update(matches).set({ status: "completed", completedAt: new Date() }).where(eq(matches.id, matchId));
      await db.update(lobbies).set({ status: "completed" }).where(eq(lobbies.id, matchState.lobbyId));
    } else {
      matchState.currentQuestionIndex = nextIndex;
      matchState.participants.forEach(p => {
        p.hasAnsweredCurrent = false;
        p.currentQuestionIndex = nextIndex;
      });
      
      await db.update(matches).set({ currentQuestionIndex: nextIndex }).where(eq(matches.id, matchId));
    }
    
    return matchState;
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
}

export const matchService = new MatchService();
