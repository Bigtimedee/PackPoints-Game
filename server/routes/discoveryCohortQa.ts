/**
 * Staff-only discovery cohort. X-QA-Token required. No image URL is accepted
 * or returned. Staging hashes bytes the caller sends. It does not fetch them.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { isMissingExpansionId } from "../services/baseballExpansion/registry";
import {
  appendSourceRevision,
  createDiscoveryCohort,
  parseCohortMembers,
  readDiscoveryCohort,
  recordDiscoveryAddition,
  registerGeometryProposal,
  stageExactSource,
} from "../services/baseballExpansion/discoveryCohort";
import { expansionTargetById } from "../services/baseballExpansion/registry";

function send(res: Response, status: number, payload: unknown): void {
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function gate(req: Request, res: Response): boolean {
  stripConditionalValidators(req);
  if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token")) || !isMissingExpansionId(req.params.setId)) {
    send(res, 404, { error: "Not found" });
    return false;
  }
  return true;
}

function noUrl(body: Record<string, unknown>): boolean {
  return !("imageUrl" in body) && !("sourceUrl" in body) && !("url" in body);
}

export function registerDiscoveryCohortRoutes(app: Express): void {
  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    const target = expansionTargetById(req.params.setId);
    const members = parseCohortMembers(body.members, target?.baseCount ?? 0);
    const artifact = typeof body.artifactSha256 === "string" ? body.artifactSha256.trim() : "";
    if (!members) return send(res, 400, { error: "members are not a cohort" });
    void createDiscoveryCohort({ setId: req.params.setId, artifactSha256: artifact, members })
      .then((result) => {
        if (!result.ok) return send(res, 409, { code: result.code, releaseAuthorized: false });
        send(res, 200, { ...result, releaseAuthorized: false, sourceValidated: false });
      })
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "cohort failed" }); });
  });

  app.get("/api/qa/baseball-expansion/:setId/discovery-cohort", (req, res) => {
    if (!gate(req, res)) return;
    void readDiscoveryCohort(req.params.setId)
      .then((row) => send(res, row ? 200 : 404, row ?? { error: "Not found" }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "cohort failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/revisions", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.memberKey !== "string" || typeof body.sha256 !== "string" || typeof body.parentSha256 !== "string") {
      return send(res, 400, { error: "revision needs memberKey, sha256, parentSha256, width, height, bytes" });
    }
    if (typeof body.width !== "number" || typeof body.height !== "number" || typeof body.bytes !== "number") {
      return send(res, 400, { error: "revision needs memberKey, sha256, parentSha256, width, height, bytes" });
    }
    void appendSourceRevision({
      setId: req.params.setId,
      memberKey: body.memberKey,
      sha256: body.sha256,
      parentSha256: body.parentSha256,
      width: body.width,
      height: body.height,
      bytes: body.bytes,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "revision failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/additions", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.supplierId !== "string" || typeof body.cardNumber !== "string" || typeof body.sha256 !== "string") {
      return send(res, 400, { error: "addition needs supplierId, cardNumber, sha256, width, height, bytes" });
    }
    if (typeof body.width !== "number" || typeof body.height !== "number" || typeof body.bytes !== "number") {
      return send(res, 400, { error: "addition needs supplierId, cardNumber, sha256, width, height, bytes" });
    }
    void recordDiscoveryAddition({
      setId: req.params.setId,
      supplierId: body.supplierId,
      cardNumber: body.cardNumber,
      sha256: body.sha256,
      width: body.width,
      height: body.height,
      bytes: body.bytes,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "addition failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/stage", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body) || typeof body.supplierId !== "string" || typeof body.imageBase64 !== "string") {
      return send(res, 400, { error: "stage needs supplierId and imageBase64, not a URL" });
    }
    const bytes = Buffer.from(body.imageBase64, "base64");
    if (bytes.length < 1 || bytes.length > 2_000_000) return send(res, 400, { error: "stage needs supplierId and imageBase64, not a URL" });
    void stageExactSource(req.params.setId, body.supplierId, bytes)
      .then((result) => send(res, result.ok ? 200 : 409, { ...result, sourceValidated: false, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "stage failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/geometry-proposals", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.memberKey !== "string" || typeof body.supplierId !== "string" || typeof body.sourceSha256 !== "string") {
      return send(res, 400, { error: "proposal needs member, supplier, hash, and dimensions" });
    }
    if (typeof body.width !== "number" || typeof body.height !== "number") {
      return send(res, 400, { error: "proposal needs member, supplier, hash, and dimensions" });
    }
    const version = body.geometryVersion == null ? null : body.geometryVersion;
    if (version !== null && typeof version !== "string") return send(res, 400, { error: "proposal needs member, supplier, hash, and dimensions" });
    const pixels = body.polygonPixels == null ? null : body.polygonPixels;
    const normalized = body.polygonNormalized == null ? null : body.polygonNormalized;
    if ((pixels !== null && !Array.isArray(pixels)) || (normalized !== null && !Array.isArray(normalized))) {
      return send(res, 400, { error: "proposal needs member, supplier, hash, and dimensions" });
    }
    void registerGeometryProposal({
      setId: req.params.setId,
      memberKey: body.memberKey,
      supplierId: body.supplierId,
      sourceSha256: body.sourceSha256,
      width: body.width,
      height: body.height,
      geometryVersion: version,
      polygonPixels: pixels as number[][] | null,
      polygonNormalized: normalized as number[][] | null,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false, profileApproved: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "proposal failed" }); });
  });
}
