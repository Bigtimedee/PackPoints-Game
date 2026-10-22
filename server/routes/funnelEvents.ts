/**
 * Public signup-funnel beacon. Same-origin, rate limited, no auth.
 * Records signup_view, signup_started, signup_error, and share_view only.
 * signup_complete and first_daily5_complete_registered are server-side.
 */
import type { Express, Request, Response } from "express";
import { isSameOriginRequest } from "../lib/signupAttribution";
import { funnelEventLimiter } from "../middleware/rateLimiter";
import { parseClientFunnelEvent } from "../services/signupFunnel";
import { recordFunnelEvent } from "../services/funnel";

export function registerFunnelEventRoutes(app: Express): void {
  app.post("/api/funnel/event", funnelEventLimiter, (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const parsed = parseClientFunnelEvent(req.body);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid event" });
    }
    recordFunnelEvent(req, parsed.eventType, {
      mode: parsed.mode,
      path: parsed.path,
      utmSource: parsed.utmSource,
    });
    return res.status(204).end();
  });
}
