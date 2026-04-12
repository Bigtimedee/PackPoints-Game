/**
 * growth.routes.ts
 *
 * Admin API endpoints for the PackPTS Growth Agent and Publishing Queue.
 * All endpoints require authentication and admin role.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import {
  growthContentPlans,
  growthContentItems,
  publishingQueue,
  growthJobRuns,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { runDailyGrowthJob } from "../services/growthAgent";
import { renderVideo } from "../services/videoFactory";
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

        const result = await renderVideo(queueRow.contentItemId);
        res.json(result);
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
}
