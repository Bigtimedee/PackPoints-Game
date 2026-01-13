import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { startGameSchema, submitAnswerSchema, createLobbySchema, joinLobbySchema, registerSchema, loginSchema, users, spendWalletSchema, earnWalletSchema, adjustWalletSchema, type User } from "@shared/schema";
import { walletService } from "./services/walletService";
import { fetchAdditionalCards, VERIFIED_1987_TOPPS_IMAGES } from "./services/priceCharting";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "./services/cardHedge";
import { stripePurchaseService, isStripeConfigured } from "./services/stripePurchaseService";
import { isAuthenticated } from "./replit_integrations/auth";
import { matchService } from "./services/matchService";
import { tokenService } from "./services/tokenService";
import { quotaService } from "./services/quotaService";
import { adminService } from "./services/adminService";
import { analyticsService } from "./services/analyticsService";
import { redemptionService } from "./services/redemptionService";
import { redeemPackptsSchema } from "@shared/schema";
import { TIER_CONFIG } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import express from "express";

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

  app.post("/api/game/start", async (req: any, res) => {
    try {
      const parsed = startGameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { mode, totalQuestions } = parsed.data;
      
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const isGuest = !userId;
      
      if (mode !== "solo" && isGuest) {
        return res.status(401).json({ error: "Authentication required for this game mode" });
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
                { sessionId: session.id, mode: session.gameMode, multiplier }
              );
              
              if (earnResult.success && !earnResult.idempotent) {
                await analyticsService.ptsEarned(session.userId, finalScore, {
                  sessionId: session.id,
                  mode: session.gameMode,
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
            mode: session.gameMode,
            score: finalScore,
            correctAnswers: session.correctAnswers,
            totalQuestions: session.totalQuestions,
            multiplier,
            tokenValidated,
          });
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
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }
      
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ error: "Email already registered" });
      }
      
      const user = await storage.createLocalUser(username, email, password);
      
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
          user: {
            id: updatedUser!.id,
            username: updatedUser!.username,
            points: updatedUser!.points,
            gamesPlayed: updatedUser!.gamesPlayed,
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
      
      req.session.localUserId = user.id;
      
      // Explicitly save session to ensure it's persisted before response
      req.session.save((err: any) => {
        if (err) {
          console.error("Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        res.json({ 
          success: true, 
          user: {
            id: user.id,
            username: user.username,
            points: user.points,
            gamesPlayed: user.gamesPlayed,
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
      
      // Since email integration is not set up, log the reset link for admin use
      const resetLink = `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : ''}/reset-password?token=${resetToken.token}`;
      console.log(`Password reset link for ${email}: ${resetLink}`);
      
      // TODO: When email integration is set up, send email here
      // For now, admins can check server logs for the reset link
      
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

  app.post("/api/lobby/create", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/lobby/join", isAuthenticated, async (req: any, res) => {
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
        tierMinPackpts: calculation.tier.minPackpts,
        tierMaxPackpts: calculation.tier.maxPackpts,
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

  return httpServer;
}
