/**
 * GTM funnel and rebate liability reports. Same QA token as /api/qa/signups
 * (COVER_QA_TOKEN in header X-QA-Token). Read-only. Never referenced by client code.
 *   GET /api/qa/funnel?days=30
 *   GET /api/qa/rebate-liability?weeks=12
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";

function send(req: Request, res: Response, status: number, payload: unknown): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).json(payload);
}

const authorized = (req: Request) => coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));

export function registerFunnelQaRoutes(app: Express): void {
  app.get("/api/qa/funnel", (req, res) => {
    if (!authorized(req)) return send(req, res, 401, { error: "Unauthorized" });
    void (async () => {
      const { buildFunnelReport } = await import("../services/funnel");
      let bySource: Record<string, number> | null = null;
      try {
        const { loadSignupSourceRows } = await import("../services/signupSourceQuery");
        const { buildSignupReport } = await import("../services/signupSources");
        bySource = buildSignupReport(await loadSignupSourceRows(), new Date()).bySource.allTime;
      } catch { bySource = null; }
      const days = Number(req.query.days) || 30;
      send(req, res, 200, await buildFunnelReport(days, undefined, bySource));
    })().catch((err) => {
      console.error("[qa/funnel] failed", err?.code || err?.message);
      if (!res.headersSent) send(req, res, 500, { error: "Failed to build funnel report" });
    });
  });

  app.get("/api/qa/rebate-liability", (req, res) => {
    if (!authorized(req)) return send(req, res, 401, { error: "Unauthorized" });
    void (async () => {
      const { buildRebateLiabilityReport } = await import("../services/rebateLiability");
      send(req, res, 200, await buildRebateLiabilityReport(Number(req.query.weeks) || 12));
    })().catch((err) => {
      console.error("[qa/rebate-liability] failed", err?.code || err?.message);
      if (!res.headersSent) send(req, res, 500, { error: "Failed to build rebate liability report" });
    });
  });
}
