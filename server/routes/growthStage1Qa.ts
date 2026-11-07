/**
 * GET /api/qa/growth/stage1 — aggregate stage 1 source and cohort counts.
 * COVER_QA_TOKEN via X-QA-Token, or an authenticated admin session.
 * Counts only. No user id, email, name, or raw UTM string is returned.
 * A query token is ignored. Do not reference this path from client code.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { resolveAdminActorId } from "../auth/adminActor";
import { loadGrowthStage1Report } from "../services/growthStage1";
import type { GrowthStage1Report } from "@shared/growthStage1";

export type GrowthStage1Loader = () => Promise<GrowthStage1Report>;

let loader: GrowthStage1Loader = () => loadGrowthStage1Report();
let adminLookup: (userId: string) => Promise<boolean> = async (userId) => {
  const { storage } = await import("../storage");
  const user = await storage.getUser(userId);
  return user?.isAdmin === true;
};

export function setGrowthStage1LoaderForTests(next: GrowthStage1Loader | null): void {
  loader = next ?? (() => loadGrowthStage1Report());
}

export function setGrowthStage1AdminLookupForTests(next: ((userId: string) => Promise<boolean>) | null): void {
  adminLookup = next ?? (async (userId) => {
    const { storage } = await import("../storage");
    const user = await storage.getUser(userId);
    return user?.isAdmin === true;
  });
}

function qaJson(req: Request, res: Response, status: number, payload: unknown): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", "no-store");
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

async function authorized(req: Request): Promise<boolean> {
  if (coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"))) return true;
  const userId = resolveAdminActorId(req);
  if (!userId) return false;
  try {
    return await adminLookup(userId);
  } catch {
    return false;
  }
}

export function registerGrowthStage1Routes(app: Express): void {
  app.get("/api/qa/growth/stage1", (req, res) => {
    void authorized(req)
      .then((ok) => {
        if (!ok) {
          qaJson(req, res, 401, { error: "Unauthorized" });
          return;
        }
        return loader().then((report) => {
          if (!res.headersSent) qaJson(req, res, 200, report);
        });
      })
      .catch((err: unknown) => {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
        console.error("[qa/growth/stage1] failed", code);
        if (!res.headersSent) qaJson(req, res, 500, { error: "Failed to load growth report" });
      });
  });
}
