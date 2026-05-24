import type { Express, Request, Response, NextFunction } from "express";
import { isAuthenticated } from "../auth";
import { storage } from "../storage";
import { adminService } from "../services/adminService";
import { streakService } from "../services/streakService";
import { db } from "../db";
import { eq, sql, desc } from "drizzle-orm";
import { users, purchaseEvents, products } from "@shared/schema";
import type { User } from "@shared/schema";
import { fetch1987ToppsFromCardHedge, isCardHedgeConfigured } from "../services/cardHedge";
import { z } from "zod";

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

export function registerAdminRoutes(app: Express): void {
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
      const { getValidationStatus } = await import("../services/imageValidation");
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
      const { validatePlayableCardImages, validateBaseballCardImages } = await import("../services/imageValidation");

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
      const { getCardPoolStats, isRefreshJobRunning } = await import("../services/cardPoolRefresh");
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
      const { runCardPoolRefreshJob, isRefreshJobRunning } = await import("../services/cardPoolRefresh");

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

      const { revalidateCard } = await import("../services/imageValidation");
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
      const { getCardDeliveryStats } = await import("../services/telemetry/cardDelivery");
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
}
