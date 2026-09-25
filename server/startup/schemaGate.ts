import type { NextFunction, Request, Response } from "express";

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

export function schemaGateMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!schemaGateBlocks(req.path)) {
    next();
    return;
  }
  res.setHeader("Retry-After", "2");
  res.status(503).json({ message: "Starting up", retryAfter: 2 });
}
