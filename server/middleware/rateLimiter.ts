import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";

function getClientIdentifier(req: Request): string {
  return req.ip || (req.headers["x-forwarded-for"] as string) || "unknown";
}

function getUserIdentifier(req: any): string | null {
  return req.user?.claims?.sub || req.session?.localUserId || null;
}

async function check(key: string, max: number, windowMs: number): Promise<boolean> {
  const resetAt = new Date(Date.now() + windowMs);

  try {
    const result = await db.execute(sql`
      INSERT INTO rate_limit_counters ("key", "count", "reset_at")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN rate_limit_counters."reset_at" < NOW() THEN 1
          ELSE rate_limit_counters."count" + 1
        END,
        "reset_at" = CASE
          WHEN rate_limit_counters."reset_at" < NOW() THEN ${resetAt}
          ELSE rate_limit_counters."reset_at"
        END
      RETURNING "count";
    `);

    const count = Number((result.rows[0] as any)?.count ?? 0);
    return count <= max;
  } catch (err: any) {
    // Fail open — a DB outage must not block login.
    console.error("[RateLimit] Counter check failed, allowing request:", err?.message);
    return true;
  }
}

// Periodically drop expired rows so the table does not grow without bound.
setInterval(() => {
  db.execute(sql`DELETE FROM rate_limit_counters WHERE "reset_at" < NOW() - INTERVAL '1 hour'`)
    .catch((err: any) => console.error("[RateLimit] Cleanup failed:", err?.message));
}, 300_000).unref();

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
    void (async () => {
      const ip = getClientIdentifier(req);
      const userId = getUserIdentifier(req);

      if (opts.keySource === "ip" || opts.keySource === "both") {
        const key = `${opts.keyPrefix}:ip:${ip}`;
        if (!(await check(key, opts.max, opts.windowMs))) {
          return res.status(429).json({ error: msg });
        }
      }

      if (opts.keySource === "user" || opts.keySource === "both") {
        if (userId) {
          const key = `${opts.keyPrefix}:user:${userId}`;
          if (!(await check(key, opts.max, opts.windowMs))) {
            return res.status(429).json({ error: msg });
          }
        }
      }

      next();
    })().catch((err) => {
      console.error("[RateLimit] Middleware error, allowing request:", err?.message);
      next();
    });
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

export const forgotPasswordLimiter = rateLimit({
  windowMs: 900_000, // 15 minutes
  max: 5,
  keyPrefix: "forgot_pw",
  keySource: "ip",
  message: "Too many password reset requests. Please wait 15 minutes and try again.",
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 900_000, // 15 minutes
  max: 10, // covers token validation on page load plus submission retries
  keyPrefix: "reset_pw",
  keySource: "ip",
  message: "Too many password reset attempts. Please wait 15 minutes and try again.",
});

export const cardIdentifyLimiter = rateLimit({
  windowMs: 3_600_000, // 1 hour
  max: 20,
  keyPrefix: "card_identify",
  keySource: "user",
  message: "Too many card identification requests. Please try again in an hour.",
});
