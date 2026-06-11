/**
 * growth.routes.ts
 *
 * Admin API endpoints for the PackPTS Growth Agent and Publishing Queue.
 * All endpoints require authentication and admin role.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { isAuthenticated } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import {
  growthContentPlans,
  growthContentItems,
  publishingQueue,
  growthJobRuns,
  globalGrowthRollups,
  userGrowthRollups,
  shareEvents,
  users,
  socialPosts,
  postAnalytics,
  abTests,
} from "@shared/schema";
import { eq, desc, and, sum, sql, asc, avg, count, max } from "drizzle-orm";
// Lazy-import heavy services that depend on native binaries (sharp, ffmpeg-static).
// Static imports here would crash the server on startup if the native binaries
// fail to load, preventing ALL routes from registering.
// These are only needed in specific admin endpoints, so we import on demand.
const getGrowthAgent = () => import("../services/growthAgent");
const getVideoFactory = () => import("../services/videoFactory");
const getRollup = () => import("../services/growthFlywheel/rollup");
import { z } from "zod";

const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as any;
  const session = req.session as any;
  const userId = user?.claims?.sub || session?.localUserId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const dbUser = await storage.getUser(userId);
  if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
  next();
};

export function registerGrowthRoutes(app: Express): void {
  // GET /api/admin/growth/plans — list all plans, newest first
  app.get(
    "/api/admin/growth/plans",
    isAuthenticated,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const plans = await db
          .select()
          .from(growthContentPlans)
          .orderBy(desc(growthContentPlans.date))
          .limit(60);
        res.json(plans);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/growth/plans/:planId/items — content items for a plan
  app.get(
    "/api/admin/growth/plans/:planId/items",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const items = await db
          .select()
          .from(growthContentItems)
          .where(eq(growthContentItems.planId, req.params.planId))
          .orderBy(growthContentItems.platform, growthContentItems.contentType);
        res.json(items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/growth/queue — publishing queue, optional ?status=&platform=
  app.get(
    "/api/admin/growth/queue",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const { status, platform } = req.query as Record<string, string>;
        const conditions = [];
        if (status) conditions.push(eq(publishingQueue.status, status as any));
        if (platform) conditions.push(eq(publishingQueue.platform, platform as any));

        const rows = await db
          .select({
            queue: publishingQueue,
            item: growthContentItems,
          })
          .from(publishingQueue)
          .leftJoin(growthContentItems, eq(publishingQueue.contentItemId, growthContentItems.id))
          .where(conditions.length > 0 ? and(...(conditions as [any, ...any[]])) : undefined)
          .orderBy(desc(publishingQueue.createdAt))
          .limit(200);

        res.json(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // POST /api/admin/growth/trigger — manually trigger job for a date
  app.post(
    "/api/admin/growth/trigger",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "date must be YYYY-MM-DD" });

      try {
        const { runDailyGrowthJob } = await getGrowthAgent();
        const result = await runDailyGrowthJob(parsed.data.date);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // PATCH /api/admin/growth/queue/:queueId/mark-posted
  app.patch(
    "/api/admin/growth/queue/:queueId/mark-posted",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = req.user as any;
        const session = req.session as any;
        const userId = user?.claims?.sub || session?.localUserId;

        await db
          .update(publishingQueue)
          .set({ status: "POSTED", postedAt: new Date(), postedBy: userId ?? null })
          .where(eq(publishingQueue.id, req.params.queueId));

        const [queueRow] = await db
          .select({ contentItemId: publishingQueue.contentItemId })
          .from(publishingQueue)
          .where(eq(publishingQueue.id, req.params.queueId))
          .limit(1);

        if (queueRow) {
          await db
            .update(growthContentItems)
            .set({ status: "POSTED", updatedAt: new Date() })
            .where(eq(growthContentItems.id, queueRow.contentItemId));
        }

        res.json({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // PATCH /api/admin/growth/queue/:queueId/mark-skipped
  app.patch(
    "/api/admin/growth/queue/:queueId/mark-skipped",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        await db
          .update(publishingQueue)
          .set({ status: "SKIPPED" })
          .where(eq(publishingQueue.id, req.params.queueId));

        const [queueRow] = await db
          .select({ contentItemId: publishingQueue.contentItemId })
          .from(publishingQueue)
          .where(eq(publishingQueue.id, req.params.queueId))
          .limit(1);

        if (queueRow) {
          await db
            .update(growthContentItems)
            .set({ status: "SKIPPED", updatedAt: new Date() })
            .where(eq(growthContentItems.id, queueRow.contentItemId));
        }

        res.json({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // POST /api/admin/growth/queue/:queueId/render — render video for the content item
  app.post(
    "/api/admin/growth/queue/:queueId/render",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        // Look up the content item id via the queue row
        const [queueRow] = await db
          .select({ contentItemId: publishingQueue.contentItemId })
          .from(publishingQueue)
          .where(eq(publishingQueue.id, req.params.queueId))
          .limit(1);

        if (!queueRow) {
          return res.status(404).json({ message: "Queue entry not found" });
        }

        const { renderVideo } = await getVideoFactory();
        const result = await renderVideo(queueRow.contentItemId);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // ── Growth Flywheel routes ────────────────────────────────────────────────

  // GET /api/admin/growth/flywheel?days=N — last N days of global rollups (default 30)
  app.get(
    "/api/admin/growth/flywheel",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const days = Math.min(Number(req.query.days ?? 30), 90);
        const rows = await db
          .select()
          .from(globalGrowthRollups)
          .orderBy(desc(globalGrowthRollups.dayKey))
          .limit(days);
        res.json(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // POST /api/admin/growth/flywheel/compute — trigger rollup for a date (default: yesterday)
  app.post(
    "/api/admin/growth/flywheel/compute",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      const schema = z.object({
        dayKey: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "dayKey must be YYYY-MM-DD" });
      }
      // Default to yesterday UTC
      const dayKey =
        parsed.data.dayKey ??
        new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      try {
        const { computeRollup } = await getRollup();
        const result = await computeRollup(dayKey);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/growth/flywheel/top-users?days=N — top users ranked by signups driven
  app.get(
    "/api/admin/growth/flywheel/top-users",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const days = Math.min(Number(req.query.days ?? 30), 90);
        const cutoff = new Date(Date.now() - days * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const rows = await db
          .select({
            userId: userGrowthRollups.userId,
            username: users.username,
            matchesPlayed: sum(userGrowthRollups.matchesPlayed).mapWith(Number),
            daily5Entries: sum(userGrowthRollups.daily5Entries).mapWith(Number),
            sharesTotal: sum(userGrowthRollups.sharesTotal).mapWith(Number),
            invitesSent: sum(userGrowthRollups.invitesSent).mapWith(Number),
            signupsFromInvites: sum(userGrowthRollups.signupsFromInvites).mapWith(Number),
          })
          .from(userGrowthRollups)
          .leftJoin(users, eq(userGrowthRollups.userId, users.id))
          .where(sql`${userGrowthRollups.dayKey} >= ${cutoff}`)
          .groupBy(userGrowthRollups.userId, users.username)
          .orderBy(desc(sum(userGrowthRollups.signupsFromInvites)))
          .limit(50);
        res.json(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/growth/flywheel/top-assets?days=N — content assets ranked by share count
  app.get(
    "/api/admin/growth/flywheel/top-assets",
    isAuthenticated,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const days = Math.min(Number(req.query.days ?? 30), 90);
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const rows = await db
          .select({
            contentAssetId: shareEvents.contentAssetId,
            shareCount: sql<number>`cast(count(*) as int)`,
          })
          .from(shareEvents)
          .where(
            and(
              sql`${shareEvents.contentAssetId} is not null`,
              sql`${shareEvents.createdAt} >= ${cutoff}`,
            ),
          )
          .groupBy(shareEvents.contentAssetId)
          .orderBy(desc(sql`count(*)`))
          .limit(50);
        res.json(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/growth/job-runs — recent job runs
  app.get(
    "/api/admin/growth/job-runs",
    isAuthenticated,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const runs = await db
          .select()
          .from(growthJobRuns)
          .orderBy(desc(growthJobRuns.startedAt))
          .limit(50);
        res.json(runs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/social/analytics
  app.get(
    "/api/admin/social/analytics",
    isAuthenticated,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        // Most-recent analytics row per post via a lateral subquery approach:
        // use a CTE to rank rows by fetchedAt descending, then keep rank = 1.
        const latestAnalytics = db
          .select({
            postId: postAnalytics.postId,
            impressions: postAnalytics.impressions,
            likes: postAnalytics.likes,
            shares: postAnalytics.shares,
            comments: postAnalytics.comments,
            clicks: postAnalytics.clicks,
            conversionRate: postAnalytics.conversionRate,
            rn: sql<number>`row_number() over (partition by ${postAnalytics.postId} order by ${postAnalytics.fetchedAt} desc)`.as("rn"),
          })
          .from(postAnalytics)
          .as("latest_analytics");

        // Summary
        const [summaryRow] = await db
          .select({
            totalImpressions: sql<number>`cast(coalesce(sum(${latestAnalytics.impressions}), 0) as int)`,
            totalLikes: sql<number>`cast(coalesce(sum(${latestAnalytics.likes}), 0) as int)`,
            publishedPosts: sql<number>`cast(count(distinct ${socialPosts.id}) as int)`,
          })
          .from(socialPosts)
          .leftJoin(latestAnalytics, and(eq(socialPosts.id, latestAnalytics.postId), sql`${latestAnalytics.rn} = 1`))
          .where(eq(socialPosts.status, "PUBLISHED" as any));

        const publishedPosts = summaryRow.publishedPosts ?? 0;
        const totalImpressions = summaryRow.totalImpressions ?? 0;
        const summary = {
          totalImpressions,
          totalLikes: summaryRow.totalLikes ?? 0,
          publishedPosts,
          avgImpressionsPerPost: publishedPosts > 0 ? Math.round(totalImpressions / publishedPosts) : 0,
        };

        // By content type + ab_group
        const byContentType = await db
          .select({
            contentType: socialPosts.contentType,
            abGroup: socialPosts.abGroup,
            postCount: sql<number>`cast(count(distinct ${socialPosts.id}) as int)`,
            totalImpressions: sql<number>`cast(coalesce(sum(${latestAnalytics.impressions}), 0) as int)`,
            totalLikes: sql<number>`cast(coalesce(sum(${latestAnalytics.likes}), 0) as int)`,
            avgImpressions: sql<number>`cast(coalesce(avg(${latestAnalytics.impressions}), 0) as int)`,
            avgLikes: sql<number>`cast(coalesce(avg(${latestAnalytics.likes}), 0) as int)`,
          })
          .from(socialPosts)
          .leftJoin(latestAnalytics, and(eq(socialPosts.id, latestAnalytics.postId), sql`${latestAnalytics.rn} = 1`))
          .where(eq(socialPosts.status, "PUBLISHED" as any))
          .groupBy(socialPosts.contentType, socialPosts.abGroup)
          .orderBy(desc(sql`sum(${latestAnalytics.impressions})`));

        // Recent posts
        const recentPosts = await db
          .select({
            id: socialPosts.id,
            platform: socialPosts.platform,
            contentType: socialPosts.contentType,
            abGroup: socialPosts.abGroup,
            publishedAt: socialPosts.publishedAt,
            copyPreview: sql<string>`substring(${socialPosts.copyText}, 1, 100)`,
            impressions: latestAnalytics.impressions,
            likes: latestAnalytics.likes,
            shares: latestAnalytics.shares,
            clicks: latestAnalytics.clicks,
            conversionRate: latestAnalytics.conversionRate,
          })
          .from(socialPosts)
          .leftJoin(latestAnalytics, and(eq(socialPosts.id, latestAnalytics.postId), sql`${latestAnalytics.rn} = 1`))
          .where(eq(socialPosts.status, "PUBLISHED" as any))
          .orderBy(desc(socialPosts.publishedAt))
          .limit(50);

        res.json({ summary, byContentType, recentPosts });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );

  // GET /api/admin/social/ab-tests
  app.get(
    "/api/admin/social/ab-tests",
    isAuthenticated,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const tests = await db
          .select()
          .from(abTests)
          .orderBy(desc(abTests.startedAt))
          .limit(50);

        const latestAnalytics = db
          .select({
            postId: postAnalytics.postId,
            impressions: postAnalytics.impressions,
            likes: postAnalytics.likes,
            rn: sql<number>`row_number() over (partition by ${postAnalytics.postId} order by ${postAnalytics.fetchedAt} desc)`.as("rn"),
          })
          .from(postAnalytics)
          .as("latest_analytics");

        const variantRows = await db
          .select({
            abTestId: socialPosts.abTestId,
            abGroup: socialPosts.abGroup,
            postCount: sql<number>`cast(count(distinct ${socialPosts.id}) as int)`,
            totalImpressions: sql<number>`cast(coalesce(sum(${latestAnalytics.impressions}), 0) as int)`,
            totalLikes: sql<number>`cast(coalesce(sum(${latestAnalytics.likes}), 0) as int)`,
          })
          .from(socialPosts)
          .leftJoin(latestAnalytics, and(eq(socialPosts.id, latestAnalytics.postId), sql`${latestAnalytics.rn} = 1`))
          .where(sql`${socialPosts.abTestId} is not null`)
          .groupBy(socialPosts.abTestId, socialPosts.abGroup);

        const variantsByTest: Record<string, Record<string, { postCount: number; totalImpressions: number; totalLikes: number }>> = {};
        for (const row of variantRows) {
          if (!row.abTestId) continue;
          if (!variantsByTest[row.abTestId]) variantsByTest[row.abTestId] = {};
          variantsByTest[row.abTestId][row.abGroup ?? "?"] = {
            postCount: row.postCount,
            totalImpressions: row.totalImpressions,
            totalLikes: row.totalLikes,
          };
        }

        const result = tests.map((t) => ({
          id: t.id,
          contentType: t.contentType,
          testName: t.testName,
          status: t.status,
          winner: t.winner,
          winningMetric: t.winningMetric,
          hypothesis: t.hypothesis,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
          variants: variantsByTest[t.id] ?? {},
        }));

        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: msg });
      }
    },
  );
}
