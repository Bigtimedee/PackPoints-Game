/**
 * Staff-only held-prep reads. X-QA-Token required. A missing header is 404.
 * This process does not write a Design inbox and does not accept a filesystem path.
 * Inventory has no player names and no source URLs. Nothing here clears a set.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { listExpansionInventory } from "../services/baseballExpansion/inventory";
import { expansionTargetById } from "../services/baseballExpansion/registry";
import { readOriginalMembership, recordOriginalMembership } from "../services/baseballExpansion/store";
import { getMaskProfile } from "../masking/maskProfiles";
import { isMissingExpansionId } from "../services/baseballExpansion/registry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res: Response, status: number, payload: unknown): void {
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function tokenOk(req: Request): boolean {
  return coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));
}

export function registerBaseballExpansionQaRoutes(app: Express): void {
  app.get("/api/qa/baseball-expansion/inventory", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    void listExpansionInventory()
      .then((body) => send(res, 200, body))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "inventory failed" }); });
  });

  app.get("/api/qa/baseball-expansion/:setId/profile", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    const target = expansionTargetById(req.params.setId);
    if (!target || !isMissingExpansionId(target.id)) return send(res, 404, { error: "Not found" });
    const profile = getMaskProfile(target.identity.setName, target.id);
    const explicit = profile.matched && profile.id !== "default";
    send(res, 200, {
      setId: target.id,
      slug: target.slug,
      explicit,
      profileId: explicit ? profile.id : null,
      side: explicit ? (profile.nameAnchor === "top" ? "top" : profile.nameAnchor === "both" ? "both" : "bottom") : null,
      regions: explicit ? profile.regions.map((region) => ({
        x: region.xPct / 100, y: region.yPct / 100, w: region.wPct / 100, h: region.hPct / 100,
      })) : null,
      releaseApproval: false,
      baseCount: target.baseCount,
      baseCountProvenance: target.baseCountProvenance,
    });
  });

  app.post("/api/qa/baseball-expansion/:setId/export", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    if (!expansionTargetById(req.params.setId)) return send(res, 404, { error: "Not found" });
    send(res, 400, {
      code: "box_exporter_required",
      error: "The server does not write the Design inbox. Run scripts/export-design-inbox.ts on the box with X-QA-Token reads.",
    });
  });

  app.get("/api/qa/baseball-expansion/:setId/original-pool", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    const target = expansionTargetById(req.params.setId);
    if (!target || !isMissingExpansionId(target.id)) return send(res, 404, { error: "Not found" });
    void readOriginalMembership(target.id).then((row) => {
      if (!row) return send(res, 404, { error: "Not found" });
      if ("unreadable" in row) return send(res, 409, { code: "membership_unreadable", error: "Stored ids do not match the stored hash" });
      send(res, 200, {
        setId: target.id,
        cardIds: row.ids,
        manifestSha256: row.hash,
        originalCount: row.count,
        sourceWitness: row.sourceWitness,
        maskVersion: row.maskVersion,
        submittedAt: row.submittedAt,
        releaseApproval: false,
      });
    }).catch(() => { if (!res.headersSent) send(res, 500, { error: "membership failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/original-pool", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    const target = expansionTargetById(req.params.setId);
    if (!target || !isMissingExpansionId(target.id)) return send(res, 404, { error: "Not found" });
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    const cards = body.cards;
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 2000) {
      return send(res, 400, { error: "cards: 1-2000 of {id, sourceUrl}" });
    }
    const parsed: { id: string; sourceUrl: string }[] = [];
    for (const card of cards) {
      if (!card || typeof card !== "object") return send(res, 400, { error: "cards: 1-2000 of {id, sourceUrl}" });
      const id = (card as { id?: unknown }).id;
      const sourceUrl = (card as { sourceUrl?: unknown }).sourceUrl;
      if (typeof id !== "string" || !UUID.test(id) || typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://") || sourceUrl.length > 500) {
        return send(res, 400, { error: "cards: 1-2000 of {id, sourceUrl}" });
      }
      parsed.push({ id, sourceUrl });
    }
    void recordOriginalMembership({
      setId: target.id,
      slug: target.slug,
      cardIds: parsed.map((card) => card.id),
      sources: parsed,
    }).then((result) => {
      if (!result.stored) return send(res, 409, { code: result.code, error: "Original id membership does not match the stored manifest" });
      send(res, 200, { setId: target.id, unchanged: result.unchanged, releaseApproval: false });
    }).catch(() => { if (!res.headersSent) send(res, 500, { error: "membership failed" }); });
  });
}
