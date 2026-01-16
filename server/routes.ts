import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { startGameSchema, submitAnswerSchema, createLobbySchema, joinLobbySchema, registerSchema, loginSchema, users, spendWalletSchema, earnWalletSchema, adjustWalletSchema, products, gameSets, insertGameSetSchema, updateGameSetSchema, subscriptionProducts, insertSubscriptionProductSchema, updateSubscriptionProductSchema, type User, type InsertGameSet, type SubscriptionProduct } from "@shared/schema";
import { walletService } from "./services/walletService";
import { fetchAdditionalCards, VERIFIED_1987_TOPPS_IMAGES } from "./services/priceCharting";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "./services/cardHedge";
import { stripePurchaseService, isStripeConfigured } from "./services/stripePurchaseService";
import { storeCheckoutService } from "./services/storeCheckoutService";
import { isAuthenticated } from "./replit_integrations/auth";
import { matchService } from "./services/matchService";
import { tokenService } from "./services/tokenService";
import { quotaService } from "./services/quotaService";
import { adminService } from "./services/adminService";
import { analyticsService } from "./services/analyticsService";
import { redemptionService } from "./services/redemptionService";
import { streakService } from "./services/streakService";
import { sendPasswordResetEmail } from "./services/emailService";
import { bucketService } from "./services/bucketService";
import { expirationEngine } from "./services/expirationEngine";
import { identityService } from "./services/identityService";
import * as accessService from "./services/accessService";
import * as foundersPassService from "./services/foundersPassService";
import { redeemPackptsSchema, DEFAULT_STREAK_SCHEDULE, DEFAULT_MILESTONE_BONUSES, MAX_DAILY_STREAK_REWARD } from "@shared/schema";
import { TIER_CONFIG } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import express from "express";
import { z } from "zod";
import * as marketplaceService from "./services/marketplace";
import * as contextService from "./services/marketplace/context";

// Middleware to require admin role
const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as any;
  if (!user?.claims?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const dbUser = await storage.getUser(user.claims.sub);
  if (!dbUser?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  
  next();
};

// Middleware to require ACTIVE user status (Founders Cap enforcement)
const requireActiveUser = async (req: any, res: Response, next: NextFunction) => {
  const userId = req.user?.claims?.sub || req.session?.localUserId;
  if (!userId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  
  if (user.status !== "ACTIVE") {
    return res.status(403).json({ 
      message: "Account not activated",
      code: "WAITLISTED",
      status: user.status,
    });
  }
  
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Health check endpoint for monitoring
  app.get("/health", async (req, res) => {
    try {
      // Check database connection
      await db.execute(sql`SELECT 1`);
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: "connected"
      });
    } catch (error) {
      res.status(503).json({
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected"
      });
    }
  });

  // ============================================
  // WALLET ENDPOINTS (PackPTS)
  // ============================================

  // GET /wallet - Get current user's wallet (auth required)
  app.get("/wallet", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const walletData = await walletService.getWalletWithHistory(userId, 10);
      if (!walletData) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      res.json({
        wallet: {
          id: walletData.wallet.id,
          balance: walletData.wallet.balance,
          lifetimeEarned: walletData.wallet.lifetimeEarned,
          lifetimeSpent: walletData.wallet.lifetimeSpent,
          status: walletData.wallet.status,
          createdAt: walletData.wallet.createdAt,
          updatedAt: walletData.wallet.updatedAt,
        },
        recentTransactions: walletData.recentEntries.map(e => ({
          id: e.id,
          type: e.entryType,
          amount: e.amount,
          balanceAfter: e.balanceAfter,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error getting wallet:", error);
      res.status(500).json({ error: "Failed to get wallet" });
    }
  });

  // POST /wallet/spend - Spend PackPTS (auth required, idempotent)
  app.post("/wallet/spend", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = spendWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { amount, reason, idempotencyKey, metadata } = parsed.data;

      const result = await walletService.spend(userId, amount, reason, idempotencyKey, metadata);

      if (!result.success) {
        if (result.error === "Insufficient balance") {
          return res.status(402).json({ error: result.error });
        }
        return res.status(400).json({ error: result.error });
      }
      
      if (!result.idempotent) {
        await analyticsService.ptsSpent(userId, amount, {
          reason,
          idempotencyKey,
          ...metadata,
        });
      }

      res.json({
        success: true,
        idempotent: result.idempotent || false,
        wallet: {
          balance: result.wallet!.balance,
          lifetimeSpent: result.wallet!.lifetimeSpent,
        },
        transaction: result.ledgerEntry ? {
          id: result.ledgerEntry.id,
          amount: result.ledgerEntry.amount,
          balanceAfter: result.ledgerEntry.balanceAfter,
          createdAt: result.ledgerEntry.createdAt,
        } : null,
      });
    } catch (error) {
      console.error("Error spending from wallet:", error);
      res.status(500).json({ error: "Failed to process spend" });
    }
  });

  // ============================================
  // INTERNAL WALLET ENDPOINTS (not callable by client)
  // These require internal API key validation
  // ============================================

  const requireInternalAuth = (req: Request, res: Response, next: NextFunction) => {
    const internalKey = req.headers["x-internal-key"];
    const expectedKey = process.env.INTERNAL_API_KEY;
    
    if (!expectedKey) {
      console.error("INTERNAL_API_KEY not configured");
      return res.status(500).json({ error: "Internal configuration error" });
    }
    
    if (internalKey !== expectedKey) {
      return res.status(403).json({ error: "Forbidden" });
    }
    
    next();
  };

  // POST /internal/wallet/earn - Credit PackPTS to user (internal only)
  app.post("/internal/wallet/earn", requireInternalAuth, async (req: any, res) => {
    try {
      const parsed = earnWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { userId, amount, reason, idempotencyKey, metadata } = parsed.data;

      const result = await walletService.earn(userId, amount, reason, idempotencyKey, metadata);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        idempotent: result.idempotent || false,
        wallet: {
          balance: result.wallet!.balance,
          lifetimeEarned: result.wallet!.lifetimeEarned,
        },
        transaction: result.ledgerEntry ? {
          id: result.ledgerEntry.id,
          amount: result.ledgerEntry.amount,
          balanceAfter: result.ledgerEntry.balanceAfter,
          createdAt: result.ledgerEntry.createdAt,
        } : null,
      });
    } catch (error) {
      console.error("Error earning to wallet:", error);
      res.status(500).json({ error: "Failed to process earn" });
    }
  });

  // POST /internal/wallet/adjust - Adjust PackPTS balance (internal only)
  app.post("/internal/wallet/adjust", requireInternalAuth, async (req: any, res) => {
    try {
      const parsed = adjustWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { userId, amount, reason, idempotencyKey, metadata } = parsed.data;

      const result = await walletService.adjust(userId, amount, reason, idempotencyKey, metadata);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        idempotent: result.idempotent || false,
        wallet: {
          balance: result.wallet!.balance,
          lifetimeEarned: result.wallet!.lifetimeEarned,
          lifetimeSpent: result.wallet!.lifetimeSpent,
        },
        transaction: result.ledgerEntry ? {
          id: result.ledgerEntry.id,
          amount: result.ledgerEntry.amount,
          balanceAfter: result.ledgerEntry.balanceAfter,
          createdAt: result.ledgerEntry.createdAt,
        } : null,
      });
    } catch (error) {
      console.error("Error adjusting wallet:", error);
      res.status(500).json({ error: "Failed to process adjustment" });
    }
  });

  // ============================================
  // PACKPTS EXPIRATION ENDPOINTS
  // ============================================

  // GET /api/wallet/expirations - Get user's expiration info (auth required)
  app.get("/api/wallet/expirations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const expirationInfo = await bucketService.getUserExpirationInfo(userId);
      const upcomingExpirations = await bucketService.getUpcomingExpirations(userId, 90);
      const policy = await expirationEngine.getExpirationPolicy();

      res.json({
        balance: expirationInfo.totalBalance,
        expiringNext30Days: expirationInfo.expiringNext30Days,
        expiringNext60Days: expirationInfo.expiringNext60Days,
        expiringNext90Days: expirationInfo.expiringNext90Days,
        nextExpirationDate: expirationInfo.nextExpirationDate,
        nextExpirationAmount: expirationInfo.nextExpirationAmount,
        bucketsBySource: expirationInfo.bucketsBySource,
        weeklyExpirations: upcomingExpirations,
        policy: policy ? {
          earnedDaysToExpire: policy.earnedDaysToExpire,
          purchasedDaysToExpire: policy.purchasedDaysToExpire,
          bonusDefaultDaysToExpire: policy.bonusDefaultDaysToExpire,
          gracePeriodDays: policy.gracePeriodDays,
          inactivityEnabled: policy.inactivityEnabled,
          inactivityDays: policy.inactivityDays,
        } : null,
      });
    } catch (error) {
      console.error("Error getting expiration info:", error);
      res.status(500).json({ error: "Failed to get expiration info" });
    }
  });

  // GET /api/wallet/expiring-soon - Get points expiring in grace period (auth required)
  app.get("/api/wallet/expiring-soon", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const gracePeriodBuckets = await expirationEngine.getGracePeriodBuckets(userId);
      const totalExpiringSoon = gracePeriodBuckets.reduce((sum, b) => sum + b.remainingAmount, 0);
      const policy = await expirationEngine.getExpirationPolicy();

      res.json({
        expiringSoon: totalExpiringSoon,
        gracePeriodDays: policy?.gracePeriodDays || 7,
        buckets: gracePeriodBuckets.map(b => ({
          id: b.id,
          amount: b.remainingAmount,
          sourceType: b.sourceType,
          expiresAt: b.expiresAt,
          earnedAt: b.earnedAt,
        })),
      });
    } catch (error) {
      console.error("Error getting expiring-soon buckets:", error);
      res.status(500).json({ error: "Failed to get expiring-soon buckets" });
    }
  });

  // Admin endpoints for expiration management
  // GET /api/admin/expiration/policy - Get current expiration policy
  app.get("/api/admin/expiration/policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const policy = await expirationEngine.getExpirationPolicy();
      
      if (!policy) {
        return res.status(404).json({ error: "No expiration policy found" });
      }

      res.json({ policy });
    } catch (error) {
      console.error("Error getting expiration policy:", error);
      res.status(500).json({ error: "Failed to get expiration policy" });
    }
  });

  // PUT /api/admin/expiration/policy - Update expiration policy
  app.put("/api/admin/expiration/policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const policyUpdateSchema = z.object({
        earnedDaysToExpire: z.number().int().min(1).max(3650).optional(),
        purchasedDaysToExpire: z.number().int().min(1).max(3650).nullable().optional(),
        bonusDefaultDaysToExpire: z.number().int().min(1).max(3650).optional(),
        inactivityEnabled: z.boolean().optional(),
        inactivityDays: z.number().int().min(1).max(365).optional(),
        inactivityMinAgeDays: z.number().int().min(1).max(365).optional(),
        gracePeriodDays: z.number().int().min(1).max(30).optional(),
        enabled: z.boolean().optional(),
      });

      const parsed = policyUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const updatedPolicy = await expirationEngine.updateExpirationPolicy(parsed.data);
      
      if (!updatedPolicy) {
        return res.status(404).json({ error: "No expiration policy found to update" });
      }

      res.json({ success: true, policy: updatedPolicy });
    } catch (error) {
      console.error("Error updating expiration policy:", error);
      res.status(500).json({ error: "Failed to update expiration policy" });
    }
  });

  // GET /api/admin/expiration/liability - Get liability snapshot
  app.get("/api/admin/expiration/liability", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const latestSnapshot = await expirationEngine.getLatestLiabilitySnapshot();
      
      res.json({
        snapshot: latestSnapshot,
        generated: latestSnapshot ? true : false,
      });
    } catch (error) {
      console.error("Error getting liability snapshot:", error);
      res.status(500).json({ error: "Failed to get liability snapshot" });
    }
  });

  // POST /api/admin/expiration/snapshot - Create liability snapshot
  app.post("/api/admin/expiration/snapshot", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const result = await expirationEngine.createLiabilitySnapshot();
      
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true, snapshot: result.snapshot });
    } catch (error) {
      console.error("Error creating liability snapshot:", error);
      res.status(500).json({ error: "Failed to create liability snapshot" });
    }
  });

  // POST /api/admin/expiration/run - Run expiration job manually
  app.post("/api/admin/expiration/run", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { dryRun = false } = req.body;
      
      const result = await expirationEngine.runExpirationJob(dryRun);
      
      res.json({
        success: result.success,
        dryRun,
        expiredBuckets: result.expiredBuckets,
        totalPointsExpired: result.totalPointsExpired,
        errors: result.errors,
      });
    } catch (error) {
      console.error("Error running expiration job:", error);
      res.status(500).json({ error: "Failed to run expiration job" });
    }
  });

  // POST /api/admin/expiration/run-inactivity - Run inactivity expiration job manually
  app.post("/api/admin/expiration/run-inactivity", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { dryRun = false } = req.body;
      
      const result = await expirationEngine.runInactivityExpiration(dryRun);
      
      res.json({
        success: result.success,
        dryRun,
        usersAffected: result.usersAffected,
        bucketsExpired: result.bucketsExpired,
        totalPointsExpired: result.totalPointsExpired,
        errors: result.errors,
      });
    } catch (error) {
      console.error("Error running inactivity expiration job:", error);
      res.status(500).json({ error: "Failed to run inactivity expiration job" });
    }
  });

  // GET /api/admin/users/:userId/buckets - Get user's buckets (admin)
  app.get("/api/admin/users/:userId/buckets", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const buckets = await bucketService.getUserOpenBuckets(userId);
      const expirationInfo = await bucketService.getUserExpirationInfo(userId);
      
      res.json({
        userId,
        buckets: buckets.map(b => ({
          id: b.id,
          sourceType: b.sourceType,
          originalAmount: b.originalAmount,
          remainingAmount: b.remainingAmount,
          earnedAt: b.earnedAt,
          expiresAt: b.expiresAt,
          status: b.status,
        })),
        summary: expirationInfo,
      });
    } catch (error) {
      console.error("Error getting user buckets:", error);
      res.status(500).json({ error: "Failed to get user buckets" });
    }
  });

  app.post("/api/game/start", async (req: any, res) => {
    try {
      const parsed = startGameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { mode, totalQuestions, setId } = parsed.data;
      
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const isGuest = !userId;
      
      if (mode !== "solo" && isGuest) {
        return res.status(401).json({ error: "Authentication required for this game mode" });
      }
      
      // Founders Cap: authenticated users must have ACTIVE status
      if (userId) {
        const user = await storage.getUser(userId);
        if (user && user.status !== "ACTIVE") {
          return res.status(403).json({ 
            error: "Account not activated",
            code: "WAITLISTED",
            status: user.status,
          });
        }
      }
      
      let tier: "FREE" | "PRO" | "LEGEND" = "FREE";
      let multiplier = 1.0;
      
      const modeMapping: Record<string, string> = {
        "solo": "solo",
        "1v1": "1v1_friend",
        "tournament": "tournament"
      };
      const normalizedMode = modeMapping[mode] || mode;
      
      if (userId) {
        tier = await quotaService.getUserTier(userId);
        multiplier = TIER_CONFIG[tier].multiplier;
        
        const config = TIER_CONFIG[tier];
        const allowedModes = config.allowedModes;
        
        if (!allowedModes.includes(normalizedMode)) {
          return res.status(403).json({ 
            error: "Upgrade required",
            currentTier: tier,
            requiredTier: "PRO",
            message: `Mode '${mode}' requires a Pro subscription`,
          });
        }
        
        const quotaCheck = await quotaService.checkQuota(userId, normalizedMode);
        if (!quotaCheck.allowed) {
          return res.status(429).json({ 
            error: "Quota exceeded",
            tier: quotaCheck.tier,
            dailyUsed: quotaCheck.dailyUsed,
            dailyLimit: quotaCheck.dailyLimit,
            reason: quotaCheck.reason,
            message: "Daily match limit reached. Upgrade to Pro for unlimited matches.",
          });
        }
        
        const tokensInLastHour = await tokenService.countTokensInLastHour(userId);
        const hourlyLimit = TIER_CONFIG[tier].hourlyMatchLimit;
        if (tokensInLastHour >= hourlyLimit) {
          return res.status(429).json({ 
            error: "Rate limited",
            hourlyUsed: tokensInLastHour,
            hourlyLimit,
            message: `Maximum ${hourlyLimit} matches per hour. Please wait before starting another match.`,
          });
        }
      }
      
      let guestSessionId: string | undefined;
      if (isGuest) {
        if (!req.session.guestId) {
          req.session.guestId = randomUUID();
        }
        guestSessionId = req.session.guestId;
      }
      
      const session = await storage.createGameSession(userId, normalizedMode, totalQuestions, guestSessionId);
      
      const maxPoints = session.questions.reduce((sum, q) => sum + q.pointValue, 0);
      
      let matchToken = null;
      let tokenSignature = null;
      
      if (userId) {
        const tokenResult = await tokenService.issueMatchToken(
          userId,
          normalizedMode,
          session.id,
          maxPoints,
          multiplier
        );
        
        if (tokenResult.success) {
          matchToken = tokenResult.token;
          tokenSignature = tokenResult.signature;
          
          await quotaService.incrementMatchStarted(userId, normalizedMode);
          
          await analyticsService.matchStarted(userId, session.id, {
            mode: normalizedMode,
            tier,
            multiplier,
            totalQuestions: session.totalQuestions,
          });
          
          if (setId) {
            await contextService.logMatchContext(userId, setId, session.id, "MATCH_STARTED").catch((err) => {
              console.warn("[Context] Failed to log match context:", err);
            });
          }
        }
      }
      
      res.json({
        ...session,
        matchToken,
        tokenSignature,
        tier,
        multiplier,
      });
    } catch (error) {
      console.error("Error starting game:", error);
      res.status(500).json({ error: "Failed to start game" });
    }
  });

  app.get("/api/game/session/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const session = await storage.getGameSession(id);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json(session);
    } catch (error) {
      console.error("Error getting session:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.post("/api/game/answer", async (req, res) => {
    try {
      const parsed = submitAnswerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { sessionId, questionIndex, selectedAnswer } = parsed.data;
      const session = await storage.getGameSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      if (session.status === "completed") {
        return res.status(400).json({ error: "Game already completed" });
      }
      
      if (questionIndex !== session.currentQuestionIndex) {
        return res.status(400).json({ error: "Invalid question index" });
      }
      
      const currentQuestion = session.questions[questionIndex];
      
      if ((currentQuestion as any).answered) {
        return res.status(400).json({ error: "Question already answered" });
      }
      
      const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
      
      if (isCorrect) {
        session.score += currentQuestion.pointValue;
        session.correctAnswers += 1;
      }
      
      (currentQuestion as any).answered = true;
      (currentQuestion as any).userAnswer = selectedAnswer;
      
      await storage.updateGameSession(session);
      
      res.json({
        correct: isCorrect,
        correctAnswer: currentQuestion.correctAnswer,
        pointsEarned: isCorrect ? currentQuestion.pointValue : 0,
        totalScore: session.score,
        session,
      });
    } catch (error) {
      console.error("Error submitting answer:", error);
      res.status(500).json({ error: "Failed to submit answer" });
    }
  });

  app.post("/api/game/next", async (req: any, res) => {
    try {
      const { sessionId, matchToken, tokenSignature } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }
      
      const session = await storage.getGameSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      if (session.currentQuestionIndex >= session.totalQuestions - 1) {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        
        let multiplier = 1.0;
        let tokenValidated = false;
        
        if (session.userId && matchToken && tokenSignature) {
          const tokenResult = await tokenService.validateToken(matchToken, tokenSignature, session.userId);
          
          if (tokenResult.success && tokenResult.matchToken) {
            const token = tokenResult.matchToken;
            
            if (token.sessionId !== session.id) {
              return res.status(400).json({ error: "Token does not match this session" });
            }
            
            if (session.score > token.maxPoints) {
              console.warn(`Score exceeds max allowed: ${session.score} > ${token.maxPoints} for user ${session.userId}`);
              session.score = Math.min(session.score, token.maxPoints);
            }
            
            multiplier = token.multiplier;
            tokenValidated = true;
            
            await tokenService.completeToken(matchToken);
            await quotaService.incrementMatchCompleted(session.userId, token.mode);
          }
        }
        
        const finalScore = Math.floor(session.score * multiplier);
        
        if (session.userId) {
          await storage.updateUserStats(session.userId, {
            pointsEarned: finalScore,
            correctAnswers: session.correctAnswers,
            totalAnswers: session.totalQuestions,
          });
          
          if (tokenValidated) {
            try {
              const earnResult = await walletService.earn(
                session.userId,
                finalScore,
                `Game completed: ${session.correctAnswers}/${session.totalQuestions} correct`,
                `game_${session.id}`,
                { sessionId: session.id, mode: session.mode, multiplier }
              );
              
              if (earnResult.success && !earnResult.idempotent) {
                await analyticsService.ptsEarned(session.userId, finalScore, {
                  sessionId: session.id,
                  mode: session.mode,
                  multiplier,
                  correctAnswers: session.correctAnswers,
                  totalQuestions: session.totalQuestions,
                });
              }
            } catch (walletError) {
              console.error("Failed to credit wallet:", walletError);
            }
          }
          
          await analyticsService.matchCompleted(session.userId, session.id, {
            mode: session.mode,
            score: finalScore,
            correctAnswers: session.correctAnswers,
            totalQuestions: session.totalQuestions,
            multiplier,
            tokenValidated,
          });

          try {
            const streakResult = await streakService.processMatchCompletion(session.userId, session.id);
            if (streakResult.success && !streakResult.alreadyClaimed && streakResult.totalAwarded) {
              console.log(`[Streak] User ${session.userId} earned ${streakResult.totalAwarded} PackPTS for day ${streakResult.streakInfo?.currentDays} streak`);
            }
          } catch (streakError) {
            console.error("Failed to process streak:", streakError);
          }
        } else if (session.guestSessionId) {
          if (!req.session.pendingPoints) {
            req.session.pendingPoints = { score: 0, correctAnswers: 0, totalAnswers: 0, gamesPlayed: 0 };
          }
          req.session.pendingPoints.score += finalScore;
          req.session.pendingPoints.correctAnswers += session.correctAnswers;
          req.session.pendingPoints.totalAnswers += session.totalQuestions;
          req.session.pendingPoints.gamesPlayed += 1;
        }
        
        session.score = finalScore;
      } else {
        session.currentQuestionIndex += 1;
      }
      
      await storage.updateGameSession(session);
      
      res.json(session);
    } catch (error) {
      console.error("Error moving to next question:", error);
      res.status(500).json({ error: "Failed to move to next question" });
    }
  });

  app.get("/api/leaderboard", async (_req, res) => {
    try {
      const leaderboard = await storage.getLeaderboard(20);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error getting leaderboard:", error);
      res.status(500).json({ error: "Failed to get leaderboard" });
    }
  });

  app.get("/api/marketplace", async (_req, res) => {
    try {
      const options = await storage.getRedemptionOptions();
      res.json(options);
    } catch (error) {
      console.error("Error getting marketplace:", error);
      res.status(500).json({ error: "Failed to get marketplace" });
    }
  });

  app.get("/api/profile/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Calculate rank from leaderboard
      const leaderboard = await storage.getLeaderboard(100);
      const rank = leaderboard.findIndex(e => e.points <= user.points) + 1 || leaderboard.length + 1;
      
      // Calculate level (every 1000 points = 1 level)
      const level = Math.floor(user.points / 1000) + 1;
      const pointsToNextLevel = 1000 - (user.points % 1000);
      const levelProgress = Math.round(((user.points % 1000) / 1000) * 100);
      
      res.json({
        username: user.username,
        email: user.email,
        points: user.points,
        gamesPlayed: user.gamesPlayed,
        correctAnswers: user.correctAnswers,
        totalAnswers: user.totalAnswers,
        rank,
        level,
        pointsToNextLevel,
        levelProgress,
        createdAt: user.createdAt,
      });
    } catch (error) {
      console.error("Error getting profile stats:", error);
      res.status(500).json({ error: "Failed to get profile stats" });
    }
  });

  app.get("/api/cards", async (_req, res) => {
    try {
      const cards = await storage.getCards();
      res.json(cards);
    } catch (error) {
      console.error("Error getting cards:", error);
      res.status(500).json({ error: "Failed to get cards" });
    }
  });

  app.post("/api/auth/register", async (req: any, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      
      const { username, email, password } = parsed.data;
      const { deviceFingerprint, inviteCode } = req.body;
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }
      
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ error: "Email already registered" });
      }
      
      const user = await storage.createLocalUser(username, email, password);
      
      // Try to activate the user (Founders Cap check)
      const activationResult = await accessService.tryActivateUser(user.id, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string,
        deviceFingerprint: deviceFingerprint || undefined,
        inviteCode: inviteCode || req.session.inviteApprovedCode,
        foundersPassTokenHash: req.session.foundersPassTokenHash,
        foundersPassApproved: req.session.foundersPassApproved,
      });
      
      // Clear used invite code and founders pass from session
      if (req.session.inviteApprovedCode) {
        delete req.session.inviteApprovedCode;
      }
      if (req.session.foundersPassTokenHash) {
        delete req.session.foundersPassTokenHash;
        delete req.session.foundersPassApproved;
      }
      
      // Issue a new pass to the activated founder (if still under cap)
      let foundersPassShareUrl: string | undefined;
      if (activationResult.activated) {
        const gateClosed = await foundersPassService.isFoundersGateClosed();
        if (!gateClosed) {
          const newPass = await foundersPassService.issuePassToUser(user.id);
          if (newPass) {
            const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
            foundersPassShareUrl = `${baseUrl}/p/${newPass.rawToken}`;
          }
        }
      }
      
      if (req.session.pendingPoints) {
        const pending = req.session.pendingPoints;
        await storage.updateUserStats(user.id, {
          pointsEarned: pending.score,
          correctAnswers: pending.correctAnswers,
          totalAnswers: pending.totalAnswers,
        });
        
        for (let i = 1; i < pending.gamesPlayed; i++) {
          await db.update(users).set({
            gamesPlayed: sql`${users.gamesPlayed} + 1`
          }).where(eq(users.id, user.id));
        }
        
        delete req.session.pendingPoints;
        delete req.session.guestId;
      }
      
      req.session.localUserId = user.id;
      
      const updatedUser = await storage.getUser(user.id);
      
      // Explicitly save session to ensure it's persisted before response
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        res.json({ 
          success: true, 
          activated: activationResult.activated,
          waitlistPosition: activationResult.waitlistPosition,
          foundersPassShareUrl,
          user: {
            id: updatedUser!.id,
            username: updatedUser!.username,
            points: updatedUser!.points,
            gamesPlayed: updatedUser!.gamesPlayed,
            status: updatedUser!.status,
          }
        });
      });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "Failed to register" });
    }
  });

  app.post("/api/auth/local-login", async (req: any, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      
      const { usernameOrEmail, password } = parsed.data;
      
      const user = await storage.validateLocalCredentials(usernameOrEmail, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      // Transfer any pending guest points to the logged-in user's account
      if (req.session.pendingPoints) {
        const pending = req.session.pendingPoints;
        await storage.updateUserStats(user.id, {
          pointsEarned: pending.score,
          correctAnswers: pending.correctAnswers,
          totalAnswers: pending.totalAnswers,
        });
        
        for (let i = 1; i < pending.gamesPlayed; i++) {
          await db.update(users).set({
            gamesPlayed: sql`${users.gamesPlayed} + 1`
          }).where(eq(users.id, user.id));
        }
        
        delete req.session.pendingPoints;
        delete req.session.guestId;
      }
      
      req.session.localUserId = user.id;
      
      // Get updated user stats after transferring points
      const updatedUser = await storage.getUser(user.id);
      
      // Explicitly save session to ensure it's persisted before response
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        res.json({ 
          success: true, 
          user: {
            id: updatedUser!.id,
            username: updatedUser!.username,
            points: updatedUser!.points,
            gamesPlayed: updatedUser!.gamesPlayed,
          }
        });
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "Failed to login" });
    }
  });

  app.get("/api/guest/pending-points", async (req: any, res) => {
    try {
      const pendingPoints = req.session?.pendingPoints || null;
      res.json({ pendingPoints });
    } catch (error) {
      console.error("Error getting pending points:", error);
      res.status(500).json({ error: "Failed to get pending points" });
    }
  });

  app.post("/api/auth/local-logout", async (req: any, res) => {
    try {
      delete req.session.localUserId;
      res.json({ success: true });
    } catch (error) {
      console.error("Error logging out:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  // Password reset - request reset link
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: "Email is required" });
      }
      
      const user = await storage.getUserByEmail(email);
      
      // Always return success to prevent email enumeration attacks
      if (!user) {
        console.log(`Password reset requested for non-existent email: ${email}`);
        return res.json({ success: true, message: "If an account exists, a reset link has been sent" });
      }
      
      // Create reset token
      const resetToken = await storage.createPasswordResetToken(user.id);
      
      // Determine base URL for reset link
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
        : (process.env.REPLIT_DEPLOYMENT_URL || 'https://packpts.com');
      
      // Send password reset email
      const emailSent = await sendPasswordResetEmail(email, resetToken.token, baseUrl);
      
      if (!emailSent) {
        // Fallback: log the reset link if email fails
        const resetLink = `${baseUrl}/reset-password?token=${resetToken.token}`;
        console.log(`Email failed - Password reset link for ${email}: ${resetLink}`);
      }
      
      res.json({ success: true, message: "If an account exists, a reset link has been sent" });
    } catch (error) {
      console.error("Error requesting password reset:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Password reset - validate token
  app.get("/api/auth/validate-reset-token", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ valid: false, error: "Token is required" });
      }
      
      const resetToken = await storage.getPasswordResetToken(token);
      if (!resetToken) {
        return res.json({ valid: false });
      }
      
      res.json({ valid: true });
    } catch (error) {
      console.error("Error validating reset token:", error);
      res.status(500).json({ valid: false, error: "Failed to validate token" });
    }
  });

  // Password reset - reset password with token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required" });
      }
      
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      
      const resetToken = await storage.getPasswordResetToken(token);
      if (!resetToken) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }
      
      // Update password
      await storage.updateUserPassword(resetToken.userId, password);
      
      // Mark token as used
      await storage.markPasswordResetTokenUsed(resetToken.id);
      
      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ========================================
  // IDENTITY LINKING ENDPOINTS
  // ========================================

  // Get pending link challenge info for current session
  app.get("/api/auth/link/challenge", async (req: any, res) => {
    try {
      const challengeId = req.session?.pendingLinkChallengeId;
      if (!challengeId) {
        return res.status(404).json({ error: "No pending link challenge" });
      }

      const challenge = await identityService.getPendingChallenge(challengeId);
      if (!challenge) {
        return res.status(404).json({ error: "Challenge not found" });
      }

      if (identityService.isChallengeExpired(challenge)) {
        return res.status(410).json({ error: "Challenge expired", code: "CHALLENGE_EXPIRED" });
      }

      const targetUser = challenge.targetUserId 
        ? await storage.getUser(challenge.targetUserId)
        : null;

      res.json({
        id: challenge.id,
        provider: challenge.provider,
        email: challenge.email ? identityService.maskEmail(challenge.email) : null,
        targetUsername: targetUser?.username || null,
        expiresAt: challenge.expiresAt,
        isHighValue: challenge.targetUserId 
          ? await identityService.isHighValue(challenge.targetUserId)
          : false,
      });
    } catch (error) {
      console.error("Error getting link challenge:", error);
      res.status(500).json({ error: "Failed to get challenge" });
    }
  });

  // Confirm link after user proves ownership (logged in)
  app.post("/api/auth/link/confirm", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const challengeId = req.session?.pendingLinkChallengeId;
      if (!challengeId) {
        return res.status(404).json({ error: "No pending link challenge" });
      }

      const challenge = await identityService.getPendingChallenge(challengeId);
      if (!challenge) {
        return res.status(404).json({ error: "Challenge not found" });
      }

      if (identityService.isChallengeExpired(challenge)) {
        delete req.session.pendingLinkChallengeId;
        return res.status(410).json({ error: "Challenge expired", code: "CHALLENGE_EXPIRED" });
      }

      if (challenge.targetUserId && challenge.targetUserId !== userId) {
        return res.status(403).json({ 
          error: "You must log in to the account that owns this email",
          code: "WRONG_ACCOUNT" 
        });
      }

      const existingIdentity = await identityService.findIdentity(
        challenge.provider as any,
        challenge.providerUserId
      );
      
      if (existingIdentity && existingIdentity.userId !== userId) {
        await identityService.logAudit(
          "LINK_BLOCKED",
          challenge.provider as any,
          challenge.providerUserId,
          "Identity already linked to another user during confirmation",
          {
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
            actorUserId: userId,
            targetUserId: existingIdentity.userId,
          }
        );
        return res.status(409).json({ error: "Identity already linked to another account", code: "IDENTITY_IN_USE" });
      }

      const isHighValue = await identityService.isHighValue(userId);
      if (isHighValue && !req.session?.magicLinkVerified) {
        return res.status(403).json({ 
          error: "High-value account requires email verification",
          code: "VERIFICATION_REQUIRED",
          requiresMagicLink: true
        });
      }

      if (!existingIdentity) {
        await identityService.createIdentity(
          userId,
          challenge.provider as any,
          challenge.providerUserId,
          challenge.email,
          false
        );
      }

      await identityService.completePendingLinkChallenge(challengeId, userId);

      await identityService.logAudit(
        "LINK_COMPLETED",
        challenge.provider as any,
        challenge.providerUserId,
        "Challenge resolved via login",
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          actorUserId: userId,
          targetUserId: userId,
        }
      );

      delete req.session.pendingLinkChallengeId;
      delete req.session.magicLinkVerified;

      res.json({ success: true, message: "Account linked successfully" });
    } catch (error) {
      console.error("Error confirming link:", error);
      res.status(500).json({ error: "Failed to confirm link" });
    }
  });

  // Send magic link email for high-value account verification
  app.post("/api/auth/link/send-magic", async (req: any, res) => {
    try {
      const challengeId = req.session?.pendingLinkChallengeId;
      if (!challengeId) {
        return res.status(404).json({ error: "No pending link challenge" });
      }

      const challenge = await identityService.getPendingChallenge(challengeId);
      if (!challenge) {
        return res.status(404).json({ error: "Challenge not found" });
      }

      if (identityService.isChallengeExpired(challenge)) {
        return res.status(410).json({ error: "Challenge expired", code: "CHALLENGE_EXPIRED" });
      }

      if (!challenge.email || !challenge.targetUserId) {
        return res.status(400).json({ error: "Cannot send magic link - no email or target user" });
      }

      const targetUser = await storage.getUser(challenge.targetUserId);
      if (!targetUser || targetUser.email !== challenge.email) {
        return res.status(400).json({ error: "Email does not match target account" });
      }

      const { token } = await identityService.setMagicLinkToken(challengeId);
      
      const baseUrl = `${req.protocol}://${req.hostname}`;
      const magicLink = `${baseUrl}/api/auth/link/verify?token=${token}`;

      const { sendEmail } = await import("./services/emailService");
      await sendEmail({
        to: challenge.email,
        subject: "Verify your PackPoints account link",
        html: `
          <h2>Link Verification Request</h2>
          <p>Someone is trying to link a new login method to your PackPoints account.</p>
          <p>If this was you, click the link below to verify:</p>
          <p><a href="${magicLink}">Verify and Link Account</a></p>
          <p>This link expires in 15 minutes.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
        `,
        text: `Link Verification Request\n\nClick here to verify: ${magicLink}\n\nThis link expires in 15 minutes.`,
      });

      await identityService.logAudit(
        "MAGIC_LINK_SENT",
        challenge.provider as any,
        challenge.providerUserId,
        "Magic link sent for verification",
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          targetUserId: challenge.targetUserId,
          metadata: { email: challenge.email },
        }
      );

      res.json({ success: true, message: "Verification email sent" });
    } catch (error) {
      console.error("Error sending magic link:", error);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  });

  // Verify magic link token
  app.get("/api/auth/link/verify", async (req: any, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.redirect("/auth/error?code=INVALID_TOKEN");
      }

      const challenge = await identityService.findChallengeByMagicToken(token);
      if (!challenge) {
        return res.redirect("/auth/error?code=INVALID_TOKEN");
      }

      if (identityService.isMagicLinkExpired(challenge)) {
        return res.redirect("/auth/error?code=TOKEN_EXPIRED");
      }

      req.session.pendingLinkChallengeId = challenge.id;
      req.session.magicLinkVerified = true;

      await identityService.logAudit(
        "MAGIC_LINK_VERIFIED",
        challenge.provider as any,
        challenge.providerUserId,
        "Magic link verified",
        {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          targetUserId: challenge.targetUserId || undefined,
        }
      );

      req.session.save((err: any) => {
        if (err) {
          console.error("Session save error:", err);
          return res.redirect("/auth/error?code=SESSION_ERROR");
        }
        res.redirect("/auth/link-required?verified=true");
      });
    } catch (error) {
      console.error("Error verifying magic link:", error);
      res.redirect("/auth/error?code=VERIFICATION_FAILED");
    }
  });

  // Cancel pending link challenge
  app.post("/api/auth/link/cancel", async (req: any, res) => {
    try {
      if (req.session?.pendingLinkChallengeId) {
        await identityService.clearPendingLinkChallenge(req.sessionID);
        delete req.session.pendingLinkChallengeId;
        delete req.session.magicLinkVerified;
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error canceling link challenge:", error);
      res.status(500).json({ error: "Failed to cancel" });
    }
  });

  // Get user's linked identities
  app.get("/api/auth/identities", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const identities = await identityService.getIdentitiesForUser(userId);
      res.json(identities.map(i => ({
        id: i.id,
        provider: i.provider,
        email: i.email,
        emailVerified: i.emailVerified,
        createdAt: i.createdAt,
      })));
    } catch (error) {
      console.error("Error getting identities:", error);
      res.status(500).json({ error: "Failed to get identities" });
    }
  });

  app.post("/api/lobby/create", isAuthenticated, requireActiveUser, async (req: any, res) => {
    try {
      // Get authenticated user ID and username from session - server-side derivation, not client-provided
      const userId: string | undefined = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || !user.username) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Validate totalQuestions from request body (limit to reasonable range)
      const requestedQuestions = parseInt(req.body.totalQuestions) || 10;
      const totalQuestions = Math.min(Math.max(requestedQuestions, 5), 20);
      
      // Use server-derived identity, ignore any client-provided hostId/hostUsername
      const lobby = await matchService.createLobby(userId, user.username, totalQuestions);
      
      const { guestSecret: _, ...lobbyForHost } = lobby;
      res.json({ ...lobbyForHost, membershipSecret: lobby.hostSecret });
    } catch (error) {
      console.error("Error creating lobby:", error);
      res.status(500).json({ error: "Failed to create lobby" });
    }
  });

  app.post("/api/lobby/join", isAuthenticated, requireActiveUser, async (req: any, res) => {
    try {
      // Get authenticated user ID and username from session - server-side derivation, not client-provided
      const userId: string | undefined = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || !user.username) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { joinCode } = req.body;
      if (!joinCode || typeof joinCode !== 'string') {
        return res.status(400).json({ error: "Valid join code required" });
      }
      
      // Use server-derived identity, ignore any client-provided guestId/guestUsername
      const lobby = await matchService.joinLobby(joinCode.toUpperCase(), userId, user.username);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found or not available" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json({ ...safeLobby, membershipSecret: lobby.guestSecret });
    } catch (error) {
      console.error("Error joining lobby:", error);
      res.status(500).json({ error: "Failed to join lobby" });
    }
  });

  app.get("/api/lobby/:id", async (req, res) => {
    try {
      const lobby = await matchService.getLobby(req.params.id);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json(safeLobby);
    } catch (error) {
      console.error("Error getting lobby:", error);
      res.status(500).json({ error: "Failed to get lobby" });
    }
  });

  app.get("/api/lobby/code/:code", async (req, res) => {
    try {
      const lobby = await matchService.getLobbyByCode(req.params.code);
      
      if (!lobby) {
        return res.status(404).json({ error: "Lobby not found" });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = lobby;
      res.json(safeLobby);
    } catch (error) {
      console.error("Error getting lobby:", error);
      res.status(500).json({ error: "Failed to get lobby" });
    }
  });

  app.post("/api/lobby/:id/leave", isAuthenticated, async (req: any, res) => {
    try {
      // Get authenticated user ID from session - server-side derivation, not client-provided
      const userId: string | undefined = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const result = await matchService.leaveLobby(req.params.id, userId);
      
      res.json({ success: true, lobby: result });
    } catch (error) {
      console.error("Error leaving lobby:", error);
      res.status(500).json({ error: "Failed to leave lobby" });
    }
  });

  app.post("/api/admin/fetch-cards", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.body.limit) || 5, 10);
      
      const existingCards = await storage.getCards();
      const existingNames = new Set(existingCards.map(c => c.playerName));
      
      const newCards = await fetchAdditionalCards(limit);
      
      const uniqueNewCards = newCards.filter(c => !existingNames.has(c.playerName));
      
      let added = 0;
      for (const card of uniqueNewCards) {
        await storage.addCard({
          playerName: card.playerName,
          team: card.team || "Unknown",
          position: "Unknown",
          year: 1987,
          setName: "Topps",
          cardNumber: card.cardNumber,
          imageUrl: card.imageUrl,
          popularity: card.popularity,
          imageVerified: true,
        });
        added++;
      }
      
      res.json({ 
        message: `Added ${added} new cards to database`,
        added,
        total: existingCards.length + added
      });
    } catch (error) {
      console.error("Error fetching additional cards:", error);
      res.status(500).json({ error: "Failed to fetch cards" });
    }
  });

  app.get("/api/cards/stats", async (_req, res) => {
    try {
      const cards = await storage.getCards();
      const verified = cards.filter(c => c.imageVerified).length;
      res.json({
        total: cards.length,
        verified,
        unverified: cards.length - verified
      });
    } catch (error) {
      console.error("Error getting card stats:", error);
      res.status(500).json({ error: "Failed to get card stats" });
    }
  });

  app.get("/api/admin/dashboard", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const allUsers: User[] = await db.select().from(users);
      const allCards = await storage.getCards();
      const verifiedCards = allCards.filter(c => c.imageVerified).length;
      
      const totalUsers = allUsers.length;
      const totalPoints = allUsers.reduce((sum: number, u: User) => sum + u.points, 0);
      const totalGames = allUsers.reduce((sum: number, u: User) => sum + u.gamesPlayed, 0);
      const totalCorrect = allUsers.reduce((sum: number, u: User) => sum + u.correctAnswers, 0);
      const totalAnswers = allUsers.reduce((sum: number, u: User) => sum + u.totalAnswers, 0);
      const avgAccuracy = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
      
      const topPlayers = [...allUsers]
        .sort((a: User, b: User) => b.points - a.points)
        .slice(0, 5)
        .map((u: User) => ({
          username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
          points: u.points,
          gamesPlayed: u.gamesPlayed,
        }));
      
      const mostActive = [...allUsers]
        .sort((a: User, b: User) => b.gamesPlayed - a.gamesPlayed)
        .slice(0, 5)
        .map((u: User) => ({
          username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
          gamesPlayed: u.gamesPlayed,
          points: u.points,
        }));
      
      res.json({
        overview: {
          totalUsers,
          totalPoints,
          totalGames,
          avgAccuracy,
          totalCards: allCards.length,
          verifiedCards,
        },
        topPlayers,
        mostActive,
      });
    } catch (error) {
      console.error("Error getting dashboard stats:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  app.get("/api/admin/users", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const search = (req.query.search as string) || "";
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
      
      let allUsers: User[] = await db.select().from(users);
      
      if (search) {
        const searchLower = search.toLowerCase();
        allUsers = allUsers.filter((u: User) => 
          (u.firstName || '').toLowerCase().includes(searchLower) ||
          (u.lastName || '').toLowerCase().includes(searchLower) ||
          (u.email || '').toLowerCase().includes(searchLower)
        );
      }
      
      const total = allUsers.length;
      const sortedUsers = [...allUsers].sort((a: User, b: User) => b.points - a.points);
      const paginatedUsers = sortedUsers.slice(offset, offset + limit);
      
      const usersWithStats = paginatedUsers.map((u: User) => ({
        id: u.id,
        username: u.firstName || u.email?.split('@')[0] || 'Anonymous',
        points: u.points,
        gamesPlayed: u.gamesPlayed,
        correctAnswers: u.correctAnswers,
        totalAnswers: u.totalAnswers,
        accuracy: u.totalAnswers > 0 ? Math.round((u.correctAnswers / u.totalAnswers) * 100) : 0,
      }));
      
      res.json({
        users: usersWithStats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error getting users:", error);
      res.status(500).json({ error: "Failed to get users" });
    }
  });

  app.get("/api/admin/users/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const accuracy = user.totalAnswers > 0 
        ? Math.round((user.correctAnswers / user.totalAnswers) * 100) 
        : 0;
      
      const avgPointsPerGame = user.gamesPlayed > 0 
        ? Math.round(user.points / user.gamesPlayed) 
        : 0;
      
      res.json({
        id: user.id,
        username: user.firstName || user.email?.split('@')[0] || 'Anonymous',
        points: user.points,
        gamesPlayed: user.gamesPlayed,
        correctAnswers: user.correctAnswers,
        totalAnswers: user.totalAnswers,
        accuracy,
        avgPointsPerGame,
      });
    } catch (error) {
      console.error("Error getting user:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/admin/sync-images", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const cards = await storage.getCards();
      const players = cards.map(c => ({ playerName: c.playerName, cardNumber: c.cardNumber }));
      
      const imageResults = await fetch1987ToppsFromCardHedge(players);
      
      let verified = 0;
      let fromCardHedge = 0;
      let unverified = 0;
      
      for (const card of cards) {
        const result = imageResults.get(card.playerName);
        
        if (result && result.imageUrl && result.verified) {
          await storage.updateCardImage(card.playerName, result.imageUrl, true);
          verified++;
          if (result.source === "cardhedge") {
            fromCardHedge++;
          }
        } else if (result && result.imageUrl) {
          await storage.updateCardImage(card.playerName, result.imageUrl, false);
          unverified++;
        } else {
          await storage.updateCardImage(card.playerName, "", false);
          unverified++;
        }
      }
      
      res.json({ 
        message: `Synced images: ${verified} verified (${fromCardHedge} from Card Hedge), ${unverified} unverified`,
        verified,
        fromCardHedge,
        unverified,
        cardHedgeConfigured: isCardHedgeConfigured()
      });
    } catch (error) {
      console.error("Error syncing images:", error);
      res.status(500).json({ error: "Failed to sync images" });
    }
  });

  // Product catalog endpoints
  app.get("/api/products", async (req: any, res) => {
    try {
      const products = await storage.getProducts(true);
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        await analyticsService.storeViewed(userId, { productCount: products.length });
      }
      
      res.json(products);
    } catch (error) {
      console.error("Error getting products:", error);
      res.status(500).json({ error: "Failed to get products" });
    }
  });

  // User entitlements endpoint (requires auth)
  app.get("/api/me/entitlements", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const entitlements = await storage.getUserEntitlements(userId);
      res.json(entitlements);
    } catch (error) {
      console.error("Error getting user entitlements:", error);
      res.status(500).json({ error: "Failed to get entitlements" });
    }
  });

  // ============================================
  // STRIPE WEBHOOK & BILLING ENDPOINTS
  // ============================================

  // Stripe webhook endpoint - receives raw body for signature verification
  app.post("/webhooks/purchases", 
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const signature = req.headers["stripe-signature"];
      
      if (!signature || typeof signature !== "string") {
        console.error("Missing stripe-signature header");
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      if (!isStripeConfigured()) {
        console.error("Stripe is not configured");
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      try {
        const event = await stripePurchaseService.verifyAndParseWebhook(
          req.body,
          signature
        );

        const result = await stripePurchaseService.processWebhookEvent(event);
        
        console.log(`Webhook processed: ${result.eventId} - ${result.status}${result.message ? ` - ${result.message}` : ""}`);
        
        res.json({
          received: true,
          eventId: result.eventId,
          status: result.status,
        });
      } catch (error) {
        console.error("Webhook error:", error);
        
        if (error instanceof Error && error.message.includes("signature")) {
          return res.status(400).json({ error: "Invalid signature" });
        }
        
        return res.status(500).json({ error: "Webhook processing failed" });
      }
    }
  );

  // Billing sync endpoint - reconciles user's purchases with Stripe
  app.post("/billing/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!isStripeConfigured()) {
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      const { stripeCustomerId } = req.body || {};
      
      const result = await stripePurchaseService.syncUserPurchases(userId, stripeCustomerId);
      
      res.json({
        success: result.errors.length === 0,
        userId: result.userId,
        processedEvents: result.processedEvents,
        grantedPackPts: result.grantedPackPts,
        grantedEntitlements: result.grantedEntitlements,
        errors: result.errors,
      });
    } catch (error) {
      console.error("Billing sync error:", error);
      res.status(500).json({ error: "Failed to sync purchases" });
    }
  });

  // Admin: Reprocess a failed purchase event
  app.post("/api/admin/purchases/:eventId/reprocess", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { eventId } = req.params;
      
      if (!eventId) {
        return res.status(400).json({ error: "Event ID is required" });
      }

      const result = await stripePurchaseService.reprocessEvent(eventId);
      
      res.json({
        success: result.success,
        eventId: result.eventId,
        status: result.status,
        message: result.message,
        error: result.error,
      });
    } catch (error) {
      console.error("Reprocess error:", error);
      res.status(500).json({ error: "Failed to reprocess event" });
    }
  });

  // Stripe configuration status (for frontend)
  app.get("/api/billing/status", async (_req, res) => {
    res.json({
      stripeConfigured: isStripeConfigured(),
    });
  });

  // ============================================
  // STORE CHECKOUT ENDPOINTS
  // ============================================

  // Get PackPTS bundles for purchase
  app.get("/api/store/products", async (req: any, res) => {
    try {
      const bundles = storeCheckoutService.getPackPtsBundles();
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        await analyticsService.storeViewed(userId, { productCount: bundles.length, type: "packpts_bundles" });
      }
      
      res.json({
        products: bundles,
        stripeConfigured: isStripeConfigured(),
      });
    } catch (error) {
      console.error("Error getting store products:", error);
      res.status(500).json({ error: "Failed to get store products" });
    }
  });

  // Create Stripe checkout session for PackPTS purchase
  app.post("/api/store/checkout", isAuthenticated, requireActiveUser, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { sku } = req.body;
      if (!sku || typeof sku !== "string") {
        return res.status(400).json({ error: "SKU is required" });
      }

      if (!isStripeConfigured()) {
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const successUrl = `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/store/cancel`;

      const result = await storeCheckoutService.createCheckoutSession(
        userId,
        sku,
        successUrl,
        cancelUrl
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url, sessionId: result.sessionId });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Get checkout session status (for success page polling) - requires auth for security
  app.get("/api/store/checkout/:sessionId", isAuthenticated, async (req: any, res) => {
    try {
      const { sessionId } = req.params;
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }

      const status = await storeCheckoutService.getCheckoutSessionStatus(sessionId);
      
      if (!status) {
        return res.status(404).json({ error: "Checkout session not found" });
      }

      // Verify session belongs to the requesting user (security check)
      if (status.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(status);
    } catch (error) {
      console.error("Error getting checkout session:", error);
      res.status(500).json({ error: "Failed to get checkout session status" });
    }
  });

  // ============================================
  // MONTHLY PACKPTS SUBSCRIPTIONS
  // ============================================

  // Get available monthly PackPTS subscription products
  app.get("/api/store/subscriptions", async (req: any, res) => {
    try {
      const subscriptions = await storeCheckoutService.getPackPtsSubscriptions();
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        await analyticsService.storeViewed(userId, { productCount: subscriptions.length, type: "packpts_subscriptions" });
      }
      
      res.json({ subscriptions });
    } catch (error) {
      console.error("Error getting subscription products:", error);
      res.status(500).json({ error: "Failed to get subscription products" });
    }
  });

  // Create subscription checkout session for monthly PackPTS
  app.post("/api/store/subscribe", isAuthenticated, requireActiveUser, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { sku } = req.body;
      if (!sku) {
        return res.status(400).json({ error: "SKU is required" });
      }

      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `http://localhost:5000`;
      
      const successUrl = `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/store/cancel`;

      const result = await storeCheckoutService.createSubscriptionCheckoutSession(
        userId,
        sku,
        successUrl,
        cancelUrl
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url, sessionId: result.sessionId });
    } catch (error) {
      console.error("Error creating subscription checkout session:", error);
      res.status(500).json({ error: "Failed to create subscription checkout session" });
    }
  });

  // ============================================
  // ADMIN MANAGEMENT ENDPOINTS
  // ============================================

  // Admin: Get user's wallet and ledger
  app.get("/api/admin/users/:userId/wallet", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const walletData = await adminService.getUserWallet(userId);
      
      if (!walletData) {
        return res.status(404).json({ error: "Wallet not found" });
      }
      
      res.json(walletData);
    } catch (error) {
      console.error("Error getting user wallet:", error);
      res.status(500).json({ error: "Failed to get user wallet" });
    }
  });

  // Admin: Get purchase events
  app.get("/api/admin/purchases", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string | undefined;
      const userId = req.query.userId as string | undefined;
      
      const result = await adminService.getPurchaseEvents(page, limit, status, userId);
      res.json(result);
    } catch (error) {
      console.error("Error getting purchase events:", error);
      res.status(500).json({ error: "Failed to get purchase events" });
    }
  });

  // Admin: Get user's entitlements
  app.get("/api/admin/users/:userId/entitlements", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const entitlements = await adminService.getUserEntitlements(userId);
      res.json({ entitlements });
    } catch (error) {
      console.error("Error getting user entitlements:", error);
      res.status(500).json({ error: "Failed to get entitlements" });
    }
  });

  // Admin: Grant entitlement
  app.post("/api/admin/users/:userId/entitlements", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { entitlementKey, expiresAt } = req.body;
      
      if (!entitlementKey) {
        return res.status(400).json({ error: "Entitlement key required" });
      }
      
      const result = await adminService.grantEntitlement(
        { adminUserId, targetUserId: userId },
        entitlementKey,
        expiresAt ? new Date(expiresAt) : null
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: `Granted ${entitlementKey} to user` });
    } catch (error) {
      console.error("Error granting entitlement:", error);
      res.status(500).json({ error: "Failed to grant entitlement" });
    }
  });

  // Admin: Revoke entitlement
  app.delete("/api/admin/users/:userId/entitlements/:entitlementKey", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId, entitlementKey } = req.params;
      const { reason } = req.body || {};
      
      const result = await adminService.revokeEntitlement(
        { adminUserId, targetUserId: userId },
        entitlementKey,
        reason || "Admin revocation"
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: `Revoked ${entitlementKey} from user` });
    } catch (error) {
      console.error("Error revoking entitlement:", error);
      res.status(500).json({ error: "Failed to revoke entitlement" });
    }
  });

  // Admin: Adjust PackPTS balance
  app.post("/api/admin/users/:userId/wallet/adjust", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { amount, reason } = req.body;
      
      if (typeof amount !== "number") {
        return res.status(400).json({ error: "Amount must be a number" });
      }
      
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Reason required" });
      }
      
      const result = await adminService.adjustPackPTS(
        { adminUserId, targetUserId: userId },
        amount,
        reason
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, newBalance: result.newBalance });
    } catch (error) {
      console.error("Error adjusting PackPTS:", error);
      res.status(500).json({ error: "Failed to adjust PackPTS" });
    }
  });

  // Admin: Get user admin status
  app.get("/api/admin/users/:userId/admin-status", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const status = await adminService.getUserAdminStatus(userId);
      
      if (!status) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json(status);
    } catch (error) {
      console.error("Error getting admin status:", error);
      res.status(500).json({ error: "Failed to get admin status" });
    }
  });

  // Admin: Grant admin access
  app.post("/api/admin/users/:userId/grant-admin", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      
      const result = await adminService.grantAdminAccess({
        adminUserId,
        targetUserId: userId,
      });
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: "Admin access granted" });
    } catch (error) {
      console.error("Error granting admin:", error);
      res.status(500).json({ error: "Failed to grant admin access" });
    }
  });

  // Admin: Revoke admin access
  app.post("/api/admin/users/:userId/revoke-admin", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Reason required" });
      }
      
      const result = await adminService.revokeAdminAccess(
        { adminUserId, targetUserId: userId },
        reason
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: "Admin access revoked" });
    } catch (error) {
      console.error("Error revoking admin:", error);
      res.status(500).json({ error: "Failed to revoke admin access" });
    }
  });

  // Admin: Suspend user
  app.post("/api/admin/users/:userId/suspend", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Reason required" });
      }
      
      const result = await adminService.suspendUser(
        { adminUserId, targetUserId: userId },
        reason
      );
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: "User suspended" });
    } catch (error) {
      console.error("Error suspending user:", error);
      res.status(500).json({ error: "Failed to suspend user" });
    }
  });

  // Admin: Unsuspend user
  app.post("/api/admin/users/:userId/unsuspend", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      
      const result = await adminService.unsuspendUser({
        adminUserId,
        targetUserId: userId,
      });
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: "User unsuspended" });
    } catch (error) {
      console.error("Error unsuspending user:", error);
      res.status(500).json({ error: "Failed to unsuspend user" });
    }
  });

  // Admin: Get all admins
  app.get("/api/admin/admins", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const admins = await adminService.getAllAdmins();
      res.json({ admins });
    } catch (error) {
      console.error("Error getting admins:", error);
      res.status(500).json({ error: "Failed to get admins" });
    }
  });

  // Admin: Get feature flags
  app.get("/api/admin/feature-flags", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const flags = await adminService.getFeatureFlags();
      res.json({ flags });
    } catch (error) {
      console.error("Error getting feature flags:", error);
      res.status(500).json({ error: "Failed to get feature flags" });
    }
  });

  // Admin: Toggle feature flag
  app.patch("/api/admin/feature-flags/:key", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { key } = req.params;
      const { enabled, value } = req.body;
      
      if (typeof enabled === "boolean") {
        const result = await adminService.toggleFeatureFlag(
          { adminUserId },
          key,
          enabled
        );
        
        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }
      }
      
      if (value !== undefined) {
        const result = await adminService.updateFeatureFlagValue(
          { adminUserId },
          key,
          value
        );
        
        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating feature flag:", error);
      res.status(500).json({ error: "Failed to update feature flag" });
    }
  });

  // Admin: Get all products
  app.get("/api/admin/products", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const allProducts = await db
        .select()
        .from(products)
        .orderBy(sql`${products.createdAt} DESC`);
      res.json({ products: allProducts });
    } catch (error) {
      console.error("Error getting products:", error);
      res.status(500).json({ error: "Failed to get products" });
    }
  });

  // Admin: Create product
  app.post("/api/admin/products", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const baseSchema = z.object({
        sku: z.string().min(1).max(100),
        name: z.string().min(1).max(200),
        priceUsd: z.number().int().positive(),
        stripePriceId: z.string().optional().nullable(),
        isActive: z.boolean().default(true),
        metadata: z.record(z.any()).optional().nullable(),
      });

      const consumableSchema = baseSchema.extend({
        type: z.literal("CONSUMABLE"),
        packptsGrant: z.number().int().positive(),
        entitlementKey: z.null().optional(),
        durationDays: z.null().optional(),
      });

      const entitlementSchema = baseSchema.extend({
        type: z.literal("ENTITLEMENT"),
        packptsGrant: z.null().optional(),
        entitlementKey: z.string().min(1).max(100),
        durationDays: z.null().optional(),
      });

      const subscriptionSchema = baseSchema.extend({
        type: z.literal("SUBSCRIPTION"),
        packptsGrant: z.null().optional(),
        entitlementKey: z.string().min(1).max(100),
        durationDays: z.number().int().positive(),
      });

      const productSchema = z.discriminatedUnion("type", [
        consumableSchema,
        entitlementSchema,
        subscriptionSchema,
      ]);

      const parsed = productSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existingSku = await db
        .select()
        .from(products)
        .where(eq(products.sku, parsed.data.sku))
        .limit(1);

      if (existingSku.length > 0) {
        return res.status(400).json({ error: "SKU already exists" });
      }

      const [newProduct] = await db
        .insert(products)
        .values({
          sku: parsed.data.sku,
          name: parsed.data.name,
          type: parsed.data.type,
          packptsGrant: parsed.data.packptsGrant || null,
          entitlementKey: parsed.data.entitlementKey || null,
          durationDays: parsed.data.durationDays || null,
          priceUsd: parsed.data.priceUsd,
          isActive: parsed.data.isActive,
          metadata: {
            ...parsed.data.metadata,
            stripePriceId: parsed.data.stripePriceId,
          },
        })
        .returning();

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "product_created",
        null,
        { productId: newProduct.id, sku: newProduct.sku, name: newProduct.name }
      );

      res.json({ success: true, product: newProduct });
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  // Admin: Update product
  app.patch("/api/admin/products/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const existingProduct = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      if (existingProduct.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      const productType = existingProduct[0].type;
      
      const baseUpdateSchema = z.object({
        name: z.string().min(1).max(200).optional(),
        priceUsd: z.number().int().positive().optional(),
        stripePriceId: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
        metadata: z.record(z.any()).optional().nullable(),
      });

      let updateSchema;
      if (productType === "CONSUMABLE") {
        updateSchema = baseUpdateSchema.extend({
          packptsGrant: z.number().int().positive().optional(),
          entitlementKey: z.null().optional(),
          durationDays: z.null().optional(),
        });
      } else if (productType === "ENTITLEMENT") {
        updateSchema = baseUpdateSchema.extend({
          packptsGrant: z.null().optional(),
          entitlementKey: z.string().min(1).max(100).optional(),
          durationDays: z.null().optional(),
        });
      } else {
        updateSchema = baseUpdateSchema.extend({
          packptsGrant: z.null().optional(),
          entitlementKey: z.string().min(1).max(100).optional(),
          durationDays: z.number().int().positive().optional(),
        });
      }

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const existingMetadata = existingProduct[0].metadata as Record<string, any> || {};
      const updatedMetadata = {
        ...existingMetadata,
        ...(parsed.data.metadata || {}),
        ...(parsed.data.stripePriceId !== undefined ? { stripePriceId: parsed.data.stripePriceId } : {}),
      };

      const updateData: Record<string, any> = { metadata: updatedMetadata };
      if (parsed.data.name) updateData.name = parsed.data.name;
      if (parsed.data.priceUsd !== undefined) updateData.priceUsd = parsed.data.priceUsd;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

      if (productType === "CONSUMABLE" && parsed.data.packptsGrant !== undefined) {
        updateData.packptsGrant = parsed.data.packptsGrant;
      }
      if (productType !== "CONSUMABLE" && parsed.data.entitlementKey !== undefined) {
        updateData.entitlementKey = parsed.data.entitlementKey;
      }
      if (productType === "SUBSCRIPTION" && parsed.data.durationDays !== undefined) {
        updateData.durationDays = parsed.data.durationDays;
      }

      const [updatedProduct] = await db
        .update(products)
        .set(updateData)
        .where(eq(products.id, id))
        .returning();

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "product_updated",
        null,
        { productId: id, productType, changes: parsed.data }
      );

      res.json({ success: true, product: updatedProduct });
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  // Admin: Toggle product active status
  app.patch("/api/admin/products/:id/toggle", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const existingProduct = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      if (existingProduct.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      const newActiveStatus = !existingProduct[0].isActive;

      const [updatedProduct] = await db
        .update(products)
        .set({ isActive: newActiveStatus })
        .where(eq(products.id, id))
        .returning();

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        newActiveStatus ? "product_activated" : "product_deactivated",
        null,
        { productId: id, sku: existingProduct[0].sku }
      );

      res.json({ success: true, product: updatedProduct });
    } catch (error) {
      console.error("Error toggling product:", error);
      res.status(500).json({ error: "Failed to toggle product" });
    }
  });

  // Admin: Delete product (soft delete by setting isActive to false)
  app.delete("/api/admin/products/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const existingProduct = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      if (existingProduct.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }

      await db
        .update(products)
        .set({ isActive: false })
        .where(eq(products.id, id));

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "product_deleted",
        null,
        { productId: id, sku: existingProduct[0].sku }
      );

      res.json({ success: true, message: "Product deactivated" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  // Admin: Get audit log
  app.get("/api/admin/audit-log", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const adminUserId = req.query.adminUserId as string | undefined;
      
      const result = await adminService.getAuditLog(page, limit, adminUserId);
      res.json(result);
    } catch (error) {
      console.error("Error getting audit log:", error);
      res.status(500).json({ error: "Failed to get audit log" });
    }
  });

  // Admin: Get metrics
  app.get("/api/admin/metrics", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const date = req.query.date as string | undefined;
      const metrics = await adminService.getMetrics(date);
      res.json(metrics);
    } catch (error) {
      console.error("Error getting metrics:", error);
      res.status(500).json({ error: "Failed to get metrics" });
    }
  });

  // ============================================
  // ADMIN STREAK ENDPOINTS
  // ============================================

  // Admin: Get streak statistics
  app.get("/api/admin/streaks/stats", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const stats = await streakService.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting streak stats:", error);
      res.status(500).json({ error: "Failed to get streak statistics" });
    }
  });

  // Admin: Get top streaks
  app.get("/api/admin/streaks/top", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const topStreaks = await streakService.getTopStreaks(10);
      res.json(topStreaks);
    } catch (error) {
      console.error("Error getting top streaks:", error);
      res.status(500).json({ error: "Failed to get top streaks" });
    }
  });

  // Admin: Get streak reward configuration
  app.get("/api/admin/streaks/config", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const configs = await streakService.getRewardConfigs();
      res.json(configs);
    } catch (error) {
      console.error("Error getting streak config:", error);
      res.status(500).json({ error: "Failed to get streak configuration" });
    }
  });

  // Admin: Add streak reward configuration
  app.post("/api/admin/streaks/config", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { dayNumber, baseReward, milestoneBonus } = req.body;
      
      if (typeof dayNumber !== "number" || dayNumber < 1) {
        return res.status(400).json({ error: "Day number must be a positive integer" });
      }
      if (typeof baseReward !== "number" || baseReward < 0) {
        return res.status(400).json({ error: "Base reward must be a non-negative number" });
      }
      if (typeof milestoneBonus !== "number" || milestoneBonus < 0) {
        return res.status(400).json({ error: "Milestone bonus must be a non-negative number" });
      }

      const config = await streakService.addRewardConfig(dayNumber, baseReward, milestoneBonus);
      res.json(config);
    } catch (error) {
      console.error("Error adding streak config:", error);
      res.status(500).json({ error: "Failed to add streak configuration" });
    }
  });

  // Admin: Update streak reward configuration
  app.patch("/api/admin/streaks/config/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { baseReward, milestoneBonus } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid config ID" });
      }

      const config = await streakService.updateRewardConfig(id, { baseReward, milestoneBonus });
      if (!config) {
        return res.status(404).json({ error: "Configuration not found" });
      }
      res.json(config);
    } catch (error) {
      console.error("Error updating streak config:", error);
      res.status(500).json({ error: "Failed to update streak configuration" });
    }
  });

  // Admin: Delete streak reward configuration
  app.delete("/api/admin/streaks/config/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid config ID" });
      }

      const success = await streakService.deleteRewardConfig(id);
      if (!success) {
        return res.status(404).json({ error: "Configuration not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting streak config:", error);
      res.status(500).json({ error: "Failed to delete streak configuration" });
    }
  });

  // ============================================
  // REDEMPTION ENDPOINTS
  // ============================================

  // GET /api/redemption/tiers - Get available redemption tiers
  app.get("/api/redemption/tiers", async (_req, res) => {
    try {
      const tiers = await redemptionService.getRedemptionTiers();
      res.json({ tiers });
    } catch (error) {
      console.error("Error fetching redemption tiers:", error);
      res.status(500).json({ error: "Failed to fetch redemption tiers" });
    }
  });

  // POST /api/redemption/calculate - Preview redemption value without executing
  app.post("/api/redemption/calculate", async (req, res) => {
    try {
      const { packptsAmount } = req.body;
      
      if (typeof packptsAmount !== "number" || packptsAmount < 1000) {
        return res.status(400).json({ error: "Minimum 1000 PackPTS required" });
      }

      const calculation = await redemptionService.calculateTierValue(packptsAmount);
      if (!calculation) {
        return res.status(400).json({ error: "No valid tier for this amount" });
      }

      res.json({
        packptsAmount: calculation.packptsAmount,
        usdValueCents: calculation.usdValueCents,
        usdValue: (calculation.usdValueCents / 100).toFixed(2),
        ratePerThousand: calculation.ratePerThousand,
        tierPackptsRequired: calculation.tier.packptsRequired,
        tierName: calculation.tier.name,
      });
    } catch (error) {
      console.error("Error calculating redemption:", error);
      res.status(500).json({ error: "Failed to calculate redemption" });
    }
  });

  // POST /api/redeem - Redeem PackPTS for store credit
  app.post("/api/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parseResult = redeemPackptsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: parseResult.error.errors[0]?.message || "Invalid request" 
        });
      }

      const result = await redemptionService.redeem(userId, parseResult.data.packptsAmount, parseResult.data.idempotencyKey);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        redemption: {
          id: result.redemption?.id,
          packptsSpent: result.redemption?.packptsSpent,
          usdValue: result.redemption?.usdValue,
          status: result.redemption?.status,
          createdAt: result.redemption?.createdAt,
        },
        creditToken: result.creditToken,
        requiresReview: result.requiresReview,
        message: result.requiresReview 
          ? "Your redemption is pending admin review due to the high value."
          : "Redemption successful! Use your credit token at checkout.",
      });
    } catch (error) {
      console.error("Error processing redemption:", error);
      res.status(500).json({ error: "Failed to process redemption" });
    }
  });

  // GET /api/redemption/history - Get user's redemption history
  app.get("/api/redemption/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const redemptions = await redemptionService.getUserRedemptions(userId);
      res.json({ redemptions });
    } catch (error) {
      console.error("Error fetching redemption history:", error);
      res.status(500).json({ error: "Failed to fetch redemption history" });
    }
  });

  // POST /api/redemption/validate-token - Validate a credit token for checkout
  app.post("/api/redemption/validate-token", async (req, res) => {
    try {
      const { creditToken } = req.body;
      
      if (!creditToken || typeof creditToken !== "string") {
        return res.status(400).json({ error: "Credit token required" });
      }

      const validation = await redemptionService.validateCreditToken(creditToken);
      
      if (!validation.valid) {
        return res.status(400).json({ valid: false, error: "Invalid or expired credit token" });
      }

      res.json({
        valid: true,
        usdValueCents: validation.usdValueCents,
        usdValue: ((validation.usdValueCents || 0) / 100).toFixed(2),
      });
    } catch (error) {
      console.error("Error validating credit token:", error);
      res.status(500).json({ error: "Failed to validate credit token" });
    }
  });

  // POST /api/redemption/consume-token - Consume credit token at checkout
  app.post("/api/redemption/consume-token", async (req, res) => {
    try {
      const { creditToken } = req.body;
      
      if (!creditToken || typeof creditToken !== "string") {
        return res.status(400).json({ error: "Credit token required" });
      }

      const result = await redemptionService.consumeCreditToken(creditToken);
      
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      res.json({
        success: true,
        usdValueCents: result.usdValueCents,
        usdValue: ((result.usdValueCents || 0) / 100).toFixed(2),
      });
    } catch (error) {
      console.error("Error consuming credit token:", error);
      res.status(500).json({ error: "Failed to consume credit token" });
    }
  });

  // ============================================
  // ADMIN REDEMPTION ENDPOINTS
  // ============================================

  // GET /api/admin/redemptions - Get all redemptions (with optional status filter)
  app.get("/api/admin/redemptions", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const status = req.query.status as string | undefined;

      const result = await redemptionService.getAllRedemptions(page, pageSize, status as any);
      res.json(result);
    } catch (error) {
      console.error("Error fetching redemptions:", error);
      res.status(500).json({ error: "Failed to fetch redemptions" });
    }
  });

  // GET /api/admin/redemptions/pending - Get pending redemptions requiring review
  app.get("/api/admin/redemptions/pending", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;

      const result = await redemptionService.getPendingRedemptions(page, pageSize);
      res.json(result);
    } catch (error) {
      console.error("Error fetching pending redemptions:", error);
      res.status(500).json({ error: "Failed to fetch pending redemptions" });
    }
  });

  // POST /api/admin/redemptions/:id/approve - Approve a pending redemption
  app.post("/api/admin/redemptions/:id/approve", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;

      const result = await redemptionService.approveRedemption(id, adminUserId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      await adminService.logAction(adminUserId, "approve_redemption", result.redemption?.userId, {
        redemptionId: id,
        packptsSpent: result.redemption?.packptsSpent,
        usdValue: result.redemption?.usdValue,
      });

      res.json({
        success: true,
        redemption: result.redemption,
        creditToken: result.creditToken,
      });
    } catch (error) {
      console.error("Error approving redemption:", error);
      res.status(500).json({ error: "Failed to approve redemption" });
    }
  });

  // POST /api/admin/redemptions/:id/reject - Reject a pending redemption
  app.post("/api/admin/redemptions/:id/reject", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Rejection reason required" });
      }

      const result = await redemptionService.rejectRedemption(id, adminUserId, reason);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      await adminService.logAction(adminUserId, "reject_redemption", result.redemption?.userId, {
        redemptionId: id,
        packptsSpent: result.redemption?.packptsSpent,
        usdValue: result.redemption?.usdValue,
        reason,
      });

      res.json({
        success: true,
        redemption: result.redemption,
      });
    } catch (error) {
      console.error("Error rejecting redemption:", error);
      res.status(500).json({ error: "Failed to reject redemption" });
    }
  });

  // POST /api/admin/redemptions/:id/reverse - Reverse a completed redemption (fraud)
  app.post("/api/admin/redemptions/:id/reverse", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Reversal reason required" });
      }

      const result = await redemptionService.reverseRedemption(id, adminUserId, reason);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      await adminService.logAction(adminUserId, "reverse_redemption_fraud", result.redemption?.userId, {
        redemptionId: id,
        packptsSpent: result.redemption?.packptsSpent,
        usdValue: result.redemption?.usdValue,
        reason,
      });

      res.json({
        success: true,
        redemption: result.redemption,
        message: "Redemption reversed and PackPTS refunded to user",
      });
    } catch (error) {
      console.error("Error reversing redemption:", error);
      res.status(500).json({ error: "Failed to reverse redemption" });
    }
  });

  // Admin Tier Management Routes

  // GET /api/admin/redemption-tiers - Get all tiers (including inactive)
  app.get("/api/admin/redemption-tiers", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const tiers = await redemptionService.getAllTiers();
      res.json({ tiers });
    } catch (error) {
      console.error("Error fetching tiers:", error);
      res.status(500).json({ error: "Failed to fetch tiers" });
    }
  });

  // POST /api/admin/redemption-tiers - Create a new tier
  app.post("/api/admin/redemption-tiers", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { name, packptsRequired, usdCapCents, effectiveRatePct, description, sortOrder, isActive } = req.body;

      if (!name || !packptsRequired || !usdCapCents || !description) {
        return res.status(400).json({ error: "Missing required fields: name, packptsRequired, usdCapCents, description" });
      }

      if (packptsRequired < 100) {
        return res.status(400).json({ error: "packptsRequired must be at least 100" });
      }

      if (usdCapCents < 100) {
        return res.status(400).json({ error: "usdCapCents must be at least 100 (minimum $1)" });
      }

      const ratePct = effectiveRatePct ?? 100;
      if (ratePct < 0 || ratePct > 100) {
        return res.status(400).json({ error: "effectiveRatePct must be between 0 and 100" });
      }

      const tier = await redemptionService.createTier({
        name,
        packptsRequired,
        usdCapCents,
        effectiveRatePct,
        description,
        sortOrder,
        isActive,
      });

      await adminService.logAction(adminUserId, "create_redemption_tier", null, {
        tierId: tier.id,
        name: tier.name,
        packptsRequired: tier.packptsRequired,
        usdCapCents: tier.usdCapCents,
      });

      res.json({ tier });
    } catch (error) {
      console.error("Error creating tier:", error);
      res.status(500).json({ error: "Failed to create tier" });
    }
  });

  // PATCH /api/admin/redemption-tiers/:id - Update a tier
  app.patch("/api/admin/redemption-tiers/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;
      const updates = req.body;

      const oldTier = await redemptionService.getTierById(id);
      if (!oldTier) {
        return res.status(404).json({ error: "Tier not found" });
      }

      if (updates.packptsRequired !== undefined && updates.packptsRequired < 100) {
        return res.status(400).json({ error: "packptsRequired must be at least 100" });
      }

      if (updates.usdCapCents !== undefined && updates.usdCapCents < 100) {
        return res.status(400).json({ error: "usdCapCents must be at least 100 (minimum $1)" });
      }

      if (updates.effectiveRatePct !== undefined && (updates.effectiveRatePct < 0 || updates.effectiveRatePct > 100)) {
        return res.status(400).json({ error: "effectiveRatePct must be between 0 and 100" });
      }

      const tier = await redemptionService.updateTier(id, updates);

      await adminService.logAction(adminUserId, "update_redemption_tier", null, {
        tierId: id,
        oldValues: {
          name: oldTier.name,
          packptsRequired: oldTier.packptsRequired,
          usdCapCents: oldTier.usdCapCents,
          effectiveRatePct: oldTier.effectiveRatePct,
        },
        newValues: updates,
      });

      res.json({ tier });
    } catch (error) {
      console.error("Error updating tier:", error);
      res.status(500).json({ error: "Failed to update tier" });
    }
  });

  // DELETE /api/admin/redemption-tiers/:id - Delete a tier
  app.delete("/api/admin/redemption-tiers/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;

      const tier = await redemptionService.getTierById(id);
      if (!tier) {
        return res.status(404).json({ error: "Tier not found" });
      }

      await redemptionService.deleteTier(id);

      await adminService.logAction(adminUserId, "delete_redemption_tier", null, {
        tierId: id,
        tierName: tier.name,
        packptsRequired: tier.packptsRequired,
      });

      res.json({ success: true, message: "Tier deleted" });
    } catch (error) {
      console.error("Error deleting tier:", error);
      res.status(500).json({ error: "Failed to delete tier" });
    }
  });

  // POST /api/admin/redemption-tiers/seed - Seed default tiers
  app.post("/api/admin/redemption-tiers/seed", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await redemptionService.seedDefaultTiers();

      await adminService.logAction(adminUserId, "seed_redemption_tiers", null, {});

      const tiers = await redemptionService.getAllTiers();
      res.json({ success: true, tiers, message: "Default tiers seeded" });
    } catch (error) {
      console.error("Error seeding tiers:", error);
      res.status(500).json({ error: "Failed to seed tiers" });
    }
  });

  // ============================================
  // STREAK SYSTEM ENDPOINTS
  // ============================================

  // GET /api/streak - Get current user's streak info
  app.get("/api/streak", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const streakInfo = await streakService.getStreakInfo(userId);
      res.json(streakInfo);
    } catch (error) {
      console.error("Error fetching streak info:", error);
      res.status(500).json({ error: "Failed to fetch streak info" });
    }
  });

  // GET /api/streak/config - Get active streak reward config (public)
  app.get("/api/streak/config", async (_req, res) => {
    try {
      const config = await streakService.getActiveConfig();
      if (!config) {
        res.json({
          schedule: DEFAULT_STREAK_SCHEDULE,
          milestones: DEFAULT_MILESTONE_BONUSES,
          dailyCap: MAX_DAILY_STREAK_REWARD,
        });
      } else {
        res.json({
          schedule: config.jsonSchedule,
          milestones: config.milestoneBonuses,
          dailyCap: config.dailyCap,
        });
      }
    } catch (error) {
      console.error("Error fetching streak config:", error);
      res.status(500).json({ error: "Failed to fetch streak config" });
    }
  });

  // ============================================
  // ADMIN STREAK ENDPOINTS
  // ============================================

  // GET /api/admin/streak/stats - Get streak statistics
  app.get("/api/admin/streak/stats", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const stats = await streakService.getStreakStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching streak stats:", error);
      res.status(500).json({ error: "Failed to fetch streak stats" });
    }
  });

  // GET /api/admin/streak/configs - Get all streak configs
  app.get("/api/admin/streak/configs", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const configs = await streakService.getAllConfigs();
      res.json({ configs });
    } catch (error) {
      console.error("Error fetching streak configs:", error);
      res.status(500).json({ error: "Failed to fetch streak configs" });
    }
  });

  // POST /api/admin/streak/configs - Create a new streak config
  app.post("/api/admin/streak/configs", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { jsonSchedule, milestoneBonuses, dailyCap, effectiveFrom, effectiveUntil } = req.body;

      if (!jsonSchedule || !milestoneBonuses) {
        return res.status(400).json({ error: "jsonSchedule and milestoneBonuses are required" });
      }

      const config = await streakService.createConfig(
        jsonSchedule,
        milestoneBonuses,
        dailyCap || MAX_DAILY_STREAK_REWARD,
        effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveUntil ? new Date(effectiveUntil) : null
      );

      await adminService.logAction(adminUserId, "create_streak_config", null, {
        configId: config.id,
        dailyCap: config.dailyCap,
      });

      res.json({ config });
    } catch (error) {
      console.error("Error creating streak config:", error);
      res.status(500).json({ error: "Failed to create streak config" });
    }
  });

  // PATCH /api/admin/streak/configs/:id - Update a streak config
  app.patch("/api/admin/streak/configs/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;
      const updates = req.body;

      const config = await streakService.updateConfig(id, updates);

      await adminService.logAction(adminUserId, "update_streak_config", null, {
        configId: id,
        updates,
      });

      res.json({ config });
    } catch (error) {
      console.error("Error updating streak config:", error);
      res.status(500).json({ error: "Failed to update streak config" });
    }
  });

  // DELETE /api/admin/streak/configs/:id - Delete a streak config
  app.delete("/api/admin/streak/configs/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { id } = req.params;

      await streakService.deleteConfig(id);

      await adminService.logAction(adminUserId, "delete_streak_config", null, { configId: id });

      res.json({ success: true, message: "Streak config deleted" });
    } catch (error) {
      console.error("Error deleting streak config:", error);
      res.status(500).json({ error: "Failed to delete streak config" });
    }
  });

  // POST /api/admin/streak/configs/seed - Seed default streak config
  app.post("/api/admin/streak/configs/seed", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;

      const config = await streakService.createConfig(
        DEFAULT_STREAK_SCHEDULE,
        DEFAULT_MILESTONE_BONUSES,
        MAX_DAILY_STREAK_REWARD
      );

      await adminService.logAction(adminUserId, "seed_streak_config", null, { configId: config.id });

      res.json({ success: true, config, message: "Default streak config created" });
    } catch (error) {
      console.error("Error seeding streak config:", error);
      res.status(500).json({ error: "Failed to seed streak config" });
    }
  });

  // GET /api/admin/users/:userId/streak - Get user's streak state
  app.get("/api/admin/users/:userId/streak", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const streakInfo = await streakService.getStreakInfo(userId);
      res.json(streakInfo);
    } catch (error) {
      console.error("Error fetching user streak:", error);
      res.status(500).json({ error: "Failed to fetch user streak" });
    }
  });

  // POST /api/admin/users/:userId/streak/freeze - Grant streak freezes
  app.post("/api/admin/users/:userId/streak/freeze", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { count } = req.body;

      const freezeCount = parseInt(count) || 1;
      if (freezeCount < 1 || freezeCount > 10) {
        return res.status(400).json({ error: "Count must be between 1 and 10" });
      }

      const state = await streakService.grantStreakFreeze(userId, freezeCount);

      await adminService.logAction(adminUserId, "grant_streak_freeze", userId, {
        freezeCount,
        newTotal: state.freezesAvailable,
      });

      res.json({ success: true, state });
    } catch (error) {
      console.error("Error granting streak freeze:", error);
      res.status(500).json({ error: "Failed to grant streak freeze" });
    }
  });

  // POST /api/admin/users/:userId/streak/adjust - Adjust user's streak
  app.post("/api/admin/users/:userId/streak/adjust", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      const { newCurrentDays, reason } = req.body;

      if (typeof newCurrentDays !== "number" || newCurrentDays < 0) {
        return res.status(400).json({ error: "newCurrentDays must be a non-negative number" });
      }

      const state = await streakService.adjustStreak(userId, newCurrentDays, adminUserId);

      await adminService.logAction(adminUserId, "adjust_streak", userId, {
        newCurrentDays,
        reason,
        previousDays: state.currentDays,
      });

      res.json({ success: true, state });
    } catch (error) {
      console.error("Error adjusting streak:", error);
      res.status(500).json({ error: "Failed to adjust streak" });
    }
  });

  // ==================== FOUNDERS CAP / ACCESS CONTROL ====================
  
  // GET /api/access/summary - Public endpoint for remaining seats display
  app.get("/api/access/summary", async (_req, res) => {
    try {
      const summary = await accessService.getAccessSummary();
      res.json({
        enabled: summary.enabled,
        remainingSeats: summary.remainingSeats,
        maxSeats: summary.maxActiveUsers,
        waitlistSize: summary.waitlistSize,
      });
    } catch (error) {
      console.error("Error getting access summary:", error);
      res.status(500).json({ error: "Failed to get access summary" });
    }
  });

  // GET /api/access/cap - Public endpoint for cap status (frontend-facing)
  app.get("/api/access/cap", async (_req, res) => {
    try {
      const summary = await accessService.getAccessSummary();
      res.json({
        maxActive: summary.maxActiveUsers,
        currentActive: summary.activeCount,
        reservedSeats: summary.reservedSeatsTotal,
        reservedUsed: summary.reservedSeatsUsed,
        availableSeats: summary.remainingSeats,
        enabled: summary.enabled,
      });
    } catch (error) {
      console.error("Error getting cap status:", error);
      res.status(500).json({ error: "Failed to get cap status" });
    }
  });

  // POST /api/access/validate-invite - Validate an invite code
  app.post("/api/access/validate-invite", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Code is required" });
      }
      
      const result = await accessService.validateInviteCode(code);
      
      if (!result.valid) {
        await accessService.logAccessAudit("INVITE_INVALID", {
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] as string,
          metadata: { code, reason: result.reason },
        });
        return res.status(400).json({ valid: false, reason: result.reason });
      }
      
      await accessService.logAccessAudit("INVITE_VALIDATED", {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string,
        metadata: { code },
      });
      
      res.json({ 
        valid: true, 
        reservedSeat: result.invite?.reservedSeat,
        usesRemaining: result.invite ? result.invite.maxUses - result.invite.uses : 0,
      });
    } catch (error) {
      console.error("Error validating invite:", error);
      res.status(500).json({ error: "Failed to validate invite" });
    }
  });

  // POST /api/access/consume-invite - Consume an invite code and store in session
  app.post("/api/access/consume-invite", async (req: any, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Code is required" });
      }
      
      const result = await accessService.validateInviteCode(code);
      
      if (!result.valid) {
        return res.status(400).json({ valid: false, reason: result.reason });
      }
      
      // If user is authenticated, try to activate them directly
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        const activationResult = await accessService.tryActivateUser(userId, {
          inviteCode: code.toUpperCase(),
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] as string,
        });
        
        await accessService.logAccessAudit("INVITE_CONSUMED", {
          userId,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] as string,
          metadata: { code, activated: activationResult.activated },
        });
        
        return res.json({ 
          success: true, 
          activated: activationResult.activated,
          message: activationResult.activated ? "Account activated!" : "Failed to activate",
        });
      }
      
      // Store the approved invite code in session for later use
      req.session.inviteApprovedCode = code.toUpperCase();
      
      await accessService.logAccessAudit("INVITE_CONSUMED", {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string,
        metadata: { code },
      });
      
      res.json({ 
        success: true, 
        sessionStored: true,
        message: "Invite code accepted - complete signup to activate",
      });
    } catch (error) {
      console.error("Error consuming invite:", error);
      res.status(500).json({ error: "Failed to consume invite" });
    }
  });

  // POST /api/waitlist/join - Join the waitlist
  app.post("/api/waitlist/join", async (req: any, res) => {
    try {
      const { email, name, referredByCode, referralSource, deviceFingerprint, inviteCode } = req.body;
      
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "Valid email is required" });
      }
      
      // If invite code provided, try to activate immediately
      if (inviteCode) {
        const validation = await accessService.validateInviteCode(inviteCode);
        if (validation.valid) {
          // Store invite for use in registration
          req.session.inviteApprovedCode = inviteCode;
          return res.json({
            success: true,
            activated: true,
            message: "Invite code valid - complete signup to activate",
          });
        }
      }
      
      const result = await accessService.joinWaitlist(email, {
        name,
        referredByCode: referredByCode || referralSource,
        deviceFingerprint,
        ipAddress: req.ip,
      });
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({
        success: true,
        activated: false,
        position: result.position,
        referralCode: result.referralCode,
      });
    } catch (error) {
      console.error("Error joining waitlist:", error);
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  });

  // GET /api/waitlist/status - Get waitlist status for authenticated user or by email
  app.get("/api/waitlist/status", async (req: any, res) => {
    try {
      let email = req.query.email as string | undefined;
      
      // If no email provided, try to get from authenticated user
      if (!email) {
        const userId = req.user?.claims?.sub || req.session?.localUserId;
        if (userId) {
          const user = await storage.getUser(userId);
          if (user?.email) {
            email = user.email;
          }
        }
      }
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      
      const status = await accessService.getWaitlistStatus(email);
      res.json(status);
    } catch (error) {
      console.error("Error getting waitlist status:", error);
      res.status(500).json({ error: "Failed to get waitlist status" });
    }
  });

  // ==================== FOUNDERS PASS (Viral Invite System) ====================

  // GET /p/:token - Public pass link redirect
  app.get("/p/:token", async (req: any, res) => {
    try {
      const { token } = req.params;
      const tokenHash = foundersPassService.hashToken(token);
      
      const validation = await foundersPassService.validatePassToken(tokenHash);
      
      if (!validation.valid) {
        await foundersPassService.recordLinkViewed(
          tokenHash,
          req.ip,
          req.headers["user-agent"] as string
        );
        return res.redirect(`/waitlist?error=${encodeURIComponent(validation.reason || "Pass is invalid")}`);
      }
      
      await foundersPassService.recordLinkViewed(
        tokenHash,
        req.ip,
        req.headers["user-agent"] as string
      );
      
      req.session.foundersPassTokenHash = tokenHash;
      res.redirect("/redeem");
    } catch (error) {
      console.error("Error processing pass link:", error);
      res.redirect("/waitlist?error=An+error+occurred");
    }
  });

  // POST /api/founders-pass/redeem - Approve pass for signup flow
  app.post("/api/founders-pass/redeem", async (req: any, res) => {
    try {
      const tokenHash = req.session?.foundersPassTokenHash;
      if (!tokenHash) {
        return res.status(400).json({ ok: false, error: "No pass token in session" });
      }
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        const user = await storage.getUser(userId);
        if (user && user.status === "ACTIVE") {
          return res.status(400).json({ ok: false, error: "Already an active founder" });
        }
      }
      
      const validation = await foundersPassService.validatePassToken(tokenHash);
      if (!validation.valid) {
        delete req.session.foundersPassTokenHash;
        return res.status(400).json({ ok: false, error: validation.reason });
      }
      
      req.session.foundersPassApproved = true;
      res.json({ ok: true });
    } catch (error) {
      console.error("Error redeeming pass:", error);
      res.status(500).json({ ok: false, error: "Failed to redeem pass" });
    }
  });

  // GET /api/founders-pass/status - Get session pass status
  app.get("/api/founders-pass/status", async (req: any, res) => {
    try {
      const tokenHash = req.session?.foundersPassTokenHash;
      const approved = req.session?.foundersPassApproved === true;
      
      if (!tokenHash) {
        return res.json({ hasPass: false, approved: false });
      }
      
      const validation = await foundersPassService.validatePassToken(tokenHash);
      res.json({
        hasPass: true,
        valid: validation.valid,
        approved,
        reason: validation.reason,
      });
    } catch (error) {
      console.error("Error getting pass status:", error);
      res.status(500).json({ error: "Failed to get pass status" });
    }
  });

  // GET /api/founders-pass/mine - Get authenticated user's pass (if they have one)
  app.get("/api/founders-pass/mine", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.status !== "ACTIVE") {
        return res.json({ hasPass: false, reason: "Not an active founder" });
      }
      
      const gateClosed = await foundersPassService.isFoundersGateClosed();
      if (gateClosed) {
        return res.json({ hasPass: false, reason: "Founders gate is closed" });
      }
      
      const pass = await foundersPassService.getActivePassForUser(userId);
      if (pass) {
        return res.json({
          hasPass: true,
          passId: pass.id,
          createdAt: pass.createdAt,
        });
      }
      
      const newPass = await foundersPassService.issuePassToUser(userId);
      if (newPass) {
        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
        return res.json({
          hasPass: true,
          passId: newPass.id,
          shareUrl: `${baseUrl}/p/${newPass.rawToken}`,
          createdAt: newPass.createdAt,
          isNew: true,
        });
      }
      
      res.json({ hasPass: false, reason: "Could not issue pass" });
    } catch (error) {
      console.error("Error getting user pass:", error);
      res.status(500).json({ error: "Failed to get pass" });
    }
  });

  // POST /api/founders-pass/issue - Issue a new pass to authenticated user (force re-issue)
  app.post("/api/founders-pass/issue", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.status !== "ACTIVE") {
        return res.status(403).json({ error: "Only active founders can receive passes" });
      }
      
      const gateClosed = await foundersPassService.isFoundersGateClosed();
      if (gateClosed) {
        return res.status(400).json({ error: "Founders gate is closed" });
      }
      
      const existingPass = await foundersPassService.getActivePassForUser(userId);
      if (existingPass) {
        return res.status(400).json({ error: "You already have an active pass" });
      }
      
      const newPass = await foundersPassService.issuePassToUser(userId);
      if (!newPass) {
        return res.status(500).json({ error: "Failed to issue pass" });
      }
      
      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      res.json({
        passId: newPass.id,
        shareUrl: `${baseUrl}/p/${newPass.rawToken}`,
        createdAt: newPass.createdAt,
      });
    } catch (error) {
      console.error("Error issuing pass:", error);
      res.status(500).json({ error: "Failed to issue pass" });
    }
  });

  // Admin: Get all founders passes
  app.get("/api/admin/founders/passes", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const status = req.query.status as "ACTIVE" | "CONSUMED" | "DEACTIVATED" | "EXPIRED" | undefined;
      
      const passes = status 
        ? await foundersPassService.getPassesByStatus(status)
        : await foundersPassService.getAllPasses();
      
      res.json({ passes });
    } catch (error) {
      console.error("Error getting passes:", error);
      res.status(500).json({ error: "Failed to get passes" });
    }
  });

  // Admin: Deactivate all active passes (kill switch)
  app.post("/api/admin/founders/deactivate-all", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const count = await foundersPassService.deactivateAllPasses();
      
      await accessService.logAccessAudit("ABUSE_BLOCKED", {
        userId: adminUserId,
        metadata: { action: "deactivate_all_passes", count },
      });
      
      res.json({ success: true, deactivatedCount: count });
    } catch (error) {
      console.error("Error deactivating passes:", error);
      res.status(500).json({ error: "Failed to deactivate passes" });
    }
  });

  // Admin: Deactivate a specific pass
  app.post("/api/admin/founders/deactivate/:passId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { passId } = req.params;
      const { reason } = req.body;
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      
      const success = await foundersPassService.deactivatePass(passId, reason);
      
      if (success) {
        await accessService.logAccessAudit("ABUSE_BLOCKED", {
          userId: adminUserId,
          metadata: { action: "deactivate_pass", passId, reason },
        });
      }
      
      res.json({ success });
    } catch (error) {
      console.error("Error deactivating pass:", error);
      res.status(500).json({ error: "Failed to deactivate pass" });
    }
  });

  // Admin: Get full access summary
  app.get("/api/admin/access/summary", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const summary = await accessService.getAccessSummary();
      
      // Get additional stats
      const inviteStats = await accessService.getInviteCodes({ includeExpired: false, limit: 1000, offset: 0 });
      const waitlistStats = await accessService.getWaitlistEntries({ status: "WAITING", limit: 1, offset: 0 });
      
      res.json({
        cap: {
          maxActive: summary.maxActiveUsers,
          currentActive: summary.activeCount,
          reservedSeats: summary.reservedSeatsTotal,
          reservedUsed: summary.reservedSeatsUsed,
          availableSeats: summary.remainingSeats,
          enabled: summary.enabled,
        },
        stats: {
          activeInvites: inviteStats.codes.length,
          totalInvitesUsed: inviteStats.codes.reduce((acc, inv) => acc + (inv.uses || 0), 0),
          pendingWaitlist: summary.waitlistSize,
        },
      });
    } catch (error) {
      console.error("Error getting admin access summary:", error);
      res.status(500).json({ error: "Failed to get access summary" });
    }
  });

  // Admin: Update founders cap config
  app.post("/api/admin/access/cap", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      // Accept both naming conventions from frontend
      const { 
        maxActiveUsers, maxActive, 
        enabled, inviteBypass, 
        reservedSeatsForInvites, reservedSeats 
      } = req.body;
      
      const updates: Record<string, any> = {};
      const maxActiveValue = maxActiveUsers ?? maxActive;
      const reservedValue = reservedSeatsForInvites ?? reservedSeats;
      
      if (typeof maxActiveValue === "number") updates.maxActiveUsers = maxActiveValue;
      if (typeof enabled === "boolean") updates.enabled = enabled;
      if (typeof inviteBypass === "boolean") updates.inviteBypass = inviteBypass;
      if (typeof reservedValue === "number") updates.reservedSeatsForInvites = reservedValue;
      
      const newConfig = await accessService.updateFoundersCapConfig(updates, adminUserId);
      
      await accessService.logAccessAudit("ADMIN_CAP_CHANGE", {
        userId: adminUserId,
        metadata: { updates, newConfig },
      });
      
      res.json({ success: true, config: newConfig });
    } catch (error) {
      console.error("Error updating cap config:", error);
      res.status(500).json({ error: "Failed to update cap config" });
    }
  });

  // Admin: Create invite codes
  app.post("/api/admin/invites/create", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { count, maxUses, expiresAt, reservedSeat, note } = req.body;
      
      const inviteCount = Math.min(parseInt(count) || 1, 100);
      
      const codes = await accessService.createInviteCodes(inviteCount, {
        maxUses: parseInt(maxUses) || 1,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        reservedSeat: reservedSeat !== false,
        createdByAdminUserId: adminUserId,
        note,
      });
      
      // Return both array and single invite for convenience
      res.json({ 
        success: true, 
        codes, 
        invite: codes.length > 0 ? codes[0] : null,
      });
    } catch (error) {
      console.error("Error creating invite codes:", error);
      res.status(500).json({ error: "Failed to create invite codes" });
    }
  });

  // Admin: Get invite codes
  app.get("/api/admin/invites", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const includeExpired = req.query.includeExpired === "true";
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const result = await accessService.getInviteCodes({ includeExpired, limit, offset });
      res.json(result);
    } catch (error) {
      console.error("Error getting invite codes:", error);
      res.status(500).json({ error: "Failed to get invite codes" });
    }
  });

  // Admin: Get waitlist entries
  app.get("/api/admin/waitlist", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const result = await accessService.getWaitlistEntries({ 
        status: status as any, 
        limit, 
        offset 
      });
      res.json(result);
    } catch (error) {
      console.error("Error getting waitlist entries:", error);
      res.status(500).json({ error: "Failed to get waitlist entries" });
    }
  });

  // Admin: Invite waitlist entry (send them an invite code)
  app.post("/api/admin/waitlist/:waitlistId/invite", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { waitlistId } = req.params;
      
      const result = await accessService.inviteWaitlistEntry(waitlistId, adminUserId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      // Optionally send email here using emailService
      // For now, just return the invite code
      res.json({ success: true, inviteCode: result.inviteCode });
    } catch (error) {
      console.error("Error inviting waitlist entry:", error);
      res.status(500).json({ error: "Failed to invite waitlist entry" });
    }
  });

  // Admin: Approve a waitlisted user to active
  app.post("/api/admin/users/:userId/approve", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      const { userId } = req.params;
      
      const result = await accessService.approveWaitlistedUser(userId, adminUserId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error approving user:", error);
      res.status(500).json({ error: "Failed to approve user" });
    }
  });

  // ==================== LIVE LISTINGS MARKETPLACE ====================

  // Simple in-memory rate limiter for marketplace search (20 requests per minute per IP)
  const marketplaceRateLimiter = new Map<string, { count: number; resetAt: number }>();
  const MARKETPLACE_RATE_LIMIT = 20;
  const MARKETPLACE_RATE_WINDOW_MS = 60 * 1000;
  
  const checkMarketplaceRateLimit = (req: any): boolean => {
    const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    const existing = marketplaceRateLimiter.get(key);
    
    if (!existing || now >= existing.resetAt) {
      marketplaceRateLimiter.set(key, { count: 1, resetAt: now + MARKETPLACE_RATE_WINDOW_MS });
      return true;
    }
    
    if (existing.count >= MARKETPLACE_RATE_LIMIT) {
      return false;
    }
    
    existing.count++;
    return true;
  };

  // Clean up old rate limit entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of marketplaceRateLimiter.entries()) {
      if (now >= value.resetAt) {
        marketplaceRateLimiter.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  
  // GET /api/marketplace/search - Search live listings from eBay and Goldin
  app.get("/api/marketplace/search", async (req: any, res) => {
    if (!checkMarketplaceRateLimit(req)) {
      return res.status(429).json({ error: "Too many requests. Please wait a minute before searching again." });
    }
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length === 0) {
        return res.status(400).json({ error: "Search query required" });
      }
      if (q.length > 200) {
        return res.status(400).json({ error: "Search query too long" });
      }

      const source = (req.query.source as string) || "all";
      if (!["all", "ebay", "goldin"].includes(source)) {
        return res.status(400).json({ error: "Invalid source" });
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const sort = (req.query.sort as string) || "relevance";
      if (!["relevance", "priceAsc", "priceDesc", "endingSoon"].includes(sort)) {
        return res.status(400).json({ error: "Invalid sort" });
      }

      const result = await marketplaceService.searchMarketplace({
        q: q.trim(),
        source: source as any,
        limit,
        sort: sort as any,
      });

      const baseUrl = process.env.APP_BASE_URL || `https://${req.get("host")}`;
      const listingsWithOutboundUrls = result.listings.map((listing) => ({
        ...listing,
        outboundUrl: marketplaceService.generateListingWithOutboundUrl(listing, baseUrl),
      }));

      res.json({
        ...result,
        listings: listingsWithOutboundUrls,
      });
    } catch (error) {
      console.error("Error searching marketplace:", error);
      res.status(500).json({ error: "Failed to search marketplace" });
    }
  });

  // GET /out/ebay/:listingId - Tracked outbound redirect for eBay
  app.get("/out/ebay/:listingId", async (req: any, res) => {
    try {
      const { listingId } = req.params;
      const token = req.query.token as string;

      if (!token) {
        return res.status(400).json({ error: "Invalid redirect token" });
      }

      const payload = marketplaceService.validateOutboundToken(token);
      if (!payload || payload.source !== "ebay" || payload.listingId !== listingId) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }

      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const sessionId = req.sessionID || null;
      const ip = req.ip || req.headers["x-forwarded-for"] || null;
      const userAgent = req.headers["user-agent"] || null;

      await marketplaceService.logOutboundClick(
        "ebay",
        listingId,
        payload.destinationUrl,
        userId,
        sessionId,
        ip,
        userAgent
      );

      const finalUrl = marketplaceService.applyEpnTracking(payload.destinationUrl, userId);
      res.redirect(302, finalUrl);
    } catch (error) {
      console.error("Error processing eBay outbound redirect:", error);
      res.status(500).json({ error: "Redirect failed" });
    }
  });

  // GET /out/goldin/:listingId - Tracked outbound redirect for Goldin
  app.get("/out/goldin/:listingId", async (req: any, res) => {
    try {
      const { listingId } = req.params;
      const token = req.query.token as string;

      if (!token) {
        return res.status(400).json({ error: "Invalid redirect token" });
      }

      const payload = marketplaceService.validateOutboundToken(token);
      if (!payload || payload.source !== "goldin" || payload.listingId !== listingId) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }

      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const sessionId = req.sessionID || null;
      const ip = req.ip || req.headers["x-forwarded-for"] || null;
      const userAgent = req.headers["user-agent"] || null;

      await marketplaceService.logOutboundClick(
        "goldin",
        listingId,
        payload.destinationUrl,
        userId,
        sessionId,
        ip,
        userAgent
      );

      res.redirect(302, payload.destinationUrl);
    } catch (error) {
      console.error("Error processing Goldin outbound redirect:", error);
      res.status(500).json({ error: "Redirect failed" });
    }
  });

  // GET /api/game/sets - Get all active game sets
  app.get("/api/game/sets", async (req, res) => {
    try {
      const { getActiveGameSets } = await import("./services/marketplace/context");
      const sets = await getActiveGameSets();
      res.json(sets);
    } catch (error) {
      console.error("Error getting game sets:", error);
      res.status(500).json({ error: "Failed to get game sets" });
    }
  });

  // GET /api/marketplace/contexts - Get user's active contexts
  app.get("/api/marketplace/contexts", async (req: any, res) => {
    try {
      const { getUserActiveContexts, getActiveGameSets } = await import("./services/marketplace/context");
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const contexts = await getUserActiveContexts(userId);
      const allSets = await getActiveGameSets();
      
      res.json({
        activeContexts: contexts,
        allSets,
        userId: userId || null,
      });
    } catch (error) {
      console.error("Error getting marketplace contexts:", error);
      res.status(500).json({ error: "Failed to get contexts" });
    }
  });

  // POST /api/game/active-sets - Update user's active game sets
  app.post("/api/game/active-sets", isAuthenticated, async (req: any, res) => {
    try {
      const { updateUserActiveSets } = await import("./services/marketplace/context");
      const { updateActiveGameSetsSchema } = await import("@shared/schema");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = updateActiveGameSetsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      await updateUserActiveSets(userId, parsed.data.gameSetIds, parsed.data.defaultSetId);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating active sets:", error);
      res.status(500).json({ error: "Failed to update active sets" });
    }
  });

  // GET /api/marketplace/contextual-search - Context-aware marketplace search
  app.get("/api/marketplace/contextual-search", async (req: any, res) => {
    if (!checkMarketplaceRateLimit(req)) {
      return res.status(429).json({ error: "Too many requests. Please wait a minute before searching again." });
    }
    
    try {
      const {
        getUserActiveContexts,
        getGameSetById,
        buildMarketplaceQuery,
        getBroadeningQuery,
        getContextTags,
        gameSetToContext,
      } = await import("./services/marketplace/context");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const q = (req.query.q as string)?.trim() || "";
      const source = (req.query.source as string) || "all";
      const setId = req.query.setId as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const sort = (req.query.sort as string) || "relevance";
      const forceRefresh = req.query.forceRefresh === "true";

      if (!["all", "ebay", "goldin"].includes(source)) {
        return res.status(400).json({ error: "Invalid source" });
      }
      if (!["relevance", "priceAsc", "priceDesc", "endingSoon"].includes(sort)) {
        return res.status(400).json({ error: "Invalid sort" });
      }

      let contexts;
      
      if (setId) {
        const gameSet = await getGameSetById(setId);
        if (!gameSet || !gameSet.isActive) {
          return res.status(404).json({ error: "Game set not found or inactive" });
        }
        contexts = [gameSetToContext(gameSet)];
      } else {
        contexts = await getUserActiveContexts(userId);
      }

      if (contexts.length === 0) {
        return res.json({
          contexts: [],
          appliedContextIds: [],
          noteIfBroadened: null,
        });
      }

      const baseUrl = process.env.APP_BASE_URL || `https://${req.get("host")}`;
      const MIN_RESULTS = 5;
      const results = [];

      for (const context of contexts) {
        const marketplaceQuery = buildMarketplaceQuery(context.gameSet, q);
        
        let searchResult = await marketplaceService.searchMarketplace({
          q: marketplaceQuery,
          source: source as any,
          limit,
          sort: sort as any,
        });

        let broadened = false;
        if (searchResult.listings.length < MIN_RESULTS && q) {
          const broaderQuery = getBroadeningQuery(context.gameSet);
          searchResult = await marketplaceService.searchMarketplace({
            q: broaderQuery,
            source: source as any,
            limit,
            sort: sort as any,
          });
          broadened = true;
        }

        const listingsWithOutboundUrls = searchResult.listings.map((listing) => ({
          ...listing,
          outboundUrl: marketplaceService.generateListingWithOutboundUrl(listing, baseUrl),
        }));

        results.push({
          gameSet: context.gameSet,
          contextKey: context.contextKey,
          listings: listingsWithOutboundUrls,
          lastUpdated: searchResult.lastUpdated,
          cached: searchResult.cached,
          broadened,
          query: marketplaceQuery,
        });
      }

      res.json({
        contexts: results,
        appliedContextIds: contexts.map((c) => c.gameSet.id),
        noteIfBroadened: results.some((r) => r.broadened) 
          ? "Some results were broadened to show more items within the same vintage."
          : null,
      });
    } catch (error) {
      console.error("Error in contextual search:", error);
      res.status(500).json({ error: "Failed to search marketplace" });
    }
  });

  // Admin: Get all game sets
  app.get("/api/admin/game-sets", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const sets = await db.select().from(gameSets).orderBy(gameSets.year);
      res.json(sets);
    } catch (error) {
      console.error("Error getting game sets:", error);
      res.status(500).json({ error: "Failed to get game sets" });
    }
  });

  // Admin: Create game set
  app.post("/api/admin/game-sets", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const parsed = insertGameSetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const [gameSet] = await db.insert(gameSets).values(parsed.data).returning();
      res.status(201).json(gameSet);
    } catch (error) {
      console.error("Error creating game set:", error);
      res.status(500).json({ error: "Failed to create game set" });
    }
  });

  // Admin: Update game set
  app.put("/api/admin/game-sets/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const parsed = updateGameSetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const updateData: Record<string, any> = {};
      if (parsed.data.setName !== undefined) updateData.setName = parsed.data.setName;
      if (parsed.data.sport !== undefined) updateData.sport = parsed.data.sport;
      if (parsed.data.year !== undefined) updateData.year = parsed.data.year;
      if (parsed.data.brand !== undefined) updateData.brand = parsed.data.brand;
      if (parsed.data.marketplaceKeywords !== undefined) updateData.marketplaceKeywords = parsed.data.marketplaceKeywords;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      
      const [updated] = await db
        .update(gameSets)
        .set(updateData)
        .where(eq(gameSets.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating game set:", error);
      res.status(500).json({ error: "Failed to update game set" });
    }
  });

  // Admin: Delete game set
  app.delete("/api/admin/game-sets/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const [deleted] = await db
        .update(gameSets)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(gameSets.id, id))
        .returning();
      
      if (!deleted) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting game set:", error);
      res.status(500).json({ error: "Failed to delete game set" });
    }
  });

  // Admin: Create/Update Goldin curated listing
  app.post("/api/admin/goldin/listings", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id, title, description, imageUrl, destinationUrl, endsAt, priceDisplay, tags, isActive } = req.body;

      if (!title || !destinationUrl) {
        return res.status(400).json({ error: "Title and destination URL required" });
      }

      if (id) {
        const updated = await marketplaceService.updateCuratedListing(id, {
          title,
          description,
          imageUrl,
          destinationUrl,
          endsAt: endsAt ? new Date(endsAt) : null,
          priceDisplay,
          tags,
          isActive: isActive !== false,
        });
        if (!updated) {
          return res.status(404).json({ error: "Listing not found" });
        }
        return res.json(updated);
      }

      const listing = await marketplaceService.createCuratedListing({
        title,
        description,
        imageUrl,
        destinationUrl,
        endsAt: endsAt ? new Date(endsAt) : null,
        priceDisplay,
        tags,
        isActive: isActive !== false,
      });

      res.status(201).json(listing);
    } catch (error) {
      console.error("Error creating/updating Goldin listing:", error);
      res.status(500).json({ error: "Failed to save listing" });
    }
  });

  // Admin: Get all Goldin curated listings
  app.get("/api/admin/goldin/listings", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const listings = await marketplaceService.getAllCuratedListingsAdmin();
      res.json(listings);
    } catch (error) {
      console.error("Error getting Goldin listings:", error);
      res.status(500).json({ error: "Failed to get listings" });
    }
  });

  // Admin: Delete (deactivate) Goldin curated listing
  app.delete("/api/admin/goldin/listings/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await marketplaceService.deleteCuratedListing(id);
      if (!deleted) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting Goldin listing:", error);
      res.status(500).json({ error: "Failed to delete listing" });
    }
  });

  // ============================================
  // ADMIN: SUBSCRIPTION PRODUCTS MANAGEMENT
  // ============================================

  // Admin: Get all subscription products
  app.get("/api/admin/subscription-products", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const products = await db
        .select()
        .from(subscriptionProducts)
        .orderBy(subscriptionProducts.sortOrder);
      res.json(products);
    } catch (error) {
      console.error("Error getting subscription products:", error);
      res.status(500).json({ error: "Failed to get subscription products" });
    }
  });

  // Admin: Create subscription product
  app.post("/api/admin/subscription-products", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const parsed = insertSubscriptionProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const [product] = await db.insert(subscriptionProducts).values(parsed.data).returning();
      res.status(201).json(product);
    } catch (error) {
      console.error("Error creating subscription product:", error);
      res.status(500).json({ error: "Failed to create subscription product" });
    }
  });

  // Admin: Update subscription product
  app.put("/api/admin/subscription-products/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const parsed = updateSubscriptionProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
      if (parsed.data.packptsGrant !== undefined) updateData.packptsGrant = parsed.data.packptsGrant;
      if (parsed.data.priceUsd !== undefined) updateData.priceUsd = parsed.data.priceUsd;
      if (parsed.data.billingInterval !== undefined) updateData.billingInterval = parsed.data.billingInterval;
      if (parsed.data.stripePriceId !== undefined) updateData.stripePriceId = parsed.data.stripePriceId;
      if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
      if (parsed.data.isBestValue !== undefined) updateData.isBestValue = parsed.data.isBestValue;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      
      if (Object.keys(updateData).length === 1) { // only updatedAt
        return res.status(400).json({ error: "No valid fields to update" });
      }
      
      const [updated] = await db
        .update(subscriptionProducts)
        .set(updateData)
        .where(eq(subscriptionProducts.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Subscription product not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating subscription product:", error);
      res.status(500).json({ error: "Failed to update subscription product" });
    }
  });

  // Admin: Delete (deactivate) subscription product
  app.delete("/api/admin/subscription-products/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const [deleted] = await db
        .update(subscriptionProducts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(subscriptionProducts.id, id))
        .returning();
      
      if (!deleted) {
        return res.status(404).json({ error: "Subscription product not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting subscription product:", error);
      res.status(500).json({ error: "Failed to delete subscription product" });
    }
  });

  return httpServer;
}
