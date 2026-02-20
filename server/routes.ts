import type { Express, Request, Response, NextFunction } from "express";
import type Stripe from "stripe";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import {
  loginLimiter,
  matchCreateLimiter,
  answerSubmitLimiter,
  checkoutLimiter,
  gameStartLimiter,
  registrationLimiter,
} from "./middleware/rateLimiter";
import { startGameSchema, submitAnswerSchema, createLobbySchema, joinLobbySchema, registerSchema, loginSchema, users, wallets, purchaseEvents, spendWalletSchema, earnWalletSchema, adjustWalletSchema, products, gameSets, insertGameSetSchema, updateGameSetSchema, subscriptionProducts, insertSubscriptionProductSchema, updateSubscriptionProductSchema, playableCards, cardhedgeImportRuns, cardDetailsCache, cardhedgeSearchCache, userRiskState, riskSignals, cardSets, catalogCards, cardSetCards, setImportJobs, setAuditLog, growthContentPlans, growthContentItems, growthJobRuns, publishingQueue, type User, type InsertGameSet, type SubscriptionProduct } from "@shared/schema";
import { walletService } from "./services/walletService";
import { applyLedgerEntry, getBalance as getLedgerBalance, reconcileBalance as reconcileLedgerBalance, getLedgerHistory } from "./services/packpts/ledgerService";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "./services/cardHedge";
import {
  CardSearchRequestSchema,
  CardSearchSortedRequestSchema,
  CardDetailsRequestSchema,
  cardSearch,
  cardSearchSorted,
  cardDetails,
  normalizeCardSearchResponse,
  fetchCardDetailsNormalized,
  normalizeImageUrl,
} from "./services/cardhedge/client";
import { stripePurchaseService, isStripeConfigured, checkStripeConfigured } from "./services/stripePurchaseService";
import { storeCheckoutService } from "./services/storeCheckoutService";
import { getStripeDiagnostics, getStripeMode, assertLiveModeForHost, getStripeConfig, isProductionHost } from "./stripeClient";
import { isAuthenticated } from "./replit_integrations/auth";
import { matchService } from "./services/matchService";
import { tokenService } from "./services/tokenService";
import { quotaService } from "./services/quotaService";
import { adminService } from "./services/adminService";
import { analyticsService } from "./services/analyticsService";
import { redemptionService } from "./services/redemptionService";
import { streakService } from "./services/streakService";
import { sendPasswordResetEmail } from "./services/emailService";
import { validateImageUrl, recordImageLoadFailure, shouldAutoFlagCard } from "./services/imageValidator";
import { bucketService } from "./services/bucketService";
import { expirationEngine } from "./services/expirationEngine";
import { identityService } from "./services/identityService";
import * as accessService from "./services/accessService";
import * as foundersPassService from "./services/foundersPassService";
import { redeemPackptsSchema, DEFAULT_STREAK_SCHEDULE, DEFAULT_MILESTONE_BONUSES, MAX_DAILY_STREAK_REWARD, daily5AnswerSchema, daily5FinishSchema } from "@shared/schema";
import { daily5Service } from "./services/daily5Service";
import { TIER_CONFIG } from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, and, or, gte, inArray, isNull, isNotNull, ne, like, lt } from "drizzle-orm";
import express from "express";
import { z } from "zod";
import * as marketplaceService from "./services/marketplace";
import * as contextService from "./services/marketplace/context";
import { collectGeo } from "./middleware/geoMiddleware";
import { geoService } from "./services/geoService";
import * as rewardEngine from "./services/rewardEngine";
import { awardDailyBaseForCorrectCard, getDailyProgress } from "./services/rewards/dailyGameplayBase";
import { getDailyProgress as getMatchDailyProgress } from "./services/progress/dailyProgress";
import friendsRouter from "./routes/friends";
import cardhedgeRouter from "./routes/cardhedge.routes";
import * as matchEngine from "./services/matches/engine";
import { retryFailedWebhookEvents } from "./services/webhookRetryWorker";
import { reconcileAllWallets } from "./services/walletReconciliation";
import { isPanicEnabled, setPanicSwitch, getPanicStatus } from "./services/panicService";
import { isStripeConfiguredSync } from "./stripeClient";

// Middleware to require admin role
const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as any;
  const session = req.session as any;
  
  // Get user ID from either Replit Auth or local session
  const userId = user?.claims?.sub || session?.localUserId;
  
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const dbUser = await storage.getUser(userId);
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
  
  // Friends and match invite routes
  app.use(friendsRouter);
  
  // CardHedge API routes (server-side only, never expose API key to client)
  app.use("/api/cardhedge", cardhedgeRouter);
  
  // Health check endpoint for monitoring (no auth required)
  app.get("/api/health", async (req, res) => {
    let topStatus: "ok" | "degraded" = "ok";
    const checks: Record<string, any> = {};

    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
    } catch (err) {
      topStatus = "degraded";
      checks.database = { status: "error", message: (err as Error).message, latencyMs: Date.now() - dbStart };
    }

    try {
      checks.stripe = {
        status: "ok",
        mode: getStripeMode(),
        configured: isStripeConfiguredSync(),
      };
    } catch (err) {
      topStatus = "degraded";
      checks.stripe = { status: "error", message: (err as Error).message };
    }

    try {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(playableCards)
        .where(eq(playableCards.isPlayable, true));
      checks.playableCards = { status: "ok", count: Number(row?.count ?? 0) };
    } catch (err) {
      topStatus = "degraded";
      checks.playableCards = { status: "error", message: (err as Error).message };
    }

    res.json({
      status: topStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks,
    });
  });

  // Keep legacy /health for backwards compat
  app.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime(), database: "connected" });
    } catch {
      res.status(503).json({ status: "error", timestamp: new Date().toISOString(), database: "disconnected" });
    }
  });

  // ============================================
  // ADMIN PANIC SWITCH ENDPOINTS
  // ============================================

  app.get("/api/admin/panic/status", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const status = await getPanicStatus();
      res.json(status);
    } catch (err) {
      console.error("[PanicSwitch] Error getting status:", err);
      res.status(500).json({ error: "Failed to get panic status" });
    }
  });

  app.post("/api/admin/panic/purchases", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled (boolean) is required" });
      }
      await setPanicSwitch("disable_purchases", enabled, "Blocks all checkout/purchase creation");
      res.json({ key: "disable_purchases", enabled });
    } catch (err) {
      console.error("[PanicSwitch] Error toggling purchases:", err);
      res.status(500).json({ error: "Failed to toggle panic switch" });
    }
  });

  app.post("/api/admin/panic/pvp", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled (boolean) is required" });
      }
      await setPanicSwitch("disable_pvp", enabled, "Blocks lobby creation and matchmaking");
      res.json({ key: "disable_pvp", enabled });
    } catch (err) {
      console.error("[PanicSwitch] Error toggling pvp:", err);
      res.status(500).json({ error: "Failed to toggle panic switch" });
    }
  });

  app.post("/api/admin/panic/set", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { setId, enabled } = req.body;
      if (!setId || typeof setId !== "string") {
        return res.status(400).json({ error: "setId (string) is required" });
      }
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled (boolean) is required" });
      }
      const key = `disable_set_${setId}`;
      await setPanicSwitch(key, enabled, `Blocks set ${setId} from being used`);
      res.json({ key, enabled });
    } catch (err) {
      console.error("[PanicSwitch] Error toggling set:", err);
      res.status(500).json({ error: "Failed to toggle panic switch" });
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

      // Check user risk state (NORMAL, UNDER_REVIEW, or FROZEN)
      let riskState: { status: "NORMAL" | "UNDER_REVIEW" | "FROZEN"; reason?: string } = { status: "NORMAL" };
      try {
        const [state] = await db
          .select()
          .from(userRiskState)
          .where(eq(userRiskState.userId, userId))
          .limit(1);
        if (state) {
          riskState = { status: state.status as "NORMAL" | "UNDER_REVIEW" | "FROZEN", reason: state.reason || undefined };
        }
      } catch (e) {
        // Risk state table might not exist yet, silently continue
      }

      // Calculate debt (negative balance scenario)
      const debtPts = walletData.wallet.balance < 0 ? Math.abs(walletData.wallet.balance) : 0;
      const availablePts = Math.max(0, walletData.wallet.balance);

      res.json({
        wallet: {
          id: walletData.wallet.id,
          balance: walletData.wallet.balance,
          availablePts,
          debtPts,
          lifetimeEarned: walletData.wallet.lifetimeEarned,
          lifetimeSpent: walletData.wallet.lifetimeSpent,
          status: walletData.wallet.status,
          createdAt: walletData.wallet.createdAt,
          updatedAt: walletData.wallet.updatedAt,
        },
        riskState,
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

  // GET /api/user/daily-progress - Get today's PackPTS earning progress (card-based daily cap)
  app.get("/api/user/daily-progress", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const cardProgress = await getDailyProgress(userId);

      // Calculate time until midnight UTC (when daily cap resets)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      const msUntilReset = tomorrow.getTime() - now.getTime();
      const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
      const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));

      res.json({
        todayEarned: cardProgress.basePtsAwarded,
        dailyCap: cardProgress.basePtsMax,
        remaining: cardProgress.remainingPts,
        percentUsed: cardProgress.progressPct,
        isAtCap: cardProgress.cardsCompleted >= cardProgress.cardsMax,
        cardsCompleted: cardProgress.cardsCompleted,
        cardsMax: cardProgress.cardsMax,
        dayKey: cardProgress.dayKey,
        resetIn: {
          hours: hoursUntilReset,
          minutes: minutesUntilReset,
          ms: msUntilReset,
        },
      });
    } catch (error) {
      console.error("Error getting daily progress:", error);
      res.status(500).json({ error: "Failed to get daily progress" });
    }
  });

  // GET /api/rewards/daily-progress - Card-based daily progress (alternative endpoint)
  app.get("/api/rewards/daily-progress", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const progress = await getDailyProgress(userId);
      res.json(progress);
    } catch (error) {
      console.error("Error getting rewards daily progress:", error);
      res.status(500).json({ error: "Failed to get daily progress" });
    }
  });

  // GET /api/progress/daily - Get match-based daily progress (cards answered and matches completed today)
  app.get("/api/progress/daily", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const progress = await getMatchDailyProgress(userId);
      res.json(progress);
    } catch (error) {
      console.error("Error getting daily progress:", error);
      res.status(500).json({ error: "Failed to get daily progress" });
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

      const result = await walletService.spend(userId, amount, reason, idempotencyKey, metadata, undefined,
        { source: "redemption", eventType: "wallet_spend", refType: "api", refId: idempotencyKey }
      );

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

      const result = await walletService.earn(userId, amount, reason, idempotencyKey, metadata, undefined,
        { source: "admin", eventType: "internal_earn", refType: "api", refId: idempotencyKey }
      );

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

      const result = await walletService.adjust(userId, amount, reason, idempotencyKey, metadata,
        { source: "admin", eventType: "internal_adjust", refType: "api", refId: idempotencyKey }
      );

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
  // PACKPTS WALLET ENDPOINTS
  // ============================================

  // GET /api/wallet/balance - Get user's wallet balance and status
  app.get("/api/wallet/balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { walletService } = await import("./services/walletService");
      const { riskEngine } = await import("./services/riskEngine");

      // Get wallet balance
      const wallet = await walletService.getOrCreateWallet(userId);
      
      // Get risk status (NORMAL, RESTRICTED, FROZEN)
      const riskState = await riskEngine.getUserRiskState(userId);
      
      // Calculate debt (negative balance scenario or pending chargebacks)
      const debtPts = wallet.balance < 0 ? Math.abs(wallet.balance) : 0;
      
      // Determine status based on risk state
      let status: "NORMAL" | "RESTRICTED" | "FROZEN" = "NORMAL";
      if (riskState) {
        if (riskState.status === "FROZEN") {
          status = "FROZEN";
        }
      }
      // If user has debt, they are restricted
      if (debtPts > 0) {
        status = "RESTRICTED";
      }
      
      res.json({
        availablePts: Math.max(0, wallet.balance),
        pendingPts: 0, // Could be extended to track pending transactions
        lockedPts: 0, // Could be extended to track locked reservations
        debtPts,
        status,
        lifetimeEarned: wallet.lifetimeEarned,
        lifetimeSpent: wallet.lifetimeSpent,
      });
    } catch (error) {
      console.error("Error getting wallet balance:", error);
      res.status(500).json({ error: "Failed to get wallet balance" });
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

  // POST /api/admin/webhooks/retry - Manually trigger webhook retry for failed events
  app.post("/api/admin/webhooks/retry", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const result = await retryFailedWebhookEvents();
      res.json({
        success: true,
        totalFound: result.totalFound,
        retried: result.retried,
        succeeded: result.succeeded,
        failed: result.failed,
        results: result.results,
      });
    } catch (error) {
      console.error("Error retrying webhook events:", error);
      res.status(500).json({ error: "Failed to retry webhook events" });
    }
  });

  // ── PackPTS Ledger API ──────────────────────────────────────────────
  app.get("/api/packpts/balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const balance = await getLedgerBalance(userId);
      res.json({ balance });
    } catch (error) {
      console.error("Error fetching PackPTS balance:", error);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  app.get("/api/packpts/ledger", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const { entries, hasMore, nextCursor } = await getLedgerHistory(userId, limit, offset);
      res.json({ entries, hasMore, nextCursor, limit, offset });
    } catch (error) {
      console.error("Error fetching PackPTS ledger:", error);
      res.status(500).json({ error: "Failed to fetch ledger history" });
    }
  });

  app.post("/api/admin/packpts/reconcile", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const schema = z.object({ userId: z.string().min(1) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "userId is required and must be a non-empty string" });
      const report = await reconcileLedgerBalance(parsed.data.userId);
      res.json(report);
    } catch (error) {
      console.error("Error reconciling PackPTS:", error);
      res.status(500).json({ error: "Failed to reconcile" });
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

  app.post("/api/game/start", gameStartLimiter, collectGeo, async (req: any, res) => {
    try {
      const parsed = startGameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { mode, totalQuestions, setId } = parsed.data;

      if (setId && await isPanicEnabled(`disable_set_${setId}`)) {
        return res.status(503).json({ error: "This card set is temporarily disabled." });
      }
      
      const userId = req.user?.claims?.sub || req.session?.localUserId || null;
      const isGuest = !userId;
      
      // Debug logging for mobile auth issues
      const userAgent = req.headers['user-agent'] || '';
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      if (isMobile) {
        console.log("[Game Start] Mobile request debug", {
          userAgent: userAgent.substring(0, 100),
          hasSession: !!req.session,
          sessionId: req.sessionID ? req.sessionID.substring(0, 8) + '...' : 'none',
          localUserId: req.session?.localUserId ? 'set' : 'not set',
          hasUser: !!req.user,
          userClaims: req.user?.claims ? 'present' : 'missing',
          userId,
          isGuest,
          mode,
        });
      }
      
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
      
      let session;
      try {
        session = await storage.createGameSession(userId, normalizedMode, totalQuestions, guestSessionId, setId);
      } catch (createError: any) {
        if (createError?.message === "NO_CARDS_AVAILABLE") {
          return res.status(503).json({ 
            error: "No cards available",
            code: "NO_CARDS_AVAILABLE",
            message: "This card set has no cards available for gameplay. Please try a different set.",
          });
        }
        throw createError;
      }
      
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
      
      // Mark when the first question is shown for response time tracking
      if (session.questions[0]) {
        (session.questions[0] as any).shownAt = new Date().toISOString();
        await storage.updateGameSession(session);
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

  // Replace a card that failed to load - serves new card without losing PackPTS opportunity
  app.post("/api/game/session/:id/replace-card", async (req, res) => {
    try {
      const { id } = req.params;
      const { failedCardId, excludeCardIds = [] } = req.body;
      
      if (!failedCardId) {
        return res.status(400).json({ error: "failedCardId is required" });
      }

      const session = await storage.getGameSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status !== "active") {
        return res.status(400).json({ error: "Session is not active" });
      }

      // Always flag the failed card for admin review (regardless of replacement availability)
      await storage.flagCardForImageFailure(failedCardId);

      const result = await storage.getReplacementCardForSession(id, failedCardId, excludeCardIds);
      
      if (!result) {
        console.log(`[CardReplacement] No replacement available for session ${id}, card ${failedCardId} (flagged for review)`);
        return res.status(404).json({ error: "No replacement card available", flagged: true });
      }

      // Update the session with the replacement question
      session.questions[session.currentQuestionIndex] = result.question;
      await storage.updateGameSession(session);

      console.log(`[CardReplacement] Replaced card ${failedCardId} with ${result.question.card.id} in session ${id}`);

      res.json({
        success: true,
        question: result.question,
        flagged: result.flagged
      });
    } catch (error) {
      console.error("Error replacing card:", error);
      res.status(500).json({ error: "Failed to replace card" });
    }
  });

  app.post("/api/game/answer", answerSubmitLimiter, async (req: any, res) => {
    try {
      const parsed = submitAnswerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { sessionId, questionIndex, selectedAnswer } = parsed.data;
      const session = await storage.getGameSession(sessionId);
      
      if (!session) {
        console.warn("[Game Answer] Session not found", { sessionId, questionIndex });
        return res.status(404).json({ error: "Session not found" });
      }
      
      const userId = session.userId || req.session?.localUserId;
      if (userId) {
        console.log("[Game Answer] Authenticated submission", {
          sessionId: sessionId.substring(0, 8),
          userId: userId.substring(0, 8),
          questionIndex,
          totalQuestions: session.totalQuestions,
          currentIndex: session.currentQuestionIndex,
          status: session.status,
        });
      }
      
      if (session.status === "completed" || session.status === "expired") {
        return res.status(400).json({ error: "Game already completed" });
      }
      
      if (questionIndex !== session.currentQuestionIndex) {
        console.warn("[Game Answer] Index mismatch", { questionIndex, currentIndex: session.currentQuestionIndex, sessionId: sessionId.substring(0, 8) });
        return res.status(400).json({ error: "Invalid question index" });
      }
      
      const currentQuestion = session.questions[questionIndex];
      
      if ((currentQuestion as any).answered) {
        return res.status(400).json({ error: "Question already answered" });
      }
      
      const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
      let pointsEarned = 0;
      let rewardResult: rewardEngine.AwardResult | null = null;
      let rewardError: string | null = null;
      
      // Try to update player stats (non-blocking - gameplay should work even if this fails)
      try {
        const playerKey = rewardEngine.normalizePlayerKey(currentQuestion.correctAnswer, "baseball");
        await rewardEngine.updatePlayerStats(playerKey, isCorrect);
      } catch (statsError: any) {
        console.error("[Game] Failed to update player stats:", statsError?.message);
        // Continue - this is not critical for gameplay
      }
      
      if (isCorrect) {
        const userId = session.userId || req.session?.localUserId;
        
        if (userId) {
          try {
            const cardId = (currentQuestion.card as any)?.id || `${sessionId}:q${questionIndex}`;
            
            // Award daily base points using card-completion curve (200 cards = 15,000 pts)
            const dailyBaseResult = await awardDailyBaseForCorrectCard({
              userId,
              matchId: sessionId,
              cardId,
            });
            
            pointsEarned = dailyBaseResult.deltaPts;
            
            // Build reward result for response
            rewardResult = {
              basePts: 75, // Fixed 75 pts per card in linear curve
              finalPts: dailyBaseResult.deltaPts,
              fameScore: 0.5, // Not used in new system
              vintageMultiplier: 1.0,
              rarityMultiplier: 1.0,
              policyId: "daily_card_curve",
              capped: dailyBaseResult.isDailyCapped,
              cappedReason: dailyBaseResult.isDailyCapped ? "daily_card_cap_reached" : 
                           dailyBaseResult.isDuplicate ? "duplicate_card" : undefined,
            };
            
            const matchPointsAwarded = (session as any).matchPointsAwarded || 0;
            (session as any).matchPointsAwarded = matchPointsAwarded + pointsEarned;
          } catch (rewardErr: any) {
            console.error("[Game] Failed to award points:", rewardErr?.message);
            rewardError = rewardErr?.message || "Reward system unavailable";
            // Fall back to base point value
            pointsEarned = currentQuestion.pointValue;
          }
        } else {
          pointsEarned = currentQuestion.pointValue;
        }
        
        session.score += pointsEarned;
        session.correctAnswers += 1;
      }
      
      (currentQuestion as any).answered = true;
      (currentQuestion as any).userAnswer = selectedAnswer;
      
      await storage.updateGameSession(session);

      // Log gameplay event for risk analysis (non-blocking)
      try {
        const userId = session.userId || req.session?.localUserId;
        if (userId) {
          const { logGameplayEvent } = await import("./services/risk/events");
          // Use shownAt timestamp if available for accurate response time measurement
          // Fallback to session start time if shownAt not set (legacy sessions)
          let shownAt = (currentQuestion as any).shownAt;
          if (!shownAt) {
            // Set shownAt now for future reference and use session start as fallback
            shownAt = session.startedAt;
            (currentQuestion as any).shownAt = new Date().toISOString();
          }
          const responseTimeMs = shownAt ? Date.now() - new Date(shownAt).getTime() : null;
          await logGameplayEvent("ANSWER_SUBMITTED", {
            userId,
            matchId: sessionId,
            cardId: currentQuestion.card?.id,
            answerCorrect: isCorrect,
            responseTimeMs: responseTimeMs ?? undefined,
          });
        }
      } catch (riskError) {
        console.error("[RiskPipeline] Failed to log gameplay event:", riskError);
      }
      
      res.json({
        correct: isCorrect,
        correctAnswer: currentQuestion.correctAnswer,
        pointsEarned,
        totalScore: session.score,
        session,
        reward: rewardResult ? {
          basePts: rewardResult.basePts,
          finalPts: rewardResult.finalPts,
          fameScore: rewardResult.fameScore,
          vintageMultiplier: rewardResult.vintageMultiplier,
          rarityMultiplier: rewardResult.rarityMultiplier,
          capped: rewardResult.capped,
          cappedReason: rewardResult.cappedReason,
        } : null,
        rewardWarning: rewardError,
      });
    } catch (error: any) {
      console.error("Error submitting answer:", error);
      const errorMessage = error?.message || "Unknown error";
      const errorCode = error?.code || "SUBMIT_ANSWER_FAILED";
      res.status(500).json({ 
        error: "Failed to submit answer", 
        details: errorMessage,
        code: errorCode 
      });
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
        console.warn("[Game Next] Session not found", { sessionId });
        return res.status(404).json({ error: "Session not found" });
      }
      
      const nextUserId = session.userId || req.session?.localUserId;
      console.log("[Game Next] Advancing", {
        sessionId: sessionId.substring(0, 8),
        userId: nextUserId ? nextUserId.substring(0, 8) : "guest",
        currentIndex: session.currentQuestionIndex,
        totalQuestions: session.totalQuestions,
        isLastQuestion: session.currentQuestionIndex >= session.totalQuestions - 1,
        status: session.status,
      });
      
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
          
          try {
            const earnResult = await applyLedgerEntry({
              userId: session.userId,
              direction: "credit",
              amountPackpts: finalScore,
              source: "gameplay",
              eventType: "match_complete_award",
              refType: "match",
              refId: session.id,
              idempotencyKey: `gameplay:match_complete:${session.id}:${session.userId}`,
              metadata: { sessionId: session.id, mode: session.mode, multiplier, tokenValidated, correctAnswers: session.correctAnswers, totalQuestions: session.totalQuestions },
            });
            
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
        // Mark when the new question is shown for response time tracking
        const nextQuestion = session.questions[session.currentQuestionIndex];
        if (nextQuestion) {
          (nextQuestion as any).shownAt = new Date().toISOString();
        }
      }
      
      await storage.updateGameSession(session);
      
      res.json(session);
    } catch (error: any) {
      console.error("[Game Next] Error moving to next question:", {
        sessionId: req.body?.sessionId?.substring(0, 8),
        error: error?.message,
        stack: error?.stack?.split('\n').slice(0, 3).join(' | '),
      });
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

  // ============================================
  // DAILY 5 CHALLENGE ROUTES
  // ============================================

  app.get("/api/daily5/status", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      const status = await daily5Service.getStatus(userId || undefined);
      res.json(status);
    } catch (error) {
      console.error("[Daily5] Error getting status:", error);
      res.status(500).json({ error: "Failed to get Daily 5 status" });
    }
  });

  app.post("/api/daily5/start", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await daily5Service.startChallenge(userId);
      res.json(result);
    } catch (error: any) {
      console.error("[Daily5] Error starting challenge:", error);
      if (error.message?.includes("already completed")) {
        return res.status(409).json({ error: error.message });
      }
      if (error.message?.includes("not active") || error.message?.includes("SCHEDULED") || error.message?.includes("CLOSED")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to start Daily 5" });
    }
  });

  app.post("/api/daily5/answer", isAuthenticated, answerSubmitLimiter, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      
      const parsed = daily5AnswerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }
      
      const { challengeId, position, selectedAnswer } = parsed.data;
      const result = await daily5Service.submitAnswer(userId, challengeId, position, selectedAnswer);
      res.json(result);
    } catch (error: any) {
      console.error("[Daily5] Error submitting answer:", error);
      if (error.message?.includes("already answered") || error.message?.includes("already completed")) {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to submit answer" });
    }
  });

  app.post("/api/daily5/finish", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      
      const parsed = daily5FinishSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request" });
      }
      
      const result = await daily5Service.finishChallenge(userId, parsed.data.challengeId);
      res.json(result);
    } catch (error: any) {
      console.error("[Daily5] Error finishing challenge:", error);
      res.status(500).json({ error: "Failed to finish Daily 5" });
    }
  });

  app.get("/api/daily5/leaderboard", async (req, res) => {
    try {
      const date = req.query.date as string | undefined;
      const result = await daily5Service.getLeaderboard(date);
      res.json(result);
    } catch (error) {
      console.error("[Daily5] Error getting leaderboard:", error);
      res.status(500).json({ error: "Failed to get leaderboard" });
    }
  });

  app.get("/api/admin/daily5/stats", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const stats = await daily5Service.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("[Daily5] Error getting admin stats:", error);
      res.status(500).json({ error: "Failed to get Daily 5 stats" });
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
      
      // Get wallet balance as authoritative PackPTS source
      const walletRow = await db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)).limit(1);
      const walletBalance = walletRow[0]?.balance ?? 0;

      // Calculate rank from leaderboard (uses wallet balance)
      const leaderboard = await storage.getLeaderboard(100);
      const rank = leaderboard.findIndex(e => e.points <= walletBalance) + 1 || leaderboard.length + 1;
      
      // Calculate level (every 1000 points = 1 level)
      const level = Math.floor(walletBalance / 1000) + 1;
      const pointsToNextLevel = 1000 - (walletBalance % 1000);
      const levelProgress = Math.round(((walletBalance % 1000) / 1000) * 100);
      
      res.json({
        username: user.username,
        email: user.email,
        points: walletBalance,
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

  app.post("/api/auth/register", registrationLimiter, async (req: any, res) => {
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
    } catch (error: any) {
      console.error("Error registering user:", error);
      console.error("Error details:", {
        message: error?.message,
        code: error?.code,
        constraint: error?.constraint,
        detail: error?.detail,
        table: error?.table,
        column: error?.column,
        stack: error?.stack?.split('\n').slice(0, 5).join('\n')
      });
      // Show specific error only if DEBUG_REGISTRATION is enabled
      const errorMsg = error?.message || "Unknown error";
      const errorCode = error?.code || "";
      const response: any = { error: "Failed to register" };
      if (process.env.DEBUG_REGISTRATION === "true") {
        response.debug = `${errorCode}: ${errorMsg}`.slice(0, 200);
      }
      res.status(500).json(response);
    }
  });

  // Health check endpoint to verify auth tables exist
  app.get("/api/health/auth", async (_req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      const { db } = await import("./db");
      
      const localCredCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'local_credentials'
        ) as exists
      `);
      
      const resetTokenCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'password_reset_tokens'
        ) as exists
      `);
      
      const localCredExists = (localCredCheck.rows[0] as any)?.exists === true;
      const resetTokenExists = (resetTokenCheck.rows[0] as any)?.exists === true;
      
      res.json({
        status: localCredExists && resetTokenExists ? "healthy" : "unhealthy",
        tables: {
          local_credentials: localCredExists,
          password_reset_tokens: resetTokenExists
        }
      });
    } catch (error: any) {
      res.status(500).json({ 
        status: "error", 
        message: error?.message 
      });
    }
  });

  app.post("/api/auth/local-login", loginLimiter, async (req: any, res) => {
    try {
      console.log("[Login] Starting login attempt");
      
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log("[Login] Validation failed:", parsed.error.errors);
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }
      
      const { usernameOrEmail, password } = parsed.data;
      console.log("[Login] Validating credentials for:", usernameOrEmail);
      
      let user;
      try {
        user = await storage.validateLocalCredentials(usernameOrEmail, password);
      } catch (credError) {
        console.error("[Login] Error validating credentials:", credError);
        throw credError;
      }
      
      if (!user) {
        console.log("[Login] Invalid credentials for:", usernameOrEmail);
        try {
          const { logAuthEvent } = await import("./services/risk/events");
          await logAuthEvent("LOGIN_FAIL", { req });
        } catch (logError) {
          console.error("[Login] Error logging failed auth event:", logError);
        }
        return res.status(401).json({ error: "Invalid username or password" });
      }
      
      console.log("[Login] Credentials valid for user:", user.id);
      
      try {
        const { logAuthEvent, logDeviceSeen, getRiskContext } = await import("./services/risk/events");
        const { enqueueRiskRecalc } = await import("./services/risk/jobQueue");
        const riskCtx = getRiskContext(req);
        await logAuthEvent("LOGIN_SUCCESS", { userId: user.id, req });
        if (riskCtx.deviceId) {
          await logDeviceSeen({ userId: user.id, deviceId: riskCtx.deviceId, req });
        }
        enqueueRiskRecalc(user.id, riskCtx.deviceId || undefined, riskCtx.ipHash || undefined);
      } catch (riskError) {
        console.error("[Login] Error in risk pipeline (non-fatal):", riskError);
        // Don't throw - risk pipeline errors shouldn't block login
      }
      
      // Transfer any pending guest points to the logged-in user's account
      if (req.session.pendingPoints) {
        console.log("[Login] Transferring pending guest points");
        try {
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
        } catch (pointsError) {
          console.error("[Login] Error transferring guest points (non-fatal):", pointsError);
          // Don't throw - point transfer errors shouldn't block login
        }
      }
      
      req.session.localUserId = user.id;
      console.log("[Login] Session localUserId set:", user.id);
      
      // Get updated user stats after transferring points
      let updatedUser;
      try {
        updatedUser = await storage.getUser(user.id);
      } catch (getUserError) {
        console.error("[Login] Error getting updated user:", getUserError);
        // Fall back to original user if getUser fails
        updatedUser = user;
      }
      
      // Explicitly save session to ensure it's persisted before response
      console.log("[Login] Saving session...");
      req.session.save((err: any) => {
        if (err) {
          console.error("[Login] Error saving session:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        console.log("[Login] Session saved successfully, returning response");
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
      console.error("[Login] Unhandled error:", error);
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

  app.post("/api/lobby/create", isAuthenticated, requireActiveUser, matchCreateLimiter, async (req: any, res) => {
    try {
      if (await isPanicEnabled("disable_pvp")) {
        return res.status(503).json({ error: "PVP matches are temporarily disabled." });
      }

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
      
      // Validate gameSetId if provided
      const gameSetId = req.body.gameSetId || null;
      
      // Use server-derived identity, ignore any client-provided hostId/hostUsername
      const lobby = await matchService.createLobby(userId, user.username, totalQuestions, gameSetId);
      
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
      
      const result = await matchService.joinLobby(joinCode.toUpperCase(), userId, user.username);
      
      if ("error" in result) {
        const statusCode = result.code === "NOT_FOUND" ? 404
          : result.code === "SELF_JOIN" ? 409
          : result.code === "LOBBY_FULL" ? 409
          : result.code === "NOT_WAITING" ? 410
          : 400;
        return res.status(statusCode).json({ error: result.error, code: result.code });
      }
      
      const { hostSecret: _, guestSecret: __, ...safeLobby } = result.lobby;
      res.json({ ...safeLobby, membershipSecret: result.lobby.guestSecret });
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

  // GET /api/admin/affiliate/summary - Affiliate click analytics summary
  app.get("/api/admin/affiliate/summary", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Clicks by day
      const clicksByDay = await db.execute(sql`
        SELECT 
          date_trunc('day', created_at)::date as day,
          COUNT(*) as clicks,
          COUNT(DISTINCT user_id) as unique_users
        FROM outbound_clicks
        WHERE created_at >= ${startDate}
          AND source = 'ebay'
        GROUP BY date_trunc('day', created_at)::date
        ORDER BY day DESC
      `);
      
      // Top items by clicks
      const topItems = await db.execute(sql`
        SELECT 
          listing_id as item_id,
          COUNT(*) as clicks
        FROM outbound_clicks
        WHERE created_at >= ${startDate}
          AND source = 'ebay'
        GROUP BY listing_id
        ORDER BY clicks DESC
        LIMIT 10
      `);
      
      // Top pages by clicks
      const topPages = await db.execute(sql`
        SELECT 
          COALESCE(page_path, 'unknown') as page_path,
          COUNT(*) as clicks
        FROM outbound_clicks
        WHERE created_at >= ${startDate}
          AND source = 'ebay'
        GROUP BY page_path
        ORDER BY clicks DESC
        LIMIT 10
      `);
      
      // Total summary
      const totalSummary = await db.execute(sql`
        SELECT 
          COUNT(*) as total_clicks,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT listing_id) as unique_items
        FROM outbound_clicks
        WHERE created_at >= ${startDate}
          AND source = 'ebay'
      `);
      
      res.json({
        period: { days, startDate: startDate.toISOString() },
        summary: totalSummary.rows[0] || { total_clicks: 0, unique_users: 0, unique_items: 0 },
        clicksByDay: clicksByDay.rows,
        topItems: topItems.rows,
        topPages: topPages.rows,
      });
    } catch (error) {
      console.error("Error getting affiliate summary:", error);
      res.status(500).json({ error: "Failed to get affiliate summary" });
    }
  });

  // GET /api/admin/image-validation/status - Get image validation status
  app.get("/api/admin/image-validation/status", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { getValidationStatus } = await import("./services/imageValidation");
      const status = await getValidationStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting validation status:", error);
      res.status(500).json({ error: "Failed to get validation status" });
    }
  });

  // POST /api/admin/image-validation/run - Trigger image validation
  app.post("/api/admin/image-validation/run", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { forceRecheck, gameSetId } = req.body || {};
      const { validatePlayableCardImages, validateBaseballCardImages } = await import("./services/imageValidation");
      
      const results = {
        playableCards: await validatePlayableCardImages(gameSetId, forceRecheck === true),
        baseballCards: await validateBaseballCardImages(forceRecheck === true)
      };
      
      res.json({
        success: true,
        results,
        message: `Validated ${results.playableCards.totalChecked + results.baseballCards.totalChecked} cards, excluded ${results.playableCards.newlyExcluded + results.baseballCards.newlyExcluded}`
      });
    } catch (error) {
      console.error("Error running validation:", error);
      res.status(500).json({ error: "Failed to run validation" });
    }
  });

  // GET /api/admin/card-pool/stats - Get card pool statistics
  app.get("/api/admin/card-pool/stats", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { getCardPoolStats, isRefreshJobRunning } = await import("./services/cardPoolRefresh");
      const stats = await getCardPoolStats();
      res.json({
        ...stats,
        refreshJobRunning: isRefreshJobRunning(),
      });
    } catch (error) {
      console.error("Error getting card pool stats:", error);
      res.status(500).json({ error: "Failed to get card pool stats" });
    }
  });

  // POST /api/admin/card-pool/refresh - Trigger card pool refresh job
  app.post("/api/admin/card-pool/refresh", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { runCardPoolRefreshJob, isRefreshJobRunning } = await import("./services/cardPoolRefresh");
      
      if (isRefreshJobRunning()) {
        return res.status(409).json({ error: "Refresh job already running" });
      }
      
      const result = await runCardPoolRefreshJob();
      res.json({
        success: true,
        result,
        message: `Processed ${result.cardsProcessed} cards, revalidated ${result.cardsRevalidated}, failed ${result.cardsFailed}`
      });
    } catch (error) {
      console.error("Error running card pool refresh:", error);
      res.status(500).json({ error: "Failed to run card pool refresh" });
    }
  });

  // POST /api/admin/image-validation/revalidate/:cardId - Revalidate single card
  app.post("/api/admin/image-validation/revalidate/:cardId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { cardId } = req.params;
      const { cardType } = req.body || {};
      
      if (!cardType || !["playable", "baseball"].includes(cardType)) {
        return res.status(400).json({ error: "cardType must be 'playable' or 'baseball'" });
      }
      
      const { revalidateCard } = await import("./services/imageValidation");
      const result = await revalidateCard(cardId, cardType);
      
      res.json({
        cardId,
        cardType,
        valid: result.valid,
        error: result.error
      });
    } catch (error) {
      console.error("Error revalidating card:", error);
      res.status(500).json({ error: "Failed to revalidate card" });
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
  // STRIPE CONFIG & WEBHOOK & BILLING ENDPOINTS
  // ============================================

  app.get("/api/stripe/config", async (req: Request, res: Response) => {
    try {
      const host = req.headers.host;
      const config = await getStripeConfig(host);
      res.json(config);
    } catch (error) {
      console.error("[Stripe] Config endpoint error:", error);
      res.status(503).json({ error: "Payment configuration unavailable" });
    }
  });

  // Stripe webhook endpoint - receives raw body for signature verification
  // Global JSON parser skips /webhooks/ routes (see server/index.ts), so express.raw() gets the raw Buffer
  app.post("/webhooks/purchases", 
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const host = req.headers.host;
      const mode = getStripeMode(host);
      const signature = req.headers["stripe-signature"];
      
      if (!signature || typeof signature !== "string") {
        console.error("[Stripe] Webhook rejected: missing stripe-signature header");
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      if (isProductionHost(host) && mode !== "live") {
        console.error(`[Stripe] BLOCKED: Webhook on production host "${host}" but mode is "${mode}"`);
        return res.status(503).json({ error: "Payment processing misconfigured" });
      }

      if (!(await checkStripeConfigured())) {
        console.error("[Stripe] Webhook rejected: Stripe is not configured");
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      console.log(`[Stripe] Webhook received: host=${host}, mode=${mode}, bodyType=${Buffer.isBuffer(req.body) ? 'Buffer' : typeof req.body}, bodyLen=${Buffer.isBuffer(req.body) ? req.body.length : JSON.stringify(req.body)?.length || 0}`);

      let event: Stripe.Event;
      try {
        event = await stripePurchaseService.verifyAndParseWebhook(
          req.body,
          signature,
          host
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown verification error";
        console.error(`[Stripe] Webhook signature verification FAILED: ${msg}`);
        return res.status(400).json({ error: "Invalid signature" });
      }

      // Livemode guard: reject events that don't match the server's expected mode
      const expectedLivemode = mode === "live";
      if (event.livemode !== expectedLivemode) {
        console.error(`[Stripe] Webhook livemode MISMATCH: event.livemode=${event.livemode}, expected=${expectedLivemode} (mode=${mode})`);
        return res.status(200).json({ received: true, ignored: true, reason: "livemode mismatch" });
      }

      try {
        const result = await stripePurchaseService.processWebhookEvent(event);
        
        console.log(`[Stripe] Webhook processed: eventId=${result.eventId}, type=${event.type}, status=${result.status}${result.message ? `, msg=${result.message}` : ""}`);
        
        return res.status(200).json({
          received: true,
          eventId: result.eventId,
          status: result.status,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown processing error";
        console.error(`[Stripe] Webhook processing error (returning 200 to prevent retries): eventId=${event.id}, type=${event.type}, error=${msg}`);
        return res.status(200).json({ received: true, error: "Internal processing error" });
      }
    }
  );

  // Webhook health endpoint - no auth required, no secrets exposed
  app.get("/webhooks/health", async (_req: Request, res: Response) => {
    const mode = getStripeMode();
    const configured = await checkStripeConfigured();
    const { getWebhookSecret: getWhs } = await import("./stripeClient");
    const hasWebhookSecret = !!getWhs();
    
    res.status(200).json({
      ok: configured,
      stripeMode: mode,
      hasWebhookSecret,
      webhookPath: "/webhooks/purchases",
    });
  });

  // Billing sync endpoint - reconciles user's purchases with Stripe
  app.post("/billing/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!(await checkStripeConfigured())) {
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
    const configured = await checkStripeConfigured();
    res.json({
      stripeConfigured: configured,
    });
  });

  app.get("/api/admin/stripe-diagnostics", requireAdmin, async (_req, res) => {
    const diag = getStripeDiagnostics();
    const configured = await checkStripeConfigured();
    
    const recentEvents = await db
      .select({
        eventId: purchaseEvents.eventId,
        eventType: purchaseEvents.eventType,
        userId: purchaseEvents.userId,
        status: purchaseEvents.status,
        errorMessage: purchaseEvents.errorMessage,
        retryCount: purchaseEvents.retryCount,
        createdAt: purchaseEvents.createdAt,
        processedAt: purchaseEvents.processedAt,
      })
      .from(purchaseEvents)
      .orderBy(desc(purchaseEvents.createdAt))
      .limit(50);

    res.json({ 
      ...diag, 
      configuredNow: configured,
      recentWebhookEvents: recentEvents,
    });
  });

  // ============================================
  // STORE CHECKOUT ENDPOINTS
  // ============================================

  // Get PackPTS bundles for purchase
  app.get("/api/store/products", async (req: any, res) => {
    try {
      const bundles = await storeCheckoutService.getPackPtsBundles();
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (userId) {
        await analyticsService.storeViewed(userId, { productCount: bundles.length, type: "packpts_bundles" });
      }
      
      const configured = await checkStripeConfigured();
      res.json({
        products: bundles,
        stripeConfigured: configured,
      });
    } catch (error) {
      console.error("Error getting store products:", error);
      res.status(500).json({ error: "Failed to get store products" });
    }
  });

  // Create Stripe checkout session for PackPTS purchase
  app.post("/api/store/checkout", isAuthenticated, requireActiveUser, checkoutLimiter, async (req: any, res) => {
    try {
      if (await isPanicEnabled("disable_purchases")) {
        return res.status(503).json({ error: "Purchases are temporarily disabled." });
      }

      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { sku } = req.body;
      if (!sku || typeof sku !== "string") {
        return res.status(400).json({ error: "SKU is required" });
      }

      const host = req.headers.host;
      const mode = getStripeMode(host);

      try {
        assertLiveModeForHost(host);
      } catch (modeError) {
        console.error("[Stripe] Checkout blocked:", (modeError as Error).message);
        return res.status(503).json({ error: "Payments are temporarily unavailable. Please try again later." });
      }

      if (!(await checkStripeConfigured())) {
        return res.status(503).json({ error: "Payment processing not configured" });
      }

      const baseUrl = isProductionHost(host)
        ? `https://${host}`
        : (process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`);
      const successUrl = `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/store/cancel`;

      console.log(`[Stripe] checkout_create: { host: "${host}", mode: "${mode}", sku: "${sku}", userId: "${userId}", stripeKeyType: "${mode}" }`);

      const result = await storeCheckoutService.createCheckoutSession(
        userId,
        sku,
        successUrl,
        cancelUrl,
        host
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url, sessionId: result.sessionId });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: "Payments are temporarily unavailable. Please try again later." });
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

      const host = req.headers.host;
      const status = await storeCheckoutService.getCheckoutSessionStatus(sessionId, host);
      
      if (!status) {
        return res.status(404).json({ error: "Checkout session not found" });
      }

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

      const host = req.headers.host;
      const mode = getStripeMode(host);

      try {
        assertLiveModeForHost(host);
      } catch (modeError) {
        console.error("[Stripe] Subscribe blocked:", (modeError as Error).message);
        return res.status(503).json({ error: "Payments are temporarily unavailable. Please try again later." });
      }

      const baseUrl = isProductionHost(host)
        ? `https://${host}`
        : (process.env.REPLIT_DEV_DOMAIN 
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : `http://localhost:5000`);
      
      const successUrl = `${baseUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/store/cancel`;

      console.log(`[Stripe] subscribe_create: { host: "${host}", mode: "${mode}", sku: "${sku}", userId: "${userId}", stripeKeyType: "${mode}" }`);

      const result = await storeCheckoutService.createSubscriptionCheckoutSession(
        userId,
        sku,
        successUrl,
        cancelUrl,
        host
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url, sessionId: result.sessionId });
    } catch (error) {
      console.error("Error creating subscription checkout session:", error);
      res.status(500).json({ error: "Payments are temporarily unavailable. Please try again later." });
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
        description: z.string().optional().nullable(),
        sortOrder: z.number().int().optional().nullable(),
        isBestValue: z.boolean().optional(),
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
          stripePriceId: parsed.data.stripePriceId || null,
          description: parsed.data.description || null,
          sortOrder: parsed.data.sortOrder ?? 0,
          isBestValue: parsed.data.isBestValue ?? false,
          metadata: parsed.data.metadata || null,
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
        description: z.string().optional().nullable(),
        sortOrder: z.number().int().optional().nullable(),
        isBestValue: z.boolean().optional(),
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

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (parsed.data.name) updateData.name = parsed.data.name;
      if (parsed.data.priceUsd !== undefined) updateData.priceUsd = parsed.data.priceUsd;
      if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
      if (parsed.data.stripePriceId !== undefined) updateData.stripePriceId = parsed.data.stripePriceId || null;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description || null;
      if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder ?? 0;
      if (parsed.data.isBestValue !== undefined) updateData.isBestValue = parsed.data.isBestValue;
      if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;

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

  // Admin: Get card delivery telemetry stats
  app.get("/api/admin/telemetry/cards", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { getCardDeliveryStats } = await import("./services/telemetry/cardDelivery");
      const stats = await getCardDeliveryStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting card telemetry:", error);
      res.status(500).json({ error: "Failed to get card delivery stats" });
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

      // Log redemption event for risk analysis (non-blocking)
      try {
        const { logRedemptionEvent } = await import("./services/risk/events");
        const { enqueueRiskRecalc } = await import("./services/risk/jobQueue");
        await logRedemptionEvent("APPLY", {
          userId,
          purchaseIntentId: result.redemption?.id,
          ptsRequested: parseResult.data.packptsAmount,
        });
        enqueueRiskRecalc(userId);
      } catch (riskError) {
        console.error("[RiskPipeline] Failed to log redemption event:", riskError);
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
    const entries = Array.from(marketplaceRateLimiter.entries());
    for (const [key, value] of entries) {
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
      
      // Transform listings to match frontend's expected format
      const transformedListings = result.listings.map((listing) => ({
        id: listing.listingId,
        source: listing.source,
        title: listing.title,
        priceCents: listing.price ? Math.round(listing.price.amount * 100) : null,
        currency: listing.price?.currency || "USD",
        imageUrl: listing.imageUrl || null,
        destinationUrl: listing.url,
        condition: listing.condition || null,
        endsAt: listing.endTime || null,
        outboundUrl: marketplaceService.generateListingWithOutboundUrl(listing, baseUrl),
      }));

      res.json({
        listings: transformedListings,
        sources: {
          ebay: result.sourceBreakdown.ebay > 0,
          goldin: result.sourceBreakdown.goldin > 0,
        },
        cached: result.cached,
        lastUpdated: result.lastUpdated,
      });
    } catch (error) {
      console.error("Error searching marketplace:", error);
      res.status(500).json({ error: "Failed to search marketplace" });
    }
  });

  // GET /out/ebay/:listingId - Tracked outbound redirect for eBay with EPN affiliate tracking
  app.get("/out/ebay/:listingId", async (req: any, res) => {
    try {
      const { listingId } = req.params;
      const token = req.query.token as string;
      const pagePath = req.query.page as string || null;
      const cardSetId = req.query.cardSetId as string || null;
      const cardId = req.query.cardId as string || null;

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
      const referrer = req.headers["referer"] || null;

      // Generate affiliate URL with EPN tracking
      const finalUrl = marketplaceService.applyEpnTracking(payload.destinationUrl, userId, listingId);
      
      // Generate customId for attribution tracking
      const customId = marketplaceService.generateEpnCustomId(userId, listingId);

      // Log click with full tracking data
      await marketplaceService.logOutboundClick({
        source: "ebay",
        listingId,
        destinationUrl: payload.destinationUrl,
        outboundUrl: finalUrl,
        customId,
        userId,
        sessionId,
        ip,
        userAgent,
        referrer,
        pagePath,
        cardSetId,
        cardId,
      });

      // Log for debugging (truncated URL for safety)
      console.log("[EPN redirect]", { 
        userId: userId?.substring(0, 8) || "anon", 
        listingId, 
        outboundUrlShort: finalUrl.substring(0, 60) + "..." 
      });

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

      await marketplaceService.logOutboundClick({
        source: "goldin",
        listingId,
        destinationUrl: payload.destinationUrl,
        userId,
        sessionId,
        ip,
        userAgent,
      });

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

        // Transform listings to match frontend's expected format
        const transformedListings = searchResult.listings.map((listing) => ({
          id: listing.listingId,
          source: listing.source,
          title: listing.title,
          priceCents: listing.price ? Math.round(listing.price.amount * 100) : null,
          currency: listing.price?.currency || "USD",
          imageUrl: listing.imageUrl || null,
          destinationUrl: listing.url,
          condition: listing.condition || null,
          endsAt: listing.endTime || null,
          outboundUrl: marketplaceService.generateListingWithOutboundUrl(listing, baseUrl),
        }));

        results.push({
          gameSet: context.gameSet,
          contextKey: context.contextKey,
          listings: transformedListings,
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

  // Admin: Diagnose game set health - shows why cards may not be queryable
  app.get("/api/admin/game-sets/:id/diagnose", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get the game set
      const [gameSet] = await db
        .select()
        .from(gameSets)
        .where(eq(gameSets.id, id))
        .limit(1);
      
      if (!gameSet) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      // Get detailed card counts
      const [counts] = await db
        .select({
          totalCards: sql<number>`COUNT(*)`.as('total_cards'),
          playableTrue: sql<number>`SUM(CASE WHEN is_playable = true THEN 1 ELSE 0 END)`.as('playable_true'),
          contentVerifiedTrue: sql<number>`SUM(CASE WHEN content_verified = true THEN 1 ELSE 0 END)`.as('content_verified_true'),
          contentVerifiedNull: sql<number>`SUM(CASE WHEN content_verified IS NULL THEN 1 ELSE 0 END)`.as('content_verified_null'),
          contentVerifiedFalse: sql<number>`SUM(CASE WHEN content_verified = false THEN 1 ELSE 0 END)`.as('content_verified_false'),
          knownSilhouettes: sql<number>`SUM(CASE WHEN image_url LIKE '%05-Baseball.jpg' OR image_url LIKE '%05-Football.jpg' OR image_url LIKE '%05-Basketball.jpg' THEN 1 ELSE 0 END)`.as('known_silhouettes'),
          hasValidImage: sql<number>`SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url LIKE 'https://%' THEN 1 ELSE 0 END)`.as('has_valid_image'),
          hasPlayer: sql<number>`SUM(CASE WHEN player IS NOT NULL AND player != '' THEN 1 ELSE 0 END)`.as('has_player'),
          imageFailureLow: sql<number>`SUM(CASE WHEN image_failure_count < 2 THEN 1 ELSE 0 END)`.as('image_failure_low'),
          notRejected: sql<number>`SUM(CASE WHEN image_review_status IS NULL OR image_review_status != 'rejected' THEN 1 ELSE 0 END)`.as('not_rejected'),
          matchingSport: sql<number>`SUM(CASE WHEN LOWER(category) = LOWER(${gameSet.sport}) THEN 1 ELSE 0 END)`.as('matching_sport'),
        })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, id));
      
      // Get fully playable count (all conditions met)
      const [fullyPlayable] = await db
        .select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, id),
            eq(playableCards.isPlayable, true),
            or(isNull(playableCards.contentVerified), eq(playableCards.contentVerified, true)),
            isNotNull(playableCards.imageUrl),
            ne(playableCards.imageUrl, ''),
            like(playableCards.imageUrl, 'https://%'),
            isNotNull(playableCards.player),
            ne(playableCards.player, ''),
            or(
              isNull(playableCards.imageReviewStatus),
              ne(playableCards.imageReviewStatus, 'rejected')
            ),
            sql`LOWER(${playableCards.category}) = LOWER(${gameSet.sport})`
          )
        );
      
      // Get last 5 inserted cards for this set
      const last5Cards = await db
        .select({
          id: playableCards.id,
          gameSetId: playableCards.gameSetId,
          cardhedgeCardId: playableCards.cardhedgeCardId,
          player: playableCards.player,
          imageUrl: playableCards.imageUrl,
          category: playableCards.category,
          isPlayable: playableCards.isPlayable,
          contentVerified: playableCards.contentVerified,
          imageFailureCount: playableCards.imageFailureCount,
          imageReviewStatus: playableCards.imageReviewStatus,
          createdAt: playableCards.createdAt,
        })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, id))
        .orderBy(desc(playableCards.createdAt))
        .limit(5);
      
      // Check for null set_id cards in last hour (foreign key sanity)
      const [nullSetIdCards] = await db
        .select({ count: sql<number>`COUNT(*)`.as('count') })
        .from(playableCards)
        .where(
          and(
            isNull(playableCards.gameSetId),
            gte(playableCards.createdAt, sql`NOW() - INTERVAL '1 hour'`)
          )
        );
      
      const totalCards = Number(counts.totalCards) || 0;
      const playableCards_count = Number(fullyPlayable.count) || 0;
      
      // Diagnose the issue
      let diagnosis = "";
      if (playableCards_count > 0) {
        diagnosis = "Cards are queryable for gameplay";
      } else if (totalCards === 0) {
        diagnosis = "No cards exist in this set - import required";
      } else {
        // Identify the bottleneck
        const issues: string[] = [];
        if (Number(counts.playableTrue) === 0) issues.push("is_playable=false on all cards");
        if (Number(counts.hasValidImage) < totalCards * 0.5) issues.push("many cards missing valid images");
        if (Number(counts.matchingSport) === 0) issues.push(`no cards have category matching sport '${gameSet.sport}'`);
        if (Number(counts.imageFailureLow) === 0) issues.push("all cards have high image failure counts");
        if (Number(counts.contentVerifiedFalse) > 0 && Number(counts.contentVerifiedTrue) === 0 && Number(counts.contentVerifiedNull) === 0) {
          issues.push("all cards have content_verified=false (silhouettes)");
        }
        diagnosis = issues.length > 0 
          ? `Issues detected: ${issues.join('; ')}`
          : "No cards meet all playability criteria - review counts above";
      }
      
      res.json({
        gameSet: {
          id: gameSet.id,
          setName: gameSet.setName,
          sport: gameSet.sport,
          year: gameSet.year,
          isActive: gameSet.isActive,
          cardsImportedCount: gameSet.cardsImportedCount,
          cardhedgeSetQuery: gameSet.cardhedgeSetQuery,
          lastImportAt: gameSet.lastImportAt,
        },
        cardCounts: {
          totalCards,
          isPlayableTrue: Number(counts.playableTrue) || 0,
          contentVerified: {
            true: Number(counts.contentVerifiedTrue) || 0,
            null: Number(counts.contentVerifiedNull) || 0,
            false: Number(counts.contentVerifiedFalse) || 0,
          },
          knownSilhouettes: Number(counts.knownSilhouettes) || 0,
          hasValidImage: Number(counts.hasValidImage) || 0,
          hasPlayer: Number(counts.hasPlayer) || 0,
          imageFailureCountLow: Number(counts.imageFailureLow) || 0,
          notRejected: Number(counts.notRejected) || 0,
          matchingSport: Number(counts.matchingSport) || 0,
        },
        fullyPlayableCards: playableCards_count,
        foreignKeySanity: {
          nullSetIdCardsInLastHour: Number(nullSetIdCards?.count) || 0,
        },
        last5InsertedCards: last5Cards.map(c => ({
          id: c.id,
          player: c.player,
          imageUrl: c.imageUrl ? (c.imageUrl.slice(0, 50) + '...') : null,
          category: c.category,
          isPlayable: c.isPlayable,
          contentVerified: c.contentVerified,
          imageFailureCount: c.imageFailureCount,
          createdAt: c.createdAt,
        })),
        diagnosis,
      });
    } catch (error) {
      console.error("Error diagnosing game set:", error);
      res.status(500).json({ error: "Failed to diagnose game set" });
    }
  });

  // Alias: /api/admin/debug/set-integrity (matches spec document)
  app.get("/api/admin/debug/set-integrity", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { setId } = req.query;
      if (!setId || typeof setId !== 'string') {
        return res.status(400).json({ error: "setId query parameter required" });
      }
      
      // Forward to diagnose endpoint logic
      const [gameSet] = await db
        .select()
        .from(gameSets)
        .where(eq(gameSets.id, setId))
        .limit(1);
      
      if (!gameSet) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      // Get detailed card counts (same logic as diagnose)
      const [counts] = await db
        .select({
          totalCards: sql<number>`COUNT(*)`.as('total_cards'),
          playableTrue: sql<number>`SUM(CASE WHEN is_playable = true THEN 1 ELSE 0 END)`.as('playable_true'),
          contentVerifiedTrue: sql<number>`SUM(CASE WHEN content_verified = true THEN 1 ELSE 0 END)`.as('content_verified_true'),
          contentVerifiedNull: sql<number>`SUM(CASE WHEN content_verified IS NULL THEN 1 ELSE 0 END)`.as('content_verified_null'),
          contentVerifiedFalse: sql<number>`SUM(CASE WHEN content_verified = false THEN 1 ELSE 0 END)`.as('content_verified_false'),
          hasValidImage: sql<number>`SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url LIKE 'https://%' THEN 1 ELSE 0 END)`.as('has_valid_image'),
          hasPlayer: sql<number>`SUM(CASE WHEN player IS NOT NULL AND player != '' THEN 1 ELSE 0 END)`.as('has_player'),
          imageFailureLow: sql<number>`SUM(CASE WHEN image_failure_count < 2 THEN 1 ELSE 0 END)`.as('image_failure_low'),
          notRejected: sql<number>`SUM(CASE WHEN image_review_status IS NULL OR image_review_status != 'rejected' THEN 1 ELSE 0 END)`.as('not_rejected'),
          matchingSport: sql<number>`SUM(CASE WHEN LOWER(category) = LOWER(${gameSet.sport}) THEN 1 ELSE 0 END)`.as('matching_sport'),
        })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, setId));
      
      // Get fully playable count (all conditions met)
      const [fullyPlayable] = await db
        .select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, setId),
            eq(playableCards.isPlayable, true),
            or(isNull(playableCards.contentVerified), eq(playableCards.contentVerified, true)),
            isNotNull(playableCards.imageUrl),
            ne(playableCards.imageUrl, ''),
            like(playableCards.imageUrl, 'https://%'),
            isNotNull(playableCards.player),
            ne(playableCards.player, ''),
            or(
              isNull(playableCards.imageReviewStatus),
              ne(playableCards.imageReviewStatus, 'rejected')
            ),
            sql`LOWER(${playableCards.category}) = LOWER(${gameSet.sport})`
          )
        );
      
      // Last 5 inserted cards
      const last5Cards = await db
        .select({
          id: playableCards.id,
          gameSetId: playableCards.gameSetId,
          cardhedgeCardId: playableCards.cardhedgeCardId,
          player: playableCards.player,
          imageUrl: playableCards.imageUrl,
          category: playableCards.category,
          isPlayable: playableCards.isPlayable,
          contentVerified: playableCards.contentVerified,
          imageFailureCount: playableCards.imageFailureCount,
          createdAt: playableCards.createdAt,
        })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, setId))
        .orderBy(desc(playableCards.createdAt))
        .limit(5);
      
      // Cards with NULL set_id in last 2 hours (per spec)
      const [nullSetIdCards] = await db
        .select({ count: sql<number>`COUNT(*)`.as('count') })
        .from(playableCards)
        .where(
          and(
            isNull(playableCards.gameSetId),
            gte(playableCards.createdAt, sql`NOW() - INTERVAL '2 hours'`)
          )
        );
      
      const totalCards = Number(counts.totalCards) || 0;
      const playable_count = Number(fullyPlayable.count) || 0;
      
      res.json({
        setInfo: {
          id: gameSet.id,
          setName: gameSet.setName,
          sport: gameSet.sport,
          year: gameSet.year,
          isActive: gameSet.isActive,
          cardhedgeSetQuery: gameSet.cardhedgeSetQuery,
          lastImportAt: gameSet.lastImportAt,
        },
        counts: {
          canonical_cards_total: totalCards,
          canonical_cards_playable: playable_count,
          admin_list_count: playable_count, // Same as gameplay query
          staging_count: 0, // No staging table in this codebase
        },
        flagsBreakdown: {
          isPlayable: { true: Number(counts.playableTrue) || 0, false: totalCards - (Number(counts.playableTrue) || 0) },
          contentVerified: {
            true: Number(counts.contentVerifiedTrue) || 0,
            null: Number(counts.contentVerifiedNull) || 0,
            false: Number(counts.contentVerifiedFalse) || 0,
          },
          hasValidImage: Number(counts.hasValidImage) || 0,
          hasPlayer: Number(counts.hasPlayer) || 0,
          imageFailureCountLow: Number(counts.imageFailureLow) || 0,
          matchingSport: Number(counts.matchingSport) || 0,
        },
        last5InsertedCards: last5Cards.map(c => ({
          id: c.id,
          set_id: c.gameSetId,
          cardhedge_card_id: c.cardhedgeCardId,
          player: c.player,
          image_url: c.imageUrl,
          playable: c.isPlayable,
          verified: c.contentVerified,
        })),
        cardsWithNullSetIdLast2Hours: Number(nullSetIdCards?.count) || 0,
      });
    } catch (error) {
      console.error("Error in set-integrity check:", error);
      res.status(500).json({ error: "Failed to check set integrity" });
    }
  });

  // Admin: Get all game sets
  app.get("/api/admin/game-sets", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      // Get game sets with ACTUAL playable card counts (not stale cardsImportedCount)
      const sets = await db
        .select({
          id: gameSets.id,
          sport: gameSets.sport,
          brand: gameSets.brand,
          year: gameSets.year,
          setName: gameSets.setName,
          league: gameSets.league,
          isActive: gameSets.isActive,
          cardhedgeSetQuery: gameSets.cardhedgeSetQuery,
          cardhedgeCategory: gameSets.cardhedgeCategory,
          // Return actual playable count matching gameplay query logic
          // Allow NULL or true for content_verified (same as getRandomCardsFromSet)
          cardsImportedCount: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true 
            AND (pc.content_verified IS NULL OR pc.content_verified = true)
            AND pc.image_url IS NOT NULL
            AND pc.image_url LIKE 'https://%'
            AND pc.player IS NOT NULL
            AND pc.player != ''
            AND LOWER(pc.category) = LOWER(game_sets.sport)
          )`.as('cards_imported_count'),
          lastImportAt: gameSets.lastImportAt,
          marketplaceKeywords: gameSets.marketplaceKeywords,
          createdAt: gameSets.createdAt,
        })
        .from(gameSets)
        .orderBy(gameSets.year);
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
      
      const insertData: typeof gameSets.$inferInsert = {
        sport: parsed.data.sport,
        brand: parsed.data.brand,
        year: parsed.data.year,
        setName: parsed.data.setName,
        league: parsed.data.league ?? null,
        isActive: parsed.data.isActive ?? true,
        marketplaceKeywords: (parsed.data.marketplaceKeywords ?? []) as string[],
        cardhedgeSetQuery: parsed.data.cardhedgeSetQuery ?? null,
        cardhedgeCategory: parsed.data.cardhedgeCategory ?? null,
      };
      
      const [gameSet] = await db.insert(gameSets).values(insertData).returning();
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
        .set({ isActive: false })
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

  // Admin: Get duplicate game sets for cleanup
  app.get("/api/admin/game-sets/duplicates", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      // Get all game sets with actual playable card counts
      const allSets = await db
        .select({
          id: gameSets.id,
          setName: gameSets.setName,
          year: gameSets.year,
          sport: gameSets.sport,
          brand: gameSets.brand,
          isActive: gameSets.isActive,
          cardsImportedCount: gameSets.cardsImportedCount,
          lastImportAt: gameSets.lastImportAt,
          actualPlayableCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true
          )`.as('actual_playable_cards'),
          verifiedCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true 
            AND pc.content_verified = true
          )`.as('verified_cards'),
        })
        .from(gameSets)
        .orderBy(gameSets.setName, gameSets.year);

      // Group by set name to find duplicates
      const setGroups = new Map<string, typeof allSets>();
      for (const set of allSets) {
        const key = `${set.setName}-${set.year}-${set.sport}`;
        const group = setGroups.get(key) || [];
        group.push(set);
        setGroups.set(key, group);
      }

      // Filter to only groups with duplicates
      type SetWithCount = typeof allSets[0];
      const duplicates: { 
        key: string; 
        sets: SetWithCount[];
        recommended: string;
      }[] = [];
      
      Array.from(setGroups.entries()).forEach(([key, sets]) => {
        if (sets.length > 1) {
          // Recommend keeping the one with the most playable cards
          const recommended = sets.reduce((best: SetWithCount, current: SetWithCount) => 
            (current.actualPlayableCards || 0) > (best.actualPlayableCards || 0) ? current : best
          );
          duplicates.push({
            key,
            sets,
            recommended: recommended.id,
          });
        }
      });

      res.json({
        duplicateGroups: duplicates.length,
        totalDuplicateSets: duplicates.reduce((sum, d) => sum + d.sets.length, 0),
        duplicates,
      });
    } catch (error) {
      console.error("Error getting duplicate game sets:", error);
      res.status(500).json({ error: "Failed to get duplicate game sets" });
    }
  });

  // Admin: Cleanup duplicate game sets (deactivate all but the recommended one)
  app.post("/api/admin/game-sets/cleanup-duplicates", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      // Get all game sets with actual playable card counts
      const allSets = await db
        .select({
          id: gameSets.id,
          setName: gameSets.setName,
          year: gameSets.year,
          sport: gameSets.sport,
          isActive: gameSets.isActive,
          actualPlayableCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true
          )`.as('actual_playable_cards'),
        })
        .from(gameSets)
        .where(eq(gameSets.isActive, true));

      // Group by set name to find duplicates
      const setGroups = new Map<string, typeof allSets>();
      for (const set of allSets) {
        const key = `${set.setName}-${set.year}-${set.sport}`;
        const group = setGroups.get(key) || [];
        group.push(set);
        setGroups.set(key, group);
      }

      // Deactivate duplicates (keep the one with most cards)
      type CleanupSet = typeof allSets[0];
      const deactivated: string[] = [];
      const entries = Array.from(setGroups.entries());
      
      for (let i = 0; i < entries.length; i++) {
        const [_key, sets] = entries[i];
        if (sets.length > 1) {
          // Sort by playable cards descending - keep first, deactivate rest
          sets.sort((a: CleanupSet, b: CleanupSet) => (b.actualPlayableCards || 0) - (a.actualPlayableCards || 0));
          const toDeactivate = sets.slice(1);
          
          for (let j = 0; j < toDeactivate.length; j++) {
            const set = toDeactivate[j];
            await db
              .update(gameSets)
              .set({ isActive: false })
              .where(eq(gameSets.id, set.id));
            deactivated.push(set.id);
            console.log(`[GameSets] Deactivated duplicate set: ${set.setName} (${set.id}) with ${set.actualPlayableCards} cards`);
          }
        }
      }

      res.json({
        success: true,
        deactivatedCount: deactivated.length,
        deactivatedIds: deactivated,
      });
    } catch (error) {
      console.error("Error cleaning up duplicate game sets:", error);
      res.status(500).json({ error: "Failed to cleanup duplicate game sets" });
    }
  });

  // Admin: Repair sets - recalculate playable counts and fix stale metadata
  app.post("/api/admin/game-sets/repair", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      console.log("[Repair] Starting set repair job...");
      
      // Get all sets with their actual vs reported counts
      const allSets = await db
        .select({
          id: gameSets.id,
          setName: gameSets.setName,
          sport: gameSets.sport,
          cardsImportedCount: gameSets.cardsImportedCount,
          lastImportAt: gameSets.lastImportAt,
          isActive: gameSets.isActive,
          actualPlayableCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true 
            AND (pc.content_verified IS NULL OR pc.content_verified = true)
            AND pc.image_url IS NOT NULL
            AND pc.image_url LIKE 'https://%'
            AND pc.player IS NOT NULL
            AND pc.player != ''
            AND LOWER(pc.category) = LOWER(game_sets.sport)
          )`.as('actual_playable_cards'),
          totalCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id
          )`.as('total_cards'),
        })
        .from(gameSets)
        .orderBy(gameSets.year);
      
      const repairs: Array<{
        id: string;
        setName: string;
        oldCount: number;
        newCount: number;
        totalCards: number;
        issue: string;
      }> = [];
      
      for (const set of allSets) {
        const reportedCount = Number(set.cardsImportedCount) || 0;
        const actualCount = Number(set.actualPlayableCards) || 0;
        const totalCards = Number(set.totalCards) || 0;
        
        // Check for mismatches
        if (reportedCount !== actualCount || (totalCards > 0 && actualCount === 0)) {
          let issue = "";
          if (totalCards > 0 && actualCount === 0) {
            issue = `${totalCards} cards exist but 0 are playable - check filters`;
          } else if (reportedCount > actualCount) {
            issue = `Reported ${reportedCount} but only ${actualCount} playable`;
          } else if (reportedCount < actualCount) {
            issue = `Reported ${reportedCount} but ${actualCount} are actually playable`;
          }
          
          // Update the cardsImportedCount to match actual (though admin panel now uses computed counts)
          await db
            .update(gameSets)
            .set({ cardsImportedCount: totalCards })
            .where(eq(gameSets.id, set.id));
          
          repairs.push({
            id: set.id,
            setName: set.setName || 'Unknown',
            oldCount: reportedCount,
            newCount: actualCount,
            totalCards,
            issue,
          });
          
          console.log(`[Repair] Fixed set "${set.setName}": ${issue}`);
        }
      }
      
      console.log(`[Repair] Completed - repaired ${repairs.length} sets`);
      
      res.json({
        success: true,
        repairedCount: repairs.length,
        repairs,
      });
    } catch (error) {
      console.error("Error repairing game sets:", error);
      res.status(500).json({ error: "Failed to repair game sets" });
    }
  });

  app.post("/api/admin/game-sets/reset-timeout-quarantine", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      console.log("[QuarantineReset] Resetting cards quarantined solely due to timeouts...");
      
      const result = await db.update(playableCards)
        .set({
          quarantineStatus: "OK",
          validationFailCount: 0,
          imageFailureCount: 0,
          imageLastError: null,
          lastValidationReason: null,
          lastValidationHttpStatus: null,
          firstValidationFailAt: null,
          proposedUnplayable: false,
        })
        .where(
          and(
            eq(playableCards.isPlayable, true),
            sql`${playableCards.quarantineStatus} != 'OK'`,
            sql`LOWER(${playableCards.lastValidationReason}) LIKE '%timeout%'
              OR LOWER(${playableCards.lastValidationReason}) LIKE '%network error%'
              OR LOWER(${playableCards.lastValidationReason}) LIKE '%econnreset%'
              OR LOWER(${playableCards.lastValidationReason}) LIKE '%econnrefused%'
              OR LOWER(${playableCards.lastValidationReason}) LIKE '%etimedout%'
              OR LOWER(${playableCards.lastValidationReason}) LIKE '%abort%'`
          )
        )
        .returning({ id: playableCards.id, player: playableCards.player, gameSetId: playableCards.gameSetId });

      console.log(`[QuarantineReset] Reset ${result.length} timeout-quarantined cards to OK`);

      const setBreakdown: Record<string, number> = {};
      for (const card of result) {
        const key = card.gameSetId || "unknown";
        setBreakdown[key] = (setBreakdown[key] || 0) + 1;
      }

      res.json({
        success: true,
        resetCount: result.length,
        setBreakdown,
      });
    } catch (error) {
      console.error("Error resetting timeout quarantine:", error);
      res.status(500).json({ error: "Failed to reset timeout quarantine" });
    }
  });

  app.post("/api/admin/progress/backfill", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { backfillProgressForFinishedMatches } = await import("./services/progress/dailyProgress");
      console.log("[ProgressBackfill] Starting backfill for finished matches with progress_applied=false...");
      const result = await backfillProgressForFinishedMatches();
      console.log(`[ProgressBackfill] Done: processed=${result.matchesProcessed}, skipped=${result.matchesSkipped}, errors=${result.errors.length}`);
      res.json(result);
    } catch (error) {
      console.error("Error running progress backfill:", error);
      res.status(500).json({ error: "Failed to backfill progress" });
    }
  });

  app.post("/api/admin/wallet/reconcile", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const result = await reconcileAllWallets();
      const { reconcileCrossSystem } = await import("./services/walletReconciliation");
      const crossSystemResult = await reconcileCrossSystem();
      res.json({ walletLedger: result, crossSystem: crossSystemResult });
    } catch (error) {
      console.error("Error running wallet reconciliation:", error);
      res.status(500).json({ error: "Failed to run wallet reconciliation" });
    }
  });

  app.post("/api/admin/wallet/backfill", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { backfillUncreditedWalletPoints } = await import("./services/rewards/dailyGameplayBase");
      console.log("[WalletBackfill] Starting backfill for uncredited wallet points...");
      const result = await backfillUncreditedWalletPoints();
      console.log(`[WalletBackfill] Done: users=${result.usersProcessed}, pts=${result.totalPointsCredited}, ledger=${result.ledgerEntriesCreated}, errors=${result.errors.length}`);
      res.json(result);
    } catch (error) {
      console.error("Error running wallet backfill:", error);
      res.status(500).json({ error: "Failed to backfill wallet points" });
    }
  });

  app.post("/api/admin/wallet/backfill-awards", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { backfillPointsAwardsToWallet } = await import("./services/rewards/dailyGameplayBase");
      console.log("[PointsAwardsBackfill] Starting backfill for uncredited points_awards...");
      const result = await backfillPointsAwardsToWallet();
      console.log(`[PointsAwardsBackfill] Done: users=${result.usersProcessed}, pts=${result.totalPointsCredited}, ledger=${result.ledgerEntriesCreated}, errors=${result.errors.length}`);
      res.json(result);
    } catch (error) {
      console.error("Error running points awards backfill:", error);
      res.status(500).json({ error: "Failed to backfill points awards" });
    }
  });

  // Admin: Force re-scan cards in a game set for silhouettes
  app.post("/api/admin/game-sets/:id/rescan-silhouettes", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { analyzeImageContent } = await import("./services/imageContentAnalyzer");
      
      console.log(`[RescanSilhouettes] Starting silhouette scan for game set ${id}...`);
      
      // Get the game set
      const gameSet = await db.select().from(gameSets).where(eq(gameSets.id, id)).limit(1);
      if (!gameSet.length) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      // Get all cards in this set (even those already verified)
      const cards = await db
        .select({
          id: playableCards.id,
          imageUrl: playableCards.imageUrl,
          player: playableCards.player,
          contentVerified: playableCards.contentVerified,
        })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, id));
      
      console.log(`[RescanSilhouettes] Found ${cards.length} cards to scan`);
      
      let scanned = 0;
      let silhouettesFound = 0;
      let errors = 0;
      const BATCH_SIZE = 20;
      const PLACEHOLDER_THRESHOLD = 50;
      
      for (let i = 0; i < cards.length; i += BATCH_SIZE) {
        const batch = cards.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (card) => {
          if (!card.imageUrl) {
            return;
          }
          
          try {
            const analysis = await analyzeImageContent(card.imageUrl);
            scanned++;
            
            if (analysis.isPlaceholder && analysis.confidence >= PLACEHOLDER_THRESHOLD) {
              silhouettesFound++;
              console.log(`[RescanSilhouettes] SILHOUETTE: ${card.player?.slice(0, 25)} (${analysis.confidence}%): ${analysis.reasons[0]}`);
              
              // Mark as NOT verified (will be excluded from gameplay)
              await db
                .update(playableCards)
                .set({
                  contentVerified: false,
                  contentVerifiedAt: new Date(),
                })
                .where(eq(playableCards.id, card.id));
            } else if (card.contentVerified === null) {
              // Only mark good cards as verified if they were previously NULL (pending)
              // Don't override existing false values from other detection methods
              await db
                .update(playableCards)
                .set({
                  contentVerified: true,
                  contentVerifiedAt: new Date(),
                })
                .where(eq(playableCards.id, card.id));
            }
          } catch (err: any) {
            errors++;
            console.error(`[RescanSilhouettes] Error scanning ${card.id.slice(0, 8)}: ${err.message?.slice(0, 50)}`);
          }
        }));
        
        // Log progress every 100 cards
        if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= cards.length) {
          console.log(`[RescanSilhouettes] Progress: ${Math.min(i + BATCH_SIZE, cards.length)}/${cards.length} scanned, ${silhouettesFound} silhouettes found`);
        }
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`[RescanSilhouettes] Complete. Scanned: ${scanned}, Silhouettes: ${silhouettesFound}, Errors: ${errors}`);
      
      res.json({
        success: true,
        setName: gameSet[0].setName,
        totalCards: cards.length,
        scanned,
        silhouettesFound,
        errors,
        message: silhouettesFound > 0 
          ? `Found and blocked ${silhouettesFound} silhouette images`
          : "No silhouettes detected"
      });
    } catch (error) {
      console.error("[RescanSilhouettes] Error:", error);
      res.status(500).json({ error: "Failed to scan for silhouettes" });
    }
  });

  // Admin: Detect player name mismatches between stored data and Card Hedge API
  // Set autoQuarantine=true to automatically disable mismatched cards
  app.post("/api/admin/game-sets/:id/detect-player-mismatches", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { limit = 50, autoQuarantine = false } = req.body;
      
      console.log(`[PlayerMismatch] Starting player mismatch scan for game set ${id}...`);
      
      const gameSet = await db.select().from(gameSets).where(eq(gameSets.id, id)).limit(1);
      if (!gameSet.length) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      const cards = await db
        .select({
          id: playableCards.id,
          cardhedgeCardId: playableCards.cardhedgeCardId,
          player: playableCards.player,
          imageUrl: playableCards.imageUrl,
          isPlayable: playableCards.isPlayable,
          blockedReason: playableCards.blockedReason,
        })
        .from(playableCards)
        .where(
          and(
            eq(playableCards.gameSetId, id),
            isNotNull(playableCards.cardhedgeCardId)
          )
        )
        .limit(parseInt(String(limit), 10));
      
      console.log(`[PlayerMismatch] Checking ${cards.length} cards for player mismatches...`);
      
      const mismatches: Array<{
        cardId: string;
        storedPlayer: string | null;
        apiPlayer: string | null;
        cardHedgeId: string | null;
        imageUrl: string | null;
      }> = [];
      
      let checked = 0;
      let errors = 0;
      
      for (const card of cards) {
        if (!card.cardhedgeCardId) continue;
        
        try {
          const cardDetails = await fetchCardDetailsNormalized(card.cardhedgeCardId);
          checked++;
          
          if (cardDetails && cardDetails.player) {
            const storedNormalized = (card.player || "").trim().toLowerCase();
            const apiNormalized = (cardDetails.player || "").trim().toLowerCase();
            
            if (storedNormalized !== apiNormalized) {
              const oneContainsOther = storedNormalized.includes(apiNormalized) || apiNormalized.includes(storedNormalized);
              
              if (!oneContainsOther) {
                mismatches.push({
                  cardId: card.id,
                  storedPlayer: card.player,
                  apiPlayer: cardDetails.player,
                  cardHedgeId: card.cardhedgeCardId,
                  imageUrl: card.imageUrl,
                });
                
                console.log(`[PlayerMismatch] MISMATCH: "${card.player}" vs API "${cardDetails.player}" (${card.id.slice(0, 8)})`);
                
                // Auto-quarantine if requested (admin-initiated, uses mutation guard)
                if (autoQuarantine) {
                  const { assertMutationAllowed } = await import("./services/mutationGuard");
                  assertMutationAllowed({
                    operationSource: "ADMIN_MANUAL",
                    action: "SET_UNPLAYABLE",
                    actorUserId: (req as any).user?.id,
                    reason: `Player mismatch: stored="${card.player}" vs API="${cardDetails.player}"`,
                  });
                  await db
                    .update(playableCards)
                    .set({
                      isPlayable: false,
                      blockedReason: "player_mismatch",
                      imageReviewStatus: "excluded",
                      imageLastError: `Player mismatch: stored="${card.player}" vs API="${cardDetails.player}"`,
                      quarantineStatus: "REMOVED_BY_ADMIN",
                      updatedAt: new Date(),
                    })
                    .where(eq(playableCards.id, card.id));
                  console.log(`[PlayerMismatch] AUTO-QUARANTINED by admin: ${card.id.slice(0, 8)}`);
                }
              }
            }
          }
          
          await new Promise(r => setTimeout(r, 200));
        } catch (err: any) {
          errors++;
          console.error(`[PlayerMismatch] Error checking ${card.id.slice(0, 8)}: ${err.message?.slice(0, 50)}`);
        }
      }
      
      console.log(`[PlayerMismatch] Complete. Checked: ${checked}, Mismatches: ${mismatches.length}, Errors: ${errors}`);
      
      res.json({
        setId: id,
        setName: gameSet[0].setName,
        checked,
        mismatches: mismatches.length,
        quarantined: autoQuarantine ? mismatches.length : 0,
        errors,
        mismatchedCards: mismatches,
        message: mismatches.length > 0 
          ? autoQuarantine 
            ? `Found and quarantined ${mismatches.length} player name mismatches`
            : `Found ${mismatches.length} player name mismatches (use autoQuarantine=true to disable them)`
          : "No player name mismatches detected"
      });
    } catch (error) {
      console.error("[PlayerMismatch] Error:", error);
      res.status(500).json({ error: "Failed to detect player mismatches" });
    }
  });

  // Admin: Quarantine specific cards with player mismatches
  app.post("/api/admin/cards/quarantine-mismatches", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { cardIds } = req.body;
      
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ error: "cardIds array is required" });
      }
      
      console.log(`[PlayerMismatch] Quarantining ${cardIds.length} cards for player mismatch...`);
      
      let quarantined = 0;
      
      const { assertMutationAllowed } = await import("./services/mutationGuard");
      assertMutationAllowed({
        operationSource: "ADMIN_MANUAL",
        action: "SET_UNPLAYABLE",
        actorUserId: (req as any).user?.id,
        reason: `Bulk quarantine ${cardIds.length} cards for player mismatch`,
      });
      
      for (const cardId of cardIds) {
        try {
          await db
            .update(playableCards)
            .set({
              isPlayable: false,
              blockedReason: "player_mismatch",
              imageReviewStatus: "excluded",
              quarantineStatus: "REMOVED_BY_ADMIN",
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, cardId));
          quarantined++;
        } catch (err: any) {
          console.error(`[PlayerMismatch] Failed to quarantine ${cardId}: ${err.message}`);
        }
      }
      
      console.log(`[PlayerMismatch] Quarantined ${quarantined}/${cardIds.length} cards`);
      
      res.json({
        quarantined,
        total: cardIds.length,
        message: `Quarantined ${quarantined} cards for player mismatch`
      });
    } catch (error) {
      console.error("[PlayerMismatch] Quarantine error:", error);
      res.status(500).json({ error: "Failed to quarantine cards" });
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

  // ============================================
  // GEO INTELLIGENCE ADMIN ENDPOINTS
  // ============================================

  // Admin: Get geo stats by state
  app.get("/api/admin/geo/states", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const windowParam = req.query.window as string || "30d";
      let windowDays = 30;
      if (windowParam === "24h") windowDays = 1;
      else if (windowParam === "7d") windowDays = 7;
      else if (windowParam === "30d") windowDays = 30;
      
      const stats = await geoService.getGeoStats(windowDays);
      res.json(stats);
    } catch (error) {
      console.error("Error getting geo stats:", error);
      res.status(500).json({ error: "Failed to get geo stats" });
    }
  });

  // Admin: Get geo coverage stats
  app.get("/api/admin/geo/coverage", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const windowParam = req.query.window as string || "30d";
      let windowDays = 30;
      if (windowParam === "24h") windowDays = 1;
      else if (windowParam === "7d") windowDays = 7;
      else if (windowParam === "30d") windowDays = 30;
      
      const coverage = await geoService.getCoverageStats(windowDays);
      res.json(coverage);
    } catch (error) {
      console.error("Error getting geo coverage:", error);
      res.status(500).json({ error: "Failed to get geo coverage" });
    }
  });

  // Admin: Get user geo profile
  app.get("/api/admin/geo/user/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const geoProfile = await geoService.getUserGeoProfile(id);
      res.json(geoProfile);
    } catch (error) {
      console.error("Error getting user geo profile:", error);
      res.status(500).json({ error: "Failed to get user geo profile" });
    }
  });

  // Admin: Trigger recompute of home states
  app.post("/api/admin/geo/recompute", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const count = await geoService.computeAllHomeStates();
      await geoService.computeDailyRollups();
      res.json({ success: true, usersProcessed: count });
    } catch (error) {
      console.error("Error recomputing geo:", error);
      res.status(500).json({ error: "Failed to recompute geo" });
    }
  });

  // ============================================
  // CARD HEDGE & PLAYABLE SETS ADMIN ENDPOINTS
  // ============================================

  // Admin: Search Card Hedge with caching and rate limiting
  app.post("/api/admin/cardhedge/search", isAuthenticated, requireAdmin, async (req, res) => {
    // Get stable admin user ID for rate limiting
    const session = req.session as any;
    const adminUserId = session?.localUserId || (req.user as any)?.claims?.sub || "unknown";
    const rateLimitKey = `cardhedge-search:admin:${adminUserId}`;
    
    // Rate limiting: 120 requests/min for admin
    if (!checkRateLimit(rateLimitKey, 120, 60000)) {
      return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
    }
    
    // Input validation with additional constraints
    const rawInput = req.body;
    
    // Coerce empty strings to null
    const sanitizedInput = {
      search: rawInput.search?.trim() || null,
      set: rawInput.set?.trim() || null,
      category: rawInput.category?.trim() || null,
      player: rawInput.player?.trim() || null,
      rookie: rawInput.rookie != null ? (rawInput.rookie === "true" || rawInput.rookie === true) : null,
      raw_images_only: rawInput.raw_images_only != null ? (rawInput.raw_images_only === "true" || rawInput.raw_images_only === true) : null,
      page: parseInt(rawInput.page) || 1,
      page_size: Math.min(parseInt(rawInput.page_size) || 20, 100),
    };
    
    // Max string length validation
    const maxLen = 120;
    if (sanitizedInput.search && sanitizedInput.search.length > maxLen) {
      return res.status(422).json({ error: `search exceeds max length of ${maxLen}` });
    }
    if (sanitizedInput.set && sanitizedInput.set.length > maxLen) {
      return res.status(422).json({ error: `set exceeds max length of ${maxLen}` });
    }
    if (sanitizedInput.player && sanitizedInput.player.length > maxLen) {
      return res.status(422).json({ error: `player exceeds max length of ${maxLen}` });
    }
    
    // Generate stable cache key from sanitized input (used for both fresh read and stale fallback)
    const cacheKey = JSON.stringify(sanitizedInput);
    
    try {
      // Validate with Zod
      const validated = CardSearchRequestSchema.parse({
        search: sanitizedInput.search,
        set: sanitizedInput.set,
        category: sanitizedInput.category,
        player: sanitizedInput.player,
        rookie: sanitizedInput.rookie,
        raw_images_only: sanitizedInput.raw_images_only,
        page: sanitizedInput.page,
        page_size: sanitizedInput.page_size,
      });
      
      // Check database cache
      const [cached] = await db
        .select()
        .from(cardhedgeSearchCache)
        .where(eq(cardhedgeSearchCache.cacheKey, cacheKey))
        .limit(1);
      
      if (cached && cached.expiresAt > new Date()) {
        console.log(`[CardHedge Search] Cache HIT`);
        return res.json(cached.payload);
      }
      
      // Fetch from CardHedge API
      console.log(`[CardHedge Search] Cache MISS, fetching from API...`);
      const result = await cardSearch(validated);
      const normalized = normalizeCardSearchResponse(result);
      
      // Store in database cache
      const SEARCH_CACHE_TTL = parseInt(process.env.CARDHEDGE_CACHE_TTL_SECONDS || "300", 10);
      const expiresAt = new Date(Date.now() + SEARCH_CACHE_TTL * 1000);
      await db
        .insert(cardhedgeSearchCache)
        .values({
          cacheKey,
          payload: normalized,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: cardhedgeSearchCache.cacheKey,
          set: {
            payload: normalized,
            fetchedAt: new Date(),
            expiresAt,
          },
        });
      
      res.json(normalized);
    } catch (error: any) {
      console.error("Error searching Card Hedge:", error);
      
      // Try to return stale cache if available (uses same cacheKey from sanitized input)
      try {
        const [staleCache] = await db
          .select()
          .from(cardhedgeSearchCache)
          .where(eq(cardhedgeSearchCache.cacheKey, cacheKey))
          .limit(1);
        
        if (staleCache) {
          console.log(`[CardHedge Search] Returning stale cache due to API error`);
          return res.json(staleCache.payload);
        }
      } catch (cacheError) {
        console.error("Error checking stale cache:", cacheError);
      }
      
      if (error.name === "ZodError") {
        return res.status(422).json({ error: "Invalid request parameters", details: error.errors });
      }
      if (error.name === "CardHedgeError") {
        return res.status(503).json({ 
          error: "CARDHEDGE_UNAVAILABLE",
          message: "Card data temporarily unavailable — retrying"
        });
      }
      res.status(500).json({ error: error.message || "Failed to search Card Hedge" });
    }
  });

  // Admin: Search Card Hedge with sorting
  app.post("/api/admin/cardhedge/search-sorted", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const validated = CardSearchSortedRequestSchema.parse(req.body);
      const result = await cardSearchSorted(validated);
      res.json(result);
    } catch (error: any) {
      console.error("Error searching Card Hedge (sorted):", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid request parameters", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to search Card Hedge" });
    }
  });

  // Admin: Get Card Hedge card details
  app.post("/api/admin/cardhedge/card-details", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const validated = CardDetailsRequestSchema.parse(req.body);
      const result = await cardDetails(validated);
      res.json(result);
    } catch (error: any) {
      console.error("Error getting Card Hedge card details:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid request parameters", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to get card details" });
    }
  });

  // In-memory rate limiter
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const CACHE_TTL_SECONDS = parseInt(process.env.CARDHEDGE_CACHE_TTL_SECONDS || "600", 10);

  function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetAt < now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    
    if (entry.count >= maxRequests) {
      return false;
    }
    
    entry.count++;
    return true;
  }

  // Public: Get Card Details by ID (with caching and rate limiting)
  app.get("/api/cardhedge/card/:cardId", async (req, res) => {
    try {
      const { cardId } = req.params;
      const rawImagesOnly = req.query.rawImagesOnly === "true";
      
      // Validate cardId
      if (!cardId || cardId.length < 1) {
        return res.status(422).json({ error: "Invalid card_id" });
      }
      
      // Rate limiting: 30 requests/min/IP for public endpoint
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const rateLimitKey = `cardhedge:${clientIp}`;
      if (!checkRateLimit(rateLimitKey, 30, 60000)) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
      }
      
      // Check database cache first (using composite key: cardId + rawImagesOnly)
      const [cached] = await db
        .select()
        .from(cardDetailsCache)
        .where(and(
          eq(cardDetailsCache.cardId, cardId),
          eq(cardDetailsCache.rawImagesOnly, rawImagesOnly)
        ))
        .limit(1);
      
      if (cached && cached.expiresAt > new Date()) {
        console.log(`[CardHedge] Cache HIT for ${cardId}`);
        return res.json(cached.payload);
      }
      
      // Fetch from CardHedge API
      console.log(`[CardHedge] Cache MISS for ${cardId}, fetching from API...`);
      const normalized = await fetchCardDetailsNormalized(cardId, rawImagesOnly);
      
      if (!normalized) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      // Store in database cache (upsert by composite key)
      const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
      await db
        .insert(cardDetailsCache)
        .values({
          cardId,
          rawImagesOnly,
          payload: normalized,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [cardDetailsCache.cardId, cardDetailsCache.rawImagesOnly],
          set: {
            payload: normalized,
            fetchedAt: new Date(),
            expiresAt,
          },
        });
      
      res.json(normalized);
    } catch (error: any) {
      console.error("Error getting card details:", error);
      
      // Try to return cached data if available (even if expired)
      const { cardId } = req.params;
      const rawImagesOnly = req.query.rawImagesOnly === "true";
      
      const [staleCache] = await db
        .select()
        .from(cardDetailsCache)
        .where(and(
          eq(cardDetailsCache.cardId, cardId),
          eq(cardDetailsCache.rawImagesOnly, rawImagesOnly)
        ))
        .limit(1);
      
      if (staleCache) {
        console.log(`[CardHedge] Returning stale cache for ${cardId} due to API error`);
        return res.json(staleCache.payload);
      }
      
      res.status(503).json({
        error: "CARD_DATA_TEMPORARILY_UNAVAILABLE",
        message: "Card image temporarily unavailable - retrying"
      });
    }
  });

  // Gameplay helper: Get card image for gameplay (prefers raw images)
  app.get("/api/cardhedge/gameplay-image/:cardId", async (req, res) => {
    try {
      const { cardId } = req.params;
      
      if (!cardId) {
        return res.status(422).json({ error: "Invalid card_id" });
      }
      
      // Rate limiting: 60 requests/min/IP for gameplay
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const rateLimitKey = `gameplay:${clientIp}`;
      if (!checkRateLimit(rateLimitKey, 60, 60000)) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }
      
      // Try raw images first (preferred for gameplay)
      let normalized = await fetchCardDetailsNormalized(cardId, true);
      
      // Fallback to standard image if no raw image
      if (!normalized?.imageUrl) {
        normalized = await fetchCardDetailsNormalized(cardId, false);
      }
      
      if (!normalized) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      res.json({
        cardId: normalized.cardId,
        imageUrl: normalized.imageUrl,
        player: normalized.player,
      });
    } catch (error: any) {
      console.error("Error getting gameplay image:", error);
      res.status(503).json({
        error: "CARD_DATA_TEMPORARILY_UNAVAILABLE",
        message: "Card image temporarily unavailable"
      });
    }
  });

  // Zod schemas for playable sets validation
  const CreatePlayableSetSchema = z.object({
    sport: z.string().min(1, "sport is required"),
    brand: z.string().min(1, "brand is required"),
    year: z.coerce.number().int().min(1850).max(2100),
    setName: z.string().min(1, "setName is required"),
    cardhedgeSetQuery: z.string().optional(),
    cardhedgeCategory: z.string().optional(),
    marketplaceKeywords: z.array(z.string()).optional().default([]),
  });

  const UpdatePlayableSetSchema = z.object({
    sport: z.string().min(1).optional(),
    brand: z.string().min(1).optional(),
    year: z.coerce.number().int().min(1850).max(2100).optional(),
    setName: z.string().min(1).optional(),
    cardhedgeSetQuery: z.string().nullable().optional(),
    cardhedgeCategory: z.string().nullable().optional(),
    marketplaceKeywords: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  });

  // Admin: Create playable set (game set with Card Hedge config)
  app.post("/api/admin/playable-sets", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const validated = CreatePlayableSetSchema.parse(req.body);
      
      const [newSet] = await db
        .insert(gameSets)
        .values({
          sport: validated.sport,
          brand: validated.brand,
          year: validated.year,
          setName: validated.setName,
          cardhedgeSetQuery: validated.cardhedgeSetQuery || validated.setName,
          cardhedgeCategory: validated.cardhedgeCategory || validated.sport.charAt(0).toUpperCase() + validated.sport.slice(1),
          marketplaceKeywords: validated.marketplaceKeywords,
          isActive: true,
        })
        .returning();
      
      res.json(newSet);
    } catch (error: any) {
      console.error("Error creating playable set:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid request parameters", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create playable set" });
    }
  });

  // Admin: Update playable set
  app.put("/api/admin/playable-sets/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validated = UpdatePlayableSetSchema.parse(req.body);
      
      const updateData: any = {};
      if (validated.sport !== undefined) updateData.sport = validated.sport;
      if (validated.brand !== undefined) updateData.brand = validated.brand;
      if (validated.year !== undefined) updateData.year = validated.year;
      if (validated.setName !== undefined) updateData.setName = validated.setName;
      if (validated.cardhedgeSetQuery !== undefined) updateData.cardhedgeSetQuery = validated.cardhedgeSetQuery;
      if (validated.cardhedgeCategory !== undefined) updateData.cardhedgeCategory = validated.cardhedgeCategory;
      if (validated.marketplaceKeywords !== undefined) updateData.marketplaceKeywords = validated.marketplaceKeywords;
      if (validated.isActive !== undefined) updateData.isActive = validated.isActive;
      
      const [updated] = await db
        .update(gameSets)
        .set(updateData)
        .where(eq(gameSets.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Playable set not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating playable set:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid request parameters", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update playable set" });
    }
  });

  // Admin: Import cards from Card Hedge for a set
  app.post("/api/admin/playable-sets/:id/import", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const MAX_PAGE_SIZE = 100;
      const rawPageSize = parseInt(req.body.page_size || "100", 10);
      const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE);
      
      const [gameSet] = await db
        .select()
        .from(gameSets)
        .where(eq(gameSets.id, id));
      
      if (!gameSet) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      if (!gameSet.cardhedgeSetQuery) {
        return res.status(400).json({ error: "Game set has no cardhedgeSetQuery configured" });
      }
      
      const [importRun] = await db
        .insert(cardhedgeImportRuns)
        .values({
          gameSetId: id,
          status: "RUNNING",
          pageSize,
        })
        .returning();
      
      try {
        const { classifyCard } = await import("./services/cardClassifier");
        
        let page = 1;
        let totalCardsImported = 0;
        let wrongSportSkipped = 0;
        let hasMorePages = true;
        
        // Normalize sport for comparison (e.g., "basketball" vs "Basketball")
        const expectedSport = gameSet.sport.toLowerCase();
        
        while (hasMorePages) {
          // Use cardSearch instead of cardSearchSorted - the sorted endpoint returns many cards with empty images
          const result = await cardSearch({
            set: gameSet.cardhedgeSetQuery,
            category: gameSet.cardhedgeCategory || undefined,
            page,
            page_size: pageSize,
          });
          
          if (!result.cards || result.cards.length === 0) {
            hasMorePages = false;
            break;
          }
          
          for (const card of result.cards) {
            if (!card.card_id) continue;
            
            // Validate sport category positively matches the game set's sport
            // Cards with missing/empty category are skipped since we can't verify their sport
            const cardCategory = (card.category || "").toLowerCase().trim();
            if (cardCategory !== expectedSport) {
              const reason = cardCategory 
                ? `category "${card.category}" does not match set sport "${gameSet.sport}"`
                : `missing category field, expected sport "${gameSet.sport}"`;
              console.log(`[CardHedge Import] SKIPPING wrong-sport card: ${card.card_id} - ${reason} - ${card.player || card.description}`);
              wrongSportSkipped++;
              continue;
            }
            
            // Use shared classifier to determine playability
            const classification = classifyCard({ player: card.player, description: card.description });
            const { isPlayable, blockedReason } = classification;
            
            if (!isPlayable) {
              console.log(`[CardHedge Import] Marking non-playable card: ${card.card_id} - ${blockedReason} - ${card.player || card.description}`);
            }
            
            const imageUrl = normalizeImageUrl(card.image);
            
            await db
              .insert(playableCards)
              .values({
                gameSetId: id,
                cardhedgeCardId: card.card_id,
                description: card.description,
                player: card.player,
                set: card.set,
                number: card.number,
                variant: card.variant,
                imageUrl,
                category: card.category,
                rookie: card.rookie,
                isPlayable,
                blockedReason,
              })
              .onConflictDoUpdate({
                target: playableCards.cardhedgeCardId,
                set: {
                  description: card.description,
                  player: card.player,
                  set: card.set,
                  number: card.number,
                  variant: card.variant,
                  imageUrl,
                  category: card.category,
                  rookie: card.rookie,
                  isPlayable,
                  blockedReason,
                  updatedAt: new Date(),
                },
              });
            
            totalCardsImported++;
          }
          
          await db
            .update(cardhedgeImportRuns)
            .set({ pagesFetched: page, cardsImported: totalCardsImported })
            .where(eq(cardhedgeImportRuns.id, importRun.id));
          
          const totalPages = result.pages || 1;
          if (page >= totalPages) {
            hasMorePages = false;
          } else {
            page++;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        await db
          .update(cardhedgeImportRuns)
          .set({
            status: "SUCCESS",
            finishedAt: new Date(),
            pagesFetched: page,
            cardsImported: totalCardsImported,
          })
          .where(eq(cardhedgeImportRuns.id, importRun.id));
        
        await db
          .update(gameSets)
          .set({
            cardsImportedCount: totalCardsImported,
            lastImportAt: new Date(),
          })
          .where(eq(gameSets.id, id));
        
        if (wrongSportSkipped > 0) {
          console.log(`[CardHedge Import] Completed: ${totalCardsImported} cards imported, ${wrongSportSkipped} wrong-sport cards skipped`);
        }
        
        res.json({
          success: true,
          importRunId: importRun.id,
          cardsImported: totalCardsImported,
          wrongSportSkipped,
          pagesFetched: page,
        });
      } catch (importError: any) {
        await db
          .update(cardhedgeImportRuns)
          .set({
            status: "FAILED",
            finishedAt: new Date(),
            error: importError.message || "Unknown error",
          })
          .where(eq(cardhedgeImportRuns.id, importRun.id));
        
        throw importError;
      }
    } catch (error: any) {
      console.error("Error importing cards:", error);
      res.status(500).json({ error: error.message || "Failed to import cards" });
    }
  });

  // Admin: Purge all cards from a set and re-import from Card Hedge
  // SAFE IMPORT: Fetches cards first, computes playable count, only purges if would_import > 0
  app.post("/api/admin/playable-sets/:id/purge-reimport", isAuthenticated, requireAdmin, async (req, res) => {
    // Reject reason enum for debugging
    const REJECT_REASONS = {
      MISSING_IMAGE: 'MISSING_IMAGE',
      BAD_URL: 'BAD_URL',
      WRONG_SPORT: 'WRONG_SPORT',
      NO_PLAYER: 'NO_PLAYER',
      CLASSIFIER_REJECTED: 'CLASSIFIER_REJECTED',
      OTHER: 'OTHER',
    } as const;
    type RejectReason = typeof REJECT_REASONS[keyof typeof REJECT_REASONS];
    
    try {
      const { id } = req.params;
      
      // Get game set
      const [gameSet] = await db
        .select()
        .from(gameSets)
        .where(eq(gameSets.id, id))
        .limit(1);
      
      if (!gameSet) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      if (!gameSet.cardhedgeSetQuery) {
        return res.status(400).json({ error: "This set doesn't have a Card Hedge query configured" });
      }
      
      // Count existing cards before any changes
      const [existingCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, id));
      
      const existingCardCount = existingCount?.count || 0;
      
      console.log(`[Purge & Reimport] Starting SAFE import for set "${gameSet.setName}" (${id})`);
      console.log(`[Purge & Reimport] Existing cards: ${existingCardCount}`);
      
      const MAX_PAGE_SIZE = 100;
      const rawPageSize = parseInt(req.body.page_size || "100", 10);
      const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE);
      
      const { classifyCard } = await import("./services/cardClassifier");
      const expectedSport = gameSet.sport.toLowerCase();
      
      // ===== PHASE 1: DRY-RUN FETCH =====
      // Fetch all cards and compute would-be-playable count BEFORE purging
      interface CardToImport {
        card_id: string;
        description: string | null;
        player: string | null;
        set: string | null;
        number: string | null;
        variant: string | null;
        imageUrl: string | null;
        category: string | null;
        rookie: boolean | null;
        isPlayable: boolean;
        blockedReason: string | null;
      }
      
      const cardsToImport: CardToImport[] = [];
      const rejectReasons: Record<RejectReason, number> = {
        MISSING_IMAGE: 0,
        BAD_URL: 0,
        WRONG_SPORT: 0,
        NO_PLAYER: 0,
        CLASSIFIER_REJECTED: 0,
        OTHER: 0,
      };
      let totalFetched = 0;
      let pagesFetched = 0;
      
      // Log first 10 fetched cards for debugging
      const debugSampleCards: any[] = [];
      
      console.log(`[Purge & Reimport] PHASE 1: Dry-run fetch to compute would-be-playable count...`);
      
      let page = 1;
      let hasMorePages = true;
      
      while (hasMorePages) {
        // Use cardSearch instead of cardSearchSorted - the sorted endpoint returns many cards with empty images
        const result = await cardSearch({
          set: gameSet.cardhedgeSetQuery,
          category: gameSet.cardhedgeCategory || undefined,
          page,
          page_size: pageSize,
        });
        
        pagesFetched++;
        
        if (!result.cards || result.cards.length === 0) {
          hasMorePages = false;
          break;
        }
        
        for (const card of result.cards) {
          if (!card.card_id) continue;
          totalFetched++;
          
          // Log first 10 cards for debugging
          if (debugSampleCards.length < 10) {
            debugSampleCards.push({
              card_id: card.card_id,
              player: card.player,
              raw_image: card.image,
              category: card.category,
            });
          }
          
          // Check sport category
          const cardCategory = (card.category || "").toLowerCase().trim();
          if (cardCategory !== expectedSport) {
            rejectReasons.WRONG_SPORT++;
            continue;
          }
          
          // Check image URL - must be https:// (normalizeImageUrl upgrades http:// to https://)
          const imageUrl = normalizeImageUrl(card.image);
          if (!imageUrl) {
            rejectReasons.MISSING_IMAGE++;
            continue;
          }
          if (!imageUrl.startsWith('https://')) {
            rejectReasons.BAD_URL++;
            continue;
          }
          
          // Check player field
          if (!card.player || card.player.trim() === '') {
            rejectReasons.NO_PLAYER++;
            continue;
          }
          
          // Run classifier
          const classification = classifyCard({ player: card.player, description: card.description });
          if (!classification.isPlayable) {
            rejectReasons.CLASSIFIER_REJECTED++;
            // Still add to import list but marked as non-playable
          }
          
          cardsToImport.push({
            card_id: card.card_id,
            description: card.description || null,
            player: card.player || null,
            set: card.set || null,
            number: card.number || null,
            variant: card.variant || null,
            imageUrl,
            category: card.category || null,
            rookie: card.rookie ?? null,
            isPlayable: classification.isPlayable,
            blockedReason: classification.blockedReason,
          });
        }
        
        hasMorePages = result.pages ? page < result.pages : result.cards.length === pageSize;
        page++;
        
        if (page > 50) {
          console.log(`[Purge & Reimport] Stopping at page 50 safety limit`);
          break;
        }
      }
      
      // Compute would-be-playable count
      const wouldBePlayable = cardsToImport.filter(c => c.isPlayable && c.imageUrl && c.player).length;
      
      console.log(`[Purge & Reimport] DRY-RUN RESULTS:`);
      console.log(`  Total fetched: ${totalFetched}`);
      console.log(`  Would import: ${cardsToImport.length}`);
      console.log(`  Would be playable: ${wouldBePlayable}`);
      console.log(`  Reject reasons: ${JSON.stringify(rejectReasons)}`);
      console.log(`  Sample cards (first 10):`, debugSampleCards);
      
      // ===== SAFE PURGE CHECK =====
      // If would_import_playable_count == 0, do NOT purge
      if (wouldBePlayable === 0) {
        console.warn(`[Purge & Reimport] ABORTING: Would import 0 playable cards. Keeping existing ${existingCardCount} cards.`);
        
        // Find top reject reason
        const topRejectReason = Object.entries(rejectReasons)
          .filter(([_, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => `${reason}=${count}`)
          .slice(0, 3)
          .join(', ');
        
        return res.json({
          success: false,
          status: "aborted",
          cardsPurged: 0,
          cardsImported: 0,
          playableCount: 0,
          totalFetched,
          existingCardsKept: existingCardCount,
          warning: `Import aborted: 0 playable cards. Kept existing ${existingCardCount} cards. Top reject reasons: ${topRejectReason || 'none'}`,
          rejectReasons,
          debugSampleCards: debugSampleCards.slice(0, 5),
        });
      }
      
      // ===== PHASE 2: ACTUAL PURGE & IMPORT =====
      console.log(`[Purge & Reimport] PHASE 2: Proceeding with purge and import (${wouldBePlayable} playable cards)...`);
      
      // Create import run record
      const [importRun] = await db
        .insert(cardhedgeImportRuns)
        .values({
          gameSetId: id,
          status: "running",
          pageSize,
          pagesFetched,
          cardsImported: 0,
        })
        .returning();
      
      try {
        // First, delete any card_image_reports for cards in this set (to avoid FK constraint)
        const { cardImageReports } = await import("@shared/schema");
        const cardIdsInSet = await db
          .select({ id: playableCards.id })
          .from(playableCards)
          .where(eq(playableCards.gameSetId, id));
        
        if (cardIdsInSet.length > 0) {
          const cardIds = cardIdsInSet.map(c => c.id);
          await db
            .delete(cardImageReports)
            .where(inArray(cardImageReports.cardId, cardIds));
          console.log(`[Purge & Reimport] Deleted card_image_reports for ${cardIds.length} cards`);
        }
        
        // Delete all existing cards for this set
        await db
          .delete(playableCards)
          .where(eq(playableCards.gameSetId, id));
        
        const cardsPurged = existingCardCount;
        console.log(`[Purge & Reimport] Purged ${cardsPurged} cards, now inserting ${cardsToImport.length}...`);
        
        // Insert all cards from dry-run
        let totalCardsImported = 0;
        for (const card of cardsToImport) {
          await db
            .insert(playableCards)
            .values({
              gameSetId: id,
              cardhedgeCardId: card.card_id,
              description: card.description,
              player: card.player,
              set: card.set,
              number: card.number,
              variant: card.variant,
              imageUrl: card.imageUrl,
              category: card.category,
              rookie: card.rookie,
              isPlayable: card.isPlayable,
              blockedReason: card.blockedReason,
              contentVerified: null, // New imports pending verification (NULL passes playable check)
              imageFailureCount: 0,
            })
            .onConflictDoUpdate({
              target: playableCards.cardhedgeCardId,
              set: {
                gameSetId: id,
                description: card.description,
                player: card.player,
                set: card.set,
                number: card.number,
                variant: card.variant,
                imageUrl: card.imageUrl,
                category: card.category,
                rookie: card.rookie,
                isPlayable: card.isPlayable,
                blockedReason: card.blockedReason,
                contentVerified: null, // Re-import resets to pending
                imageFailureCount: 0, // Reset failure count on reimport
              },
            });
          
          totalCardsImported++;
        }
        
        // Update progress
        await db
          .update(cardhedgeImportRuns)
          .set({
            pagesFetched,
            cardsImported: totalCardsImported,
          })
          .where(eq(cardhedgeImportRuns.id, importRun.id));
        
        // Update final counts
        await db
          .update(gameSets)
          .set({ cardsImportedCount: totalCardsImported, lastImportAt: new Date() })
          .where(eq(gameSets.id, id));
        
        await db
          .update(cardhedgeImportRuns)
          .set({
            status: "completed",
            finishedAt: new Date(),
            pagesFetched,
            cardsImported: totalCardsImported,
          })
          .where(eq(cardhedgeImportRuns.id, importRun.id));
        
        // FORENSIC DIAGNOSTICS: Compute actual playable card counts after import
        const [forensicCounts] = await db
          .select({
            totalInserted: sql<number>`COUNT(*)`.as('total_inserted'),
            isPlayableTrue: sql<number>`SUM(CASE WHEN is_playable = true THEN 1 ELSE 0 END)`.as('is_playable_true'),
            contentVerifiedTrue: sql<number>`SUM(CASE WHEN content_verified = true THEN 1 ELSE 0 END)`.as('content_verified_true'),
            contentVerifiedNull: sql<number>`SUM(CASE WHEN content_verified IS NULL THEN 1 ELSE 0 END)`.as('content_verified_null'),
            contentVerifiedFalse: sql<number>`SUM(CASE WHEN content_verified = false THEN 1 ELSE 0 END)`.as('content_verified_false'),
            hasValidImage: sql<number>`SUM(CASE WHEN image_url IS NOT NULL AND image_url LIKE 'https://%' THEN 1 ELSE 0 END)`.as('has_valid_image'),
            matchingSport: sql<number>`SUM(CASE WHEN LOWER(category) = LOWER(${gameSet.sport}) THEN 1 ELSE 0 END)`.as('matching_sport'),
          })
          .from(playableCards)
          .where(eq(playableCards.gameSetId, id));
        
        // Get actual playable count using the same logic as admin list (for gameplay)
        const [actualPlayable] = await db
          .select({ count: sql<number>`COUNT(*)`.as('count') })
          .from(playableCards)
          .where(
            and(
              eq(playableCards.gameSetId, id),
              eq(playableCards.isPlayable, true),
              // Allow NULL or true for content_verified (same as getRandomCardsFromSet)
              or(isNull(playableCards.contentVerified), eq(playableCards.contentVerified, true)),
              isNotNull(playableCards.imageUrl),
              like(playableCards.imageUrl, 'https://%'),
              isNotNull(playableCards.player),
              ne(playableCards.player, ''),
              sql`LOWER(${playableCards.category}) = LOWER(${gameSet.sport})`
            )
          );
        
        const playableCount = Number(actualPlayable?.count) || 0;
        
        // Log forensic diagnostics
        console.log(`[Purge & Reimport] FORENSIC DIAGNOSTICS for set "${gameSet.setName}" (${id}):`);
        console.log(`  Total inserted: ${forensicCounts.totalInserted}`);
        console.log(`  is_playable=true: ${forensicCounts.isPlayableTrue}`);
        console.log(`  content_verified=true: ${forensicCounts.contentVerifiedTrue}, null: ${forensicCounts.contentVerifiedNull}, false: ${forensicCounts.contentVerifiedFalse}`);
        console.log(`  has_valid_image: ${forensicCounts.hasValidImage}`);
        console.log(`  matching_sport (${gameSet.sport}): ${forensicCounts.matchingSport}`);
        console.log(`  ACTUAL PLAYABLE for gameplay: ${playableCount}`);
        
        // Sample 3 inserted rows for debugging
        const sampleCards = await db
          .select({
            id: playableCards.id,
            gameSetId: playableCards.gameSetId,
            cardhedgeCardId: playableCards.cardhedgeCardId,
            player: playableCards.player,
            imageUrl: playableCards.imageUrl,
            isPlayable: playableCards.isPlayable,
            contentVerified: playableCards.contentVerified,
            category: playableCards.category,
            createdAt: playableCards.createdAt,
          })
          .from(playableCards)
          .where(eq(playableCards.gameSetId, id))
          .limit(3);
        
        console.log(`  Sample inserted cards:`, sampleCards.map(c => ({
          id: c.id.slice(0, 8) + '...',
          player: c.player,
          isPlayable: c.isPlayable,
          contentVerified: c.contentVerified,
          category: c.category,
        })));
        
        // WARNING if imported > 0 but playable = 0
        let status = "completed";
        let warning: string | undefined;
        if (totalCardsImported > 0 && playableCount === 0) {
          status = "warning";
          warning = `CRITICAL: Imported ${totalCardsImported} cards but 0 are playable. Check content_verified flags or category matching.`;
          console.warn(`[Purge & Reimport] ${warning}`);
        }
        
        console.log(`[Purge & Reimport] Completed: ${cardsPurged} purged, ${totalCardsImported} imported, ${playableCount} playable, ${rejectReasons.WRONG_SPORT} wrong-sport skipped`);
        
        // Log set-integrity summary (per spec Part B.3)
        console.log(`[Purge & Reimport] SET-INTEGRITY SUMMARY for ${id}:`);
        console.log(`  canonical_cards_total: ${forensicCounts.totalInserted}`);
        console.log(`  canonical_cards_playable: ${playableCount}`);
        console.log(`  admin_list_count: ${playableCount}`);
        console.log(`  flags_breakdown: is_playable=${forensicCounts.isPlayableTrue}, content_verified=(true=${forensicCounts.contentVerifiedTrue}, null=${forensicCounts.contentVerifiedNull}, false=${forensicCounts.contentVerifiedFalse}), has_valid_image=${forensicCounts.hasValidImage}`);
        
        res.json({
          success: true,
          cardsPurged,
          cardsImported: totalCardsImported,
          playableCount,
          totalFetched,
          pagesFetched,
          rejectReasons,
          importRunId: importRun.id,
          status,
          warning,
          forensics: {
            totalInserted: Number(forensicCounts.totalInserted) || 0,
            isPlayableTrue: Number(forensicCounts.isPlayableTrue) || 0,
            contentVerified: {
              true: Number(forensicCounts.contentVerifiedTrue) || 0,
              null: Number(forensicCounts.contentVerifiedNull) || 0,
              false: Number(forensicCounts.contentVerifiedFalse) || 0,
            },
            hasValidImage: Number(forensicCounts.hasValidImage) || 0,
            matchingSport: Number(forensicCounts.matchingSport) || 0,
          },
        });
      } catch (importError: any) {
        await db
          .update(cardhedgeImportRuns)
          .set({
            status: "failed",
            finishedAt: new Date(),
            error: importError.message,
          })
          .where(eq(cardhedgeImportRuns.id, importRun.id));
        
        throw importError;
      }
    } catch (error: any) {
      console.error("Error in purge & reimport:", error);
      res.status(500).json({ error: error.message || "Failed to purge and reimport cards" });
    }
  });

  // Admin: Get import runs for a set
  app.get("/api/admin/playable-sets/:id/imports", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const runs = await db
        .select()
        .from(cardhedgeImportRuns)
        .where(eq(cardhedgeImportRuns.gameSetId, id))
        .orderBy(desc(cardhedgeImportRuns.startedAt))
        .limit(10);
      
      res.json(runs);
    } catch (error) {
      console.error("Error getting import runs:", error);
      res.status(500).json({ error: "Failed to get import runs" });
    }
  });

  // Admin: Get quarantine status for a set (shows Total, Playable, Quarantined counts)
  app.get("/api/admin/playable-sets/:id/quarantine-status", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const [counts] = await db.select({
        totalCards: sql<number>`count(*)`,
        playableCards: sql<number>`count(*) filter (where ${playableCards.isPlayable} = true)`,
        excludedCards: sql<number>`count(*) filter (where ${playableCards.isPlayable} = false)`,
        quarantinedCards: sql<number>`count(*) filter (where ${playableCards.quarantineStatus} != 'OK')`,
        proposedUnplayable: sql<number>`count(*) filter (where ${playableCards.proposedUnplayable} = true)`,
        suspectTransient: sql<number>`count(*) filter (where ${playableCards.quarantineStatus} = 'SUSPECT_TRANSIENT')`,
        suspectPersistent: sql<number>`count(*) filter (where ${playableCards.quarantineStatus} = 'SUSPECT_PERSISTENT')`,
        awaitingAdminReview: sql<number>`count(*) filter (where ${playableCards.quarantineStatus} = 'QUARANTINED_ADMIN_REVIEW')`,
      })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, id));
      
      res.json({
        setId: id,
        totalCards: Number(counts.totalCards) || 0,
        playableCards: Number(counts.playableCards) || 0,
        excludedCards: Number(counts.excludedCards) || 0,
        quarantinedCards: Number(counts.quarantinedCards) || 0,
        proposedUnplayable: Number(counts.proposedUnplayable) || 0,
        breakdown: {
          suspectTransient: Number(counts.suspectTransient) || 0,
          suspectPersistent: Number(counts.suspectPersistent) || 0,
          awaitingAdminReview: Number(counts.awaitingAdminReview) || 0,
        }
      });
    } catch (error) {
      console.error("Error getting quarantine status:", error);
      res.status(500).json({ error: "Failed to get quarantine status" });
    }
  });

  // Admin: Apply proposed unplayable changes for a set (ADMIN_MANUAL operation)
  app.post("/api/admin/playable-sets/:id/apply-proposed", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user as User;
      
      const { applyProposedChanges } = await import("./services/imageValidation");
      const result = await applyProposedChanges(id, user.id);
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: result.errors[0], applied: result.applied });
      }
      
      res.json({
        success: true,
        applied: result.applied,
        message: `Applied ${result.applied} proposed changes. Cards are now marked unplayable.`
      });
    } catch (error) {
      console.error("Error applying proposed changes:", error);
      res.status(500).json({ error: "Failed to apply proposed changes" });
    }
  });

  // Admin: Get audit log for a set
  app.get("/api/admin/playable-sets/:id/audit-log", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { limit: limitParam = "50" } = req.query;
      const limitNum = Math.min(parseInt(String(limitParam), 10) || 50, 200);
      
      const logs = await db
        .select()
        .from(setAuditLog)
        .where(eq(setAuditLog.setId, id))
        .orderBy(desc(setAuditLog.createdAt))
        .limit(limitNum);
      
      res.json(logs);
    } catch (error) {
      console.error("Error getting audit log:", error);
      res.status(500).json({ error: "Failed to get audit log" });
    }
  });

  // Admin: Get global audit log (all sets)
  app.get("/api/admin/audit-log", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { limit: limitParam = "100", operationSource } = req.query;
      const limitNum = Math.min(parseInt(String(limitParam), 10) || 100, 500);
      
      const whereCondition = operationSource && typeof operationSource === 'string' 
        ? eq(setAuditLog.operationSource, operationSource) 
        : undefined;
      
      const logs = await db
        .select()
        .from(setAuditLog)
        .where(whereCondition)
        .orderBy(desc(setAuditLog.createdAt))
        .limit(limitNum);
      
      res.json(logs);
    } catch (error) {
      console.error("Error getting global audit log:", error);
      res.status(500).json({ error: "Failed to get audit log" });
    }
  });

  // Admin: Test card distribution - verify random selection works across full set
  app.post("/api/admin/playable-sets/:id/test-distribution", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { trials = 50, cardsPerTrial = 10 } = req.body;
      
      const [gameSet] = await db
        .select()
        .from(gameSets)
        .where(eq(gameSets.id, id));
      
      if (!gameSet) {
        return res.status(404).json({ error: "Game set not found" });
      }
      
      const totalCards = await db
        .select({ count: sql<number>`count(*)` })
        .from(playableCards)
        .where(eq(playableCards.gameSetId, id));
      
      const totalCardCount = Number(totalCards[0]?.count || 0);
      
      if (totalCardCount === 0) {
        return res.status(400).json({ error: "No cards in this set. Run import first." });
      }
      
      const cardSelectionCounts = new Map<string, number>();
      
      for (let trial = 0; trial < trials; trial++) {
        const selectedCards = await storage.getRandomCardsFromSet(id, cardsPerTrial);
        
        for (const card of selectedCards) {
          const count = cardSelectionCounts.get(card.id) || 0;
          cardSelectionCounts.set(card.id, count + 1);
        }
      }
      
      const uniqueCardsSelected = cardSelectionCounts.size;
      const coveragePercentage = (uniqueCardsSelected / totalCardCount) * 100;
      
      const selectionCounts = Array.from(cardSelectionCounts.values());
      const avgSelections = selectionCounts.length > 0 
        ? selectionCounts.reduce((a, b) => a + b, 0) / selectionCounts.length 
        : 0;
      const maxSelections = Math.max(...selectionCounts, 0);
      const minSelections = Math.min(...selectionCounts, 0);
      
      const expectedSelectionsPerCard = (trials * cardsPerTrial) / totalCardCount;
      
      res.json({
        setId: id,
        setName: gameSet.setName,
        testParameters: {
          trials,
          cardsPerTrial,
          totalSelectionsAttempted: trials * cardsPerTrial,
        },
        results: {
          totalCardsInSet: totalCardCount,
          uniqueCardsSelected,
          coveragePercentage: coveragePercentage.toFixed(2) + "%",
          expectedSelectionsPerCard: expectedSelectionsPerCard.toFixed(2),
          actualAvgSelectionsPerCard: avgSelections.toFixed(2),
          minSelections,
          maxSelections,
        },
        analysis: {
          distributionIsRandom: uniqueCardsSelected > totalCardCount * 0.3,
          fullSetAccessible: uniqueCardsSelected > 0 && coveragePercentage > 50,
          recommendation: coveragePercentage < 50 
            ? "Low coverage - check if cards are being properly randomized"
            : coveragePercentage < 80
            ? "Good coverage - run more trials for better assessment"
            : "Excellent coverage - randomization is working well",
        },
      });
    } catch (error) {
      console.error("Error testing distribution:", error);
      res.status(500).json({ error: "Failed to test card distribution" });
    }
  });

  // Public: Get active playable sets with card counts
  // Deduplicates sets with the same name, returning only the one with the most playable cards
  app.get("/api/playable-sets", async (_req, res) => {
    try {
      // Get all active sets with actual playable card counts
      const setsWithCounts = await db
        .select({
          id: gameSets.id,
          sport: gameSets.sport,
          brand: gameSets.brand,
          year: gameSets.year,
          setName: gameSets.setName,
          league: gameSets.league,
          cardsImportedCount: gameSets.cardsImportedCount,
          lastImportAt: gameSets.lastImportAt,
          // Get actual verified playable card count using correlated subquery
          // Must match getRandomCardsFromSet() logic exactly
          actualPlayableCards: sql<number>`(
            SELECT COUNT(*) FROM playable_cards pc 
            WHERE pc.game_set_id = game_sets.id 
            AND pc.is_playable = true 
            AND (pc.content_verified IS NULL OR pc.content_verified = true)
            AND pc.image_url IS NOT NULL 
            AND pc.image_url != ''
            AND pc.image_url LIKE 'https://%'
            AND pc.player IS NOT NULL 
            AND pc.player != ''
            AND LOWER(pc.category) = LOWER(game_sets.sport)
          )`.as('actual_playable_cards'),
        })
        .from(gameSets)
        .where(eq(gameSets.isActive, true))
        .orderBy(gameSets.year, gameSets.setName);
      
      // Deduplicate: keep only the set with the most actual playable cards for each setName
      const deduplicatedMap = new Map<string, typeof setsWithCounts[0]>();
      const duplicatesFound: string[] = [];
      
      for (const set of setsWithCounts) {
        const key = `${set.setName}-${set.year}-${set.sport}`;
        const existing = deduplicatedMap.get(key);
        
        if (existing) {
          // Duplicate found - keep the one with more playable cards
          duplicatesFound.push(set.setName || 'Unknown');
          if ((set.actualPlayableCards || 0) > (existing.actualPlayableCards || 0)) {
            deduplicatedMap.set(key, set);
          }
        } else {
          deduplicatedMap.set(key, set);
        }
      }
      
      // Log warning if duplicates were found
      if (duplicatesFound.length > 0) {
        const uniqueDuplicates = Array.from(new Set(duplicatesFound));
        console.warn(`[GameSets] Duplicate active sets detected and deduplicated: ${uniqueDuplicates.join(', ')}. Run /api/admin/game-sets/duplicates to review.`);
      }
      
      // Convert map back to array and use actualPlayableCards for display
      const deduplicated = Array.from(deduplicatedMap.values()).map(set => ({
        id: set.id,
        sport: set.sport,
        brand: set.brand,
        year: set.year,
        setName: set.setName,
        league: set.league,
        // Use actual playable card count instead of stale cardsImportedCount
        cardsImportedCount: set.actualPlayableCards || set.cardsImportedCount,
        lastImportAt: set.lastImportAt,
      }));
      
      res.json(deduplicated);
    } catch (error) {
      console.error("Error getting playable sets:", error);
      res.status(500).json({ error: "Failed to get playable sets" });
    }
  });

  // Public: Get cards from a playable set (for gameplay)
  app.get("/api/playable-sets/:id/cards", async (req, res) => {
    try {
      const { id } = req.params;
      const { random, limit = "20", offset = "0", player, number } = req.query;
      
      const conditions = [eq(playableCards.gameSetId, id)];
      
      if (player) {
        conditions.push(sql`${playableCards.player} ILIKE ${"%" + player + "%"}`);
      }
      
      if (number) {
        conditions.push(eq(playableCards.number, number as string));
      }
      
      const orderByClause = random === "1" || random === "true" 
        ? sql`RANDOM()` 
        : playableCards.player;
      
      const cards = await db
        .select()
        .from(playableCards)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(parseInt(limit as string, 10))
        .offset(parseInt(offset as string, 10));
      
      res.json(cards);
    } catch (error) {
      console.error("Error getting playable cards:", error);
      res.status(500).json({ error: "Failed to get playable cards" });
    }
  });

  // Public: Get card by Card Hedge ID
  app.get("/api/cards/:cardhedgeCardId", async (req, res) => {
    try {
      const { cardhedgeCardId } = req.params;
      
      const [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.cardhedgeCardId, cardhedgeCardId));
      
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      res.json(card);
    } catch (error) {
      console.error("Error getting card:", error);
      res.status(500).json({ error: "Failed to get card" });
    }
  });

  // Admin: Backfill card playability using shared classifier
  app.post("/api/admin/playable-cards/backfill", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { classifyCard } = await import("./services/cardClassifier");
      
      const allCards = await db
        .select({
          id: playableCards.id,
          player: playableCards.player,
          description: playableCards.description,
          isPlayable: playableCards.isPlayable,
          blockedReason: playableCards.blockedReason,
        })
        .from(playableCards);
      
      let updated = 0;
      let unchanged = 0;
      const changes: Array<{ id: string; player: string | null; oldPlayable: boolean; newPlayable: boolean; reason: string | null }> = [];
      
      for (const card of allCards) {
        const classification = classifyCard({ player: card.player, description: card.description });
        
        if (card.isPlayable !== classification.isPlayable || card.blockedReason !== classification.blockedReason) {
          await db
            .update(playableCards)
            .set({
              isPlayable: classification.isPlayable,
              blockedReason: classification.blockedReason,
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, card.id));
          
          changes.push({
            id: card.id,
            player: card.player,
            oldPlayable: card.isPlayable,
            newPlayable: classification.isPlayable,
            reason: classification.blockedReason,
          });
          updated++;
        } else {
          unchanged++;
        }
      }
      
      console.log(`[Card Backfill] Updated ${updated} cards, ${unchanged} unchanged`);
      
      res.json({
        success: true,
        totalCards: allCards.length,
        updated,
        unchanged,
        changes: changes.slice(0, 100),
      });
    } catch (error) {
      console.error("Error backfilling card playability:", error);
      res.status(500).json({ error: "Failed to backfill card playability" });
    }
  });

  // ============================================
  // CARD IMAGE REPORT ENDPOINTS
  // ============================================

  // User: Report a card with a wrong/mismatched image (allows anonymous reports)
  // Supports both playableCards (solo mode) and baseballCards (1v1 mode)
  app.post("/api/cards/:cardId/report", async (req: any, res) => {
    try {
      const { cardId } = req.params;
      const { createCardImageReportSchema, cardImageReports, baseballCards } = await import("@shared/schema");
      
      const parsed = createCardImageReportSchema.safeParse({ cardId, ...req.body });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid report data", details: parsed.error.flatten() });
      }
      
      // First try playableCards (solo mode - Card Hedge imported cards)
      let [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      let isLegacyCard = false;
      
      // If not found in playableCards, check baseballCards (1v1 mode - legacy cards)
      if (!card) {
        const [legacyCard] = await db
          .select()
          .from(baseballCards)
          .where(eq(baseballCards.id, cardId))
          .limit(1);
        
        if (legacyCard) {
          isLegacyCard = true;
          console.log(`[Card Report] Card ${cardId} is from legacy baseballCards table`);
        } else {
          return res.status(404).json({ error: "Card not found" });
        }
      }
      
      // Get user ID if authenticated, otherwise null for anonymous report
      const reporterId = (req as any).user?.id || null;
      
      // For legacy cards (1v1 mode), we can't store in cardImageReports (FK constraint)
      // But we CAN exclude them by setting imageVerified=false (match service filters by this)
      if (isLegacyCard) {
        console.log(`[Card Report] LEGACY CARD ${cardId} reported for ${parsed.data.reason} by ${reporterId || "guest"}`);
        
        // For multi_player or wrong_player reports on legacy cards, immediately exclude by setting imageVerified=false
        // This prevents them from appearing in future 1v1 matches (match service filters by imageVerified=true)
        const shouldExclude = parsed.data.reason === "multi_player" || parsed.data.reason === "wrong_player";
        if (shouldExclude) {
          await db
            .update(baseballCards)
            .set({ imageVerified: false })
            .where(eq(baseballCards.id, cardId));
          
          console.log(`[Card Report] LEGACY CARD ${cardId} EXCLUDED from 1v1 matches: ${parsed.data.reason} report`);
        }
        
        return res.json({ 
          success: true, 
          reportId: null, 
          excluded: shouldExclude,
          message: shouldExclude
            ? "Card has been flagged and will be removed from future matches."
            : "Report logged for legacy card. These cards are from a curated set and will be reviewed." 
        });
      }
      
      // For playableCards (solo mode), store full report and apply auto-exclusion
      const [report] = await db
        .insert(cardImageReports)
        .values({
          cardId,
          reporterId,
          sessionId: parsed.data.sessionId,
          reason: parsed.data.reason,
          description: parsed.data.description,
          status: "pending",
        })
        .returning();
      
      await db
        .update(playableCards)
        .set({
          reportCount: sql`${playableCards.reportCount} + 1`,
          imageReviewStatus: sql`CASE WHEN ${playableCards.reportCount} >= 2 THEN 'flagged' ELSE ${playableCards.imageReviewStatus} END`,
          updatedAt: new Date(),
        })
        .where(eq(playableCards.id, cardId));
      
      // Auto-exclude cards with 2+ multi_player reports
      if (parsed.data.reason === "multi_player") {
        const multiPlayerReportCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(cardImageReports)
          .where(and(
            eq(cardImageReports.cardId, cardId),
            eq(cardImageReports.reason, "multi_player")
          ));
        
        const count = multiPlayerReportCount[0]?.count || 0;
        if (count >= 2) {
          // ANTI-PRUNING: Do NOT auto-exclude. Flag for admin review instead.
          await db
            .update(playableCards)
            .set({
              quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
              proposedUnplayable: true,
              lastValidationReason: `${count} multi_player reports from users`,
              imageReviewStatus: "pending",
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, cardId));
          
          console.log(`[Card Report] Card ${cardId} FLAGGED FOR ADMIN REVIEW: 2+ multi_player reports (${count} total)`);
        }
      }
      
      // Flag wrong_player reports for admin review
      // Card remains playable until admin approves exclusion
      if (parsed.data.reason === "wrong_player") {
        const wrongPlayerReportCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(cardImageReports)
          .where(and(
            eq(cardImageReports.cardId, cardId),
            eq(cardImageReports.reason, "wrong_player")
          ));
        
        const count = wrongPlayerReportCount[0]?.count || 0;
        if (count >= 1) {
          // ANTI-PRUNING: Do NOT auto-exclude. Flag for admin review instead.
          await db
            .update(playableCards)
            .set({
              quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
              proposedUnplayable: true,
              lastValidationReason: `${count} wrong_player report(s) - possible player/image mismatch`,
              imageReviewStatus: "pending",
              updatedAt: new Date(),
            })
            .where(eq(playableCards.id, cardId));
          
          console.log(`[Card Report] Card ${cardId} FLAGGED FOR ADMIN REVIEW: wrong_player report (player/image mismatch)`);
        }
      }
      
      console.log(`[Card Report] Card ${cardId} reported for ${parsed.data.reason} by ${reporterId || "guest"}`);
      
      res.json({ success: true, reportId: report.id });
    } catch (error) {
      console.error("Error creating card report:", error);
      res.status(500).json({ error: "Failed to submit report" });
    }
  });

  // Report an image load failure during gameplay (auto-flag mechanism)
  // Rate limited to prevent abuse
  app.post("/api/cards/:cardId/image-failure", async (req: any, res) => {
    try {
      const { cardId } = req.params;
      
      // Rate limit by IP to prevent abuse (max 10 failures per minute per IP)
      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
      const rateLimitKey = `image-failure:${clientIp}`;
      if (!checkRateLimit(rateLimitKey, 10, 60000)) {
        return res.status(429).json({ error: "Too many image failure reports" });
      }
      
      const [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      // Record the failure and check if it should be auto-flagged
      const failureCount = recordImageLoadFailure(cardId);
      const shouldFlag = shouldAutoFlagCard(cardId);
      
      if (shouldFlag && card.imageReviewStatus !== "flagged" && card.imageReviewStatus !== "rejected") {
        await db
          .update(playableCards)
          .set({
            imageReviewStatus: "flagged",
            blockedReason: "Auto-flagged: repeated image load failures",
            reportCount: sql`${playableCards.reportCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, cardId));
        
        console.log(`[ImageValidator] Auto-flagged card ${cardId} after ${failureCount} load failures`);
      }
      
      res.json({ 
        recorded: true, 
        failureCount, 
        autoFlagged: shouldFlag && card.imageReviewStatus !== "flagged" 
      });
    } catch (error) {
      console.error("Error recording image failure:", error);
      res.status(500).json({ error: "Failed to record image failure" });
    }
  });

  // Admin: List pending card image reports
  app.get("/api/admin/card-reports", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { cardImageReports } = await import("@shared/schema");
      const { status = "pending", limit: limitParam = "50", offset: offsetParam = "0" } = req.query;
      
      const limitNum = Math.min(parseInt(limitParam as string, 10) || 50, 100);
      const offsetNum = parseInt(offsetParam as string, 10) || 0;
      
      const reports = await db
        .select({
          report: cardImageReports,
          card: playableCards,
        })
        .from(cardImageReports)
        .leftJoin(playableCards, eq(cardImageReports.cardId, playableCards.id))
        .where(eq(cardImageReports.status, status as string))
        .orderBy(desc(cardImageReports.createdAt))
        .limit(limitNum)
        .offset(offsetNum);
      
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(cardImageReports)
        .where(eq(cardImageReports.status, status as string));
      
      res.json({ reports, total: Number(count), limit: limitNum, offset: offsetNum });
    } catch (error) {
      console.error("Error fetching card reports:", error);
      res.status(500).json({ error: "Failed to fetch card reports" });
    }
  });

  // Admin: Get cards with multiple reports (prioritized review queue)
  app.get("/api/admin/card-reports/flagged", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const flaggedCards = await db
        .select()
        .from(playableCards)
        .where(
          or(
            eq(playableCards.imageReviewStatus, "flagged"),
            gte(playableCards.reportCount, 3)
          )
        )
        .orderBy(desc(playableCards.reportCount))
        .limit(100);
      
      res.json({ cards: flaggedCards });
    } catch (error) {
      console.error("Error fetching flagged cards:", error);
      res.status(500).json({ error: "Failed to fetch flagged cards" });
    }
  });

  // Admin: Resolve a card report (approve card, reject card, dismiss report)
  app.post("/api/admin/card-reports/:reportId/resolve", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { reportId } = req.params;
      const { action, resolution } = req.body;
      const { cardImageReports } = await import("@shared/schema");
      
      if (!["approve", "reject", "dismiss"].includes(action)) {
        return res.status(400).json({ error: "Invalid action. Must be: approve, reject, dismiss" });
      }
      
      const [report] = await db
        .select()
        .from(cardImageReports)
        .where(eq(cardImageReports.id, reportId))
        .limit(1);
      
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      
      await db
        .update(cardImageReports)
        .set({
          status: "resolved",
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
          resolution: resolution || action,
        })
        .where(eq(cardImageReports.id, reportId));
      
      if (action === "approve") {
        await db
          .update(playableCards)
          .set({
            imageReviewStatus: "approved",
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, report.cardId));
      } else if (action === "reject") {
        const { assertMutationAllowed } = await import("./services/mutationGuard");
        assertMutationAllowed({
          operationSource: "ADMIN_MANUAL",
          action: "SET_UNPLAYABLE",
          actorUserId: req.user.id,
          reason: `Report ${reportId} rejected - image mismatch confirmed`,
        });
        await db
          .update(playableCards)
          .set({
            imageReviewStatus: "rejected",
            isPlayable: false,
            blockedReason: "Image mismatch confirmed via report",
            quarantineStatus: "REMOVED_BY_ADMIN",
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, report.cardId));
      }
      
      console.log(`[Card Report] Report ${reportId} resolved with action: ${action} by admin ${req.user.id}`);
      
      res.json({ success: true, action });
    } catch (error) {
      console.error("Error resolving card report:", error);
      res.status(500).json({ error: "Failed to resolve report" });
    }
  });

  // Admin: Bulk resolve all pending reports for a card
  app.post("/api/admin/cards/:cardId/review", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { cardId } = req.params;
      const { action, resolution, imageRotation } = req.body;
      const { cardImageReports } = await import("@shared/schema");
      
      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ error: "Invalid action. Must be: approve or reject" });
      }
      
      const [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      await db
        .update(cardImageReports)
        .set({
          status: "resolved",
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
          resolution: resolution || `Bulk ${action} by admin`,
        })
        .where(and(
          eq(cardImageReports.cardId, cardId),
          eq(cardImageReports.status, "pending")
        ));
      
      if (action === "approve") {
        // Build update object - include rotation if provided
        const updateData: any = {
          imageReviewStatus: "approved",
          updatedAt: new Date(),
        };
        if (typeof imageRotation === "number" && [0, 90, 180, 270].includes(imageRotation)) {
          updateData.imageRotation = imageRotation;
        }
        await db
          .update(playableCards)
          .set(updateData)
          .where(eq(playableCards.id, cardId));
      } else if (action === "reject") {
        const { assertMutationAllowed } = await import("./services/mutationGuard");
        assertMutationAllowed({
          operationSource: "ADMIN_MANUAL",
          action: "SET_UNPLAYABLE",
          actorUserId: req.user.id,
          reason: resolution || "Image mismatch confirmed via admin review",
        });
        await db
          .update(playableCards)
          .set({
            imageReviewStatus: "rejected",
            isPlayable: false,
            blockedReason: resolution || "Image mismatch confirmed via admin review",
            quarantineStatus: "REMOVED_BY_ADMIN",
            updatedAt: new Date(),
          })
          .where(eq(playableCards.id, cardId));
      }
      
      console.log(`[Card Review] Card ${cardId} reviewed with action: ${action} by admin ${req.user.id}`);
      
      res.json({ success: true, action, cardId });
    } catch (error) {
      console.error("Error reviewing card:", error);
      res.status(500).json({ error: "Failed to review card" });
    }
  });

  // Schema for bulk card flag/unflag operations
  const bulkCardIdsSchema = z.object({
    cardIds: z.array(z.string().uuid()).min(1, "At least one card ID required").max(100, "Maximum 100 cards per request"),
  });

  // Flag cards as multi-player (bulk support)
  app.post("/api/admin/cards/flag-multi-player", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const parsed = bulkCardIdsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { cardIds } = parsed.data;
      
      const { assertMutationAllowed } = await import("./services/mutationGuard");
      assertMutationAllowed({
        operationSource: "ADMIN_MANUAL",
        action: "SET_UNPLAYABLE",
        actorUserId: req.user.id,
        reason: `Bulk flag ${cardIds.length} cards as multi-player`,
      });
      
      const results = await db
        .update(playableCards)
        .set({
          isPlayable: false,
          blockedReason: "multi-player",
          quarantineStatus: "REMOVED_BY_ADMIN",
          updatedAt: new Date(),
        })
        .where(inArray(playableCards.id, cardIds))
        .returning({ id: playableCards.id });
      
      console.log(`[Card Flag] ${results.length} cards flagged as multi-player by admin ${req.user.id}`);
      
      res.json({ 
        success: true, 
        flaggedCount: results.length,
        cardIds: results.map(r => r.id)
      });
    } catch (error) {
      console.error("Error flagging cards as multi-player:", error);
      res.status(500).json({ error: "Failed to flag cards" });
    }
  });

  // Unflag cards (restore playability)
  app.post("/api/admin/cards/unflag", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const parsed = bulkCardIdsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { cardIds } = parsed.data;
      
      const results = await db
        .update(playableCards)
        .set({
          isPlayable: true,
          blockedReason: null,
          updatedAt: new Date(),
        })
        .where(inArray(playableCards.id, cardIds))
        .returning({ id: playableCards.id });
      
      console.log(`[Card Unflag] ${results.length} cards restored by admin ${req.user.id}`);
      
      res.json({ 
        success: true, 
        unflaggedCount: results.length,
        cardIds: results.map(r => r.id)
      });
    } catch (error) {
      console.error("Error unflagging cards:", error);
      res.status(500).json({ error: "Failed to unflag cards" });
    }
  });

  // ============================================
  // CARD ADMIN ACTIONS (Exclude/Restore)
  // ============================================

  // Manually exclude a card from gameplay (admin action)
  app.post("/api/admin/cards/:cardId/exclude", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { cardId } = req.params;
      const { reason } = req.body;
      const { assertMutationAllowed } = await import("./services/mutationGuard");
      
      const [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      if (!card.isPlayable) {
        return res.status(400).json({ error: "Card is already excluded", blockedReason: card.blockedReason });
      }
      
      // Use mutation guard to ensure this is allowed (ADMIN_MANUAL can always SET_UNPLAYABLE)
      assertMutationAllowed({
        operationSource: "ADMIN_MANUAL",
        action: "SET_UNPLAYABLE",
        actorUserId: req.user.id,
        reason: reason || "Manual admin exclusion",
      });
      
      await db
        .update(playableCards)
        .set({
          isPlayable: false,
          blockedReason: reason || "admin_manual_exclusion",
          imageReviewStatus: "excluded",
          quarantineStatus: "REMOVED_BY_ADMIN",
          updatedAt: new Date(),
        })
        .where(eq(playableCards.id, cardId));
      
      console.log(`[Card Exclude] Card ${cardId} manually excluded by admin ${req.user.id}: ${reason || "no reason"}`);
      
      res.json({ success: true, cardId, excluded: true });
    } catch (error) {
      console.error("Error excluding card:", error);
      res.status(500).json({ error: "Failed to exclude card" });
    }
  });

  // Restore an excluded card to gameplay (admin action)
  app.post("/api/admin/cards/:cardId/restore", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { cardId } = req.params;
      
      const [card] = await db
        .select()
        .from(playableCards)
        .where(eq(playableCards.id, cardId))
        .limit(1);
      
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }
      
      if (card.isPlayable) {
        return res.status(400).json({ error: "Card is already playable" });
      }
      
      await db
        .update(playableCards)
        .set({
          isPlayable: true,
          blockedReason: null,
          imageReviewStatus: "approved",
          quarantineStatus: "OK",
          proposedUnplayable: false,
          validationFailCount: 0,
          updatedAt: new Date(),
        })
        .where(eq(playableCards.id, cardId));
      
      console.log(`[Card Restore] Card ${cardId} restored to gameplay by admin ${req.user.id}`);
      
      res.json({ success: true, cardId, restored: true });
    } catch (error) {
      console.error("Error restoring card:", error);
      res.status(500).json({ error: "Failed to restore card" });
    }
  });

  // Admin: Bulk restore cards that were auto-excluded by background validation
  app.post("/api/admin/cards/bulk-restore", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { setId, dryRun = true } = req.body;
      const { writeAuditLog } = await import("./services/mutationGuard");
      
      const conditions = [
        sql`is_playable = false`,
        sql`image_url IS NOT NULL`,
        sql`image_url LIKE 'https://%'`,
        sql`player IS NOT NULL`,
        sql`player != ''`,
        sql`(content_verified IS NULL OR content_verified = true)`,
        sql`(blocked_reason = 'image_validation_failed' OR blocked_reason = 'missing_image' OR blocked_reason = 'placeholder_image')`,
      ];
      
      if (setId) {
        conditions.push(sql`game_set_id = ${setId}`);
      }
      
      const whereClause = sql.join(conditions, sql` AND `);
      
      const countResult = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM playable_cards WHERE ${whereClause}`
      );
      const restorableCount = parseInt(String(countResult.rows?.[0]?.cnt || "0"), 10);
      
      if (dryRun) {
        const breakdown = await db.execute(
          sql`SELECT blocked_reason, COUNT(*) as cnt FROM playable_cards WHERE ${whereClause} GROUP BY blocked_reason ORDER BY cnt DESC`
        );
        return res.json({ 
          dryRun: true, 
          restorableCount,
          breakdown: breakdown.rows,
          message: `Would restore ${restorableCount} cards. Set dryRun=false to execute.`
        });
      }
      
      if (restorableCount === 0) {
        return res.json({ success: true, restoredCount: 0, message: "No cards eligible for restoration" });
      }
      
      const result = await db.execute(
        sql`UPDATE playable_cards SET 
          is_playable = true, 
          blocked_reason = NULL, 
          image_failure_count = 0,
          image_last_error = NULL,
          quarantine_status = 'OK',
          proposed_unplayable = false,
          validation_fail_count = 0,
          last_validation_reason = NULL,
          first_validation_fail_at = NULL,
          updated_at = NOW()
        WHERE ${whereClause}`
      );
      
      const restoredCount = result.rowCount || 0;
      
      await writeAuditLog({
        setId: setId || undefined,
        actionType: "BULK_RESTORE",
        operationSource: "ADMIN_MANUAL",
        actorUserId: req.user.id,
        beforePlayableCards: 0,
        afterPlayableCards: restoredCount,
        reason: `Bulk restored ${restoredCount} cards auto-excluded by background validation`,
      });
      
      console.log(`[Bulk Restore] Admin ${req.user.id} restored ${restoredCount} cards${setId ? ` in set ${setId}` : ' globally'}`);
      
      res.json({ success: true, restoredCount, message: `Restored ${restoredCount} cards to gameplay` });
    } catch (error) {
      console.error("Error bulk restoring cards:", error);
      res.status(500).json({ error: "Failed to bulk restore cards" });
    }
  });

  // Admin: Reset image_failure_count for all playable cards (prevent future backdoor pruning)
  app.post("/api/admin/cards/reset-failure-counts", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { writeAuditLog } = await import("./services/mutationGuard");
      
      const result = await db.execute(
        sql`UPDATE playable_cards SET 
          image_failure_count = 0,
          image_last_error = NULL,
          last_image_check = NULL
        WHERE image_failure_count > 0`
      );
      
      const resetCount = result.rowCount || 0;
      
      await writeAuditLog({
        actionType: "RESET_FAILURE_COUNTS",
        operationSource: "ADMIN_MANUAL",
        actorUserId: req.user.id,
        reason: `Reset image_failure_count to 0 for ${resetCount} cards to prevent backdoor pruning`,
      });
      
      console.log(`[Reset Failure Counts] Admin ${req.user.id} reset image_failure_count for ${resetCount} cards`);
      
      res.json({ success: true, resetCount, message: `Reset failure counts for ${resetCount} cards` });
    } catch (error) {
      console.error("Error resetting failure counts:", error);
      res.status(500).json({ error: "Failed to reset failure counts" });
    }
  });

  // ============================================
  // REWARD SYSTEM ENDPOINTS
  // ============================================

  // Public: Explain reward calculation for a card
  app.get("/api/rewards/explain", async (req, res) => {
    try {
      const { cardId, playerName, year, rarityType } = req.query;
      
      if (!playerName && !cardId) {
        return res.status(400).json({ error: "playerName or cardId required" });
      }
      
      let cardContext: rewardEngine.CardContext;
      
      if (cardId) {
        const [card] = await db
          .select()
          .from(playableCards)
          .where(eq(playableCards.id, cardId as string))
          .limit(1);
        
        if (!card) {
          return res.status(404).json({ error: "Card not found" });
        }
        
        const setYear = card.set ? parseInt(card.set.match(/^\d{4}/)?.[0] || "0", 10) || undefined : undefined;
        cardContext = {
          cardId: card.id,
          playerName: card.player || "Unknown",
          year: setYear,
          rarityType: "base",
          sport: "baseball",
        };
      } else {
        cardContext = {
          playerName: playerName as string,
          year: year ? parseInt(year as string, 10) : undefined,
          rarityType: (rarityType as any) || "base",
          sport: "baseball",
        };
      }
      
      const explanation = await rewardEngine.explainReward(cardContext);
      res.json(explanation);
    } catch (error) {
      console.error("Error explaining reward:", error);
      res.status(500).json({ error: "Failed to explain reward" });
    }
  });

  // Admin: Get current reward policy
  app.get("/api/admin/rewards/policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const policy = await rewardEngine.loadActivePolicy();
      res.json(policy);
    } catch (error) {
      console.error("Error getting reward policy:", error);
      res.status(500).json({ error: "Failed to get reward policy" });
    }
  });

  // Admin: Create new reward policy
  app.post("/api/admin/rewards/policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { createRewardPolicySchema, rewardPolicy: rewardPolicyTable } = await import("@shared/schema");
      const parsed = createRewardPolicySchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const data = parsed.data;
      const effectiveFrom = data.effectiveFrom ? new Date(data.effectiveFrom) : new Date();
      
      const [newPolicy] = await db
        .insert(rewardPolicyTable)
        .values({
          effectiveFrom,
          enabled: true,
          minPts: data.minPts ?? 100,
          maxPts: data.maxPts ?? 200,
          gamma: data.gamma ?? 2.0,
          maxAwardCap: data.maxAwardCap ?? 250,
          vintageMultipliers: data.vintageMultipliers ?? { pre1980: 1.15, "1980_1999": 1.05, "2000_2019": 1.0, "2020_plus": 0.9 },
          rarityMultipliers: data.rarityMultipliers ?? { base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3 },
          dailyPointsCap: data.dailyPointsCap ?? 5000,
          perMatchPointsCap: data.perMatchPointsCap ?? 1000,
        })
        .returning();
      
      rewardEngine.clearPolicyCache();
      
      res.json({ success: true, policy: newPolicy });
    } catch (error) {
      console.error("Error creating reward policy:", error);
      res.status(500).json({ error: "Failed to create reward policy" });
    }
  });

  // Admin: Search player fame
  app.get("/api/admin/rewards/player-fame", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { q, sport, limit = "50" } = req.query;
      const { playerFame: playerFameTable } = await import("@shared/schema");
      
      const conditions = [];
      
      if (q) {
        conditions.push(sql`${playerFameTable.playerName} ILIKE ${"%" + q + "%"}`);
      }
      
      if (sport) {
        conditions.push(eq(playerFameTable.sport, sport as string));
      }
      
      const results = conditions.length > 0
        ? await db.select().from(playerFameTable).where(and(...conditions)).limit(parseInt(limit as string, 10))
        : await db.select().from(playerFameTable).limit(parseInt(limit as string, 10));
      
      res.json(results);
    } catch (error) {
      console.error("Error searching player fame:", error);
      res.status(500).json({ error: "Failed to search player fame" });
    }
  });

  // Admin: Update player fame (override)
  app.post("/api/admin/rewards/player-fame", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { updatePlayerFameSchema, playerFame: playerFameTable } = await import("@shared/schema");
      const parsed = updatePlayerFameSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }
      
      const { playerKey, fameScore, sport } = parsed.data;
      
      const [existing] = await db
        .select()
        .from(playerFameTable)
        .where(eq(playerFameTable.playerKey, playerKey))
        .limit(1);
      
      if (existing) {
        await db
          .update(playerFameTable)
          .set({
            fameScore,
            sourceBreakdown: { ...((existing.sourceBreakdown as any) || {}), override: true, overrideValue: fameScore },
            lastUpdated: new Date(),
          })
          .where(eq(playerFameTable.playerKey, playerKey));
      } else {
        await db.insert(playerFameTable).values({
          sport: sport || "baseball",
          playerName: playerKey.split(":").slice(1).join(":") || playerKey,
          playerKey,
          fameScore,
          sourceBreakdown: { override: true, overrideValue: fameScore },
        });
      }
      
      res.json({ success: true, playerKey, fameScore });
    } catch (error) {
      console.error("Error updating player fame:", error);
      res.status(500).json({ error: "Failed to update player fame" });
    }
  });

  // Admin: Get points awards audit log
  app.get("/api/admin/rewards/audits", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId, from, to, limit = "100" } = req.query;
      const { pointsAwards: pointsAwardsTable } = await import("@shared/schema");
      
      let conditions = [];
      
      if (userId) {
        conditions.push(eq(pointsAwardsTable.userId, userId as string));
      }
      
      if (from) {
        conditions.push(sql`${pointsAwardsTable.createdAt} >= ${new Date(from as string)}`);
      }
      
      if (to) {
        conditions.push(sql`${pointsAwardsTable.createdAt} <= ${new Date(to as string)}`);
      }
      
      const query = conditions.length > 0
        ? db.select().from(pointsAwardsTable).where(and(...conditions))
        : db.select().from(pointsAwardsTable);
      
      const audits = await query
        .orderBy(desc(pointsAwardsTable.createdAt))
        .limit(parseInt(limit as string, 10));
      
      res.json(audits);
    } catch (error) {
      console.error("Error getting reward audits:", error);
      res.status(500).json({ error: "Failed to get reward audits" });
    }
  });

  // Admin: Recompute fame scores from gameplay stats
  app.post("/api/admin/rewards/recompute-fame", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const updated = await rewardEngine.recomputeFameFromStats();
      res.json({ success: true, updated });
    } catch (error) {
      console.error("Error recomputing fame:", error);
      res.status(500).json({ error: "Failed to recompute fame" });
    }
  });

  // ============================================
  // IMAGE PROXY ENDPOINT (CORS-safe)
  // ============================================

  const ALLOWED_IMAGE_DOMAINS = [
    "s3.amazonaws.com",
    "cdn.bubble.io",
    "bubble.io",
    "cardhedger.com",
    "comc.com",
    "ebayimg.com",
    "i.ebayimg.com",
  ];

  const isPrivateIpAddress = (ip: string): boolean => {
    const privateIPv4Patterns = [
      /^127\./, // Loopback
      /^10\./, // Private A
      /^192\.168\./, // Private C
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private B
      /^0\./, // Current network
      /^169\.254\./, // Link-local
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Carrier-grade NAT
      /^192\.0\.0\./, // IETF protocol assignments
      /^192\.0\.2\./, // TEST-NET-1
      /^198\.51\.100\./, // TEST-NET-2
      /^203\.0\.113\./, // TEST-NET-3
      /^224\./, // Multicast
      /^240\./, // Reserved
      /^255\./, // Broadcast
    ];
    
    const privateIPv6Patterns = [
      /^::1$/, // Loopback
      /^fe80:/i, // Link-local
      /^fc00:/i, // Unique local
      /^fd[0-9a-f]{2}:/i, // Unique local
      /^::$/, // Unspecified
      /^::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i, // IPv4-mapped private
    ];
    
    return privateIPv4Patterns.some(p => p.test(ip)) || 
           privateIPv6Patterns.some(p => p.test(ip));
  };

  const isPrivateIp = (hostname: string): boolean => {
    const privatePatterns = [
      /^localhost$/,
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^0\./,
      /^169\.254\./,
      /^\[::1\]$/,
      /^\[fc00:/,
      /^\[fd00:/,
    ];
    return privatePatterns.some(pattern => pattern.test(hostname));
  };

  /**
   * DNS resolution with private IP validation.
   * 
   * SECURITY NOTE: While there's a theoretical TOCTOU gap between DNS resolution
   * and the fetch connection, the practical risk is minimal because:
   * 1. ALLOWED_IMAGE_DOMAINS contains only trusted CDN domains (AWS S3, eBay CDN, etc.)
   * 2. Attackers cannot control DNS for these trusted domains
   * 3. Multiple layers of defense: allowlist + DNS check + redirect validation
   * 
   * For maximum security, all card images should be hosted on a controlled CDN
   * rather than proxied from arbitrary sources.
   */
  const resolveAndCheckPrivateIp = async (hostname: string): Promise<{ allowed: boolean; error?: string }> => {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const lookup = promisify(dns.lookup);
    
    try {
      const result = await lookup(hostname, { all: true });
      const addresses = Array.isArray(result) ? result : [result];
      
      for (const addr of addresses) {
        if (isPrivateIpAddress(addr.address)) {
          return { allowed: false, error: `Hostname resolves to private IP` };
        }
      }
      return { allowed: true };
    } catch (err: any) {
      if (err.code === "ENOTFOUND") {
        return { allowed: false, error: "Hostname could not be resolved" };
      }
      return { allowed: false, error: `DNS lookup failed: ${err.code || err.message}` };
    }
  };

  app.get("/api/images/proxy", async (req, res) => {
    try {
      const proxyEnabled = process.env.CARD_IMAGE_PROXY_ENABLED !== "false";
      if (!proxyEnabled) {
        return res.status(403).json({ error: "Image proxy is disabled" });
      }

      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL parameter required" });
      }

      if (url.length > 2000) {
        return res.status(400).json({ error: "URL too long" });
      }

      let parsedUrl: URL;
      try {
        let normalizedUrl = url;
        if (url.startsWith("//")) {
          normalizedUrl = `https:${url}`;
        }
        parsedUrl = new URL(normalizedUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL" });
      }

      if (parsedUrl.protocol !== "https:") {
        return res.status(400).json({ error: "Only HTTPS URLs allowed" });
      }

      if (isPrivateIp(parsedUrl.hostname)) {
        return res.status(400).json({ error: "Private IP addresses not allowed" });
      }

      const isAllowed = ALLOWED_IMAGE_DOMAINS.some(domain => 
        parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`)
      );

      if (!isAllowed) {
        return res.status(403).json({ 
          error: "Domain not in allowlist",
          hostname: parsedUrl.hostname,
        });
      }

      const dnsCheck = await resolveAndCheckPrivateIp(parsedUrl.hostname);
      if (!dnsCheck.allowed) {
        return res.status(400).json({ error: dnsCheck.error });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const MAX_REDIRECTS = 5;
      let currentUrl = parsedUrl;
      let redirectCount = 0;

      try {
        while (redirectCount <= MAX_REDIRECTS) {
          const response = await fetch(currentUrl.toString(), {
            signal: controller.signal,
            redirect: "manual",
            headers: {
              "User-Agent": "PackPoints-ImageProxy/1.0",
            },
          });

          if (response.status >= 300 && response.status < 400) {
            const locationHeader = response.headers.get("location");
            if (!locationHeader) {
              return res.status(502).json({ error: "Redirect without location header" });
            }

            let redirectUrl: URL;
            try {
              redirectUrl = new URL(locationHeader, currentUrl.toString());
            } catch {
              return res.status(400).json({ error: "Invalid redirect URL" });
            }

            if (redirectUrl.protocol !== "https:") {
              return res.status(400).json({ error: "Redirect to non-HTTPS not allowed" });
            }

            if (isPrivateIp(redirectUrl.hostname)) {
              return res.status(400).json({ error: "Redirect to private IP not allowed" });
            }

            const redirectAllowed = ALLOWED_IMAGE_DOMAINS.some(domain => 
              redirectUrl.hostname === domain || redirectUrl.hostname.endsWith(`.${domain}`)
            );
            if (!redirectAllowed) {
              return res.status(403).json({ 
                error: "Redirect to domain not in allowlist",
                hostname: redirectUrl.hostname,
              });
            }

            const redirectDnsCheck = await resolveAndCheckPrivateIp(redirectUrl.hostname);
            if (!redirectDnsCheck.allowed) {
              return res.status(400).json({ error: `Redirect blocked: ${redirectDnsCheck.error}` });
            }

            currentUrl = redirectUrl;
            redirectCount++;
            continue;
          }

          clearTimeout(timeoutId);

          if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to fetch image" });
          }

          const contentType = response.headers.get("content-type");
          if (!contentType || !contentType.startsWith("image/")) {
            return res.status(400).json({ error: "URL does not point to an image" });
          }

          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.setHeader("X-Content-Type-Options", "nosniff");

          const arrayBuffer = await response.arrayBuffer();
          return res.send(Buffer.from(arrayBuffer));
        }

        clearTimeout(timeoutId);
        return res.status(400).json({ error: "Too many redirects" });
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
          return res.status(504).json({ error: "Image fetch timed out" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error proxying image:", error);
      res.status(500).json({ error: "Failed to proxy image" });
    }
  });

  // ============================================
  // MASKED CARD IMAGE ENDPOINT
  // ============================================
  app.get("/api/cards/:cardId/masked-image", async (req, res) => {
    const { cardId } = req.params;

    if (!cardId || cardId.length > 100) {
      return res.status(400).json({ error: "Invalid card ID" });
    }

    try {
      const { getMaskedImagePath } = await import("./masking/maskingService");
      const path = await import("path");
      const fs = await import("fs");

      const maskedPath = await getMaskedImagePath(cardId);
      
      if (!maskedPath) {
        return res.status(404).json({ error: "Unable to generate masked image" });
      }

      const filePath = path.join(process.cwd(), "data", "masked-cards", maskedPath);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Masked image not found" });
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("[MaskedImage] Error serving masked image:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ============================================
  // CARD IMAGE PROXY BY CARD ID
  // ============================================
  app.get("/api/images/card/:cardId", async (req, res) => {
    const { cardId } = req.params;

    if (!cardId || cardId.length > 100) {
      return res.status(400).json({ error: "Invalid card ID" });
    }

    try {
      const { getSourceUrlForCard, getCachedImageUrl, getOrValidateCardImage, markImageBad } = await import("./services/images/imageGate");
      const { normalizeImageUrl } = await import("./services/cards/imageQuality");

      let sourceUrl = await getCachedImageUrl(cardId);

      if (!sourceUrl) {
        sourceUrl = await getSourceUrlForCard(cardId);
      }

      if (!sourceUrl) {
        console.warn(`[ImageProxy] Card ${cardId} has no source URL`);
        return res.status(404).json({ error: "Card image not found" });
      }

      const normalized = normalizeImageUrl(sourceUrl);
      if (!normalized) {
        return res.status(404).json({ error: "Invalid image URL" });
      }

      const validation = await getOrValidateCardImage(cardId, normalized);
      
      if (validation.status !== "ok") {
        console.warn(`[ImageProxy] Card ${cardId} failed validation: ${validation.status}`);
        return res.status(404).json({ error: "Image not available" });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(normalized, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "PackPTS/1.0 ImageProxy",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await markImageBad(cardId, `proxy_fetch_failed:${response.status}`);
        return res.status(502).json({ error: "Failed to fetch image" });
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.toLowerCase().startsWith("image/")) {
        await markImageBad(cardId, `invalid_content_type:${contentType}`);
        return res.status(502).json({ error: "Invalid content type" });
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Card-Id", cardId);
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.error(`[ImageProxy] Timeout for card ${cardId}`);
        return res.status(504).json({ error: "Image fetch timed out" });
      }
      console.error(`[ImageProxy] Error for card ${cardId}:`, error);
      return res.status(500).json({ error: "Failed to proxy image" });
    }
  });

  // ============================================
  // CARD SET MASK CONFIGURATION
  // ============================================

  app.get("/api/card-sets/:setKey/mask", async (req, res) => {
    try {
      const { setKey } = req.params;
      const { getMaskConfig } = await import("./services/maskConfig");
      
      const config = await getMaskConfig(setKey || "");
      
      res.json(config);
    } catch (error) {
      console.error("Error getting mask config:", error);
      res.status(500).json({ error: "Failed to get mask configuration" });
    }
  });

  app.post("/api/admin/card-sets/:setKey/mask", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { setKey } = req.params;
      const { regions, providerSetId } = req.body;
      
      if (!regions || !Array.isArray(regions)) {
        return res.status(400).json({ error: "regions array required" });
      }
      
      const { saveMaskConfig } = await import("./services/maskConfig");
      const config = await saveMaskConfig(setKey, regions, providerSetId);
      
      res.json(config);
    } catch (error) {
      console.error("Error saving mask config:", error);
      res.status(500).json({ error: "Failed to save mask configuration" });
    }
  });

  // ============================================
  // PROFIT GUARDRAIL & MARKETPLACE REDEMPTIONS
  // ============================================

  // GET /api/profit-policy - Public endpoint to get active policy for UI display
  app.get("/api/profit-policy", async (_req, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      const policy = await profitGuardrailService.getPolicyForDisplay();
      
      if (!policy) {
        return res.status(404).json({ error: "No active profit policy configured" });
      }
      
      res.json(policy);
    } catch (error) {
      console.error("Error getting profit policy:", error);
      res.status(500).json({ error: "Failed to get profit policy" });
    }
  });

  // POST /api/marketplace/redemption/quote - Get redemption quote for a listing
  app.post("/api/marketplace/redemption/quote", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      const { redemptionQuoteRequestSchema } = await import("@shared/schema");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = redemptionQuoteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { source, listingId, listingUrl, priceCents, currency } = parsed.data;
      
      const quote = await profitGuardrailService.createQuote(
        userId,
        source,
        listingId,
        listingUrl,
        priceCents,
        currency
      );
      
      res.json(quote);
    } catch (error: any) {
      console.error("Error creating redemption quote:", error);
      res.status(500).json({ error: error.message || "Failed to create redemption quote" });
    }
  });

  // POST /api/marketplace/redemption/quote-batch - Get batch quotes for multiple listings
  app.post("/api/marketplace/redemption/quote-batch", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      const { walletService } = await import("./services/walletService");
      const { riskEngine } = await import("./services/riskEngine");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { items } = req.body as { items: Array<{ provider: "ebay" | "goldin"; externalId: string; priceCents: number; currency?: string }> };
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array required" });
      }
      
      if (items.length > 50) {
        return res.status(400).json({ error: "Maximum 50 items per batch" });
      }

      // Get user wallet and risk status once (not per item)
      const wallet = await walletService.getOrCreateWallet(userId);
      const riskState = await riskEngine.getUserRiskState(userId);
      const debtPts = wallet.balance < 0 ? Math.abs(wallet.balance) : 0;
      const availablePts = Math.max(0, wallet.balance);
      
      // Determine if user can redeem at all
      const isFrozen = riskState?.status === "FROZEN";
      const hasDebt = debtPts > 0;
      const canRedeem = !isFrozen && !hasDebt && availablePts > 0;
      
      const quotes: Record<string, any> = {};
      
      for (const item of items) {
        const key = `${item.provider}:${item.externalId}`;
        
        if (!canRedeem) {
          // User cannot redeem - return zero quote with reasons
          const reasons: string[] = [];
          if (isFrozen) reasons.push("Redemption disabled (account frozen)");
          if (hasDebt) reasons.push("Debt balance must be repaid");
          if (availablePts === 0) reasons.push("You have 0 available PackPTS");
          
          quotes[key] = {
            listing: { provider: item.provider, externalId: item.externalId },
            cashPriceCents: item.priceCents,
            ptsMaxApplicable: 0,
            ptsApplied: 0,
            usdDueCents: item.priceCents,
            usdSavingsCents: 0,
            effectiveValuePerPtMicrousds: 0,
            reasons,
            ctaLabel: "Earn PackPTS",
          };
          continue;
        }
        
        try {
          // Create quote using existing service
          const quote = await profitGuardrailService.createQuote(
            userId,
            item.provider,
            item.externalId,
            "", // listingUrl not needed for batch preview
            item.priceCents,
            item.currency || "USD"
          );
          
          // Transform to spec format
          const ptsMaxApplicable = quote.rMax;
          const ptsApplied = Math.min(ptsMaxApplicable, Math.floor(ptsMaxApplicable * 0.5)); // Default 50%
          const valuePerPtCents = quote.policySummary?.packptsValueUsd || 0.002;
          const usdSavingsCents = Math.round(ptsApplied * valuePerPtCents * 100);
          const usdDueCents = Math.max(0, item.priceCents - usdSavingsCents);
          
          quotes[key] = {
            listing: { provider: item.provider, externalId: item.externalId },
            cashPriceCents: item.priceCents,
            ptsMaxApplicable,
            ptsApplied,
            usdDueCents,
            usdSavingsCents,
            effectiveValuePerPtMicrousds: Math.round(valuePerPtCents * 1000000),
            reasons: [],
            ctaLabel: ptsMaxApplicable > 0 ? "Apply PackPTS" : "Earn PackPTS",
          };
        } catch (e) {
          // On error, return non-applicable quote
          quotes[key] = {
            listing: { provider: item.provider, externalId: item.externalId },
            cashPriceCents: item.priceCents,
            ptsMaxApplicable: 0,
            ptsApplied: 0,
            usdDueCents: item.priceCents,
            usdSavingsCents: 0,
            effectiveValuePerPtMicrousds: 0,
            reasons: ["Quote unavailable"],
            ctaLabel: "View Listing",
          };
        }
      }
      
      res.json({ quotes });
    } catch (error: any) {
      console.error("Error creating batch quotes:", error);
      res.status(500).json({ error: error.message || "Failed to create batch quotes" });
    }
  });

  // POST /api/marketplace/redemption/apply - Apply PackPTS to a purchase intent
  app.post("/api/marketplace/redemption/apply", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      const { redemptionApplyRequestSchema } = await import("@shared/schema");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = redemptionApplyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { purchaseIntentId, requestedRedeemPackpts } = parsed.data;
      
      const result = await profitGuardrailService.applyRedemption(
        userId,
        purchaseIntentId,
        requestedRedeemPackpts
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error applying redemption:", error);
      res.status(500).json({ error: error.message || "Failed to apply redemption" });
    }
  });

  // POST /api/marketplace/purchase/confirm - Confirm a purchase (stub for admin review)
  app.post("/api/marketplace/purchase/confirm", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      const { purchaseConfirmRequestSchema } = await import("@shared/schema");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = purchaseConfirmRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { purchaseIntentId, evidence } = parsed.data;
      
      const result = await profitGuardrailService.confirmPurchase(
        userId,
        purchaseIntentId,
        evidence
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error confirming purchase:", error);
      res.status(500).json({ error: error.message || "Failed to confirm purchase" });
    }
  });

  // GET /api/marketplace/redemption/intents - Get user's purchase intents
  app.get("/api/marketplace/redemption/intents", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const status = req.query.status as string | undefined;
      const intents = await profitGuardrailService.getUserPurchaseIntents(userId, status);
      
      res.json(intents);
    } catch (error: any) {
      console.error("Error getting purchase intents:", error);
      res.status(500).json({ error: error.message || "Failed to get purchase intents" });
    }
  });

  // Admin: Update profit policy
  app.post("/api/admin/profit-policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      
      const newPolicy = await profitGuardrailService.updatePolicy(req.body);
      
      res.json(newPolicy);
    } catch (error: any) {
      console.error("Error updating profit policy:", error);
      res.status(500).json({ error: error.message || "Failed to update profit policy" });
    }
  });

  // Admin: Get redemption queue
  app.get("/api/admin/redemptions", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      
      const status = req.query.status as "PENDING" | "GRANTED" | "REVERSED" | undefined;
      const redemptions = await profitGuardrailService.getRedemptionQueue(status);
      
      res.json(redemptions);
    } catch (error: any) {
      console.error("Error getting redemption queue:", error);
      res.status(500).json({ error: error.message || "Failed to get redemption queue" });
    }
  });

  // Admin: Reverse a redemption
  app.post("/api/admin/redemptions/:id/reverse", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      
      const { id } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ error: "Reason is required" });
      }
      
      const result = await profitGuardrailService.reverseRedemption(id, reason);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error reversing redemption:", error);
      res.status(500).json({ error: error.message || "Failed to reverse redemption" });
    }
  });

  // Admin: Get treasury status
  app.get("/api/admin/treasury/status", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const status = await treasuryService.getTreasuryStatus();
      
      res.json(status);
    } catch (error: any) {
      console.error("Error getting treasury status:", error);
      res.status(500).json({ error: error.message || "Failed to get treasury status" });
    }
  });

  // Admin: Credit margin pool (from affiliate payout, partner rebate, or manual adjustment)
  app.post("/api/admin/treasury/credit", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const { amountCents, type, referenceId, description } = req.body;
      
      if (!amountCents || typeof amountCents !== "number" || amountCents <= 0) {
        return res.status(400).json({ error: "Valid positive amountCents required" });
      }
      
      const validTypes = ["PACKPTS_SALE", "AFFILIATE_PAYOUT", "PARTNER_REBATE", "ADJUSTMENT"];
      if (!type || !validTypes.includes(type)) {
        return res.status(400).json({ error: `Type must be one of: ${validTypes.join(", ")}` });
      }
      
      const entry = await treasuryService.creditMarginPool(
        amountCents,
        type,
        referenceId || null,
        description || `Admin credit: ${type}`
      );
      
      res.json({ success: true, entry });
    } catch (error: any) {
      console.error("Error crediting treasury:", error);
      res.status(500).json({ error: error.message || "Failed to credit treasury" });
    }
  });

  // Admin: Get margin ledger history
  app.get("/api/admin/treasury/ledger", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const limit = parseInt(req.query.limit as string) || 50;
      const ledger = await treasuryService.getMarginLedger(limit);
      
      res.json(ledger);
    } catch (error: any) {
      console.error("Error getting margin ledger:", error);
      res.status(500).json({ error: error.message || "Failed to get margin ledger" });
    }
  });

  // Admin: Get marketplace margin config
  app.get("/api/admin/treasury/marketplace-config", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const configs = await treasuryService.getMarketplaceConfigs();
      
      res.json(configs);
    } catch (error: any) {
      console.error("Error getting marketplace config:", error);
      res.status(500).json({ error: error.message || "Failed to get marketplace config" });
    }
  });

  // Admin: Update marketplace margin config
  app.put("/api/admin/treasury/marketplace-config/:source", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const { source } = req.params;
      const { affiliateRateBps, haircutRateBps } = req.body;
      
      if (affiliateRateBps !== undefined && (typeof affiliateRateBps !== "number" || affiliateRateBps < 0 || affiliateRateBps > 10000)) {
        return res.status(400).json({ error: "affiliateRateBps must be 0-10000" });
      }
      
      if (haircutRateBps !== undefined && (typeof haircutRateBps !== "number" || haircutRateBps < 0 || haircutRateBps > 10000)) {
        return res.status(400).json({ error: "haircutRateBps must be 0-10000" });
      }
      
      const updated = await treasuryService.updateMarketplaceConfig(source, {
        affiliateRateBps,
        haircutRateBps,
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Marketplace config not found" });
      }
      
      res.json({ success: true, config: updated });
    } catch (error: any) {
      console.error("Error updating marketplace config:", error);
      res.status(500).json({ error: error.message || "Failed to update marketplace config" });
    }
  });

  // Admin: Get active reservations
  app.get("/api/admin/treasury/reservations", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const { treasuryService } = await import("./services/treasuryService");
      
      const reservations = await treasuryService.getActiveReservations();
      
      res.json(reservations);
    } catch (error: any) {
      console.error("Error getting reservations:", error);
      res.status(500).json({ error: error.message || "Failed to get reservations" });
    }
  });

  // ============================================
  // ADMIN: RISK MANAGEMENT
  // ============================================

  // Get user risk state
  app.get("/api/admin/risk/user/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { riskEngine } = await import("./services/riskEngine");
      const userId = req.params.userId;
      
      const [riskState, assessment, actions] = await Promise.all([
        riskEngine.getUserRiskState(userId),
        riskEngine.detectPatterns(userId),
        riskEngine.getActiveActions(userId),
      ]);
      
      res.json({
        userId,
        riskState: riskState || { status: "NORMAL" },
        assessment,
        activeActions: actions,
      });
    } catch (error: any) {
      console.error("Error getting user risk state:", error);
      res.status(500).json({ error: error.message || "Failed to get risk state" });
    }
  });

  // Freeze user
  app.post("/api/admin/risk/freeze/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { riskEngine } = await import("./services/riskEngine");
      const userId = req.params.userId;
      const reason = req.body.reason || "Admin freeze";
      
      await riskEngine.applyAction(userId, "FREEZE", reason);
      
      res.json({ success: true, message: `User ${userId} frozen` });
    } catch (error: any) {
      console.error("Error freezing user:", error);
      res.status(500).json({ error: error.message || "Failed to freeze user" });
    }
  });

  // Unfreeze user
  app.post("/api/admin/risk/unfreeze/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { riskEngine } = await import("./services/riskEngine");
      const userId = req.params.userId;
      const adminNote = req.body.note || "Unfrozen by admin";
      
      await riskEngine.unfreezeUser(userId, adminNote);
      
      res.json({ success: true, message: `User ${userId} unfrozen` });
    } catch (error: any) {
      console.error("Error unfreezing user:", error);
      res.status(500).json({ error: error.message || "Failed to unfreeze user" });
    }
  });

  // List frozen users
  app.get("/api/admin/risk/frozen-users", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const frozenUsers = await db
        .select()
        .from(userRiskState)
        .where(eq(userRiskState.status, "FROZEN"));
      
      res.json(frozenUsers);
    } catch (error: any) {
      console.error("Error listing frozen users:", error);
      res.status(500).json({ error: error.message || "Failed to list frozen users" });
    }
  });

  // Get risk signals for a user
  app.get("/api/admin/risk/signals/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const userId = req.params.userId;
      const limit = parseInt(req.query.limit) || 50;
      
      const signals = await db
        .select()
        .from(riskSignals)
        .where(eq(riskSignals.userId, userId))
        .orderBy(desc(riskSignals.createdAt))
        .limit(limit);
      
      res.json(signals);
    } catch (error: any) {
      console.error("Error getting risk signals:", error);
      res.status(500).json({ error: error.message || "Failed to get risk signals" });
    }
  });

  // User: Cancel redemption
  app.post("/api/marketplace/redemption/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const { profitGuardrailService } = await import("./services/profitGuardrailService");
      
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { purchaseIntentId } = req.body;
      if (!purchaseIntentId) {
        return res.status(400).json({ error: "purchaseIntentId required" });
      }

      const result = await profitGuardrailService.cancelRedemption(userId, purchaseIntentId);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error canceling redemption:", error);
      res.status(500).json({ error: error.message || "Failed to cancel redemption" });
    }
  });

  // ============================================
  // STORE PACKAGE PROFIT GUARDRAILS
  // ============================================

  // Admin: Preview package evaluation (no save)
  app.post("/api/admin/store/packages/preview", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");
      const { evaluatePackageSchema } = await import("@shared/schema");

      const parsed = evaluatePackageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const evaluation = await packageGuardrailService.evaluatePackage(
        parsed.data.priceCents,
        parsed.data.ptsGrant,
        parsed.data.channel
      );

      res.json(evaluation);
    } catch (error: any) {
      console.error("Error previewing package:", error);
      res.status(500).json({ error: error.message || "Failed to preview package" });
    }
  });

  // Admin: Get package policy and fee profiles
  app.get("/api/admin/store/packages/config", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const policy = await packageGuardrailService.getActivePolicy();
      const feeProfiles = await packageGuardrailService.getAllFeeProfiles();

      res.json({
        policy: policy ? {
          id: policy.id,
          minMarginRate: policy.minMarginRate,
          warnMarginBand: policy.warnMarginBand,
          maxValuePerPtMicrousd: policy.maxValuePerPtMicrousd,
          allowOverride: policy.allowOverride,
          reserveRate: policy.reserveRate,
        } : null,
        feeProfiles: feeProfiles.map(fp => ({
          id: fp.id,
          channel: fp.channel,
          feeRate: fp.feeRate,
          feeFixedCents: fp.feeFixedCents,
          platformFeeRate: fp.platformFeeRate,
        })),
      });
    } catch (error: any) {
      console.error("Error getting package config:", error);
      res.status(500).json({ error: error.message || "Failed to get package config" });
    }
  });

  // Admin: Update package policy
  app.put("/api/admin/store/packages/policy", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const updateSchema = z.object({
        minMarginRate: z.number().min(0).max(1).optional(),
        warnMarginBand: z.number().min(0).max(0.5).optional(),
        maxValuePerPtMicrousd: z.number().int().positive().optional(),
        allowOverride: z.boolean().optional(),
        reserveRate: z.number().min(0).max(1).optional(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const updatedPolicy = await packageGuardrailService.updatePolicy(parsed.data);

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "store_package_policy_updated",
        null,
        { policyId: updatedPolicy.id, updates: parsed.data }
      );

      res.json({ success: true, policy: updatedPolicy });
    } catch (error: any) {
      console.error("Error updating package policy:", error);
      res.status(500).json({ error: error.message || "Failed to update package policy" });
    }
  });

  // Admin: Update fee profile
  app.put("/api/admin/store/packages/fee-profile/:channel", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const { channel } = req.params;
      if (!["web_stripe", "ios_iap", "android_iap"].includes(channel)) {
        return res.status(400).json({ error: "Invalid channel" });
      }

      const updateSchema = z.object({
        feeRate: z.number().min(0).max(1).optional(),
        feeFixedCents: z.number().int().min(0).optional(),
        platformFeeRate: z.number().min(0).max(1).optional(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const updatedProfile = await packageGuardrailService.updateFeeProfile(
        channel as "web_stripe" | "ios_iap" | "android_iap",
        parsed.data
      );

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "store_fee_profile_updated",
        null,
        { channel, updates: parsed.data }
      );

      res.json({ success: true, feeProfile: updatedProfile });
    } catch (error: any) {
      console.error("Error updating fee profile:", error);
      res.status(500).json({ error: error.message || "Failed to update fee profile" });
    }
  });

  // Admin: Create PackPTS package with guardrail validation
  app.post("/api/admin/store/packages", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService, BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");
      const { createStorePackageSchema } = await import("@shared/schema");

      const parsed = createStorePackageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      if (!adminUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { productId, validationId, evaluation } = await packageGuardrailService.createPackage(
        parsed.data.sku,
        parsed.data.name,
        parsed.data.priceCents,
        parsed.data.ptsGrant,
        parsed.data.channel,
        adminUserId,
        parsed.data.confirm ?? false
      );

      await adminService.logAction(
        adminUserId,
        "store_package_created",
        null,
        { productId, validationId, sku: parsed.data.sku }
      );

      res.json({
        success: true,
        productId,
        validationId,
        evaluation,
      });
    } catch (error: any) {
      const { BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");
      
      if (error instanceof BlockedPackageError) {
        return res.status(422).json({
          error: "PACKAGE_BLOCKED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }
      
      if (error instanceof WarnPackageError) {
        return res.status(409).json({
          error: "CONFIRMATION_REQUIRED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      console.error("Error creating package:", error);
      res.status(500).json({ error: error.message || "Failed to create package" });
    }
  });

  // Admin: Update PackPTS package with guardrail validation
  app.put("/api/admin/store/packages/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService, BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");
      const { updateStorePackageSchema } = await import("@shared/schema");

      const { id } = req.params;

      const parsed = updateStorePackageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      if (!adminUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { validationId, evaluation } = await packageGuardrailService.updatePackage(
        id,
        {
          sku: parsed.data.sku,
          name: parsed.data.name,
          priceCents: parsed.data.priceCents,
          ptsGrant: parsed.data.ptsGrant,
          channel: parsed.data.channel,
        },
        adminUserId,
        parsed.data.confirm ?? false
      );

      await adminService.logAction(
        adminUserId,
        "store_package_updated",
        null,
        { productId: id, validationId }
      );

      res.json({
        success: true,
        productId: id,
        validationId,
        evaluation,
      });
    } catch (error: any) {
      const { BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");
      
      if (error instanceof BlockedPackageError) {
        return res.status(422).json({
          error: "PACKAGE_BLOCKED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }
      
      if (error instanceof WarnPackageError) {
        return res.status(409).json({
          error: "CONFIRMATION_REQUIRED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      console.error("Error updating package:", error);
      res.status(500).json({ error: error.message || "Failed to update package" });
    }
  });

  // Admin: Override blocked package
  app.post("/api/admin/store/packages/:id/override", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");
      const { overridePackageSchema } = await import("@shared/schema");

      const { id } = req.params;

      const parsed = overridePackageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      if (!adminUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { validationId } = await packageGuardrailService.overridePackage(
        id,
        parsed.data.note,
        adminUserId
      );

      await adminService.logAction(
        adminUserId,
        "store_package_override",
        null,
        { productId: id, validationId, note: parsed.data.note }
      );

      res.json({ success: true, validationId });
    } catch (error: any) {
      console.error("Error overriding package:", error);
      res.status(500).json({ error: error.message || "Failed to override package" });
    }
  });

  // Admin: Get validation history for a package
  app.get("/api/admin/store/packages/:id/validations", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const { id } = req.params;
      const validations = await packageGuardrailService.getValidationHistory(id);

      res.json({ validations });
    } catch (error: any) {
      console.error("Error getting validation history:", error);
      res.status(500).json({ error: error.message || "Failed to get validation history" });
    }
  });

  // Admin: Get latest validation for a package
  app.get("/api/admin/store/packages/:id/validation", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const { id } = req.params;
      const validation = await packageGuardrailService.getLatestValidation(id);

      if (!validation) {
        return res.status(404).json({ error: "No validations found" });
      }

      res.json({ validation });
    } catch (error: any) {
      console.error("Error getting latest validation:", error);
      res.status(500).json({ error: error.message || "Failed to get latest validation" });
    }
  });

  // ============================================
  // BUNDLE BUILDER ENDPOINTS (v2)
  // ============================================

  app.post("/api/admin/store/bundles/preview", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const previewSchema = z.object({
        channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).optional(),
        usdPriceCents: z.number().int().positive().optional(),
        packptsAmount: z.number().int().positive().optional(),
        driver: z.enum(["USD", "PACKPTS"]).optional(),
        ratioMode: z.enum(["AUTO", "OVERRIDE"]).optional(),
        overrideRatioUsdPerPackptMicro: z.number().int().positive().optional(),
      });

      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const result = await packageGuardrailService.previewBundle(parsed.data);
      res.json(result);
    } catch (error: any) {
      console.error("Error previewing bundle:", error);
      res.status(500).json({ error: error.message || "Failed to preview bundle" });
    }
  });

  app.post("/api/admin/store/bundles", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService, BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");

      const createSchema = z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        channel: z.enum(["web_stripe", "ios_iap", "android_iap"]),
        usdPriceCents: z.number().int().positive(),
        packptsAmount: z.number().int().positive(),
        ratioMode: z.enum(["AUTO", "OVERRIDE"]).default("AUTO"),
        overrideRatioUsdPerPackptMicro: z.number().int().positive().optional(),
        overrideReason: z.string().optional(),
        overrideGuardrails: z.boolean().optional(),
        overrideGuardrailsReason: z.string().optional(),
        confirm: z.boolean().optional(),
      });

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      if (!adminUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const result = await packageGuardrailService.createBundle({
        ...parsed.data,
        adminUserId,
      });

      res.json({ success: true, ...result });
    } catch (error: any) {
      const { BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");

      if (error instanceof BlockedPackageError) {
        return res.status(422).json({
          error: "PACKAGE_BLOCKED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      if (error instanceof WarnPackageError) {
        return res.status(409).json({
          error: "CONFIRMATION_REQUIRED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      console.error("Error creating bundle:", error);
      res.status(500).json({ error: error.message || "Failed to create bundle" });
    }
  });

  app.put("/api/admin/store/bundles/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService, BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");

      const updateSchema = z.object({
        sku: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        channel: z.enum(["web_stripe", "ios_iap", "android_iap"]).optional(),
        usdPriceCents: z.number().int().positive().optional(),
        packptsAmount: z.number().int().positive().optional(),
        ratioMode: z.enum(["AUTO", "OVERRIDE"]).optional(),
        overrideRatioUsdPerPackptMicro: z.number().int().positive().optional(),
        overrideReason: z.string().optional(),
        overrideGuardrails: z.boolean().optional(),
        overrideGuardrailsReason: z.string().optional(),
        confirm: z.boolean().optional(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      if (!adminUserId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const result = await packageGuardrailService.updateBundle({
        productId: req.params.id,
        ...parsed.data,
        adminUserId,
      });

      res.json({ success: true, productId: req.params.id, ...result });
    } catch (error: any) {
      const { BlockedPackageError, WarnPackageError } = await import("./services/store/packageGuardrailService");

      if (error instanceof BlockedPackageError) {
        return res.status(422).json({
          error: "PACKAGE_BLOCKED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      if (error instanceof WarnPackageError) {
        return res.status(409).json({
          error: "CONFIRMATION_REQUIRED",
          message: error.message,
          evaluation: error.evaluation,
        });
      }

      console.error("Error updating bundle:", error);
      res.status(500).json({ error: error.message || "Failed to update bundle" });
    }
  });

  app.get("/api/admin/store/bundles", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const channel = req.query.channel as string | undefined;
      const status = req.query.status as string | undefined;

      const bundles = await packageGuardrailService.listBundles({
        channel: channel as any,
        status,
      });

      res.json({ bundles });
    } catch (error: any) {
      console.error("Error listing bundles:", error);
      res.status(500).json({ error: error.message || "Failed to list bundles" });
    }
  });

  app.get("/api/admin/store/bundles/:id/audit-log", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { packageGuardrailService } = await import("./services/store/packageGuardrailService");

      const logs = await packageGuardrailService.getBundleAuditLog(req.params.id);

      res.json({ logs });
    } catch (error: any) {
      console.error("Error getting bundle audit log:", error);
      res.status(500).json({ error: error.message || "Failed to get bundle audit log" });
    }
  });

  // ============================================
  // FRAUD SCORING PIPELINE & RISK API ENDPOINTS
  // ============================================

  // Internal: Get user's own risk info (limited data)
  app.get("/api/internal/risk/snapshot", isAuthenticated, async (req: any, res) => {
    try {
      const { getPublicRiskInfo } = await import("./services/risk/riskAPI");
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const info = await getPublicRiskInfo(userId);
      if (!info) {
        return res.json({ tierSuggestion: "LOW", topReasons: [] });
      }

      res.json(info);
    } catch (error: any) {
      console.error("Error getting risk info:", error);
      res.status(500).json({ error: "Failed to get risk info" });
    }
  });

  // Internal: Request risk recalculation for current user
  app.post("/api/internal/risk/recompute", isAuthenticated, async (req: any, res) => {
    try {
      const { enqueueRiskRecalc } = await import("./services/risk/jobQueue");
      const userId = req.user?.claims?.sub || req.session?.localUserId;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const rateLimitKey = `risk-recompute:${userId}`;
      if (!checkRateLimit(rateLimitKey, 1, 60000)) {
        return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
      }

      await enqueueRiskRecalc(userId);
      res.json({ success: true, message: "Risk recalculation queued" });
    } catch (error: any) {
      console.error("Error queueing risk recompute:", error);
      res.status(500).json({ error: "Failed to queue risk recompute" });
    }
  });

  // Admin: Get full risk snapshot for a user
  app.get("/api/admin/risk/snapshot/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { getFullRiskSnapshot } = await import("./services/risk/riskAPI");
      const { userId } = req.params;

      const snapshot = await getFullRiskSnapshot(userId);
      if (!snapshot) {
        return res.json({ userId, tierSuggestion: "LOW", score: 0, flags: {}, topReasons: [] });
      }

      res.json(snapshot);
    } catch (error: any) {
      console.error("Error getting admin risk snapshot:", error);
      res.status(500).json({ error: "Failed to get risk snapshot" });
    }
  });

  // Admin: Get recent fraud signals for a user
  app.get("/api/admin/risk/signals/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { getRecentFraudSignals } = await import("./services/risk/riskAPI");
      const { userId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      const signals = await getRecentFraudSignals(userId, limit);
      res.json({ signals });
    } catch (error: any) {
      console.error("Error getting fraud signals:", error);
      res.status(500).json({ error: "Failed to get fraud signals" });
    }
  });

  // Admin: Create or update risk suppression
  app.post("/api/admin/risk/suppressions", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { createRiskSuppression } = await import("./services/risk/riskAPI");
      const { userId, signalType, expiresAt, reason } = req.body;

      if (!userId || !signalType || !expiresAt) {
        return res.status(400).json({ error: "userId, signalType, and expiresAt are required" });
      }

      const suppression = await createRiskSuppression(
        userId,
        signalType,
        new Date(expiresAt),
        reason
      );

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "risk_suppression_created",
        userId,
        { signalType, expiresAt, reason }
      );

      res.json({ success: true, suppression });
    } catch (error: any) {
      console.error("Error creating risk suppression:", error);
      res.status(500).json({ error: "Failed to create risk suppression" });
    }
  });

  // Admin: Get active suppressions for a user
  app.get("/api/admin/risk/suppressions/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { getActiveSuppressions } = await import("./services/risk/riskAPI");
      const { userId } = req.params;

      const suppressions = await getActiveSuppressions(userId);
      res.json({ suppressions });
    } catch (error: any) {
      console.error("Error getting risk suppressions:", error);
      res.status(500).json({ error: "Failed to get risk suppressions" });
    }
  });

  // Admin: Force risk recalculation for a user
  app.post("/api/admin/risk/recompute/:userId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { updateRiskSnapshot } = await import("./services/risk/snapshot");
      const { userId } = req.params;

      const snapshot = await updateRiskSnapshot(userId);

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(
        adminUserId,
        "risk_recompute_forced",
        userId,
        { newTier: snapshot.tierSuggestion, newScore: snapshot.score }
      );

      res.json({ success: true, snapshot });
    } catch (error: any) {
      console.error("Error forcing risk recompute:", error);
      res.status(500).json({ error: "Failed to recompute risk" });
    }
  });

  // ============================================================
  // ADMIN SET IMPORTER ENDPOINTS
  // ============================================================

  // GET /api/admin/card-sets - List all card sets with latest job status
  app.get("/api/admin/card-sets", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const sets = await db.select()
        .from(cardSets)
        .orderBy(sql`${cardSets.createdAt} DESC`);

      const setsWithDetails = await Promise.all(sets.map(async (set) => {
        const { getLatestJobForSet, getSetCardCount } = await import("./services/catalog/importer/setImporter");
        const latestJob = await getLatestJobForSet(set.id);
        const cardCount = await getSetCardCount(set.id);
        return {
          ...set,
          linkedCardCount: cardCount,
          latestJob: latestJob ? {
            id: latestJob.id,
            status: latestJob.status,
            cardsLinked: latestJob.cardsLinked,
            startedAt: latestJob.startedAt,
            finishedAt: latestJob.finishedAt,
          } : null,
        };
      }));

      res.json({ sets: setsWithDetails });
    } catch (error: any) {
      console.error("Error listing card sets:", error);
      res.status(500).json({ error: "Failed to list card sets" });
    }
  });

  // POST /api/admin/card-sets - Create a new card set
  app.post("/api/admin/card-sets", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { createCardSetSchema } = await import("@shared/schema");
      const parsed = createCardSetSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { sport, year, brand, setName, keywords, expectedCardCount } = parsed.data;

      const [newSet] = await db.insert(cardSets)
        .values({
          sport,
          year,
          brand: brand || null,
          setName,
          keywords: keywords || [],
          expectedCardCount: expectedCardCount || null,
        })
        .returning();

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(adminUserId, "card_set_created", newSet.id, { setName, sport, year });

      res.json({ success: true, set: newSet });
    } catch (error: any) {
      console.error("Error creating card set:", error);
      res.status(500).json({ error: "Failed to create card set" });
    }
  });

  // GET /api/admin/card-sets/:id - Get card set details
  app.get("/api/admin/card-sets/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      
      const [set] = await db.select()
        .from(cardSets)
        .where(eq(cardSets.id, id))
        .limit(1);

      if (!set) {
        return res.status(404).json({ error: "Card set not found" });
      }

      const { getLatestJobForSet, getSetCardCount } = await import("./services/catalog/importer/setImporter");
      const latestJob = await getLatestJobForSet(id);
      const cardCount = await getSetCardCount(id);

      res.json({
        set: {
          ...set,
          linkedCardCount: cardCount,
          latestJob,
        },
      });
    } catch (error: any) {
      console.error("Error getting card set:", error);
      res.status(500).json({ error: "Failed to get card set" });
    }
  });

  // PUT /api/admin/card-sets/:id - Update a card set
  app.put("/api/admin/card-sets/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { updateCardSetSchema } = await import("@shared/schema");
      const parsed = updateCardSetSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const data = parsed.data;
      
      if (data.sport !== undefined) updates.sport = data.sport;
      if (data.year !== undefined) updates.year = data.year;
      if (data.brand !== undefined) updates.brand = data.brand;
      if (data.setName !== undefined) updates.setName = data.setName;
      if (data.keywords !== undefined) updates.keywords = data.keywords;
      if (data.expectedCardCount !== undefined) updates.expectedCardCount = data.expectedCardCount;
      if (data.isActive !== undefined) updates.isActive = data.isActive;

      const [updated] = await db.update(cardSets)
        .set(updates)
        .where(eq(cardSets.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Card set not found" });
      }

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(adminUserId, "card_set_updated", id, updates);

      res.json({ success: true, set: updated });
    } catch (error: any) {
      console.error("Error updating card set:", error);
      res.status(500).json({ error: "Failed to update card set" });
    }
  });

  // DELETE /api/admin/card-sets/:id - Delete a card set
  app.delete("/api/admin/card-sets/:id", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      await db.delete(cardSets).where(eq(cardSets.id, id));

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(adminUserId, "card_set_deleted", id, {});

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting card set:", error);
      res.status(500).json({ error: "Failed to delete card set" });
    }
  });

  // POST /api/admin/card-sets/:id/import - Start import job for a card set
  app.post("/api/admin/card-sets/:id/import", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const [set] = await db.select()
        .from(cardSets)
        .where(eq(cardSets.id, id))
        .limit(1);

      if (!set) {
        return res.status(404).json({ error: "Card set not found" });
      }

      const { createImportJob, importSetFromCardHedge } = await import("./services/catalog/importer/setImporter");
      const jobId = await createImportJob(id);

      importSetFromCardHedge(id, jobId).catch((error) => {
        console.error(`Import job ${jobId} failed:`, error);
      });

      const adminUserId = req.user?.claims?.sub || req.session?.localUserId;
      await adminService.logAction(adminUserId, "card_set_import_started", id, { jobId });

      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("Error starting import:", error);
      res.status(500).json({ error: "Failed to start import" });
    }
  });

  // GET /api/admin/set-import-jobs/:jobId - Get import job status and logs
  app.get("/api/admin/set-import-jobs/:jobId", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { jobId } = req.params;

      const [job] = await db.select()
        .from(setImportJobs)
        .where(eq(setImportJobs.id, jobId))
        .limit(1);

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      const { getJobLogs } = await import("./services/catalog/importer/setImporter");
      const logs = await getJobLogs(jobId);

      res.json({ job, logs });
    } catch (error: any) {
      console.error("Error getting import job:", error);
      res.status(500).json({ error: "Failed to get import job" });
    }
  });

  // GET /api/admin/card-sets/:id/cards - Get cards linked to a set
  app.get("/api/admin/card-sets/:id/cards", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const offset = (page - 1) * pageSize;

      const cards = await db.select({
        id: catalogCards.id,
        player: catalogCards.player,
        description: catalogCards.description,
        cardNumber: catalogCards.cardNumber,
        variant: catalogCards.variant,
        imageUrl: catalogCards.imageUrl,
        setName: catalogCards.setName,
      })
        .from(cardSetCards)
        .innerJoin(catalogCards, eq(cardSetCards.cardId, catalogCards.id))
        .where(eq(cardSetCards.setId, id))
        .orderBy(catalogCards.player)
        .limit(pageSize)
        .offset(offset);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(cardSetCards)
        .where(eq(cardSetCards.setId, id));

      const totalCount = Number(countResult?.count ?? 0);

      res.json({
        cards,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      });
    } catch (error: any) {
      console.error("Error getting set cards:", error);
      res.status(500).json({ error: "Failed to get set cards" });
    }
  });

  // POST /api/admin/provider-diagnostics - Run provider diagnostics
  app.post("/api/admin/provider-diagnostics", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { sport } = req.body;
      
      if (!sport || !["Baseball", "Basketball", "Football", "Hockey"].includes(sport)) {
        return res.status(400).json({ error: "Invalid sport. Must be Baseball, Basketball, Football, or Hockey" });
      }

      const { cardHedgeProvider } = await import("./services/catalog/providers/cardhedge/cardhedgeProvider");
      const result = await cardHedgeProvider.diagnoseCoverage({ sport });

      res.json({ result });
    } catch (error: any) {
      console.error("Error running provider diagnostics:", error);
      res.status(500).json({ error: "Failed to run provider diagnostics" });
    }
  });

  // GET /api/card-sets - Public endpoint for active sets (for gameplay)
  app.get("/api/card-sets", async (_req, res) => {
    try {
      const activeSets = await db.select({
        id: cardSets.id,
        sport: cardSets.sport,
        year: cardSets.year,
        brand: cardSets.brand,
        setName: cardSets.setName,
      })
        .from(cardSets)
        .where(eq(cardSets.isActive, true))
        .orderBy(cardSets.year, cardSets.setName);

      const setsWithCount = await Promise.all(activeSets.map(async (set) => {
        const { getSetCardCount } = await import("./services/catalog/importer/setImporter");
        const linkedCount = await getSetCardCount(set.id);
        return { ...set, linkedCount };
      }));

      const playableSets = setsWithCount.filter(s => s.linkedCount >= 10);

      res.json({ sets: playableSets });
    } catch (error: any) {
      console.error("Error getting card sets:", error);
      res.status(500).json({ error: "Failed to get card sets" });
    }
  });

  // GET /api/card-sets/:id/cards - Public endpoint for set cards (for gameplay)
  app.get("/api/card-sets/:id/cards", async (req, res) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const offset = (page - 1) * pageSize;

      const [set] = await db.select()
        .from(cardSets)
        .where(and(eq(cardSets.id, id), eq(cardSets.isActive, true)))
        .limit(1);

      if (!set) {
        return res.status(404).json({ error: "Set not found or not active" });
      }

      const cards = await db.select({
        id: catalogCards.id,
        player: catalogCards.player,
        description: catalogCards.description,
        cardNumber: catalogCards.cardNumber,
        variant: catalogCards.variant,
        imageUrl: catalogCards.imageUrl,
      })
        .from(cardSetCards)
        .innerJoin(catalogCards, eq(cardSetCards.cardId, catalogCards.id))
        .where(eq(cardSetCards.setId, id))
        .limit(pageSize)
        .offset(offset);

      res.json({ cards });
    } catch (error: any) {
      console.error("Error getting set cards:", error);
      res.status(500).json({ error: "Failed to get set cards" });
    }
  });

  // ==================== MATCHMAKING & PRESENCE ENDPOINTS ====================

  // GET /api/presence/stats - Get online player statistics (public)
  app.get("/api/presence/stats", async (_req, res) => {
    try {
      const { presenceService } = await import("./services/presenceService");
      const { matchmakingService } = await import("./services/matchmakingService");
      
      const presenceStats = await presenceService.getPresenceStats();
      const queueStats = matchmakingService.getQueueStats();
      
      res.json({
        online: presenceStats.total,
        searching: presenceStats.searching,
        inMatch: presenceStats.inMatch,
        queueSize: queueStats.total,
        queuesByBucket: queueStats.byBucket,
      });
    } catch (error: unknown) {
      console.error("Error getting presence stats:", error);
      res.status(500).json({ error: "Failed to get presence stats" });
    }
  });

  // GET /api/matchmaking/status - Get current user's matchmaking status (authenticated)
  app.get("/api/matchmaking/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { presenceService } = await import("./services/presenceService");
      const { matchmakingService } = await import("./services/matchmakingService");

      const presence = await presenceService.getPresence(userId);
      const ticket = matchmakingService.getUserTicket(userId);
      const activeTicket = await matchmakingService.getActiveTicket(userId);

      res.json({
        isOnline: presence?.status !== "OFFLINE",
        status: presence?.status || "OFFLINE",
        inQueue: !!ticket,
        ticket: ticket ? {
          ticketId: ticket.ticketId,
          position: matchmakingService.getQueuePosition(ticket.ticketId),
          bucket: ticket.bucket,
          joinedAt: ticket.joinedAt,
          waitTime: Date.now() - ticket.joinedAt,
        } : null,
        dbTicket: activeTicket,
      });
    } catch (error: unknown) {
      console.error("Error getting matchmaking status:", error);
      res.status(500).json({ error: "Failed to get matchmaking status" });
    }
  });

  // POST /api/matches/:matchId/answer - REST fallback for answer submission
  // Uses the same DB-transactional engine path as the WebSocket handler
  const httpAnswerRateTracker: Map<string, number[]> = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of Array.from(httpAnswerRateTracker.entries())) {
      const recent = timestamps.filter((t: number) => now - t < 2000);
      if (recent.length === 0) httpAnswerRateTracker.delete(userId);
      else httpAnswerRateTracker.set(userId, recent);
    }
  }, 60000);
  app.post("/api/matches/:matchId/answer", isAuthenticated, async (req: any, res) => {
    try {
      const { matchId } = req.params;
      const { idx, selected, clientMsgId } = req.body;
      const userId = req.user.id;
      
      // Rate limit: max 3 submissions per 2 second window
      const now = Date.now();
      const timestamps = httpAnswerRateTracker.get(userId) || [];
      const recent = timestamps.filter(t => now - t < 2000);
      recent.push(now);
      if (recent.length === 0) httpAnswerRateTracker.delete(userId);
      else httpAnswerRateTracker.set(userId, recent);
      if (recent.length > 3) {
        return res.status(429).json({ ok: false, reason: "rate_limited" });
      }
      
      if (typeof idx !== "number" || typeof selected !== "string" || !selected) {
        return res.status(400).json({ ok: false, reason: "bad_payload" });
      }
      
      const result = await matchEngine.submitAnswer(matchId, userId, idx, selected, clientMsgId);
      
      if (result.status === "REJECTED") {
        const statusCode = result.reason === "stale_index" || result.reason === "match_initializing" ? 409 : 400;
        return res.status(statusCode).json({ 
          ok: false, 
          reason: result.reason,
          serverIndex: result.serverIndex,
          serverStatus: result.serverStatus,
        });
      }
      
      return res.json({ 
        ok: true, 
        correct: result.correct,
        correctAnswer: result.correctAnswer,
        pointsEarned: result.pointsEarned,
      });
    } catch (error: unknown) {
      console.error("Error submitting answer via REST:", error);
      res.status(500).json({ ok: false, reason: "server_error" });
    }
  });

  // GET /api/matches/:matchId/state - REST fallback for match state resync
  // Uses DB-sourced buildMatchState for consistency
  app.get("/api/matches/:matchId/state", isAuthenticated, async (req: any, res) => {
    try {
      const { matchId } = req.params;
      const userId = req.user.id;
      
      const matchState = await matchEngine.buildMatchState(matchId);
      
      if (!matchState) {
        return res.status(404).json({ ok: false, reason: "match_not_found" });
      }
      
      const isParticipant = matchState.participants.some(p => p.userId === userId);
      if (!isParticipant) {
        return res.status(403).json({ ok: false, reason: "not_participant" });
      }
      
      const currentQuestion = matchState.questions[matchState.currentQuestionIndex];
      
      return res.json({
        ok: true,
        matchId: matchState.matchId,
        status: matchState.status,
        currentIndex: matchState.currentQuestionIndex,
        totalQuestions: matchState.totalQuestions,
        question: currentQuestion ? {
          card: currentQuestion.card,
          options: currentQuestion.options,
          pointValue: currentQuestion.pointValue,
        } : null,
        participants: matchState.participants.map(p => ({
          userId: p.userId,
          username: p.username,
          score: p.score,
          correctAnswers: p.correctAnswers,
          hasAnsweredCurrent: p.hasAnsweredCurrent,
        })),
      });
    } catch (error: unknown) {
      console.error("Error getting match state via REST:", error);
      res.status(500).json({ ok: false, reason: "server_error" });
    }
  });

  // POST /api/matches/:matchId/resync-card - Replace a card that failed to load
  app.post("/api/matches/:matchId/resync-card", isAuthenticated, async (req: any, res) => {
    try {
      const { matchId } = req.params;
      const { idx } = req.body;
      const userId = req.user?.claims?.sub || req.session?.localUserId;

      if (!userId) {
        return res.status(401).json({ ok: false, error: "Authentication required" });
      }

      if (typeof idx !== "number" || idx < 0) {
        return res.status(400).json({ ok: false, error: "Invalid question index" });
      }

      const result = await matchService.resyncCard(matchId, idx, userId);

      if (!result.success) {
        if (result.error === "NO_REAL_IMAGE_CARDS_AVAILABLE") {
          return res.status(503).json({ ok: false, error: "NO_REAL_IMAGE_CARDS_AVAILABLE" });
        }
        return res.status(400).json({ ok: false, error: result.error });
      }

      return res.json({
        ok: true,
        idx,
        newQuestion: result.newQuestion ? {
          card: result.newQuestion.card,
          options: result.newQuestion.options,
          pointValue: result.newQuestion.pointValue,
        } : null,
      });
    } catch (error: unknown) {
      console.error("Error resyncing card:", error);
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // GET /api/matchmaking/queue-size - Get queue size (public)
  app.get("/api/matchmaking/queue-size", async (_req, res) => {
    try {
      const { matchmakingService } = await import("./services/matchmakingService");
      const stats = matchmakingService.getQueueStats();
      
      res.json({
        total: stats.total,
        byBucket: stats.byBucket,
      });
    } catch (error: unknown) {
      console.error("Error getting queue size:", error);
      res.status(500).json({ error: "Failed to get queue size" });
    }
  });

  // GET /api/debug/matches/:matchId/events - Admin debug endpoint for match events audit log
  app.get("/api/debug/matches/:matchId/events", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { matchId } = req.params;
      const limit = parseInt(req.query.limit) || 200;
      
      const events = await matchEngine.getMatchEvents(matchId, Math.min(limit, 500));
      
      return res.json({
        ok: true,
        matchId,
        count: events.length,
        events,
      });
    } catch (error: unknown) {
      console.error("Error getting match events:", error);
      res.status(500).json({ ok: false, error: "Failed to get match events" });
    }
  });

  // GET /api/debug/matches/:matchId/answers - Admin debug endpoint for match answers
  app.get("/api/debug/matches/:matchId/answers", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { matchId } = req.params;
      const idx = req.query.idx !== undefined ? parseInt(req.query.idx) : undefined;
      
      const answers = await matchEngine.getMatchAnswers(matchId, idx);
      const answeredCount = answers.length;
      
      return res.json({
        ok: true,
        matchId,
        idx: idx ?? "all",
        answeredCount,
        rows: answers.map((a: any) => ({
          userId: a.userId,
          idx: a.idx,
          selected: a.selected,
          isCorrect: a.isCorrect,
          answeredAt: a.answeredAt,
        })),
      });
    } catch (error: unknown) {
      console.error("Error getting match answers:", error);
      res.status(500).json({ ok: false, error: "Failed to get match answers" });
    }
  });

  // ==========================================
  // GROWTH AGENT ADMIN API
  // ==========================================

  app.get("/api/admin/growth/overview", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { getRegisteredJobs, getSchedule, getCircuitBreakerStatus, getPipelineHealth, getOpenAIHealthStatus, getTikTokConfig } = await import("./services/growth");
      const plans = await db.select().from(growthContentPlans).orderBy(desc(growthContentPlans.date)).limit(7);
      const recentRuns = await db.select().from(growthJobRuns).orderBy(desc(growthJobRuns.startedAt)).limit(20);
      const queueCount = await db.select({ count: sql<number>`count(*)` }).from(publishingQueue).where(eq(publishingQueue.status, "READY"));
      const platformStatus = {
        discord: !!process.env.DISCORD_WEBHOOK_URL,
        x: !!(process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET && process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_SECRET),
        instagram: !!(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN),
        reddit: !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD),
      };

      const todayChicago = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const [todayPlan] = await db.select().from(growthContentPlans)
        .where(and(eq(growthContentPlans.date, todayChicago), eq(growthContentPlans.status, "ACTIVE")))
        .limit(1);
      let todayContentResult: { count: number }[];
      let todayPostResult: { count: number }[];
      if (todayPlan) {
        todayContentResult = await db.select({ count: sql<number>`count(*)` }).from(growthContentItems)
          .where(eq(growthContentItems.planId, todayPlan.id));
        todayPostResult = await db.select({ count: sql<number>`count(*)` }).from(growthContentItems)
          .where(and(
            eq(growthContentItems.planId, todayPlan.id),
            eq(growthContentItems.status, "POSTED")
          ));
      } else {
        todayContentResult = [{ count: 0 }];
        todayPostResult = [{ count: 0 }];
      }
      const todayContentCount = Number(todayContentResult[0]?.count || 0);
      const todayPostCount = Number(todayPostResult[0]?.count || 0);

      let lastPlanFailure: string | undefined;
      const [failedPlanRun] = await db.select().from(growthJobRuns)
        .where(and(
          eq(growthJobRuns.jobName, "generate_daily_plan"),
          eq(growthJobRuns.status, "FAILED"),
          sql`${growthJobRuns.startedAt} >= ${todayChicago}::date`,
          sql`${growthJobRuns.startedAt} < (${todayChicago}::date + interval '1 day')`
        ))
        .orderBy(desc(growthJobRuns.startedAt))
        .limit(1);
      if (failedPlanRun) {
        lastPlanFailure = failedPlanRun.error || "Unknown error";
      }

      let stalled = false;
      let stalledReason: string | undefined;
      if (!todayPlan && failedPlanRun) {
        stalled = true;
        stalledReason = `Today's content plan failed to generate. No content can be created until this is fixed. Last error: ${lastPlanFailure}`;
      } else if (!todayPlan && todayContentCount === 0) {
        const now = new Date();
        const utcHour = now.getUTCHours();
        if (utcHour >= 14) {
          stalled = true;
          stalledReason = "No content plan or content items exist for today. The pipeline may not be running. Try manually triggering 'generate daily plan'.";
        }
      }

      const detailedHealth = await getPipelineHealth();

      const tiktokConfig = getTikTokConfig();

      res.json({
        enabled: process.env.GROWTH_AGENT_ENABLED === "true",
        circuitBreaker: getCircuitBreakerStatus(),
        registeredJobs: getRegisteredJobs(),
        schedule: getSchedule(),
        recentPlans: plans,
        recentRuns,
        pendingQueueCount: Number(queueCount[0]?.count || 0),
        platformStatus: {
          ...platformStatus,
          tiktok: tiktokConfig.enabled,
        },
        tiktokConfig,
        pipelineHealth: {
          hasTodayPlan: !!todayPlan,
          todayContentCount,
          todayPostCount,
          lastPlanFailure,
          stalled,
          stalledReason,
        },
        detailedPipelineHealth: detailedHealth,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/admin/growth/plans", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 30, 100);
      const plans = await db.select().from(growthContentPlans).orderBy(desc(growthContentPlans.date)).limit(limit);
      res.json({ plans });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.patch("/api/admin/growth/plans/:id", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !["ACTIVE", "ARCHIVED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be ACTIVE or ARCHIVED." });
      }
      const [updated] = await db.update(growthContentPlans)
        .set({ status, updatedAt: new Date() })
        .where(eq(growthContentPlans.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Plan not found" });
      res.json({ plan: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/admin/growth/items", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const platform = req.query.platform as string | undefined;
      const status = req.query.status as string | undefined;
      let query = db.select().from(growthContentItems).orderBy(desc(growthContentItems.createdAt)).limit(limit);
      if (platform) query = query.where(eq(growthContentItems.platform, platform)) as any;
      if (status) query = query.where(eq(growthContentItems.status, status)) as any;
      const items = await query;
      res.json({ items });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/admin/growth/queue", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const status = req.query.status as string | undefined;
      const platform = req.query.platform as string | undefined;
      const date = req.query.date as string | undefined;

      const conditions: any[] = [];
      if (status) conditions.push(eq(publishingQueue.status, status));
      if (platform) conditions.push(eq(publishingQueue.platform, platform));

      let query;
      if (conditions.length > 0) {
        query = db.select({
          queue: publishingQueue,
          contentItem: growthContentItems,
        })
          .from(publishingQueue)
          .leftJoin(growthContentItems, eq(publishingQueue.contentItemId, growthContentItems.id))
          .where(and(...conditions))
          .orderBy(desc(publishingQueue.createdAt))
          .limit(limit);
      } else {
        query = db.select({
          queue: publishingQueue,
          contentItem: growthContentItems,
        })
          .from(publishingQueue)
          .leftJoin(growthContentItems, eq(publishingQueue.contentItemId, growthContentItems.id))
          .orderBy(desc(publishingQueue.createdAt))
          .limit(limit);
      }

      const rows = await query;

      let items = rows.map(r => ({
        ...r.queue,
        contentItem: r.contentItem ? {
          id: r.contentItem.id,
          type: r.contentItem.type,
          title: r.contentItem.title,
          body: r.contentItem.body,
          metadata: r.contentItem.metadata,
          scheduledFor: r.contentItem.scheduledFor,
          status: r.contentItem.status,
        } : null,
      }));

      if (date) {
        items = items.filter(item => {
          const sf = item.contentItem?.scheduledFor;
          if (!sf) {
            const ca = item.createdAt;
            if (!ca) return false;
            return new Date(ca).toISOString().slice(0, 10) === date;
          }
          return new Date(sf).toISOString().slice(0, 10) === date;
        });
      }

      res.json({ items });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/admin/growth/queue/:id/posted", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(publishingQueue).where(eq(publishingQueue.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Queue item not found" });
      if (existing.status === "POSTED") return res.json({ ok: true, already: true, item: existing });

      const [updated] = await db.update(publishingQueue).set({
        status: "POSTED",
        postedBy: req.user?.id || null,
        postedAt: new Date(),
      }).where(eq(publishingQueue.id, id)).returning();

      if (existing.contentItemId) {
        await db.update(growthContentItems).set({
          status: "POSTED",
          postedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(growthContentItems.id, existing.contentItemId));
      }

      res.json({ ok: true, item: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/admin/growth/queue/:id/mark-ready", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(publishingQueue).where(eq(publishingQueue.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Queue item not found" });

      const [updated] = await db.update(publishingQueue).set({
        status: "READY",
        postedBy: null,
        postedAt: null,
      }).where(eq(publishingQueue.id, id)).returning();

      if (existing.contentItemId) {
        await db.update(growthContentItems).set({
          status: "READY",
          postedAt: null,
          updatedAt: new Date(),
        }).where(eq(growthContentItems.id, existing.contentItemId));
      }

      res.json({ ok: true, item: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/admin/growth/queue/bulk-mark-posted", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });

      const results: string[] = [];
      for (const id of ids) {
        const [existing] = await db.select().from(publishingQueue).where(eq(publishingQueue.id, id)).limit(1);
        if (!existing || existing.status === "POSTED") continue;

        await db.update(publishingQueue).set({
          status: "POSTED",
          postedBy: req.user?.id || null,
          postedAt: new Date(),
        }).where(eq(publishingQueue.id, id));

        if (existing.contentItemId) {
          await db.update(growthContentItems).set({
            status: "POSTED",
            postedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(growthContentItems.id, existing.contentItemId));
        }

        results.push(id);
      }

      res.json({ ok: true, markedCount: results.length, ids: results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/admin/growth/runs", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const runs = await db.select().from(growthJobRuns).orderBy(desc(growthJobRuns.startedAt)).limit(limit);
      res.json({ runs });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/admin/growth/run-job", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { jobName } = req.body;
      if (!jobName) return res.status(400).json({ error: "jobName required" });
      const { executeJob } = await import("./services/growth");
      const result = await executeJob(jobName, { skipCircuitBreaker: true });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/admin/growth/circuit-breaker/reset", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const { resetCircuitBreaker } = await import("./services/growth");
      resetCircuitBreaker();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  return httpServer;
}
