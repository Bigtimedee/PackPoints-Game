/**
 * Token-gated additive import for an allowlisted set (see services/setFillMissing.ts).
 * Same COVER_QA_TOKEN + X-QA-Token gate as the other /api/qa routes; unset,
 * blank, or a bad header is 404. A query param token is ignored.
 *
 * POST /api/qa/sets/:setId/fill-missing  { dryRun?: boolean (default true), details?: boolean,
 *   queries?: [{ set?, search?, player? }], acceptSets?: string[] } -> 202 { jobId }
 * GET  /api/qa/sets/:setId/fill-missing/:jobId -> job state + report
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
  fillMissingCards,
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

const jobs = new Map<string, FillJob>();
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

  app.get("/api/qa/sets/:setId/fill-missing/:jobId", (req, res) => {
    if (!gate(req, res)) return;
    const job = jobs.get(req.params.jobId);
    if (!job || job.setId !== req.params.setId) { send(res, 404, { error: "job not found" }); return; }
    send(res, 200, job);
  });
}
