/**
 * Server-trusted anonymous identity.
 *
 * The browser never chooses the anon id. A long-lived HttpOnly cookie holds
 * an opaque token; we store only its hash. A local fingerprint (header) is a
 * lookup hint when the cookie is missing (Safari storage quirks, PWA). A
 * claimed row is never reused for more guest play.
 */
import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  anonDailyRuns,
  anonGameCredits,
  anonPlayers,
  dailyChallengeEntries,
  users,
  type AnonPlayer,
} from "@shared/schema";
import {
  ANON_COOKIE_NAME,
  ANON_FINGERPRINT_HEADER,
  type AnonPlaySurface,
  type AnonPlayerSnapshot,
  type PublicAnonGate,
  anonGateDeniedBody,
  creditIfNew,
  emptyAnonSnapshot,
  planEscrowClaim,
  toPublicAnonGate,
} from "@shared/anonGate";
import { getPackptsDayKey } from "@shared/packptsDay";
import { walletService } from "./walletService";
import { storage } from "../storage";

const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

type GateRequest = Request & {
  session?: {
    pendingPoints?: {
      score: number;
      correctAnswers: number;
      totalAnswers: number;
      gamesPlayed: number;
    };
    guestId?: string;
    localUserId?: string;
  };
};

export class AnonGateError extends Error {
  readonly status = 403;
  readonly body: ReturnType<typeof anonGateDeniedBody>;

  constructor(gate: PublicAnonGate) {
    super(gate.reason === "next_day" ? "Register to keep playing" : "Register to keep playing");
    this.name = "AnonGateError";
    this.body = anonGateDeniedBody(gate);
  }
}

function hashSecret(kind: "token" | "fp", value: string): string {
  const salt = process.env.SESSION_SECRET || "packpts-anon";
  return createHash("sha256").update(`${salt}:${kind}:${value}`).digest("hex");
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eqAt = part.indexOf("=");
    if (eqAt === -1) continue;
    const key = part.slice(0, eqAt).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(eqAt + 1).trim());
    } catch {
      return part.slice(eqAt + 1).trim();
    }
  }
  return null;
}

function fingerprintHeader(req: Request): string | null {
  const raw = req.headers[ANON_FINGERPRINT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 300);
  if (trimmed.length < 8) return null;
  return trimmed;
}

function cookieOptions() {
  const isDev = process.env.NODE_ENV === "development";
  return {
    httpOnly: true as const,
    secure: !isDev,
    sameSite: "lax" as const,
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

function setAnonCookie(res: Response, token: string) {
  res.cookie(ANON_COOKIE_NAME, token, cookieOptions());
}

function snapshotOf(row: AnonPlayer): AnonPlayerSnapshot {
  return {
    gamesCompleted: row.gamesCompleted,
    gamesStarted: row.gamesStarted,
    daily5Completed: row.daily5Completed,
    setsPlaysCompleted: row.setsPlaysCompleted,
    soloPlaysCompleted: row.soloPlaysCompleted,
    escrowPoints: row.escrowPoints,
    escrowCorrect: row.escrowCorrect,
    escrowAnswers: row.escrowAnswers,
    lastPlayDay: row.lastPlayDay,
    softDismissed: !!row.softDismissedAt,
    claimedAt: row.claimedAt,
  };
}

export function publicGateFor(
  row: Pick<AnonPlayer, "gamesCompleted" | "lastPlayDay" | "escrowPoints" | "softDismissedAt">,
  today = getPackptsDayKey(),
): PublicAnonGate {
  return toPublicAnonGate(
    {
      gamesCompleted: row.gamesCompleted,
      lastPlayDay: row.lastPlayDay,
      escrowPoints: row.escrowPoints,
      softDismissed: !!row.softDismissedAt,
    },
    today,
  );
}

async function insertPlayer(token: string, fingerprintHash: string | null): Promise<AnonPlayer> {
  const [created] = await db
    .insert(anonPlayers)
    .values({
      tokenHash: hashSecret("token", token),
      fingerprintHash,
    })
    .returning();
  return created;
}

/**
 * Resolve the guest row from the cookie, else from the fingerprint.
 * `create` mints a row and sets the cookie. Claimed rows are not reused.
 */
export async function resolveAnonPlayer(
  req: GateRequest,
  res: Response,
  opts: { create: boolean },
): Promise<AnonPlayer | null> {
  const fpRaw = fingerprintHeader(req);
  const fpHash = fpRaw ? hashSecret("fp", fpRaw) : null;
  const token = readCookie(req, ANON_COOKIE_NAME);

  if (token) {
    const tokenHash = hashSecret("token", token);
    const [byToken] = await db
      .select()
      .from(anonPlayers)
      .where(eq(anonPlayers.tokenHash, tokenHash))
      .limit(1);
    if (byToken && !byToken.claimedAt) {
      if (fpHash && byToken.fingerprintHash !== fpHash) {
        await db
          .update(anonPlayers)
          .set({ fingerprintHash: fpHash, updatedAt: new Date() })
          .where(eq(anonPlayers.id, byToken.id));
        byToken.fingerprintHash = fpHash;
      }
      return byToken;
    }
  }

  if (fpHash) {
    const [byFp] = await db
      .select()
      .from(anonPlayers)
      .where(and(eq(anonPlayers.fingerprintHash, fpHash), isNull(anonPlayers.claimedAt)))
      .orderBy(desc(anonPlayers.updatedAt))
      .limit(1);
    if (byFp) {
      const nextToken = randomBytes(32).toString("hex");
      await db
        .update(anonPlayers)
        .set({ tokenHash: hashSecret("token", nextToken), updatedAt: new Date() })
        .where(eq(anonPlayers.id, byFp.id));
      setAnonCookie(res, nextToken);
      byFp.tokenHash = hashSecret("token", nextToken);
      return byFp;
    }
  }

  if (!opts.create) return null;

  const nextToken = randomBytes(32).toString("hex");
  const created = await insertPlayer(nextToken, fpHash);
  setAnonCookie(res, nextToken);
  return created;
}

export async function readAnonGate(req: GateRequest, res: Response): Promise<PublicAnonGate> {
  const today = getPackptsDayKey();
  const player = await resolveAnonPlayer(req, res, { create: false });
  if (!player) {
    return toPublicAnonGate({ ...emptyAnonSnapshot(), gamesCompleted: 0, lastPlayDay: null, escrowPoints: 0 }, today);
  }
  return publicGateFor(player, today);
}

export async function beginAnonGame(
  req: GateRequest,
  res: Response,
  surface: AnonPlaySurface,
): Promise<{ ok: true; player: AnonPlayer; gate: PublicAnonGate } | { ok: false; body: ReturnType<typeof anonGateDeniedBody> }> {
  const player = await resolveAnonPlayer(req, res, { create: true });
  if (!player) {
    const gate = toPublicAnonGate(emptyAnonSnapshot(), getPackptsDayKey());
    return { ok: false, body: anonGateDeniedBody({ ...gate, phase: "hard", canStart: false, prompt: "hard", reason: "game_cap" }) };
  }
  const gate = publicGateFor(player);
  if (!gate.canStart) {
    return { ok: false, body: anonGateDeniedBody(gate) };
  }
  await db
    .update(anonPlayers)
    .set({ openSurface: surface, updatedAt: new Date() })
    .where(and(eq(anonPlayers.id, player.id), isNull(anonPlayers.claimedAt)));
  player.openSurface = surface;
  return { ok: true, player, gate };
}

/** Soft sheet shows once. Dismiss does not spend the remaining guest round. */
export async function dismissAnonSoft(req: GateRequest, res: Response): Promise<PublicAnonGate> {
  const today = getPackptsDayKey();
  const player = await resolveAnonPlayer(req, res, { create: false });
  if (!player || player.claimedAt || player.softDismissedAt || player.gamesCompleted < 1) {
    return player ? publicGateFor(player, today) : toPublicAnonGate(emptyAnonSnapshot(), today);
  }
  const [saved] = await db
    .update(anonPlayers)
    .set({ softDismissedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(anonPlayers.id, player.id), isNull(anonPlayers.softDismissedAt)))
    .returning();
  return publicGateFor(saved ?? player, today);
}

export async function creditAnonGame(
  anonPlayerId: string,
  creditId: string,
  input: {
    surface?: AnonPlaySurface;
    points: number;
    correct: number;
    answers: number;
  },
): Promise<PublicAnonGate | null> {
  const today = getPackptsDayKey();
  return db.transaction(async (tx) => {
    const [player] = await tx
      .select()
      .from(anonPlayers)
      .where(eq(anonPlayers.id, anonPlayerId))
      .for("update")
      .limit(1);
    if (!player || player.claimedAt) return player ? publicGateFor(player, today) : null;

    const surface = (input.surface ?? (player.openSurface as AnonPlaySurface | null) ?? "solo") as AnonPlaySurface;
    const creditInput = { ...input, surface };

    const inserted = await tx
      .insert(anonGameCredits)
      .values({
        id: creditId,
        anonPlayerId,
        surface,
        points: Math.max(0, Math.floor(creditInput.points)),
        correct: Math.max(0, Math.floor(creditInput.correct)),
        answers: Math.max(0, Math.floor(creditInput.answers)),
        playDay: today,
      })
      .onConflictDoNothing()
      .returning({ id: anonGameCredits.id });

    const { row, applied } = creditIfNew(
      snapshotOf(player),
      { ...creditInput, today },
      inserted.length === 0,
    );
    if (!applied) return publicGateFor(player, today);

    const [saved] = await tx
      .update(anonPlayers)
      .set({
        gamesCompleted: row.gamesCompleted,
        gamesStarted: row.gamesStarted,
        daily5Completed: row.daily5Completed,
        setsPlaysCompleted: row.setsPlaysCompleted,
        soloPlaysCompleted: row.soloPlaysCompleted,
        escrowPoints: row.escrowPoints,
        escrowCorrect: row.escrowCorrect,
        escrowAnswers: row.escrowAnswers,
        lastPlayDay: row.lastPlayDay,
        openSurface: player.openSurface === surface ? null : player.openSurface,
        updatedAt: new Date(),
      })
      .where(eq(anonPlayers.id, anonPlayerId))
      .returning();
    return publicGateFor(saved ?? player, today);
  });
}

async function copyDailyRunsToUser(anonPlayerId: string, userId: string) {
  const runs = await db
    .select()
    .from(anonDailyRuns)
    .where(and(eq(anonDailyRuns.anonPlayerId, anonPlayerId), sql`${anonDailyRuns.completedAt} is not null`));

  for (const run of runs) {
    try {
      await db
        .insert(dailyChallengeEntries)
        .values({
          dailyChallengeId: run.dailyChallengeId,
          userId,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          creditedAt: new Date(),
          score: run.score,
          correctCount: run.correctCount,
          timeMs: run.timeMs,
          flagged: run.flagged,
          flagReason: run.flagReason,
          answers: run.answers ?? [],
        })
        .onConflictDoNothing();
    } catch (err) {
      console.error("[Anon] Daily 5 claim copy failed:", err);
    }
  }
}

async function applyClaimStats(userId: string, plan: { creditPoints: number; games: number; correct: number; answers: number }) {
  if (plan.creditPoints > 0) {
    const earned = await walletService.earn(
      userId,
      plan.creditPoints,
      "Guest play claimed",
      `anon_escrow:${userId}:${plan.creditPoints}:${plan.games}`,
      { source: "anon_escrow" },
    );
    if (!earned.success) {
      throw new Error(earned.error || "Failed to credit guest PackPTS");
    }
  }

  if (plan.games <= 0 && plan.creditPoints <= 0 && plan.correct <= 0 && plan.answers <= 0) return;

  await storage.updateUserStats(userId, {
    pointsEarned: plan.creditPoints,
    correctAnswers: plan.correct,
    totalAnswers: plan.answers,
  });
  for (let i = 1; i < plan.games; i++) {
    await db.update(users).set({
      gamesPlayed: sql`${users.gamesPlayed} + 1`,
    }).where(eq(users.id, userId));
  }
}

/**
 * Move escrow onto the real wallet. Idempotent per anon row (claimed_at).
 * Also folds a legacy session `pendingPoints` blob when the row has no escrow
 * yet, so a deploy does not drop an in-flight guest score.
 */
export async function claimAnonForUser(req: GateRequest, res: Response, userId: string): Promise<{ credited: number }> {
  const player = await resolveAnonPlayer(req, res, { create: false });
  const legacy = req.session?.pendingPoints;

  if (player && !player.claimedAt) {
    const plan = planEscrowClaim(snapshotOf(player));
    const useLegacy = plan.creditPoints === 0 && plan.games === 0 && legacy && legacy.score > 0;
    const effective = useLegacy
      ? {
          alreadyClaimed: false,
          creditPoints: Math.max(0, Math.floor(legacy!.score)),
          games: Math.max(0, legacy!.gamesPlayed || 0),
          correct: Math.max(0, legacy!.correctAnswers || 0),
          answers: Math.max(0, legacy!.totalAnswers || 0),
        }
      : plan;

    const locked = await db
      .update(anonPlayers)
      .set({ claimedByUserId: userId, claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(anonPlayers.id, player.id), isNull(anonPlayers.claimedAt)))
      .returning({ id: anonPlayers.id });

    if (locked.length === 0) {
      clearLegacy(req);
      return { credited: 0 };
    }

    try {
      const idempotentPlan = effective;
      if (idempotentPlan.creditPoints > 0) {
        const earned = await walletService.earn(
          userId,
          idempotentPlan.creditPoints,
          "Guest play claimed",
          `anon_escrow:${player.id}`,
          { source: "anon_escrow", anonPlayerId: player.id },
        );
        if (!earned.success) {
          throw new Error(earned.error || "Failed to credit guest PackPTS");
        }
      }
      if (idempotentPlan.games > 0 || idempotentPlan.creditPoints > 0) {
        await storage.updateUserStats(userId, {
          pointsEarned: idempotentPlan.creditPoints,
          correctAnswers: idempotentPlan.correct,
          totalAnswers: idempotentPlan.answers,
        });
        for (let i = 1; i < idempotentPlan.games; i++) {
          await db.update(users).set({
            gamesPlayed: sql`${users.gamesPlayed} + 1`,
          }).where(eq(users.id, userId));
        }
      }
      await copyDailyRunsToUser(player.id, userId);
      clearLegacy(req);
      return { credited: idempotentPlan.creditPoints };
    } catch (err) {
      await db
        .update(anonPlayers)
        .set({ claimedByUserId: null, claimedAt: null, updatedAt: new Date() })
        .where(and(eq(anonPlayers.id, player.id), eq(anonPlayers.claimedByUserId, userId)));
      throw err;
    }
  }

  if (legacy && (legacy.score > 0 || legacy.gamesPlayed > 0)) {
    await applyClaimStats(userId, {
      creditPoints: Math.max(0, Math.floor(legacy.score || 0)),
      games: Math.max(0, legacy.gamesPlayed || 0),
      correct: Math.max(0, legacy.correctAnswers || 0),
      answers: Math.max(0, legacy.totalAnswers || 0),
    });
    clearLegacy(req);
    return { credited: Math.max(0, Math.floor(legacy.score || 0)) };
  }

  return { credited: 0 };
}

function clearLegacy(req: GateRequest) {
  if (req.session?.pendingPoints) delete req.session.pendingPoints;
  if (req.session?.guestId) delete req.session.guestId;
}
