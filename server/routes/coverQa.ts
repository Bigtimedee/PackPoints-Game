/**
 * Token-gated cover review for Design. Public /sets can hide covers at the same time.
 * The token is COVER_QA_TOKEN plus the X-QA-Token header. A query param is ignored.
 */
import { createReadStream } from "fs";
import type { Express, Request, Response } from "express";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { eligibleCoverFile, listCoverCandidates } from "../services/setCovers";

const DEFAULT_CANDIDATES = 12;
const MAX_CANDIDATES = 24;

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

function authorized(req: Request, res: Response): boolean {
  if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token"))) {
    qaNotFound(req, res);
    return false;
  }
  return true;
}

function candidateLimit(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_CANDIDATES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_CANDIDATES;
  return Math.min(MAX_CANDIDATES, n);
}

export function registerCoverQaRoutes(app: Express): void {
  app.get("/api/qa/sets/:setId/cover-candidates", (req, res) => {
    if (!authorized(req, res)) return;
    void listCoverCandidates(req.params.setId, candidateLimit(req.query.n))
      .then((report) => {
        qaJson(req, res, {
          setId: req.params.setId,
          maskVersion: CURRENT_MASK_VERSION,
          pinnedCount: report.pinnedCount,
          validCount: report.validCount,
          coversDisabled: report.coversDisabled,
          pins: report.pins,
          picker: report.picker,
          candidates: report.candidates,
        });
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });

  app.get("/api/qa/cover-image/:cardId", (req, res) => {
    if (!authorized(req, res)) return;
    void eligibleCoverFile(req.params.cardId)
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
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
      });
  });
}
