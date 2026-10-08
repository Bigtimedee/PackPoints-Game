import type { Express, Request, Response } from "express";
import { clearAttributionCookie, isSameOriginRequest, sanitizeAttribution, setAttributionCookie } from "../lib/signupAttribution";

/** Historical provider identities remain in the DB; no SDK, linking or provider calls. */
export function registerRetiredProviderRoutes(app: Express): void {
  app.post("/api/auth/attribution", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "Forbidden" });
    const attribution = sanitizeAttribution(req.body);
    if (!attribution) { clearAttributionCookie(res); return res.status(204).end(); }
    setAttributionCookie(res, attribution);
    return res.status(204).end();
  });
  app.get("/api/auth/workos/start", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Fixed local destination: ignore next, redirect, linkIntent and all external URLs.
    res.redirect(302, "/auth?tab=login");
  });
  app.get("/api/auth/workos/callback", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(410).json({ error: "This sign-in provider has been retired. Use password sign-in or password recovery." });
  });
}
