/**
 * Token-gated inventory and Design export for the 21 baseball targets.
 * A missing or bad X-QA-Token is 404. Query tokens are ignored.
 * Responses carry counts and ids, not player names or source URLs.
 * Export writes only when PACKPTS_DESIGN_INBOX is set, and only after
 * { "write": true }. The default call does not start a job.
 */
import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, rmSync } from "fs";
import type { Express, Request, Response } from "express";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { maskReadySidecarDir, readMaskFailureReason } from "../masking/maskReadySidecar";
import { readNameVisibilityPassed } from "../masking/nameOutsideMask";
import { getMaskProfile } from "../masking/maskProfiles";
import { resolveReadyWarmMaskedFile } from "../startup/warmMaskGate";
import { designInboxDirectory, exportDesignSet, type ExportCardInput, type ExportProfile, type MaskFraction } from "../services/baseballExpansion/exportSet";
import { listExpansionInventory } from "../services/baseballExpansion/inventory";
import { expansionTargetById, isMissingExpansionId } from "../services/baseballExpansion/registry";
import { readSubmissionCount, recordHealthCheck, recordSubmissionIfAbsent } from "../services/baseballExpansion/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

type ExportJob = {
  id: string;
  setId: string;
  state: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  originalCount?: number;
  verdict?: string;
  ready?: boolean;
  slug?: string;
};

const jobs = new Map<string, ExportJob>();
const running = new Set<string>();

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

function fractions(profileId: string, regions: { xPct: number; yPct: number; wPct: number; hPct: number }[], side: ExportProfile["side"], explicit: boolean): ExportProfile {
  if (!explicit) return { explicit: false, profileId: null, side: null, regions: null };
  const mapped: MaskFraction[] = regions.map((region) => ({
    x: region.xPct / 100,
    y: region.yPct / 100,
    w: region.wPct / 100,
    h: region.hPct / 100,
  }));
  return { explicit: true, profileId, side, regions: mapped };
}

export function profileForExport(setName: string, setId: string): ExportProfile {
  if (isMissingExpansionId(setId)) {
    const profile = getMaskProfile(setName, setId);
    if (!profile.matched || profile.id === "default") {
      return { explicit: false, profileId: null, side: null, regions: null };
    }
  }
  const profile = getMaskProfile(setName, setId);
  const explicit = profile.matched && profile.id !== "default";
  const side = profile.nameAnchor === "top" ? "top" : profile.nameAnchor === "both" ? "both" : "bottom";
  return fractions(profile.id, profile.regions, side, explicit);
}

async function loadCards(setId: string): Promise<ExportCardInput[]> {
  const rows = await db.execute<{ id: string; player: string | null; number: string | null; image_url: string | null; blocked_reason: string | null; is_playable: boolean; variant: string | null }>(sql`
    SELECT id, player, number, image_url, blocked_reason, is_playable, variant
    FROM playable_cards WHERE game_set_id = ${setId}
    ORDER BY id`);
  const sidecar = maskReadySidecarDir();
  const cards: ExportCardInput[] = [];
  for (const row of rows.rows ?? []) {
    let sourceJpeg: Buffer | null = null;
    let width = 0;
    let height = 0;
    const sourceUrl = row.image_url && row.image_url.startsWith("https://") ? row.image_url : "";
    if (sourceUrl) {
      try {
        const upstream = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (upstream.ok) {
          const body = Buffer.from(await upstream.arrayBuffer());
          if (body.length > 0 && body.length <= MAX_SOURCE_BYTES) {
            const meta = await sharp(body).metadata();
            if (meta.width && meta.height) {
              sourceJpeg = body;
              width = meta.width;
              height = meta.height;
            }
          }
        }
      } catch { /* source stays missing; the card fails closed */ }
    }
    const maskedPath = resolveReadyWarmMaskedFile(sidecar, row.id);
    const maskedJpeg = maskedPath ? readFileSync(maskedPath) : null;
    cards.push({
      heldId: row.id,
      player: row.player || "",
      cardNo: row.number || "",
      sourceUrl,
      width,
      height,
      sourceJpeg,
      maskedJpeg,
      blockedReason: row.blocked_reason,
      isPlayable: row.is_playable,
      nameCheckPassed: readNameVisibilityPassed(row.id, sidecar),
      maskRefused: Boolean(readMaskFailureReason(row.id)),
      variant: row.variant,
      proposedCover: false,
    });
  }
  return cards;
}

export function registerBaseballExpansionQaRoutes(app: Express): void {
  app.get("/api/qa/baseball-expansion/inventory", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    void listExpansionInventory()
      .then((body) => send(res, 200, body))
      .catch(() => { if (!res.headersSent) send(res, 500, { error: "inventory failed" }); });
  });

  app.post("/api/qa/baseball-expansion/:setId/export", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    const target = expansionTargetById(req.params.setId);
    if (!target) return send(res, 404, { error: "Not found" });
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    if (body.write !== true) {
      return send(res, 200, {
        setId: target.id,
        slug: target.slug,
        jobStarted: false,
        write: false,
        note: "Send {\"write\":true} to export this set. PACKPTS_DESIGN_INBOX must already be set. Nothing was written.",
      });
    }
    const root = process.env.PACKPTS_DESIGN_INBOX?.trim();
    if (!root) return send(res, 409, { error: "PACKPTS_DESIGN_INBOX is not set", code: "inbox_unconfigured" });
    const coverIds = parseCoverIds(body.coverIds);
    if (!coverIds) return send(res, 400, { error: "coverIds must be up to 8 unique uuids" });
    if (running.has(target.id)) return send(res, 409, { error: "export already running for this set" });
    const job: ExportJob = { id: randomUUID(), setId: target.id, state: "running", startedAt: new Date().toISOString() };
    jobs.set(job.id, job);
    running.add(target.id);
    send(res, 202, { jobId: job.id, setId: target.id, slug: target.slug, statusPath: `/api/qa/baseball-expansion/${target.id}/export/${job.id}` });
    void (async () => {
      const cards = await loadCards(target.id);
      const coverSet = new Set(coverIds);
      for (const card of cards) card.proposedCover = coverSet.has(card.heldId);
      const directory = designInboxDirectory(root, target.slug);
      mkdirSync(directory, { recursive: true });
      const result = await exportDesignSet({
        target,
        profile: profileForExport(target.identity.setName, target.id),
        cards,
        directory,
      });
      const sha = String(result.reconciliation.manifestSha256 || "");
      await recordSubmissionIfAbsent({
        setId: target.id,
        slug: target.slug,
        originalCount: result.originalCount,
        manifestSha256: sha,
        cardIds: result.originalCardIds,
      });
      const storedCount = await readSubmissionCount(target.id);
      const aligned = storedCount == null || storedCount === result.originalCount;
      if (!aligned && result.ready) rmSync(pathReady(directory), { force: true });
      await recordHealthCheck({
        setId: target.id,
        originalCount: result.health.originalCount,
        passedCount: result.health.passedCount,
        releasedCount: aligned ? result.health.releasedCount : 0,
        verdict: aligned ? result.health.verdict : "incomplete",
      });
      job.originalCount = result.originalCount;
      job.verdict = aligned ? result.health.verdict : "incomplete";
      job.ready = aligned && result.ready;
      job.slug = result.slug;
      job.state = "completed";
    })().catch((error) => {
      job.state = "failed";
      job.error = error instanceof Error ? error.message.slice(0, 300) : "failed";
    }).finally(() => {
      job.finishedAt = new Date().toISOString();
      running.delete(target.id);
      console.log(`[DesignExport] set=${target.id} slug=${target.slug} state=${job.state} verdict=${job.verdict ?? ""} ready=${job.ready ?? false} original=${job.originalCount ?? 0}`);
    });
  });

  app.get("/api/qa/baseball-expansion/:setId/export/:jobId", (req, res) => {
    stripConditionalValidators(req);
    if (!tokenOk(req)) return send(res, 404, { error: "Not found" });
    const job = jobs.get(req.params.jobId);
    if (!job || job.setId !== req.params.setId) return send(res, 404, { error: "job not found" });
    send(res, 200, job);
  });
}

function parseCoverIds(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8) return null;
  if (!raw.every((id) => typeof id === "string" && UUID.test(id))) return null;
  return [...new Set(raw as string[])];
}

function pathReady(directory: string): string {
  return `${directory}/READY`;
}
