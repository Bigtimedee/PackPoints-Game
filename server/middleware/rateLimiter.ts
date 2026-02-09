import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  });
}, 60_000);

function getClientIdentifier(req: Request): string {
  return req.ip || (req.headers["x-forwarded-for"] as string) || "unknown";
}

function getUserIdentifier(req: any): string | null {
  return req.user?.claims?.sub || req.session?.localUserId || null;
}

function check(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) {
    return false;
  }

  entry.count++;
  return true;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keySource: "ip" | "user" | "both";
  message?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  const msg = opts.message || "Too many requests. Please try again later.";

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIdentifier(req);
    const userId = getUserIdentifier(req);

    if (opts.keySource === "ip" || opts.keySource === "both") {
      const key = `${opts.keyPrefix}:ip:${ip}`;
      if (!check(key, opts.max, opts.windowMs)) {
        return res.status(429).json({ error: msg });
      }
    }

    if (opts.keySource === "user" || opts.keySource === "both") {
      if (userId) {
        const key = `${opts.keyPrefix}:user:${userId}`;
        if (!check(key, opts.max, opts.windowMs)) {
          return res.status(429).json({ error: msg });
        }
      }
    }

    next();
  };
}

export const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "login",
  keySource: "ip",
  message: "Too many login attempts. Please wait a minute and try again.",
});

export const matchCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyPrefix: "match_create",
  keySource: "both",
  message: "Too many match creation requests. Please slow down.",
});

export const answerSubmitLimiter = rateLimit({
  windowMs: 10_000,
  max: 15,
  keyPrefix: "answer_submit",
  keySource: "both",
  message: "Submitting answers too quickly. Please slow down.",
});

export const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "checkout",
  keySource: "both",
  message: "Too many checkout requests. Please wait a minute.",
});

export const gameStartLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  keyPrefix: "game_start",
  keySource: "both",
  message: "Too many game start requests. Please slow down.",
});

export const registrationLimiter = rateLimit({
  windowMs: 300_000,
  max: 5,
  keyPrefix: "register",
  keySource: "ip",
  message: "Too many registration attempts. Please wait a few minutes.",
});
