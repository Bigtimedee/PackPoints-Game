import type { NextFunction, Request, Response } from "express";
import { tryServeWarmMasked } from "./warmMaskGate";

/**
 * DB routes stay closed until `drizzle-kit push --force` has finished.
 * `/api/version` and the static SPA stay up so a deploy is not a hard 502
 * for the whole schema step.
 */
let schemaReady = false;

export function isSchemaReady(): boolean {
  return schemaReady;
}

export function markSchemaReady(): void {
  schemaReady = true;
}

export function resetSchemaGateForTests(): void {
  schemaReady = false;
}

export function schemaGateBlocks(path: string): boolean {
  if (schemaReady) return false;
  if (path === "/api/version" || path.startsWith("/api/version/")) return false;
  return path === "/api" || path.startsWith("/api/");
}

/** Warm masked JPEGs with a bake ok sidecar can be HMAC-checked on disk. Reveal and raw scans stay closed. */
export function schemaGateServesWarmMask(method: string, path: string): boolean {
  if (schemaReady) return false;
  if (method !== "GET" && method !== "HEAD") return false;
  return /^\/api\/play\/m\/[^/]+\/[^/]+\/\d{1,3}\/[^/]+$/.test(path);
}

export function schemaGateMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!schemaGateBlocks(req.path)) {
    next();
    return;
  }
  if (schemaGateServesWarmMask(req.method, req.path) && tryServeWarmMasked(req, res)) {
    return;
  }
  res.setHeader("Retry-After", "2");
  res.status(503).json({ message: "Starting up", retryAfter: 2 });
}
