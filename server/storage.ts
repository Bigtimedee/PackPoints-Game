import { type User, type InsertUser, type BaseballCard, type GameSession, type GameQuestion, type LeaderboardEntry, type RedemptionOption } from "@shared/schema";
import { randomUUID } from "crypto";
import { fetch1987ToppsCards } from "./services/sportsCardsPro";

const REDEMPTION_OPTIONS: RedemptionOption[] = [
  { id: "1", title: "$5 Goldin Credit", description: "Redeemable for any item on Goldin Auctions", pointsCost: 5000, usdValue: 5, platform: "goldin", imageUrl: "" },
  { id: "2", title: "$10 eBay Gift Card", description: "Use on any eBay sports card purchase", pointsCost: 10000, usdValue: 10, platform: "ebay", imageUrl: "" },
  { id: "3", title: "$25 Goldin Credit", description: "Premium credit for Goldin Auctions", pointsCost: 25000, usdValue: 25, platform: "goldin", imageUrl: "" },
  { id: "4", title: "$50 eBay Gift Card", description: "Major purchase credit for eBay", pointsCost: 50000, usdValue: 50, platform: "ebay", imageUrl: "" },
  { id: "5", title: "$100 Goldin Credit", description: "High-value Goldin Auctions credit", pointsCost: 100000, usdValue: 100, platform: "goldin", imageUrl: "" },
  { id: "6", title: "$2 eBay Credit", description: "Starter credit for eBay purchases", pointsCost: 2000, usdValue: 2, platform: "ebay", imageUrl: "" },
];

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPoints(id: string, points: number): Promise<User | undefined>;
  
  getCards(): Promise<BaseballCard[]>;
  getRandomCards(count: number): Promise<BaseballCard[]>;
  
  createGameSession(userId: string, mode: string, totalQuestions: number): Promise<GameSession>;
  getGameSession(id: string): Promise<GameSession | undefined>;
  updateGameSession(session: GameSession): Promise<GameSession>;
  
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;
  
  getRedemptionOptions(): Promise<RedemptionOption[]>;
  
  initialize(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private gameSessions: Map<string, GameSession>;
  private cards: BaseballCard[] = [];
  private playerNames: string[] = [];
  private initialized: boolean = false;

  constructor() {
    this.users = new Map();
    this.gameSessions = new Map();
    
    const mockUsers: User[] = [
      { id: "1", username: "CardKing87", password: "hash", points: 15420, gamesPlayed: 156, correctAnswers: 1248, totalAnswers: 1560 },
      { id: "2", username: "VintageCollector", password: "hash", points: 12850, gamesPlayed: 132, correctAnswers: 1056, totalAnswers: 1320 },
      { id: "3", username: "ToppsHunter", password: "hash", points: 11200, gamesPlayed: 98, correctAnswers: 833, totalAnswers: 980 },
      { id: "4", username: "DiamondExpert", password: "hash", points: 9875, gamesPlayed: 87, correctAnswers: 696, totalAnswers: 870 },
      { id: "5", username: "BaseballBuff", password: "hash", points: 8640, gamesPlayed: 72, correctAnswers: 576, totalAnswers: 720 },
      { id: "6", username: "PackRipper", password: "hash", points: 7320, gamesPlayed: 61, correctAnswers: 488, totalAnswers: 610 },
      { id: "7", username: "CardShark", password: "hash", points: 6100, gamesPlayed: 55, correctAnswers: 440, totalAnswers: 550 },
      { id: "8", username: "RookieHunter", password: "hash", points: 5450, gamesPlayed: 48, correctAnswers: 384, totalAnswers: 480 },
      { id: "9", username: "HallOfFamer", password: "hash", points: 4800, gamesPlayed: 42, correctAnswers: 336, totalAnswers: 420 },
      { id: "10", username: "SlabCollector", password: "hash", points: 4200, gamesPlayed: 38, correctAnswers: 304, totalAnswers: 380 },
    ];
    
    mockUsers.forEach(user => this.users.set(user.id, user));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log("Initializing card data from SportsCardsPro/COMC...");
    
    try {
      const cardData = await fetch1987ToppsCards();
      
      this.cards = cardData.map((card, index) => ({
        id: String(index + 1),
        playerName: card.playerName,
        team: card.team || "Unknown",
        position: "Unknown",
        year: 1987,
        setName: "Topps",
        cardNumber: card.cardNumber,
        imageUrl: card.imageUrl,
        popularity: card.popularity,
      }));
      
      this.playerNames = this.cards.map(card => card.playerName);
      
      console.log(`Loaded ${this.cards.length} cards for 1987 Topps set`);
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize card data:", error);
      this.loadFallbackCards();
    }
  }

  private loadFallbackCards(): void {
    const fallbackCards = [
      { cardNumber: "320", playerName: "Barry Bonds", popularity: 95 },
      { cardNumber: "366", playerName: "Mark McGwire", popularity: 92 },
      { cardNumber: "170", playerName: "Bo Jackson", popularity: 88 },
      { cardNumber: "340", playerName: "Roger Clemens", popularity: 85 },
      { cardNumber: "450", playerName: "Kirby Puckett", popularity: 82 },
      { cardNumber: "784", playerName: "Cal Ripken Jr", popularity: 90 },
      { cardNumber: "500", playerName: "Don Mattingly", popularity: 78 },
      { cardNumber: "130", playerName: "Dwight Gooden", popularity: 75 },
      { cardNumber: "620", playerName: "Jose Canseco", popularity: 80 },
      { cardNumber: "460", playerName: "Darryl Strawberry", popularity: 72 },
      { cardNumber: "150", playerName: "Wade Boggs", popularity: 77 },
      { cardNumber: "680", playerName: "Ryne Sandberg", popularity: 76 },
      { cardNumber: "530", playerName: "Tony Gwynn", popularity: 79 },
      { cardNumber: "757", playerName: "Nolan Ryan", popularity: 91 },
      { cardNumber: "749", playerName: "Ozzie Smith", popularity: 74 },
    ];
    
    this.cards = fallbackCards.map((card, index) => ({
      id: String(index + 1),
      playerName: card.playerName,
      team: "Unknown",
      position: "Unknown",
      year: 1987,
      setName: "Topps",
      cardNumber: card.cardNumber,
      imageUrl: `https://www.comc.com/Cards/Baseball/1987/Topps_-_Base/${card.cardNumber}/${card.playerName.replace(/\s+/g, "_")}`,
      popularity: card.popularity,
    }));
    
    this.playerNames = this.cards.map(card => card.playerName);
    this.initialized = true;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
    };
    this.users.set(id, user);
    return user;
  }

  async updateUserPoints(id: string, points: number): Promise<User | undefined> {
    const user = this.users.get(id);
    if (user) {
      user.points += points;
      this.users.set(id, user);
    }
    return user;
  }

  async getCards(): Promise<BaseballCard[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.cards;
  }

  async getRandomCards(count: number): Promise<BaseballCard[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    const shuffled = [...this.cards].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
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

  async createGameSession(userId: string, mode: string, totalQuestions: number): Promise<GameSession> {
    const cards = await this.getRandomCards(totalQuestions);
    const questions = cards.map(card => this.generateQuestion(card));
    
    const session: GameSession = {
      id: randomUUID(),
      mode: mode as "solo" | "1v1" | "tournament",
      userId,
      questions,
      currentQuestionIndex: 0,
      score: 0,
      correctAnswers: 0,
      totalQuestions,
      status: "active",
      startedAt: new Date().toISOString(),
    };
    
    this.gameSessions.set(session.id, session);
    return session;
  }

  async getGameSession(id: string): Promise<GameSession | undefined> {
    return this.gameSessions.get(id);
  }

  async updateGameSession(session: GameSession): Promise<GameSession> {
    this.gameSessions.set(session.id, session);
    return session;
  }

  async getLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    const users = Array.from(this.users.values())
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
    
    return users.map((user, index) => ({
      rank: index + 1,
      username: user.username,
      points: user.points,
      gamesPlayed: user.gamesPlayed,
      accuracy: user.totalAnswers > 0 ? Math.round((user.correctAnswers / user.totalAnswers) * 100) : 0,
    }));
  }

  async getRedemptionOptions(): Promise<RedemptionOption[]> {
    return REDEMPTION_OPTIONS;
  }
}

export const storage = new MemStorage();
