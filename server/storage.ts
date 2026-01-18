import { type User, type InsertUser, type BaseballCard, type GameSession, type GameQuestion, type LeaderboardEntry, type RedemptionOption, users, baseballCards, localCredentials, type InsertBaseballCard, type LocalCredential, products, userEntitlements, type Product, type InsertProduct, type UserEntitlement, type InsertUserEntitlement, passwordResetTokens, type PasswordResetToken, playableCards, gameSets, type PlayableCard } from "@shared/schema";
import { randomUUID } from "crypto";
import { fetch1987ToppsCards } from "./services/priceCharting";
import { db } from "./db";
import { eq, sql, desc, and, gte, isNotNull, ne, not, like } from "drizzle-orm";
import bcrypt from "bcryptjs";

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
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByWorkosId(workosUserId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPoints(id: string, points: number): Promise<User | undefined>;
  updateUserStats(id: string, stats: { pointsEarned: number; correctAnswers: number; totalAnswers: number }): Promise<User | undefined>;
  
  createLocalUser(username: string, email: string, password: string): Promise<User>;
  createWorkosUser(data: { workosUserId: string; email?: string; firstName?: string; lastName?: string; profileImageUrl?: string; username: string }): Promise<User>;
  linkWorkosUser(userId: string, workosUserId: string): Promise<void>;
  validateLocalCredentials(usernameOrEmail: string, password: string): Promise<User | null>;
  updateUserPassword(userId: string, newPassword: string): Promise<void>;
  
  // Password reset tokens
  createPasswordResetToken(userId: string): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | null>;
  markPasswordResetTokenUsed(tokenId: string): Promise<void>;
  
  getCards(): Promise<BaseballCard[]>;
  getRandomCards(count: number): Promise<BaseballCard[]>;
  getVerifiedCards(): Promise<BaseballCard[]>;
  addCard(card: InsertBaseballCard): Promise<BaseballCard>;
  updateCardImage(playerName: string, imageUrl: string, verified: boolean): Promise<void>;
  
  getRandomCardsFromSet(setId: string, count: number): Promise<PlayableCard[]>;
  getSamplePlayerNamesFromSet(setId: string, sampleSize: number): Promise<string[]>;
  getDefaultPlayableSetId(): Promise<string | null>;
  
  createGameSession(userId: string | null, mode: string, totalQuestions: number, guestSessionId?: string, setId?: string): Promise<GameSession>;
  getGameSession(id: string): Promise<GameSession | undefined>;
  updateGameSession(session: GameSession): Promise<GameSession>;
  
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;
  
  getRedemptionOptions(): Promise<RedemptionOption[]>;
  
  // Product catalog methods
  getProducts(activeOnly?: boolean): Promise<Product[]>;
  getProductBySku(sku: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  
  // User entitlements methods
  getUserEntitlements(userId: string): Promise<UserEntitlement[]>;
  hasEntitlement(userId: string, entitlementKey: string): Promise<boolean>;
  grantEntitlement(entitlement: InsertUserEntitlement): Promise<UserEntitlement>;
  revokeEntitlement(userId: string, entitlementKey: string, reason?: string): Promise<void>;
  
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
      await this.ensureAdminUser();
    } catch (error) {
      console.error("Failed to initialize card data:", error);
      this.initialized = false;
      throw error;
    }
  }

  private async ensureAdminUser(): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminUsername = process.env.ADMIN_USERNAME;
    
    if (!adminEmail || !adminPassword || !adminUsername) {
      console.log("[Admin] ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_USERNAME env vars not set - skipping admin bootstrap");
      return;
    }
    
    const existingUser = await this.getUserByEmail(adminEmail);
    
    if (existingUser) {
      if (!existingUser.isAdmin) {
        await db.update(users).set({ isAdmin: true }).where(eq(users.id, existingUser.id));
        console.log(`[Admin] Updated ${adminEmail} to admin status`);
      }
      
      const [existingCreds] = await db.select().from(localCredentials).where(eq(localCredentials.userId, existingUser.id));
      const newHash = await bcrypt.hash(adminPassword, 10);
      
      if (existingCreds) {
        await db.update(localCredentials).set({ passwordHash: newHash }).where(eq(localCredentials.userId, existingUser.id));
        console.log(`[Admin] Reset password for ${adminEmail}`);
      } else {
        await db.insert(localCredentials).values({ userId: existingUser.id, passwordHash: newHash });
        console.log(`[Admin] Created credentials for ${adminEmail}`);
      }
    } else {
      const { normalizeEmail } = await import("./services/accessService");
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      
      const [newAdmin] = await db.insert(users).values({
        username: adminUsername,
        email: adminEmail,
        emailNormalized: normalizeEmail(adminEmail),
        firstName: adminUsername,
        isAdmin: true,
        status: "ACTIVE",
      }).returning();
      
      await db.insert(localCredentials).values({ userId: newAdmin.id, passwordHash });
      console.log(`[Admin] Created admin user ${adminEmail}`);
    }
  }

  private async seedMockUsers(): Promise<void> {
    const existingUsers = await db.select().from(users).limit(1);
    
    if (existingUsers.length === 0) {
      console.log("Seeding mock users for leaderboard...");
      const mockUsers = [
        { firstName: "CardKing87", points: 15420, gamesPlayed: 156, correctAnswers: 1248, totalAnswers: 1560 },
        { firstName: "VintageCollector", points: 12850, gamesPlayed: 132, correctAnswers: 1056, totalAnswers: 1320 },
        { firstName: "ToppsHunter", points: 11200, gamesPlayed: 98, correctAnswers: 833, totalAnswers: 980 },
        { firstName: "DiamondExpert", points: 9875, gamesPlayed: 87, correctAnswers: 696, totalAnswers: 870 },
        { firstName: "BaseballBuff", points: 8640, gamesPlayed: 72, correctAnswers: 576, totalAnswers: 720 },
        { firstName: "PackRipper", points: 7320, gamesPlayed: 61, correctAnswers: 488, totalAnswers: 610 },
        { firstName: "CardShark", points: 6100, gamesPlayed: 55, correctAnswers: 440, totalAnswers: 550 },
        { firstName: "RookieHunter", points: 5450, gamesPlayed: 48, correctAnswers: 384, totalAnswers: 480 },
        { firstName: "HallOfFamer", points: 4800, gamesPlayed: 42, correctAnswers: 336, totalAnswers: 420 },
        { firstName: "SlabCollector", points: 4200, gamesPlayed: 38, correctAnswers: 304, totalAnswers: 380 },
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

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Case-insensitive email lookup
    const [user] = await db.select().from(users).where(sql`LOWER(${users.email}) = LOWER(${email})`);
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Case-insensitive username lookup
    const [user] = await db.select().from(users).where(sql`LOWER(${users.username}) = LOWER(${username})`);
    return user || undefined;
  }

  async getUserByWorkosId(workosUserId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.workosUserId, workosUserId));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createLocalUser(username: string, email: string, password: string): Promise<User> {
    const passwordHash = await bcrypt.hash(password, 10);
    const { normalizeEmail } = await import("./services/accessService");
    
    const [user] = await db.insert(users).values({
      username,
      email,
      emailNormalized: normalizeEmail(email),
      firstName: username,
      status: "PENDING",
    }).returning();
    
    await db.insert(localCredentials).values({
      userId: user.id,
      passwordHash,
    });
    
    return user;
  }

  async createWorkosUser(data: { workosUserId: string; email?: string; firstName?: string; lastName?: string; profileImageUrl?: string; username: string }): Promise<User> {
    const { normalizeEmail } = await import("./services/accessService");
    
    const [user] = await db.insert(users).values({
      username: data.username,
      email: data.email,
      emailNormalized: data.email ? normalizeEmail(data.email) : undefined,
      firstName: data.firstName || data.username,
      lastName: data.lastName,
      profileImageUrl: data.profileImageUrl,
      workosUserId: data.workosUserId,
      status: "PENDING",
    }).returning();
    
    return user;
  }

  async linkWorkosUser(userId: string, workosUserId: string): Promise<void> {
    await db.update(users)
      .set({ workosUserId })
      .where(eq(users.id, userId));
  }

  async validateLocalCredentials(usernameOrEmail: string, password: string): Promise<User | null> {
    // Try to find by username first, then by email
    let user = await this.getUserByUsername(usernameOrEmail);
    if (!user) {
      user = await this.getUserByEmail(usernameOrEmail);
    }
    if (!user) return null;
    
    const [credential] = await db.select().from(localCredentials).where(eq(localCredentials.userId, user.id));
    if (!credential) return null;
    
    const valid = await bcrypt.compare(password, credential.passwordHash);
    return valid ? user : null;
  }

  async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(localCredentials)
      .set({ passwordHash })
      .where(eq(localCredentials.userId, userId));
  }

  async createPasswordResetToken(userId: string): Promise<PasswordResetToken> {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    
    const [resetToken] = await db.insert(passwordResetTokens).values({
      userId,
      token,
      expiresAt,
    }).returning();
    
    return resetToken;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | null> {
    const [resetToken] = await db.select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    
    if (!resetToken) return null;
    
    // Check if token is expired or already used
    if (resetToken.expiresAt < new Date() || resetToken.usedAt) {
      return null;
    }
    
    return resetToken;
  }

  async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, tokenId));
  }

  async updateUserPoints(id: string, points: number): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ points: sql`${users.points} + ${points}` })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async updateUserStats(id: string, stats: { pointsEarned: number; correctAnswers: number; totalAnswers: number }): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({
        points: sql`${users.points} + ${stats.pointsEarned}`,
        gamesPlayed: sql`${users.gamesPlayed} + 1`,
        correctAnswers: sql`${users.correctAnswers} + ${stats.correctAnswers}`,
        totalAnswers: sql`${users.totalAnswers} + ${stats.totalAnswers}`,
      })
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

  async updateCardImage(playerName: string, imageUrl: string, verified: boolean): Promise<void> {
    await db
      .update(baseballCards)
      .set({ imageUrl, imageVerified: verified })
      .where(eq(baseballCards.playerName, playerName));
  }

  async getRandomCardsFromSet(setId: string, count: number): Promise<PlayableCard[]> {
    return await db
      .select()
      .from(playableCards)
      .where(
        and(
          eq(playableCards.gameSetId, setId),
          isNotNull(playableCards.imageUrl),
          ne(playableCards.imageUrl, ''),
          not(like(playableCards.imageUrl, '%null%')),
          like(playableCards.imageUrl, 'https://%')
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(count);
  }

  async getPlayerNamesFromSet(setId: string): Promise<string[]> {
    const cards = await db
      .select({ player: playableCards.player })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setId));
    
    return cards
      .map(c => c.player)
      .filter((name): name is string => !!name);
  }

  async getSamplePlayerNamesFromSet(setId: string, sampleSize: number): Promise<string[]> {
    const cards = await db
      .select({ player: playableCards.player })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setId))
      .orderBy(sql`RANDOM()`)
      .limit(sampleSize);
    
    return cards
      .map(c => c.player)
      .filter((name): name is string => !!name);
  }

  async getDefaultPlayableSetId(): Promise<string | null> {
    const [activeSet] = await db
      .select({ id: gameSets.id })
      .from(gameSets)
      .where(eq(gameSets.isActive, true))
      .limit(1);
    
    return activeSet?.id || null;
  }

  private generateQuestionFromPlayableCard(card: PlayableCard, playerNames: string[]): GameQuestion {
    const correctAnswer = card.player || "Unknown Player";
    // Only use player names from the same set - do NOT mix with legacy baseball players
    // Ensure unique names to prevent duplicate key issues in React
    const uniqueNames = Array.from(new Set(playerNames));
    let wrongOptions = uniqueNames
      .filter(name => name !== correctAnswer && name)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    
    // Ensure no duplicates in final options array
    const options = Array.from(new Set([correctAnswer, ...wrongOptions])).sort(() => Math.random() - 0.5);
    
    const basePoints = 100;
    const pointValue = basePoints;
    
    const cardAsBaseballCard: BaseballCard = {
      id: card.id,
      playerName: card.player || "Unknown Player",
      team: card.set || "",
      year: 0,
      cardNumber: card.number || "",
      imageUrl: card.imageUrl || "",
      popularity: 50,
      imageVerified: true,
      setName: card.set || "",
      position: "",
    };
    
    return {
      card: cardAsBaseballCard,
      options,
      correctAnswer,
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

  async createGameSession(userId: string | null, mode: string, totalQuestions: number, guestSessionId?: string, setId?: string): Promise<GameSession> {
    let questions: GameQuestion[];
    
    const effectiveSetId = setId || await this.getDefaultPlayableSetId();
    
    if (effectiveSetId) {
      const playableSetCards = await this.getRandomCardsFromSet(effectiveSetId, totalQuestions);
      
      if (playableSetCards.length === 0) {
        const cards = await this.getRandomCards(totalQuestions);
        questions = cards.map(card => this.generateQuestion(card));
      } else {
        const playerNames = playableSetCards.map(c => c.player).filter((p): p is string => !!p);
        const additionalNames = await this.getSamplePlayerNamesFromSet(effectiveSetId, 100);
        // Only use player names from the same set - do NOT mix with legacy baseball players
        const allNames = Array.from(new Set([...playerNames, ...additionalNames]));
        questions = playableSetCards.map(card => this.generateQuestionFromPlayableCard(card, allNames));
      }
    } else {
      const cards = await this.getRandomCards(totalQuestions);
      questions = cards.map(card => this.generateQuestion(card));
    }
    
    const session: GameSession = {
      id: randomUUID(),
      mode: mode as "solo" | "1v1" | "tournament",
      userId,
      guestSessionId,
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
      username: user.firstName || user.email?.split('@')[0] || `Player${index + 1}`,
      points: user.points,
      gamesPlayed: user.gamesPlayed,
      accuracy: user.totalAnswers > 0 ? Math.round((user.correctAnswers / user.totalAnswers) * 100) : 0,
    }));
  }

  async getRedemptionOptions(): Promise<RedemptionOption[]> {
    return REDEMPTION_OPTIONS;
  }

  async getProducts(activeOnly: boolean = true): Promise<Product[]> {
    if (activeOnly) {
      return await db.select().from(products).where(eq(products.isActive, true));
    }
    return await db.select().from(products);
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const result = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
    return result[0];
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [created] = await db.insert(products).values(product).returning();
    return created;
  }

  async getUserEntitlements(userId: string): Promise<UserEntitlement[]> {
    const now = new Date();
    return await db
      .select()
      .from(userEntitlements)
      .where(
        and(
          eq(userEntitlements.userId, userId),
          sql`(${userEntitlements.expiresAt} IS NULL OR ${userEntitlements.expiresAt} > ${now})`
        )
      );
  }

  async hasEntitlement(userId: string, entitlementKey: string): Promise<boolean> {
    const now = new Date();
    const result = await db
      .select()
      .from(userEntitlements)
      .where(
        and(
          eq(userEntitlements.userId, userId),
          eq(userEntitlements.entitlementKey, entitlementKey),
          sql`(${userEntitlements.expiresAt} IS NULL OR ${userEntitlements.expiresAt} > ${now})`
        )
      )
      .limit(1);
    return result.length > 0;
  }

  async grantEntitlement(entitlement: InsertUserEntitlement): Promise<UserEntitlement> {
    const [created] = await db.insert(userEntitlements).values(entitlement).returning();
    return created;
  }

  async revokeEntitlement(userId: string, entitlementKey: string, reason?: string): Promise<void> {
    await db
      .update(userEntitlements)
      .set({ 
        expiresAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userEntitlements.userId, userId),
          eq(userEntitlements.entitlementKey, entitlementKey),
          sql`(${userEntitlements.expiresAt} IS NULL OR ${userEntitlements.expiresAt} > NOW())`
        )
      );
    
    console.log(`Revoked entitlement ${entitlementKey} for user ${userId}${reason ? `: ${reason}` : ""}`);
  }
}

export const storage = new DatabaseStorage();
