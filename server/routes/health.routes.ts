import type { Express } from "express";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { playableCards } from "@shared/schema";
import { isStripeConfiguredSync, getStripeMode } from "../stripeClient";

export function registerHealthRoutes(app: Express): void {
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
      socialPlatforms: {
        instagram: !!process.env.INSTAGRAM_ACCESS_TOKEN,
        facebook: !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
        tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
        aiContentGeneration: !!process.env.OPENAI_API_KEY,
      },
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
}
