import { type User, type InsertUser, type BaseballCard, type GameSession, type GameQuestion, type LeaderboardEntry, type RedemptionOption, users, baseballCards, localCredentials, type InsertBaseballCard, type LocalCredential, products, userEntitlements, type Product, type InsertProduct, type UserEntitlement, type InsertUserEntitlement, passwordResetTokens, type PasswordResetToken, playableCards, gameSets, type PlayableCard, type GameplayCard, activeUserCounter } from "@shared/schema";
import { randomUUID } from "crypto";
import { fetch1987ToppsCards } from "./services/priceCharting";
import { db } from "./db";
import { eq, sql, desc, and, gte, lt, isNotNull, ne, not, like, or, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getFreshImageUrl, isImageStale } from "./services/cardImageRefresh";

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

  private async ensureAuthTablesExist(): Promise<void> {
    try {
      // Try to enable uuid-ossp extension (more widely available than pgcrypto)
      try {
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      } catch (extError) {
        console.log('[Auth] uuid-ossp extension not available, will use application-generated UUIDs');
      }
      
      // Check if local_credentials table exists, create if not
      const result = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'local_credentials'
        ) as exists
      `);
      
      const tableExists = (result.rows[0] as any)?.exists === true;
      
      if (!tableExists) {
        console.log('[Auth] Creating local_credentials table...');
        // Create without default UUID - application will provide ID
        await db.execute(sql`
          CREATE TABLE local_credentials (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL REFERENCES users(id),
            password_hash VARCHAR NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        console.log('[Auth] local_credentials table created');
      }
      
      // Check if password_reset_tokens table exists, create if not
      const resetResult = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'password_reset_tokens'
        ) as exists
      `);
      
      const resetTableExists = (resetResult.rows[0] as any)?.exists === true;
      
      if (!resetTableExists) {
        console.log('[Auth] Creating password_reset_tokens table...');
        // Create without default UUID - application will provide ID
        await db.execute(sql`
          CREATE TABLE password_reset_tokens (
            id VARCHAR NOT NULL PRIMARY KEY,
            user_id VARCHAR NOT NULL REFERENCES users(id),
            token VARCHAR NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        console.log('[Auth] password_reset_tokens table created');
      }
      
      console.log('[Auth] Auth tables verified');
    } catch (error) {
      console.error('[Auth] Error ensuring auth tables exist:', error);
      // Don't throw - let the app continue and fail gracefully on actual operations
    }
  }

  private async ensureAccessCounterExists(): Promise<void> {
    try {
      // Check if active_user_counter row exists
      const [existingCounter] = await db.select().from(activeUserCounter).where(eq(activeUserCounter.id, 1));
      
      if (!existingCounter) {
        console.log('[Access] Creating active user counter row...');
        await db.insert(activeUserCounter).values({
          id: 1,
          count: 0,
          reservedSeatsUsed: 0,
        }).onConflictDoNothing();
        console.log('[Access] Active user counter row created');
      } else {
        console.log('[Access] Active user counter verified');
      }
    } catch (error) {
      console.error('[Access] Error ensuring access counter exists:', error);
      // Don't throw - let the app continue and fail gracefully on actual operations
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.initialized = true;
    
    // Ensure critical auth tables exist (for production where db:push may not have run)
    await this.ensureAuthTablesExist();
    
    // Ensure access counter row exists (required for registration)
    await this.ensureAccessCounterExists();
    
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
        await db.insert(localCredentials).values({ id: randomUUID(), userId: existingUser.id, passwordHash: newHash });
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
      
      await db.insert(localCredentials).values({ id: randomUUID(), userId: newAdmin.id, passwordHash });
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
    const { randomUUID } = await import("crypto");
    
    const [user] = await db.insert(users).values({
      username,
      email,
      emailNormalized: normalizeEmail(email),
      firstName: username,
      status: "PENDING",
    }).returning();
    
    // Provide explicit ID in case database doesn't have UUID generation capability
    await db.insert(localCredentials).values({
      id: randomUUID(),
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
      id: randomUUID(),
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
    // First get the game set's sport for validation
    const [gameSet] = await db
      .select({ sport: gameSets.sport })
      .from(gameSets)
      .where(eq(gameSets.id, setId))
      .limit(1);
    
    const expectedSport = gameSet?.sport?.toLowerCase() || "";
    
    // Query playable cards with sport category validation
    // Also filter out flagged/rejected cards (image quality issues)
    // CRITICAL: Only serve cards that pass content verification (no silhouettes/placeholders)
    const cards = await db
      .select()
      .from(playableCards)
      .where(
        and(
          eq(playableCards.gameSetId, setId),
          eq(playableCards.isPlayable, true),
          eq(playableCards.contentVerified, true), // CRITICAL: Only content-verified cards
          isNotNull(playableCards.imageUrl),
          ne(playableCards.imageUrl, ''),
          not(like(playableCards.imageUrl, '%null%')),
          like(playableCards.imageUrl, 'https://%'),
          isNotNull(playableCards.player),
          ne(playableCards.player, ''),
          // Exclude only rejected cards (admin has confirmed bad image)
          // Flagged cards still appear until admin reviews them
          or(
            isNull(playableCards.imageReviewStatus),
            ne(playableCards.imageReviewStatus, 'rejected')
          ),
          // Only serve cards with validated images (failure count < 2)
          lt(playableCards.imageFailureCount, 2)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(count * 3); // Fetch more to filter wrong-sport cards
    
    // Filter cards whose category matches the game set's sport (case-insensitive)
    // This is a strict safety check - only allow cards with matching category
    const validCards = expectedSport 
      ? cards.filter(card => {
          const cardCategory = (card.category || "").toLowerCase();
          // Require category to exist AND match the expected sport - no empty categories allowed
          // This prevents wrong-sport cards from slipping through if Card Hedge omits category
          return cardCategory && cardCategory === expectedSport;
        })
      : cards;
    
    // If we filtered out too many cards, log a warning
    if (validCards.length < cards.length) {
      const filteredCount = cards.length - validCards.length;
      console.log(`[Storage] Filtered ${filteredCount} wrong-sport cards from set ${setId} (expected sport: ${expectedSport})`);
    }
    
    // Get cards to serve and refresh stale images
    const cardsToServe = validCards.slice(0, count);
    const refreshedCards = await this.refreshStaleCardImages(cardsToServe);
    
    return refreshedCards;
  }

  async getPlayerNamesFromSet(setId: string): Promise<string[]> {
    const cards = await db
      .select({ player: playableCards.player })
      .from(playableCards)
      .where(
        and(
          eq(playableCards.gameSetId, setId),
          eq(playableCards.isPlayable, true),
          isNotNull(playableCards.player),
          ne(playableCards.player, '')
        )
      );
    
    return cards
      .map(c => c.player)
      .filter((name): name is string => !!name);
  }

  async getSamplePlayerNamesFromSet(setId: string, sampleSize: number): Promise<string[]> {
    const cards = await db
      .select({ player: playableCards.player })
      .from(playableCards)
      .where(
        and(
          eq(playableCards.gameSetId, setId),
          eq(playableCards.isPlayable, true),
          isNotNull(playableCards.player),
          ne(playableCards.player, '')
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(sampleSize);
    
    return cards
      .map(c => c.player)
      .filter((name): name is string => !!name);
  }

  async getDefaultPlayableSetId(): Promise<string | null> {
    // Get active set that actually has imported playable cards
    const [activeSet] = await db
      .select({ id: gameSets.id })
      .from(gameSets)
      .innerJoin(playableCards, eq(playableCards.gameSetId, gameSets.id))
      .where(
        and(
          eq(gameSets.isActive, true),
          eq(playableCards.isPlayable, true),
          isNotNull(playableCards.imageUrl)
        )
      )
      .groupBy(gameSets.id)
      .limit(1);
    
    return activeSet?.id || null;
  }

  private async refreshStaleCardImages(cards: PlayableCard[]): Promise<PlayableCard[]> {
    const refreshedCards: PlayableCard[] = [];
    
    for (const card of cards) {
      if (isImageStale(card.lastImageCheck)) {
        try {
          const result = await getFreshImageUrl(
            card.id,
            card.cardhedgeCardId || null,
            card.imageUrl || null,
            card.lastImageCheck || null
          );
          
          if (result.success && result.imageUrl) {
            refreshedCards.push({
              ...card,
              imageUrl: result.imageUrl,
              lastImageCheck: new Date(),
              imageFailureCount: 0,
            });
            if (!result.fromCache) {
              console.log(`[Storage] Refreshed stale image for card ${card.id}`);
            }
          } else {
            refreshedCards.push(card);
          }
        } catch (error) {
          console.error(`[Storage] Error refreshing card ${card.id}:`, error);
          refreshedCards.push(card);
        }
      } else {
        refreshedCards.push(card);
      }
    }
    
    return refreshedCards;
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
    
    const cardAsGameplayCard: GameplayCard = {
      id: card.id,
      playerName: card.player || "Unknown Player",
      team: card.set || "",
      year: 0,
      cardNumber: card.number || "",
      imageUrl: `/api/cards/${card.id}/masked-image`,
      popularity: 50,
      imageVerified: true,
      setName: card.set || "",
      position: "",
      imageRotation: card.imageRotation || 0, // Include rotation correction
      playableCardId: card.id, // Track original card id for reporting
      lastImageCheck: card.lastImageCheck || null,
      imageFailureCount: card.imageFailureCount || 0,
      imageLastError: card.imageLastError || null,
    };
    
    return {
      card: cardAsGameplayCard,
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

  async createGameSession(userId: string | null, mode: string, totalQuestions: number, guestSessionId?: string, setId?: string): Promise<GameSession> {
    let questions: GameQuestion[];
    
    const effectiveSetId = setId || await this.getDefaultPlayableSetId();
    
    if (effectiveSetId) {
      const playableSetCards = await this.getRandomCardsFromSet(effectiveSetId, totalQuestions);
      
      if (playableSetCards.length === 0) {
        // Try fallback to legacy cards
        const cards = await this.getRandomCards(totalQuestions);
        if (cards.length === 0) {
          // No cards available at all - throw error
          throw new Error("NO_CARDS_AVAILABLE");
        }
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
      if (cards.length === 0) {
        // No cards available at all - throw error
        throw new Error("NO_CARDS_AVAILABLE");
      }
      questions = cards.map(card => this.generateQuestion(card));
    }
    
    // Final safety check - ensure we have questions
    if (questions.length === 0) {
      throw new Error("NO_CARDS_AVAILABLE");
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

  async getReplacementCardForSession(
    sessionId: string,
    failedCardId: string,
    excludeCardIds: string[] = []
  ): Promise<{ question: GameQuestion; flagged: boolean } | null> {
    const session = await this.getGameSession(sessionId);
    if (!session) return null;

    // Get all card IDs already used in this session plus excluded ones
    const usedCardIds = new Set([
      ...session.questions.map(q => q.card.playableCardId || q.card.id),
      ...excludeCardIds,
      failedCardId
    ]);

    // Get a replacement card from the same set, excluding used cards
    const currentQuestion = session.questions[session.currentQuestionIndex];
    const setName = currentQuestion?.card.setName;

    // Find the set ID and sport
    let targetSetId: string | null = null;
    let expectedSport: string | null = null;
    
    if (setName) {
      const [gameSet] = await db
        .select({ id: gameSets.id, sport: gameSets.sport })
        .from(gameSets)
        .where(eq(gameSets.setName, setName))
        .limit(1);
      targetSetId = gameSet?.id || null;
      expectedSport = gameSet?.sport?.toLowerCase() || null;
    }

    // Query for a replacement card - ONLY cards with validated images
    let replacementCard: typeof playableCards.$inferSelect | undefined;
    
    if (targetSetId) {
      const candidates = await db
        .select()
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, targetSetId),
            eq(playableCards.isPlayable, true),
            or(
              eq(playableCards.imageReviewStatus, "pending"),
              eq(playableCards.imageReviewStatus, "approved")
            ),
            // Only serve cards with validated images (failure count < 2)
            lt(playableCards.imageFailureCount, 2)
          )
        )
        .limit(50);
      
      // Filter out used cards and filter by sport category
      let available = candidates.filter(c => !usedCardIds.has(c.id));
      
      // Also filter by sport category for additional safety
      if (expectedSport) {
        available = available.filter(c => {
          const cardCategory = (c.category || "").toLowerCase();
          return cardCategory === expectedSport;
        });
      }
      
      if (available.length > 0) {
        replacementCard = available[Math.floor(Math.random() * available.length)];
      }
    }

    // If no replacement found from same set, try another active set WITH THE SAME SPORT
    if (!replacementCard && expectedSport) {
      // Find an active set with the same sport and validated images
      const [fallbackSet] = await db
        .select({ id: gameSets.id })
        .from(gameSets)
        .innerJoin(playableCards, eq(playableCards.gameSetId, gameSets.id))
        .where(
          and(
            eq(gameSets.isActive, true),
            sql`LOWER(${gameSets.sport}) = ${expectedSport}`,
            eq(playableCards.isPlayable, true),
            isNotNull(playableCards.imageUrl),
            // Only consider sets with validated cards
            lt(playableCards.imageFailureCount, 2)
          )
        )
        .groupBy(gameSets.id)
        .limit(1);
      
      if (fallbackSet) {
        const candidates = await db
          .select()
          .from(playableCards)
          .where(
            and(
              eq(playableCards.gameSetId, fallbackSet.id),
              eq(playableCards.isPlayable, true),
              or(
                eq(playableCards.imageReviewStatus, "pending"),
                eq(playableCards.imageReviewStatus, "approved")
              ),
              // Only serve cards with validated images (failure count < 2)
              lt(playableCards.imageFailureCount, 2)
            )
          )
          .limit(50);
        
        // Filter by sport category for extra safety
        let available = candidates.filter(c => !usedCardIds.has(c.id));
        available = available.filter(c => {
          const cardCategory = (c.category || "").toLowerCase();
          return cardCategory === expectedSport;
        });
        
        if (available.length > 0) {
          replacementCard = available[Math.floor(Math.random() * available.length)];
          console.log(`[CardReplacement] Using fallback set ${fallbackSet.id} for sport ${expectedSport}`);
        }
      }
    }

    if (!replacementCard) {
      console.log(`[CardReplacement] No replacement found for sport ${expectedSport || 'unknown'}`);
      return null;
    }

    // Refresh the card image if stale before serving
    const [refreshedCard] = await this.refreshStaleCardImages([replacementCard]);

    // Get player names for options
    const additionalNames = await this.getSamplePlayerNamesFromSet(
      refreshedCard.gameSetId || "",
      100
    );
    const question = this.generateQuestionFromPlayableCard(refreshedCard, additionalNames);

    return { question, flagged: true };
  }

  async flagCardForImageFailure(cardId: string): Promise<void> {
    try {
      // Increment both report count and image failure count
      // If failure count reaches 2, the card will be excluded from future serving
      await db
        .update(playableCards)
        .set({
          reportCount: sql`COALESCE(${playableCards.reportCount}, 0) + 1`,
          imageFailureCount: sql`COALESCE(${playableCards.imageFailureCount}, 0) + 1`,
          imageLastError: 'Client-side image load failure',
          lastImageCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(playableCards.id, cardId));
      
      // Check if card should now be excluded (2+ failures)
      const [card] = await db
        .select({ failureCount: playableCards.imageFailureCount })
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      if (card && card.failureCount >= 2) {
        await db
          .update(playableCards)
          .set({ isPlayable: false })
          .where(eq(playableCards.id, cardId));
        console.log(`[CardReplacement] Card ${cardId} excluded due to 2+ image failures`);
      } else {
        console.log(`[CardReplacement] Flagged card ${cardId} for image load failure (count: ${card?.failureCount || 1})`);
      }
    } catch (error) {
      console.error(`[CardReplacement] Failed to flag card ${cardId}:`, error);
    }
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
