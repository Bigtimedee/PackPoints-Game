import type { Express } from "express";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cardReviewApprovals, playableCards } from "@shared/schema";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { db } from "../db";
import { isAuthenticated } from "../auth";
import { requireAdmin } from "../auth/requireAdmin";
import { DONRUSS_1987_HOLD_ID } from "../config/heldSets";
import { getMaskedImagePath } from "../masking/maskingService";
import { readMaskFailureReason } from "../masking/maskReadySidecar";
import { eligibleDealFilter } from "../services/playableSetEligibility";
import { explicitPreparationIds, preparedMaskFile, prepareExplicitCards, type PreparedCardResult } from "../services/heldMaskPreparation";

type Job = { id: string; setId: string; state: "running" | "completed"; cardIds: string[]; results: PreparedCardResult[]; startedAt: string; finishedAt?: string };
const jobs = new Map<string, Job>();
const active = new Map<string, string>();
const MAX_JOBS = 100;
const candidates = (ids?: string[]) => and(
  eq(playableCards.gameSetId, DONRUSS_1987_HOLD_ID),
  ids ? inArray(playableCards.id, ids) : undefined,
  eq(playableCards.isPlayable, true),
  eq(playableCards.quarantineStatus, "OK"),
  eq(playableCards.proposedUnplayable, false),
  eq(playableCards.contentVerified, true),
  sql`COALESCE(${playableCards.imageReviewStatus}, '') NOT IN ('excluded','rejected','flagged')`,
);

export function registerHeldMaskPreparationRoutes(app: Express): void {
  const base = "/api/admin/held-sets/:setId";
  app.use(base, isAuthenticated, requireAdmin, (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.params.setId !== DONRUSS_1987_HOLD_ID) { res.status(404).json({ error: "Preparation not enabled for this set" }); return; }
    next();
  });
  app.post(`${base}/prepare`, async (req, res) => {
    const ids = explicitPreparationIds(req.body);
    if (!ids) { res.status(400).json({ error: "reviewed=true and 1-20 unique explicit UUID cardIds required; all is not supported" }); return; }
    if (active.has(req.params.setId)) { res.status(409).json({ error: "Preparation already running", jobId: active.get(req.params.setId) }); return; }
    // Reserve before awaiting DB, so two requests cannot both start.
    const id = randomUUID(); active.set(req.params.setId, id);
    try {
      const rows = await db.select({ id: playableCards.id }).from(playableCards).where(candidates(ids));
      const found = new Set(rows.map((r) => r.id));
      if (found.size !== ids.length) {
        active.delete(req.params.setId);
        res.status(422).json({ error: "No bake started: excluded, quarantined, unverified or wrong-set IDs", refused: ids.filter((x) => !found.has(x)) }); return;
      }
      if (jobs.size >= MAX_JOBS) {
        const old = [...jobs.values()].find((j) => j.state === "completed");
        if (old) jobs.delete(old.id);
      }
      const job: Job = { id, setId: req.params.setId, state: "running", cardIds: ids, results: [], startedAt: new Date().toISOString() };
      jobs.set(id, job);
      res.status(202).json({ ...job, maskVersion: CURRENT_MASK_VERSION, statusPath: `/api/admin/held-sets/${job.setId}/prepare/${id}`, note: "Set remains held. Job is in-memory; after restart re-read readiness before resubmitting." });
      void prepareExplicitCards(ids, async (cardId) => {
        // Recheck each row immediately before dispatch. Never restore a flag.
        const [row] = await db.select({ id: playableCards.id }).from(playableCards).where(candidates([cardId]));
        if (!row) throw new Error("candidate_changed");
        return getMaskedImagePath(cardId, { priority: "warm" });
      }, (cardId) => Boolean(preparedMaskFile(cardId)), readMaskFailureReason, (result) => job.results.push(result))
        .finally(() => { job.state = "completed"; job.finishedAt = new Date().toISOString(); active.delete(job.setId); });
    } catch {
      active.delete(req.params.setId); res.status(500).json({ error: "Preparation could not start" });
    }
  });
  app.get(`${base}/prepare/:jobId`, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.setId !== req.params.setId) { res.status(404).json({ error: "Job not found; read review status before retrying" }); return; }
    res.json({ ...job, maskVersion: CURRENT_MASK_VERSION });
  });
  app.get(`${base}/review`, async (req, res) => {
    try {
      const rows = await db.select({ cardId: playableCards.id, player: playableCards.player, number: playableCards.number,
        isPlayable: playableCards.isPlayable, blockedReason: playableCards.blockedReason, quarantineStatus: playableCards.quarantineStatus,
        imageReviewStatus: playableCards.imageReviewStatus, source: cardReviewApprovals.source,
        approvedBy: cardReviewApprovals.approvedBy, approvedAt: cardReviewApprovals.approvedAt, note: cardReviewApprovals.note })
        .from(playableCards).leftJoin(cardReviewApprovals, eq(cardReviewApprovals.cardId, playableCards.id))
        .where(eq(playableCards.gameSetId, req.params.setId));
      res.json({ setId: req.params.setId, held: true, maskVersion: CURRENT_MASK_VERSION,
        cards: rows.map((row) => ({ ...row, maskReady: Boolean(preparedMaskFile(row.cardId)),
          refusal: readMaskFailureReason(row.cardId), previewPath: `/api/admin/held-sets/${req.params.setId}/preview/${row.cardId}` })) });
    } catch { res.status(500).json({ error: "Could not read review records" }); }
  });
  app.get(`${base}/preview/:cardId`, async (req, res) => {
    try {
      const [row] = await db.select({ id: playableCards.id }).from(playableCards).where(candidates([req.params.cardId]));
      const file = row ? preparedMaskFile(row.id) : null;
      if (!file) { res.status(409).json({ error: "Mask not ready; POST prepare required. Preview never bakes." }); return; }
      res.type("jpeg"); res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(file);
    } catch { res.status(500).json({ error: "Preview unavailable" }); }
  });
  app.post(`${base}/approve-reviewed`, async (req: any, res) => {
    const ids = explicitPreparationIds(req.body);
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
    if (!ids || !note || req.body?.maskVersion !== CURRENT_MASK_VERSION) {
      res.status(400).json({ error: "Explicit IDs, reviewed=true, current maskVersion and visual review note required" }); return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        // Lock the cards so exclusions cannot race the review write.
        await tx.execute(sql`SELECT id FROM playable_cards WHERE id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) FOR UPDATE`);
        const rows = await tx.select({ id: playableCards.id }).from(playableCards).where(and(candidates(ids),
          eligibleDealFilter("playable_cards", { ignoreHeldSets: true, ignoreCardReview: true })));
        const ready = new Set(rows.filter((r) => preparedMaskFile(r.id)).map((r) => r.id));
        if (ready.size !== ids.length) return { refused: ids.filter((x) => !ready.has(x)), approved: [] };
        // An explicit post-mask visual review can promote seed -> qa. Existing qa stays unchanged.
        const approved = await tx.insert(cardReviewApprovals).values(ids.map((cardId) => ({ cardId,
          gameSetId: DONRUSS_1987_HOLD_ID, source: "qa", approvedBy: req.session?.localUserId || req.user?.claims?.sub || req.user?.id, note })))
          .onConflictDoUpdate({ target: cardReviewApprovals.cardId,
            set: { source: "qa", approvedBy: req.session?.localUserId || req.user?.claims?.sub || req.user?.id, note, approvedAt: new Date() },
            setWhere: eq(cardReviewApprovals.source, "seed") }).returning({ cardId: cardReviewApprovals.cardId });
        return { refused: [], approved: approved.map((r) => r.cardId), alreadyQa: ids.filter((x) => !approved.some((r) => r.cardId === x)) };
      });
      res.status(result.refused.length ? 422 : 200).json({ ...result, held: true });
    } catch { res.status(500).json({ error: "Review approvals failed" }); }
  });
        }
