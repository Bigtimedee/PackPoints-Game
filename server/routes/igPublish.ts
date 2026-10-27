/**
 * Public Instagram surfaces and QA controls.
 * QA uses COVER_QA_TOKEN via X-QA-Token, same as the other /api/qa routes.
 * GET /social/ig/:file sends the stored file bytes. No image pipeline.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import {
  IgInputError,
  enqueueIgPost,
  igBioRedirectUrl,
  igBioTarget,
  inspectMedia,
  listQueue,
  publishIg,
  updateQueuedRow,
  type IgQueueRow,
} from "../services/igPublish";
import { dryRunFb } from "../services/fbPublish";

function qaJson(req: Request, res: Response, status: number, payload: unknown): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function authorized(req: Request): boolean {
  return coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));
}

export function igQueueJson(row: IgQueueRow) {
  return {
    id: row.id,
    kind: row.kind,
    mediaPath: row.mediaPath,
    caption: row.caption,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status,
    containerId: row.containerId,
    igMediaId: row.igMediaId,
    error: row.error,
    approvalHash: row.approvalHash,
    utmContent: row.utmContent,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    platform: row.platform,
    variant: row.variant,
    testId: row.testId,
    trial: row.trial,
    insights: row.insights,
    abTestId: row.abTestId,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function queryOverride(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function registerIgRoutes(app: Express): void {
  app.get("/ig", (req, res) => {
    stripConditionalValidators(req);
    applyNoStoreHeaders(res);
    void igBioTarget(queryOverride(req.query.c))
      .then((location) => {
        if (!res.headersSent) res.redirect(302, location);
      })
      .catch((err: unknown) => {
        if (res.headersSent) return;
        if (err instanceof IgInputError) qaJson(req, res, 400, { error: err.code });
        else res.redirect(302, igBioRedirectUrl("bio"));
      });
  });

  app.get("/social/ig/:file", (req, res) => {
    stripConditionalValidators(req);
    void inspectMedia(req.params.file)
      .then((media) => {
        if (res.headersSent) return;
        if (!media.ok) {
          qaJson(req, res, 404, { error: "Not found" });
          return;
        }
        res.status(200);
        res.setHeader("Content-Type", media.contentType);
        res.setHeader("Content-Length", String(media.bytes.length));
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Robots-Tag", "noindex");
        res.removeHeader("ETag");
        res.removeHeader("Content-Encoding");
        res.end(media.bytes);
      })
      .catch(() => {
        if (!res.headersSent) qaJson(req, res, 404, { error: "Not found" });
      });
  });

  app.get("/api/qa/ig/queue", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    void listQueue()
      .then((items) => qaJson(req, res, 200, { items: items.map(igQueueJson) }))
      .catch(() => qaJson(req, res, 500, { error: "queue_failed" }));
  });

  app.post("/api/qa/ig/queue", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const body = req.body ?? {};
    void enqueueIgPost({
      kind: body.kind,
      mediaPath: body.mediaPath,
      caption: body.caption,
      scheduledFor: body.scheduledFor,
      approvalHash: body.approvalHash,
      utmContent: body.utmContent,
      platform: body.platform === "fb" ? "fb" : "ig",
      variant: body.variant === "A" || body.variant === "B" ? body.variant : null,
      testId: typeof body.testId === "string" ? body.testId : null,
      trial: body.trial === true,
    })
      .then((row) => qaJson(req, res, 201, { item: igQueueJson(row) }))
      .catch((err: unknown) => {
        if (err instanceof IgInputError) qaJson(req, res, 400, { error: err.code });
        else qaJson(req, res, 500, { error: "enqueue_failed" });
      });
  });

  app.patch("/api/qa/ig/queue/:id", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      qaJson(req, res, 400, { error: "bad_id" });
      return;
    }
    const body = req.body ?? {};
    void updateQueuedRow(id, {
      caption: Object.prototype.hasOwnProperty.call(body, "caption") ? body.caption : undefined,
      mediaPath: Object.prototype.hasOwnProperty.call(body, "mediaPath") ? body.mediaPath : undefined,
    })
      .then((row) => qaJson(req, res, 200, { item: igQueueJson(row) }))
      .catch((err: unknown) => {
        if (err instanceof IgInputError && err.code === "not_found") qaJson(req, res, 404, { error: err.code });
        else if (err instanceof IgInputError && err.code === "not_queued") qaJson(req, res, 409, { error: err.code });
        else if (err instanceof IgInputError) qaJson(req, res, 400, { error: err.code });
        else qaJson(req, res, 500, { error: "caption_failed" });
      });
  });

  app.post("/api/qa/ig/dry-run", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      qaJson(req, res, 400, { error: "bad_id" });
      return;
    }
    void publishIg(id, { dryRun: true })
      .then((result) => qaJson(req, res, result.status === "not_found" ? 404 : 200, result))
      .catch(() => qaJson(req, res, 500, { error: "dry_run_failed" }));
  });

  app.post("/api/qa/fb/dry-run", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      qaJson(req, res, 400, { error: "bad_id" });
      return;
    }
    void dryRunFb(id)
      .then((result) => qaJson(req, res, result.status === "not_found" ? 404 : 200, result))
      .catch(() => qaJson(req, res, 500, { error: "dry_run_failed" }));
  });

  app.post("/api/qa/ig/publish", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      qaJson(req, res, 400, { error: "bad_id" });
      return;
    }
    void publishIg(id, { allowFailed: true, recheckSkipped: true })
      .then((result) => qaJson(req, res, result.status === "not_found" ? 404 : 200, result))
      .catch(() => qaJson(req, res, 500, { error: "publish_failed" }));
  });
}
