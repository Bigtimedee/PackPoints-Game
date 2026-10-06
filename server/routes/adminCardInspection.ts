import type { Express, Request, RequestHandler } from "express";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CardInspectionQuery { setId: string; limit: number; after: string | null }
export function parseCardInspectionQuery(setId: string, query: Request["query"]): CardInspectionQuery | null {
  if (!UUID.test(setId) || Object.keys(query).some((key) => !["limit", "after"].includes(key))) return null;
  const raw = query.limit;
  if (raw !== undefined && (typeof raw !== "string" || !/^[1-9][0-9]{0,2}$/.test(raw))) return null;
  const limit = raw === undefined ? 50 : Number(raw);
  if (limit > 100) return null;
  const after = query.after;
  if (after !== undefined && (typeof after !== "string" || !UUID.test(after))) return null;
  return { setId: setId.toLowerCase(), limit, after: typeof after === "string" ? after.toLowerCase() : null };
}
export interface CardInspectionDeps {
  read: (query: CardInspectionQuery) => Promise<unknown | null>;
  log: (error: unknown) => void;
}
const defaultDeps: CardInspectionDeps = {
  read: async (query) => (await import("../services/adminCardInspection")).readAdminCardInspection(query),
  log: (error) => console.error("[AdminCardInspection] Read failed", error),
};
/** Existing admin gates only. GET never bakes, validates images, starts jobs, or changes a card. */
export function registerAdminCardInspectionRoutes(app: Express, isAuthenticated: RequestHandler,
  requireAdmin: RequestHandler, deps: CardInspectionDeps = defaultDeps): void {
  const path = "/api/admin/game-sets/:id/card-inspection";
  app.get(path, (req, res, next) => {
    stripConditionalValidators(req); applyNoStoreHeaders(res);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff"); next();
  }, isAuthenticated, requireAdmin, async (req, res) => {
    const query = parseCardInspectionQuery(req.params.id, req.query);
    if (!query) { res.status(400).json({ error: "UUID set ID, optional UUID after cursor and limit 1-100 required. No other parameters are supported." }); return; }
    try {
      const result = await deps.read(query);
      if (!result) { res.status(404).json({ error: "Game set not found" }); return; }
      // End directly to avoid fresh Express ETags or conditional 304s for private card evidence.
      const body = JSON.stringify(result);
      res.status(200).setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(body)); res.end(body);
    } catch (error) {
      deps.log(error); res.status(503).json({ error: "Card inspection unavailable; no scan or card change was performed." });
    }
  });
}
