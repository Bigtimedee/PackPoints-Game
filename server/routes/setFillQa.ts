/**
 * Token-gated additive import for an allowlisted set (see services/setFillMissing.ts).
 * Same COVER_QA_TOKEN + X-QA-Token gate as the other /api/qa routes; unset,
 * blank, or a bad header is 404. A query param token is ignored.
 *
 * POST /api/qa/sets/:setId/fill-missing  { dryRun?: boolean (default true), details?: boolean,
 *   queries?: [{ set?, search?, player? }], acceptSets?: string[] } -> 202 { jobId }
 * GET  /api/qa/sets/:setId/fill-missing/:jobId -> job state + report
 *
 * POST /api/qa/sets/:setId/fill-missing/prepare { cardIds: uuid[] (1-200) } -> 202 { jobId }
 * GET  /api/qa/sets/:setId/fill-missing/prepare/:jobId
 *   Silhouette scan + v4.6 bake for new, unreviewed, unrefused cards only.
 *
 * Insert-only: existing rows, approvals and pinned covers are untouched, and
 * every new row is held as awaiting_card_review. Never approves.
 */
import { randomUUID } from "crypto";
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import {
  FILL_MISSING_SETS,
  MAX_PREPARE_FILLED,
  fillMissingCards,
  prepareFilledCards,
  type FilledPrepareResult,
  sanitizeAcceptSets,
  sanitizeQueries,
  type FillMissingReport,
} from "../services/setFillMissing";

type FillJob = {
  id: string;
  setId: string;
  dryRun: boolean;
  state: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  report?: FillMissingReport;
};

type PrepareJob = {
  id: string;
  setId: string;
  state: "running" | "completed" | "failed";
  cardIds: string[];
  results: FilledPrepareResult[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

const jobs = new Map<string, FillJob>();
const prepareJobs = new Map<string, PrepareJob>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePrepareIds(body: unknown): string[] | null {
  const ids = (body && typeof body === "object") ? (body as Record<string, unknown>).cardIds : undefined;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PREPARE_FILLED) return null;
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) return null;
  const unique = [...new Set(ids as string[])];
  return unique.length === ids.length ? unique : null;
}
const running = new Set<string>();
const MAX_JOBS = 20;

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
  if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token")) || !FILL_MISSING_SETS[req.params.setId]) {
    send(res, 404, { error: "Not found" });
    return false;
  }
  return true;
}

export function registerSetFillQaRoutes(app: Express): void {
  app.post("/api/qa/sets/:setId/fill-missing", (req, res) => {
    if (!gate(req, res)) return;
    const body = (req.body && typeof req.body === "object") ? req.body as Record<string, unknown> : {};
    const queries = sanitizeQueries(body.queries);
    const acceptSets = sanitizeAcceptSets(body.acceptSets);
    if ((body.queries !== undefined && !queries) || !acceptSets
      || (body.dryRun !== undefined && typeof body.dryRun !== "boolean")
      || (body.details !== undefined && typeof body.details !== "boolean")) {
      send(res, 400, { error: "dryRun/details must be boolean; queries 1-8 of {set,search,player}; acceptSets up to 8 strings" });
      return;
    }
    const setId = req.params.setId;
    if (running.has(setId)) { send(res, 409, { error: "fill already running for this set" }); return; }
    if (jobs.size >= MAX_JOBS) {
      const old = [...jobs.values()].find((j) => j.state !== "running");
      if (old) jobs.delete(old.id);
    }
    const job: FillJob = { id: randomUUID(), setId, dryRun: body.dryRun !== false, state: "running", startedAt: new Date().toISOString() };
    jobs.set(job.id, job);
    running.add(setId);
    send(res, 202, { jobId: job.id, dryRun: job.dryRun, statusPath: `/api/qa/sets/${setId}/fill-missing/${job.id}` });
    void fillMissingCards(setId, { dryRun: job.dryRun, details: body.details === true, queries: queries ?? undefined, acceptSets })
      .then((report) => { job.report = report; job.state = "completed"; })
      .catch((error) => { job.state = "failed"; job.error = error instanceof Error ? error.message.slice(0, 300) : "failed"; })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        running.delete(setId);
        console.log(`[FillMissing] set=${setId} job=${job.id} dryRun=${job.dryRun} state=${job.state}`
          + ` inserted=${job.report?.inserted.length ?? 0} candidates=${job.report?.candidates.length ?? 0}`);
      });
  });

  app.post("/api/qa/sets/:setId/fill-missing/prepare", (req, res) => {
    if (!gate(req, res)) return;
    const ids = parsePrepareIds(req.body);
    if (!ids) { send(res, 400, { error: `cardIds: 1-${MAX_PREPARE_FILLED} unique UUIDs required` }); return; }
    const setId = req.params.setId;
    const key = `prepare:${setId}`;
    if (running.has(key)) { send(res, 409, { error: "prepare already running for this set" }); return; }
    if (prepareJobs.size >= MAX_JOBS) {
      const old = [...prepareJobs.values()].find((j) => j.state !== "running");
      if (old) prepareJobs.delete(old.id);
    }
    const job: PrepareJob = { id: randomUUID(), setId, state: "running", cardIds: ids, results: [], startedAt: new Date().toISOString() };
    prepareJobs.set(job.id, job);
    running.add(key);
    send(res, 202, { jobId: job.id, statusPath: `/api/qa/sets/${setId}/fill-missing/prepare/${job.id}` });
    void (async () => {
      const [{ analyzeImageContent }, { getMaskedImagePath }, { readMaskFailureReason }, { preparedMaskFile }] = await Promise.all([
        import("../services/imageContentAnalyzer"),
        import("../masking/maskingService"),
        import("../masking/maskReadySidecar"),
        import("../services/heldMaskPreparation"),
      ]);
      await prepareFilledCards(setId, ids, {
        analyze: analyzeImageContent,
        bake: (cardId) => getMaskedImagePath(cardId, { priority: "warm" }),
        ready: (cardId) => Boolean(preparedMaskFile(cardId)),
        failure: (cardId) => readMaskFailureReason(cardId),
      }, (result) => job.results.push(result));
    })()
      .then(() => { job.state = "completed"; })
      .catch((error) => { job.state = "failed"; job.error = error instanceof Error ? error.message.slice(0, 300) : "failed"; })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        running.delete(key);
        const tally: Record<string, number> = {};
        for (const r of job.results) tally[r.status] = (tally[r.status] || 0) + 1;
        console.log(`[FillMissing] prepare set=${setId} job=${job.id} state=${job.state} ${JSON.stringify(tally)}`);
      });
  });

  app.get("/api/qa/sets/:setId/fill-missing/prepare/:jobId", (req, res) => {
    if (!gate(req, res)) return;
    const job = prepareJobs.get(req.params.jobId);
    if (!job || job.setId !== req.params.setId) { send(res, 404, { error: "job not found" }); return; }
    send(res, 200, job);
  });

  app.get("/api/qa/sets/:setId/fill-missing/:jobId", (req, res) => {
    if (!gate(req, res)) return;
    const job = jobs.get(req.params.jobId);
    if (!job || job.setId !== req.params.setId) { send(res, 404, { error: "job not found" }); return; }
    send(res, 200, job);
  });
}
