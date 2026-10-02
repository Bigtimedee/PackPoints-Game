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
import { backfillLimit, backfillMaskBakeRefusals } from "../masking/maskRefusalBackfill";
import { latestMaskBakeRefusalImage, listMaskBakeRefusals } from "../masking/maskRefusalLog";
import { renderRefusalAttemptPng, renderRefusalDebugPng } from "../masking/maskRefusalPng";
import {
  dealableMaskedFile,
  dealablePageLimit,
  dealablePageOffset,
  listActiveDealableSets,
  listDealableCards,
} from "../services/dealableQa";
import { eligibleCoverFile } from "../services/setCovers";
import { addPackptsDays, getPackptsDayKey, isPackptsDayKey, PACKPTS_DAY_TZ } from "@shared/packptsDay";
import {
  DAILY5_CALENDAR_START,
  daily5CalendarConfig,
  daily5Weekday,
  scheduledDaily5Set,
  WEEKDAYS,
} from "../services/daily5Calendar";
import { daily5Service } from "../services/daily5Service";

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

const MAX_PREVIEW_DAYS = 31;

export function registerDealableQaRoutes(app: Express): void {
  /**
   * Daily 5 calendar and deal preview. ?date=YYYY-MM-DD (default today CT)
   * and ?days=1..31. Read-only: a day with no stored row is computed, not
   * created. Card ids only, no player names.
   */
  app.get("/api/qa/daily5/preview", (req, res) => {
    if (!authorized(req, res)) return;
    const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : "";
    const start = rawDate || getPackptsDayKey();
    const days = Math.min(MAX_PREVIEW_DAYS, Math.max(1, Number.parseInt(String(req.query.days ?? "1"), 10) || 1));
    if (!isPackptsDayKey(start)) {
      qaJson(req, res, 400, { error: "date must be YYYY-MM-DD" });
      return;
    }
    void (async () => {
      const config = daily5CalendarConfig();
      const out = [];
      for (let i = 0; i < days; i++) {
        const date = addPackptsDays(start, i);
        const scheduled = scheduledDaily5Set(date, config);
        const preview = await daily5Service.previewDeal(date);
        out.push({
          date,
          weekday: WEEKDAYS[daily5Weekday(date)],
          scheduledSetId: scheduled?.setId ?? null,
          slot: scheduled?.slot ?? null,
          stored: preview.stored,
          setId: preview.setId,
          setName: preview.setName,
          source: preview.choice?.source ?? (preview.stored ? "stored" : null),
          skipped: preview.choice?.skipped ?? [],
          dealableCount: preview.dealableCount,
          cardIds: preview.cardIds,
        });
      }
      qaJson(req, res, 200, {
        today: getPackptsDayKey(),
        timezone: PACKPTS_DAY_TZ,
        calendarStart: DAILY5_CALENDAR_START,
        greenSetIds: config.greenSetIds,
        fallbackSetId: config.fallbackSetId,
        days: out,
      });
    })().catch(() => {
      if (!res.headersSent) qaNotFound(req, res);
    });
  });

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
    // A card that already passes the pinned-cover filters is the baked file.
    // That path does not bake. A dealable card with no sidecar still bakes.
    void eligibleCoverFile(req.params.cardId)
      .then((coverFile) => coverFile ?? dealableMaskedFile(req.params.cardId))
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

  app.post("/api/qa/rejected-cards/backfill", (req, res) => {
    if (!authorized(req, res)) return;
    void backfillMaskBakeRefusals(querySetId(req.query.setId), backfillLimit(req.query.limit))
      .then((counts) => {
        qaJson(req, res, 200, counts);
      })
      .catch(() => {
        if (!res.headersSent) qaNotFound(req, res);
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
