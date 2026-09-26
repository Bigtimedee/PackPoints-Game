/**
 * Token-gated list of cards admitted through the TOP_PLATE placement-contract
 * fallback. Same gate as the cover QA routes: COVER_QA_TOKEN and X-QA-Token.
 * A query param is ignored. A missing or wrong token is 404.
 */
import type { Express, Request, Response } from "express";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { listFallbackPendingCards } from "../masking/maskFallbackReview";

function qaHeaders(req: Request, res: Response): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
}

function qaNotFound(req: Request, res: Response): void {
  qaHeaders(req, res);
  const body = JSON.stringify({ error: "Not found" });
  res.status(404);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function qaJson(req: Request, res: Response, payload: unknown): void {
  qaHeaders(req, res);
  const body = JSON.stringify(payload);
  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

export function registerMaskFallbackQaRoutes(app: Express): void {
  app.get("/api/qa/mask-fallbacks", (req, res) => {
    if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token"))) {
      qaNotFound(req, res);
      return;
    }
    void listFallbackPendingCards()
      .then((listing) => {
        qaJson(req, res, {
          maskVersion: CURRENT_MASK_VERSION,
          state: "fallback_pending_review",
          cards: listing.cards,
          countsBySet: listing.countsBySet,
        });
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });
}
