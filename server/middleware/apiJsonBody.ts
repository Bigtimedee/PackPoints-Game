/**
 * The process-wide JSON parser stays at 100KB. Two staff cohort posts are
 * larger than that: the 486-member document, and a staged image of at most
 * 2MB. Those paths check the QA token and the held-set id before any parse.
 * Every other route keeps the 100KB cap.
 */
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { isMissingExpansionId } from "../services/baseballExpansion/registry";

/** body-parser's default. Other routes stay here. */
export const DEFAULT_JSON_LIMIT = 100 * 1024;

/** The submitted 486-member document is 183915 bytes. This bound leaves room for whitespace. */
export const COHORT_JSON_LIMIT = 512 * 1024;

export const STAGE_IMAGE_MAX_BYTES = 2_000_000;

/** Encoded length of a 2MB image, including base64 padding. Longer text is refused before decode. */
export function stageBase64CharCap(): number {
  return 4 * Math.ceil(STAGE_IMAGE_MAX_BYTES / 3);
}

/** JSON envelope around supplierId plus the capped base64 text. */
export const STAGE_JSON_LIMIT = stageBase64CharCap() + 4_096;

export const COHORT_DOCUMENT_BOUNDS = {
  maxDepth: 8,
  maxArray: 2000,
  maxKeys: 32,
  maxNodes: 40_000,
} as const;

const COHORT_POST = /^\/api\/qa\/baseball-expansion\/([^/]+)\/discovery-cohort$/;
const STAGE_POST = /^\/api\/qa\/baseball-expansion\/([^/]+)\/discovery-cohort\/stage$/;

export function largeQaJsonPost(method: string, path: string): { kind: "cohort" | "stage"; setId: string } | null {
  if (method !== "POST") return null;
  const cohort = COHORT_POST.exec(path);
  if (cohort?.[1]) return { kind: "cohort", setId: cohort[1] };
  const stage = STAGE_POST.exec(path);
  if (stage?.[1]) return { kind: "stage", setId: stage[1] };
  return null;
}

export function jsonDocumentWithinBounds(
  value: unknown,
  bounds: { maxDepth: number; maxArray: number; maxKeys: number; maxNodes: number },
): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > bounds.maxNodes || current.depth > bounds.maxDepth) return false;
    if (Array.isArray(current.value)) {
      if (current.value.length > bounds.maxArray) return false;
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (current.value !== null && typeof current.value === "object") {
      const keys = Object.keys(current.value as object);
      if (keys.length > bounds.maxKeys) return false;
      const record = current.value as Record<string, unknown>;
      for (const key of keys) stack.push({ value: record[key], depth: current.depth + 1 });
    }
  }
  return true;
}

function declaredLength(req: Request): number | null {
  const raw = req.headers["content-length"];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text || !/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
}

function sendQaNotFound(res: Response): void {
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  const body = JSON.stringify({ error: "Not found" });
  res.status(404);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function sendEntityTooLarge(res: Response): void {
  const body = JSON.stringify({ message: "request entity too large" });
  res.status(413);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function boundedJson(limit: number, keepRaw: boolean) {
  const parser = express.json({
    limit,
    verify: keepRaw
      ? (req, _res, buf) => {
        req.rawBody = buf;
      }
      : undefined,
  });
  return (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (err) => {
      if (err && typeof err === "object" && "body" in err) {
        delete (err as { body?: unknown }).body;
      }
      next(err);
    });
  };
}

export function installApiJsonParser(app: Express): void {
  const ordinary = boundedJson(DEFAULT_JSON_LIMIT, true);
  const cohort = boundedJson(COHORT_JSON_LIMIT, false);
  const stage = boundedJson(STAGE_JSON_LIMIT, false);
  app.use((req, res, next) => {
    if (req.path.startsWith("/webhooks/")) return next();
    const large = largeQaJsonPost(req.method, req.path);
    if (!large) return ordinary(req, res, next);
    stripConditionalValidators(req);
    if (!coverQaEnabled() || !coverQaHeaderMatches(req.get("x-qa-token")) || !isMissingExpansionId(large.setId)) {
      sendQaNotFound(res);
      return;
    }
    const limit = large.kind === "stage" ? STAGE_JSON_LIMIT : COHORT_JSON_LIMIT;
    const declared = declaredLength(req);
    if (declared != null && declared > limit) {
      sendEntityTooLarge(res);
      return;
    }
    return (large.kind === "stage" ? stage : cohort)(req, res, next);
  });
}
