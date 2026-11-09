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
  importBoundStagedSource,
  listGeometryProposals,
} from "../services/baseballExpansion/discoveryCohort";
import {
  recordExpansionRelease,
  recordOutputApproval,
  recordServeClearance,
  recordSourceAcceptance,
  readStoredOpaquePreview,
  replaceExpansionRelease,
  revokeExpansionRelease,
} from "../services/baseballExpansion/perCardRelease";
import { expansionTargetById } from "../services/baseballExpansion/registry";
import {
  COHORT_DOCUMENT_BOUNDS,
  STAGE_IMAGE_MAX_BYTES,
  jsonDocumentWithinBounds,
  stageBase64CharCap,
} from "../middleware/apiJsonBody";

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
    if (!jsonDocumentWithinBounds(body, COHORT_DOCUMENT_BOUNDS)) {
      return send(res, 400, { error: "members are not a cohort" });
    }
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
    const shaOk = typeof body.sha256 === "string" && /^[a-f0-9]{64}$/.test(body.sha256);
    const parentOk = typeof body.parentSha256 === "string" && /^[a-f0-9]{64}$/.test(body.parentSha256);
    const sizeOk = typeof body.width === "number" && typeof body.height === "number" && typeof body.bytes === "number"
      && body.width >= 1 && body.height >= 1 && body.bytes >= 1 && body.width <= 10000 && body.height <= 10000 && body.bytes <= 20_000_000;
    if (typeof body.memberKey !== "string" || !shaOk || !parentOk || !sizeOk) {
      return send(res, 400, { error: "revision needs a member, two sha256 values, and positive dimensions" });
    }
    void appendSourceRevision({
      setId: req.params.setId,
      memberKey: body.memberKey,
      sha256: body.sha256 as string,
      parentSha256: body.parentSha256 as string,
      width: body.width as number,
      height: body.height as number,
      bytes: body.bytes as number,
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
    const maxEncoded = stageBase64CharCap();
    if (!noUrl(body) || typeof body.supplierId !== "string" || typeof body.imageBase64 !== "string" || body.imageBase64.length > maxEncoded) {
      return send(res, 400, { error: "stage needs supplierId and imageBase64, not a URL" });
    }
    const bytes = Buffer.from(body.imageBase64, "base64");
    if (bytes.length < 1 || bytes.length > STAGE_IMAGE_MAX_BYTES) return send(res, 400, { error: "stage needs supplierId and imageBase64, not a URL" });
    void stageExactSource(req.params.setId, body.supplierId, bytes)
      .then((result) => send(res, result.ok ? 200 : 409, { ...result, sourceValidated: false, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "stage failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/import-staged", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if ("sourceUrl" in body || "url" in body || "imageBase64" in body || "imageBytes" in body) {
      return send(res, 400, { error: "import uses the staged bytes, not a new image" });
    }
    if (typeof body.supplierId !== "string" || typeof body.imageUrl !== "string" || typeof body.player !== "string") {
      return send(res, 400, { error: "import needs supplierId, imageUrl, and player" });
    }
    const variant = body.variant == null ? null : body.variant;
    const category = body.category == null ? null : body.category;
    if ((variant !== null && typeof variant !== "string") || (category !== null && typeof category !== "string")) {
      return send(res, 400, { error: "import needs supplierId, imageUrl, and player" });
    }
    void importBoundStagedSource({
      setId: req.params.setId,
      supplierId: body.supplierId,
      imageUrl: body.imageUrl,
      player: body.player,
      variant,
      category,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, fetched: false, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "import failed" }); });
  });

  app.get("/api/qa/baseball-expansion/:setId/geometry-proposals", (req, res) => {
    if (!gate(req, res)) return;
    const memberKey = req.query.memberKey;
    if (memberKey !== undefined && typeof memberKey !== "string") {
      return send(res, 400, { error: "memberKey must be a string" });
    }
    void listGeometryProposals(req.params.setId, memberKey)
      .then((result) => send(res, result.ok ? 200 : 409, result))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "proposal failed" }); });
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

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/source-acceptance", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.memberKey !== "string" || typeof body.sourceSha256 !== "string" || typeof body.evidenceRef !== "string" || typeof body.acceptedBy !== "string") {
      return send(res, 400, { error: "acceptance needs member, hash, and evidence" });
    }
    void recordSourceAcceptance({
      setId: req.params.setId,
      memberKey: body.memberKey,
      sourceSha256: body.sourceSha256,
      evidenceRef: body.evidenceRef,
      acceptedBy: body.acceptedBy,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "acceptance failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/output-approval", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    const native = typeof body.nativeBase64 === "string" ? Buffer.from(body.nativeBase64, "base64") : null;
    const preview = typeof body.preview300Base64 === "string" ? Buffer.from(body.preview300Base64, "base64") : null;
    if (!native || !preview || native.length < 1 || preview.length < 1) return send(res, 400, { error: "approval needs both opaque images" });
    if (typeof body.memberKey !== "string" || typeof body.acceptanceId !== "string" || typeof body.proposalId !== "string" || typeof body.rendererId !== "string" || typeof body.nativeSha256 !== "string" || typeof body.preview300Sha256 !== "string" || typeof body.evidenceRef !== "string" || typeof body.approvedBy !== "string" || !Array.isArray(body.polygonPixels) || !Array.isArray(body.polygonNormalized)) {
      return send(res, 400, { error: "approval needs member, proposal, renderer, and hashes" });
    }
    void recordOutputApproval({
      setId: req.params.setId,
      memberKey: body.memberKey,
      acceptanceId: body.acceptanceId,
      proposalId: body.proposalId,
      polygonPixels: body.polygonPixels as number[][],
      polygonNormalized: body.polygonNormalized as number[][],
      rendererId: body.rendererId,
      nativeBytes: native,
      preview300Bytes: preview,
      nativeSha256: body.nativeSha256,
      preview300Sha256: body.preview300Sha256,
      evidenceRef: body.evidenceRef,
      approvedBy: body.approvedBy,
    }).then((result) => send(res, result.ok ? 200 : 409, { ok: result.ok, id: result.ok ? result.id : undefined, unchanged: result.ok ? result.unchanged : undefined, code: result.ok ? undefined : result.code, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "approval failed" }); });
  });

  app.get("/api/qa/baseball-expansion/:setId/discovery-cohort/output-preview/:memberKey/:variant", (req, res) => {
    if (!gate(req, res)) return;
    const variant = req.params.variant;
    if (variant !== "native" && variant !== "preview300") {
      return send(res, 400, { error: "preview variant is native or preview300" });
    }
    void readStoredOpaquePreview({ setId: req.params.setId, memberKey: req.params.memberKey, variant })
      .then((result) => {
        if (!result.ok) return send(res, result.code === "output_unapproved" ? 404 : 409, { ...result, releaseAuthorized: false });
        applyNoStoreHeaders(res);
        res.setHeader("X-Robots-Tag", "noindex");
        res.setHeader("X-Content-Sha256", result.sha256);
        res.setHeader("X-Release-Authorized", "false");
        res.setHeader("X-Serve-Cleared", "false");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.status(200);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Content-Length", result.bytes.length);
        res.end(result.bytes);
      })
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "preview failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/serve-clearance", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.memberKey !== "string" || typeof body.outputApprovalId !== "string" || typeof body.evidenceRef !== "string" || typeof body.clearedBy !== "string") {
      return send(res, 400, { error: "serve clearance needs member, output, and evidence" });
    }
    void recordServeClearance({
      setId: req.params.setId,
      memberKey: body.memberKey,
      outputApprovalId: body.outputApprovalId,
      evidenceRef: body.evidenceRef,
      clearedBy: body.clearedBy,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "serve clearance failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/set-clearance", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.evidenceRef !== "string" || typeof body.clearedBy !== "string" || typeof body.discoveryMembershipSha256 !== "string" || typeof body.version !== "number" || !Array.isArray(body.memberKeys)) {
      return send(res, 400, { error: "set clearance needs an explicit manifest" });
    }
    void recordExpansionRelease({
      setId: req.params.setId,
      memberKeys: body.memberKeys.filter((key): key is string => typeof key === "string"),
      version: body.version,
      evidenceRef: body.evidenceRef,
      clearedBy: body.clearedBy,
      discoveryMembershipSha256: body.discoveryMembershipSha256,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: result.ok }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "set clearance failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/set-clearance/replace", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.evidenceRef !== "string" || typeof body.clearedBy !== "string" || typeof body.discoveryMembershipSha256 !== "string" || typeof body.expectedManifestId !== "string" || typeof body.version !== "number" || !Array.isArray(body.memberKeys)) {
      return send(res, 400, { error: "replacement needs the current manifest and the full next list" });
    }
    void replaceExpansionRelease({
      setId: req.params.setId,
      expectedManifestId: body.expectedManifestId,
      memberKeys: body.memberKeys.filter((key): key is string => typeof key === "string"),
      version: body.version,
      evidenceRef: body.evidenceRef,
      clearedBy: body.clearedBy,
      discoveryMembershipSha256: body.discoveryMembershipSha256,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: result.ok }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "set clearance failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/discovery-cohort/set-clearance/revoke", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (!noUrl(body)) return send(res, 400, { error: "source URLs are not accepted" });
    if (typeof body.evidenceRef !== "string" || typeof body.revokedBy !== "string" || typeof body.version !== "number") {
      return send(res, 400, { error: "revocation needs version and evidence" });
    }
    void revokeExpansionRelease({
      setId: req.params.setId,
      version: body.version,
      evidenceRef: body.evidenceRef,
      revokedBy: body.revokedBy,
    }).then((result) => send(res, result.ok ? 200 : 409, { ...result, releaseAuthorized: false }))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "revocation failed" }); });
  });
}
