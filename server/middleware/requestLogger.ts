import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.requestId = randomUUID().slice(0, 12);
  next();
}

const CRITICAL_PATTERNS = [
  "/api/game/start",
  "/api/game/answer",
  "/api/lobby/create",
  "/api/store/checkout",
  "/api/stripe/webhook",
  "/api/auth/local-login",
  "/api/auth/register",
  "/api/redeem",
  "/api/admin/wallet",
  "/api/admin/panic",
  "/api/admin/webhooks",
];

function isCriticalPath(path: string): boolean {
  return CRITICAL_PATTERNS.some((p) => path.startsWith(p));
}

export function structuredRequestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const path = req.path;

    if (!path.startsWith("/api")) return;

    if (isCriticalPath(path) || res.statusCode >= 400) {
      const entry: Record<string, unknown> = {
        rid: req.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        ms: duration,
      };

      const userId =
        (req as any).user?.claims?.sub ||
        (req as any).session?.localUserId ||
        undefined;
      if (userId) entry.userId = userId;

      if (res.statusCode >= 500) {
        console.error("[REQ]", JSON.stringify(entry));
      } else if (res.statusCode >= 400) {
        console.warn("[REQ]", JSON.stringify(entry));
      } else {
        console.log("[REQ]", JSON.stringify(entry));
      }
    }
  });

  next();
}
