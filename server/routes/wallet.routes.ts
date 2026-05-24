import type { Express, Request, Response, NextFunction } from "express";
import { walletService } from "../services/walletService";
import { applyLedgerEntry, getBalance as getLedgerBalance, reconcileBalance as reconcileLedgerBalance, getLedgerHistory } from "../services/packpts/ledgerService";
import { reconcileAllWallets, reconcileCrossSystem } from "../services/walletReconciliation";
import { isAuthenticated } from "../auth";
import { bucketService } from "../services/bucketService";
import { expirationEngine } from "../services/expirationEngine";
import { analyticsService } from "../services/analyticsService";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { spendWalletSchema, earnWalletSchema, adjustWalletSchema, userRiskState } from "@shared/schema";
import { z } from "zod";
import { getDailyProgress } from "../services/rewards/dailyGameplayBase";
import { getDailyProgress as getMatchDailyProgress } from "../services/progress/dailyProgress";
import { retryFailedWebhookEvents } from "../services/webhookRetryWorker";

// Middleware to require admin role (local copy for wallet admin routes)
const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as any;
  const session = req.session as any;
  const userId = user?.claims?.sub || session?.localUserId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { storage } = await import("../storage");
  const dbUser = await storage.getUser(userId);
  if (!dbUser?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

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

export function registerWalletRoutes(app: Express): void {
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

      let walletData = await walletService.getWalletWithHistory(userId, 10);
      if (!walletData) {
        await walletService.getOrCreateWallet(userId);
        walletData = await walletService.getWalletWithHistory(userId, 10);
      }
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

      const { walletService: ws } = await import("../services/walletService");
      const { riskEngine } = await import("../services/riskEngine");

      // Get wallet balance
      const wallet = await ws.getOrCreateWallet(userId);

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

  // POST /api/admin/packpts/reconcile-all — check every wallet's cached balance vs ledger sum
  app.post("/api/admin/packpts/reconcile-all", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const report = await reconcileAllWallets();
      res.json(report);
    } catch (error) {
      console.error("Error running reconcileAllWallets:", error);
      res.status(500).json({ error: "Failed to run full wallet reconciliation" });
    }
  });

  // POST /api/admin/packpts/reconcile-cross-system — compare pointsAwards totals vs wallet.lifetimeEarned
  app.post("/api/admin/packpts/reconcile-cross-system", isAuthenticated, requireAdmin, async (_req: any, res) => {
    try {
      const report = await reconcileCrossSystem();
      res.json(report);
    } catch (error) {
      console.error("Error running reconcileCrossSystem:", error);
      res.status(500).json({ error: "Failed to run cross-system reconciliation" });
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
}
