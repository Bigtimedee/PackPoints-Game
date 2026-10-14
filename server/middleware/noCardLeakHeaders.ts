import type { Request, Response, NextFunction } from "express";

/**
 * Public responses must never expose a card id, mask plan or name in headers
 * (Design QA cheat-leak RED, Oct 14 2026). Blocks these headers on every
 * route except token-gated QA/admin routes, whatever code tries to set them.
 */
export const FORBIDDEN_PUBLIC_HEADER = /^x-(card-id|card-options|card-name|mask-plan|player|answer|correct|set-card)/i;

export function isPrivilegedPath(path: string): boolean {
  return path.startsWith("/api/qa/") || path.startsWith("/api/admin/");
}

export function noCardLeakHeaders(req: Request, res: Response, next: NextFunction): void {
  if (isPrivilegedPath(req.path)) return next();
  const original = res.setHeader.bind(res);
  (res as any).setHeader = (name: string, value: any) => {
    if (FORBIDDEN_PUBLIC_HEADER.test(String(name))) return res;
    return original(name, value);
  };
  next();
}
