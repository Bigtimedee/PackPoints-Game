/**
 * Token-gated sweep of every dealable card. Same COVER_QA_TOKEN gate as cover review.
 * A query param is ignored. Unset, blank, or a bad header is 404.
 */
import { createReadStream } from "fs";
import type { Express, Request, Response } from "express";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { isMaskBakeTimeout } from "../masking/maskingService";
import { latestMaskBakeRefusalImage, listMaskBakeRefusals } from "../masking/maskRefusalLog";
import { renderRefusalAttemptPng, renderRefusalDebugPng } from "../masking/maskRefusalPng";
import {
  dealableMaskedFile,
  dealablePageLimit,
  dealablePageOffset,
  listActiveDealableSets,
  listDealableCards,
} from "../services/dealableQa";

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

function qaJson(req: Request, res: Response, status: number, payload: unknown): void {
  qaHeaders(req, res);
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function querySetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function qaImage(req: Request, res: Response, body: Buffer, contentType: string): void {
  qaHeaders(req, res);
  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", body.length);
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

function authorized(req: Request, res: Response): boolean {
  if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token"))) {
    qaNotFound(req, res);
    return false;
  }
  return true;
}

export function registerDealableQaRoutes(app: Express): void {
  app.get("/api/qa/sets", (req, res) => {
    if (!authorized(req, res)) return;
    void listActiveDealableSets()
      .then((sets) => {
        qaJson(req, res, 200, { maskVersion: CURRENT_MASK_VERSION, sets });
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/sets/:setId/dealable-cards", (req, res) => {
    if (!authorized(req, res)) return;
    const offset = dealablePageOffset(req.query.offset);
    const limit = dealablePageLimit(req.query.limit);
    void listDealableCards(req.params.setId, offset, limit)
      .then((page) => {
        if (!page) {
          qaNotFound(req, res);
          return;
        }
        qaJson(req, res, 200, page);
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/cover-image/:cardId", (req, res) => {
    if (!authorized(req, res)) return;
    void dealableMaskedFile(req.params.cardId)
      .then((file) => {
        if (!file) {
          qaNotFound(req, res);
          return;
        }
        qaHeaders(req, res);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("X-Card-Id", req.params.cardId);
        res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const stream = createReadStream(file);
        stream.on("error", () => {
          if (!res.headersSent) qaNotFound(req, res);
          else res.destroy();
        });
        stream.pipe(res);
      })
      .catch((error) => {
        if (res.headersSent) return;
        if (isMaskBakeTimeout(error)) {
          qaHeaders(req, res);
          res.setHeader("Retry-After", "5");
          const body = JSON.stringify({ error: "Masked image temporarily unavailable" });
          res.status(503);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Content-Length", Buffer.byteLength(body));
          res.end(body);
          return;
        }
        qaNotFound(req, res);
      });
  });

  app.get("/api/qa/rejected-cards", (req, res) => {
    if (!authorized(req, res)) return;
    const offset = dealablePageOffset(req.query.offset);
    const limit = dealablePageLimit(req.query.limit);
    void listMaskBakeRefusals(querySetId(req.query.setId), offset, limit)
      .then((page) => {
        qaJson(req, res, 200, {
          maskVersion: CURRENT_MASK_VERSION,
          total: page.total,
          offset,
          limit,
          refusals: page.refusals,
        });
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/rejected-cards/:cardId/debug.png", (req, res) => {
    if (!authorized(req, res)) return;
    void latestMaskBakeRefusalImage(req.params.cardId)
      .then(async (row) => {
        if (!row) {
          qaNotFound(req, res);
          return;
        }
        qaImage(req, res, await renderRefusalDebugPng(row), "image/png");
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/rejected-cards/:cardId/source", (req, res) => {
    if (!authorized(req, res)) return;
    void latestMaskBakeRefusalImage(req.params.cardId)
      .then((row) => {
        if (!row) {
          qaNotFound(req, res);
          return;
        }
        qaImage(req, res, row.sourceImage, row.contentType);
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/rejected-cards/:cardId/attempt.png", (req, res) => {
    if (!authorized(req, res)) return;
    void latestMaskBakeRefusalImage(req.params.cardId)
      .then(async (row) => {
        if (!row) {
          qaNotFound(req, res);
          return;
        }
        qaImage(req, res, await renderRefusalAttemptPng(row.sourceImage, row.paintRegions), "image/png");
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });
}
