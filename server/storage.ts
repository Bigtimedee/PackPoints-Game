import { type User, type InsertUser, type BaseballCard, type GameSession, type GameQuestion, type LeaderboardEntry, type RedemptionOption, users, baseballCards, type InsertBaseballCard } from "@shared/schema";
import { randomUUID } from "crypto";
import { fetch1987ToppsCards } from "./services/priceCharting";
import { db } from "./db";
import { eq, sql, desc, and, gte } from "drizzle-orm";

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
  getVerifiedCards(): Promise<BaseballCard[]>;
  addCard(card: InsertBaseballCard): Promise<BaseballCard>;
  
  createGameSession(userId: string, mode: string, totalQuestions: number): Promise<GameSession>;
  getGameSession(id: string): Promise<GameSession | undefined>;
  updateGameSession(session: GameSession): Promise<GameSession>;
  
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;
  
  getRedemptionOptions(): Promise<RedemptionOption[]>;
  
  initialize(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private gameSessions: Map<string, GameSession>;
  private initialized: boolean = false;
  private playerNames: string[] = [];

  constructor() {
    this.gameSessions = new Map();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.initialized = true;
    
    console.log("Initializing card data from PriceCharting/COMC...");
    
    try {
      const existingCards = await db.select().from(baseballCards).limit(1);
      
      if (existingCards.length === 0) {
        console.log("No cards in database, seeding from curated list...");
        const cardData = await fetch1987ToppsCards();
        
        for (const card of cardData) {
          const insertData: InsertBaseballCard = {
            playerName: card.playerName,
            team: card.team || "Unknown",
            position: "Unknown",
            year: 1987,
            setName: "Topps",
            cardNumber: card.cardNumber,
            imageUrl: card.imageUrl,
            popularity: card.popularity,
            imageVerified: !card.imageUrl.includes('placehold'),
          };
          
          await db.insert(baseballCards).values(insertData).onConflictDoNothing();
        }
        
        console.log(`Seeded ${cardData.length} cards to database`);
      } else {
        console.log("Cards already exist in database, skipping seed");
      }
      
      const allCards = await db.select().from(baseballCards);
      this.playerNames = allCards.map(card => card.playerName);
      const verifiedCount = allCards.filter(c => c.imageVerified).length;
      
      console.log(`Loaded ${allCards.length} cards for 1987 Topps set (${verifiedCount} with verified images)`);
      
      await this.seedMockUsers();
    } catch (error) {
      console.error("Failed to initialize card data:", error);
      this.initialized = false;
      throw error;
    }
  }

  private async seedMockUsers(): Promise<void> {
    const existingUsers = await db.select().from(users).limit(1);
    
    if (existingUsers.length === 0) {
      console.log("Seeding mock users for leaderboard...");
      const mockUsers = [
        { username: "CardKing87", password: "hash", points: 15420, gamesPlayed: 156, correctAnswers: 1248, totalAnswers: 1560 },
        { username: "VintageCollector", password: "hash", points: 12850, gamesPlayed: 132, correctAnswers: 1056, totalAnswers: 1320 },
        { username: "ToppsHunter", password: "hash", points: 11200, gamesPlayed: 98, correctAnswers: 833, totalAnswers: 980 },
        { username: "DiamondExpert", password: "hash", points: 9875, gamesPlayed: 87, correctAnswers: 696, totalAnswers: 870 },
        { username: "BaseballBuff", password: "hash", points: 8640, gamesPlayed: 72, correctAnswers: 576, totalAnswers: 720 },
        { username: "PackRipper", password: "hash", points: 7320, gamesPlayed: 61, correctAnswers: 488, totalAnswers: 610 },
        { username: "CardShark", password: "hash", points: 6100, gamesPlayed: 55, correctAnswers: 440, totalAnswers: 550 },
        { username: "RookieHunter", password: "hash", points: 5450, gamesPlayed: 48, correctAnswers: 384, totalAnswers: 480 },
        { username: "HallOfFamer", password: "hash", points: 4800, gamesPlayed: 42, correctAnswers: 336, totalAnswers: 420 },
        { username: "SlabCollector", password: "hash", points: 4200, gamesPlayed: 38, correctAnswers: 304, totalAnswers: 380 },
      ];
      
      for (const user of mockUsers) {
        await db.insert(users).values(user).onConflictDoNothing();
      }
      console.log("Seeded mock users");
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPoints(id: string, points: number): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ points: sql`${users.points} + ${points}` })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getCards(): Promise<BaseballCard[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await db.select().from(baseballCards);
  }

  async getVerifiedCards(): Promise<BaseballCard[]> {
    return await db.select().from(baseballCards).where(eq(baseballCards.imageVerified, true));
  }

  async getRandomCards(count: number): Promise<BaseballCard[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    const verifiedCards = await this.getVerifiedCards();
    const shuffled = [...verifiedCards].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  async addCard(card: InsertBaseballCard): Promise<BaseballCard> {
    const [newCard] = await db.insert(baseballCards).values(card).returning();
    if (newCard && !this.playerNames.includes(newCard.playerName)) {
      this.playerNames.push(newCard.playerName);
    }
    return newCard;
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
    const topUsers = await db
      .select()
      .from(users)
      .orderBy(desc(users.points))
      .limit(limit);
    
    return topUsers.map((user, index) => ({
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

export const storage = new DatabaseStorage();
