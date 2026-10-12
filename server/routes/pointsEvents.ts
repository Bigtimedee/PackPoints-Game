/**
 * POST /api/points/event: points clarity analytics (ENG_SPEC section 4.7).
 * Allowlisted event names only. rebateLive is stamped from the server flag,
 * never trusted from the client. Fire-and-forget via track(); always 204.
 */
import type { Express, Request, Response } from "express";
import { track } from "../services/analytics/track";
import { rebatesLive } from "./pointsValue";

export const POINTS_EVENTS = ["points_strip_view", "points_cta_click", "points_page_view", "wallet_sheet_open"] as const;
const SURFACES = new Set(["game_complete", "daily5_complete", "points_page", "wallet_sheet", "onboarding", "home"]);
const CTAS = new Set(["how_points_work", "play_now", "back_to_game", "start_playing", "skip"]);

export function sanitizePointsEvent(body: any): { event: string; payload: Record<string, any> } | null {
  if (!body || typeof body !== "object") return null;
  const event = body.event;
  if (typeof event !== "string" || !(POINTS_EVENTS as readonly string[]).includes(event)) return null;
  const payload: Record<string, any> = { rebateLive: rebatesLive() };
  if (typeof body.surface === "string" && SURFACES.has(body.surface)) payload.surface = body.surface;
  if (typeof body.cta === "string" && CTAS.has(body.cta)) payload.cta = body.cta;
  return { event, payload };
}

export function registerPointsEventsRoute(app: Express): void {
  app.post("/api/points/event", (req: Request, res: Response) => {
    const clean = sanitizePointsEvent(req.body);
    if (!clean) return res.status(400).json({ error: "unknown event" });
    const userId = (req as any).user?.claims?.sub || (req as any).session?.localUserId || null;
    track({ eventType: clean.event, userId, payload: clean.payload });
    res.status(204).end();
  });
}
