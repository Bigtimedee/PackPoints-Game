import { type User, type InsertUser, type BaseballCard, type GameSession, type GameQuestion, type LeaderboardEntry, type RedemptionOption } from "@shared/schema";
import { randomUUID } from "crypto";

const MOCK_CARDS: BaseballCard[] = [
  { id: "1", playerName: "Mark McGwire", team: "Oakland Athletics", position: "1B", year: 1987, setName: "Topps", cardNumber: "366", imageUrl: "https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=400&h=560&fit=crop", popularity: 95 },
  { id: "2", playerName: "Barry Bonds", team: "Pittsburgh Pirates", position: "OF", year: 1987, setName: "Topps", cardNumber: "320", imageUrl: "https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=400&h=560&fit=crop", popularity: 98 },
  { id: "3", playerName: "Bo Jackson", team: "Kansas City Royals", position: "OF", year: 1987, setName: "Topps", cardNumber: "170", imageUrl: "https://images.unsplash.com/photo-1587385789097-0197a7fbd179?w=400&h=560&fit=crop", popularity: 90 },
  { id: "4", playerName: "Rafael Palmeiro", team: "Chicago Cubs", position: "1B", year: 1987, setName: "Topps", cardNumber: "634", imageUrl: "https://images.unsplash.com/photo-1508344928928-7165b67de128?w=400&h=560&fit=crop", popularity: 70 },
  { id: "5", playerName: "Jose Canseco", team: "Oakland Athletics", position: "OF", year: 1987, setName: "Topps", cardNumber: "620", imageUrl: "https://images.unsplash.com/photo-1461896836934- voices?w=400&h=560&fit=crop", popularity: 85 },
  { id: "6", playerName: "Will Clark", team: "San Francisco Giants", position: "1B", year: 1987, setName: "Topps", cardNumber: "420", imageUrl: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400&h=560&fit=crop", popularity: 75 },
  { id: "7", playerName: "Kevin Seitzer", team: "Kansas City Royals", position: "3B", year: 1987, setName: "Topps", cardNumber: "284", imageUrl: "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=400&h=560&fit=crop", popularity: 40 },
  { id: "8", playerName: "Ruben Sierra", team: "Texas Rangers", position: "OF", year: 1987, setName: "Topps", cardNumber: "261", imageUrl: "https://images.unsplash.com/photo-1562077772-3bd90f51d6c2?w=400&h=560&fit=crop", popularity: 55 },
  { id: "9", playerName: "Matt Nokes", team: "Detroit Tigers", position: "C", year: 1987, setName: "Topps", cardNumber: "89", imageUrl: "https://images.unsplash.com/photo-1557409518-691ebcd96038?w=400&h=560&fit=crop", popularity: 35 },
  { id: "10", playerName: "Devon White", team: "California Angels", position: "OF", year: 1987, setName: "Topps", cardNumber: "139", imageUrl: "https://images.unsplash.com/photo-1473091534298-04dcbce3278c?w=400&h=560&fit=crop", popularity: 45 },
  { id: "11", playerName: "Wally Joyner", team: "California Angels", position: "1B", year: 1987, setName: "Topps", cardNumber: "80", imageUrl: "https://images.unsplash.com/photo-1567013127542-490d757e51c5?w=400&h=560&fit=crop", popularity: 60 },
  { id: "12", playerName: "Greg Maddux", team: "Chicago Cubs", position: "P", year: 1987, setName: "Topps", cardNumber: "36", imageUrl: "https://images.unsplash.com/photo-1590496793929-36417d3117de?w=400&h=560&fit=crop", popularity: 92 },
  { id: "13", playerName: "John Kruk", team: "San Diego Padres", position: "1B", year: 1987, setName: "Topps", cardNumber: "123", imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=560&fit=crop", popularity: 50 },
  { id: "14", playerName: "Terry Steinbach", team: "Oakland Athletics", position: "C", year: 1987, setName: "Topps", cardNumber: "431", imageUrl: "https://images.unsplash.com/photo-1597589827217-afdb4e0fdc0b?w=400&h=560&fit=crop", popularity: 42 },
  { id: "15", playerName: "Mike Greenwell", team: "Boston Red Sox", position: "OF", year: 1987, setName: "Topps", cardNumber: "259", imageUrl: "https://images.unsplash.com/photo-1577223625816-7546f13df25d?w=400&h=560&fit=crop", popularity: 58 },
];

const PLAYER_NAMES = [
  "Mark McGwire", "Barry Bonds", "Bo Jackson", "Rafael Palmeiro", "Jose Canseco",
  "Will Clark", "Kevin Seitzer", "Ruben Sierra", "Matt Nokes", "Devon White",
  "Wally Joyner", "Greg Maddux", "John Kruk", "Terry Steinbach", "Mike Greenwell",
  "Don Mattingly", "Kirby Puckett", "Wade Boggs", "Roger Clemens", "Dwight Gooden",
  "Darryl Strawberry", "Eric Davis", "Andre Dawson", "Ryne Sandberg", "Cal Ripken Jr."
];

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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private gameSessions: Map<string, GameSession>;

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
    return MOCK_CARDS;
  }

  async getRandomCards(count: number): Promise<BaseballCard[]> {
    const shuffled = [...MOCK_CARDS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private generateQuestion(card: BaseballCard): GameQuestion {
    const wrongOptions = PLAYER_NAMES
      .filter(name => name !== card.playerName)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    
    const options = [card.playerName, ...wrongOptions].sort(() => Math.random() - 0.5);
    
    const basePoints = 100;
    const popularityPenalty = Math.floor(card.popularity * 0.8);
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
