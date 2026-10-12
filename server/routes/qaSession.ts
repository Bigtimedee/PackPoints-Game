/**
 * POST /api/qa/session: sign in as the fixed QA test account (shared/qaTestAccount).
 * Token: env QA_SESSION_TOKEN via header X-QA-Token only. Unset, blank, missing or
 * wrong token answers 404 so the route is invisible. The request body and query are
 * ignored entirely: there is no way to choose a user.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import {
  QA_TEST_EMAIL, QA_TEST_SEED_KEY, QA_TEST_SEED_POINTS, QA_TEST_USER_ID, QA_TEST_USERNAME,
  isQaTestUser, qaBlockedPath,
} from "@shared/qaTestAccount";

export function qaSessionTokenMatches(header: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = (env.QA_SESSION_TOKEN ?? "").trim();
  if (!expected || typeof header !== "string" || header.length === 0) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len); a.copy(pa);
  const pb = Buffer.alloc(len); b.copy(pb);
  return a.length === b.length && timingSafeEqual(pa, pb);
}

export type QaAccountEnsurer = () => Promise<void>;

async function defaultEnsure(): Promise<void> {
  const { db } = await import("../db");
  const { users } = await import("@shared/schema");
  const { walletService } = await import("../services/walletService");
  await db
    .insert(users)
    .values({
      id: QA_TEST_USER_ID,
      username: QA_TEST_USERNAME,
      usernameNormalized: QA_TEST_USERNAME,
      email: QA_TEST_EMAIL,
      emailNormalized: QA_TEST_EMAIL,
      firstName: "QA Test",
      isAdmin: false,
      status: "ACTIVE",
    } as any)
    .onConflictDoUpdate({ target: users.id, set: { isAdmin: false } as any });
  await walletService.getOrCreateWallet(QA_TEST_USER_ID);
  // Idempotent: the seed lands once, ever.
  await walletService.adjust(QA_TEST_USER_ID, QA_TEST_SEED_POINTS, "QA test account seed", QA_TEST_SEED_KEY, { qaTestAccount: true });
}

let ensure: QaAccountEnsurer = defaultEnsure;
export function setQaAccountEnsurerForTests(next: QaAccountEnsurer | null): void {
  ensure = next ?? defaultEnsure;
}

function notFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

function sessionUserId(req: Request): string | undefined {
  const r = req as any;
  return r.session?.localUserId ?? r.user?.claims?.sub;
}

/** Money paths refuse the QA account no matter how it got its session. */
export function qaTestAccountGuard(req: Request, res: Response, next: NextFunction): void {
  if (isQaTestUser(sessionUserId(req)) && qaBlockedPath(req.method, req.path)) {
    res.status(403).json({ error: "Test account cannot redeem, purchase or receive payouts" });
    return;
  }
  next();
}

export function registerQaSessionRoute(app: Express): void {
  app.post("/api/qa/session", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    if (!qaSessionTokenMatches(req.get("X-QA-Token"))) return notFound(res);
    try {
      await ensure();
      const session = (req as any).session;
      session.localUserId = QA_TEST_USER_ID;
      session.save((err: unknown) => {
        if (err) return res.status(500).json({ error: "Failed to save session" });
        res.json({ ok: true, userId: QA_TEST_USER_ID, username: QA_TEST_USERNAME, testAccount: true });
      });
    } catch (err) {
      console.error("[qa/session] failed", (err as any)?.message);
      res.status(500).json({ error: "QA session unavailable" });
    }
  });
}
