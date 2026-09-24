import { createHmac, timingSafeEqual } from "crypto";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

/** Reveal URLs die quickly. The printed name is already on screen after ACK. */
export const REVEAL_TTL_SEC = 10 * 60;

export const PLAY_SCOPES = ["solo", "d5", "ad5", "match"] as const;
export type PlayScope = (typeof PLAY_SCOPES)[number];

export type RevealTokenStatus = "valid" | "expired" | "tampered" | "other-card";

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required to sign play-image tokens");
  }
  return "packpts-play-image-dev-secret";
}

function mac(parts: string[]): string {
  return createHmac("sha256", signingSecret()).update(parts.join("\n")).digest("base64url");
}

export function safeTokenEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isPlayScope(value: string): value is PlayScope {
  return (PLAY_SCOPES as readonly string[]).includes(value);
}

export function maskToken(scope: PlayScope, sessionId: string, index: number, cardId: string): string {
  return mac(["mask", scope, sessionId, String(index), cardId]);
}

/** Guessing-phase URL. The path has no raw card id; the HMAC binds the session question. */
export function maskedPlayPath(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  cardId: string;
}): string {
  const token = maskToken(args.scope, args.sessionId, args.index, args.cardId);
  const session = encodeURIComponent(args.sessionId);
  return `/api/play/m/${args.scope}/${session}/${args.index}/${token}?v=${CURRENT_MASK_VERSION}`;
}

export function revealToken(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  cardId: string;
  exp: number;
  binder: string;
}): string {
  return mac([
    "reveal",
    args.scope,
    args.sessionId,
    String(args.index),
    args.cardId,
    String(args.exp),
    args.binder,
  ]);
}

/** Short-lived unmasked URL returned only in an accepted-answer ACK. */
export function revealPlayPath(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  cardId: string;
  binder: string;
  exp?: number;
}): string {
  const exp = args.exp ?? Math.floor(Date.now() / 1000) + REVEAL_TTL_SEC;
  const token = revealToken({ ...args, exp });
  const session = encodeURIComponent(args.sessionId);
  return `/api/play/r/${args.scope}/${session}/${args.index}/${exp}/${token}`;
}

export function maskTokenMatches(
  scope: PlayScope,
  sessionId: string,
  index: number,
  cardId: string,
  token: string,
): boolean {
  return safeTokenEqual(maskToken(scope, sessionId, index, cardId), token);
}

/**
 * `other-card` when the signature is valid for `otherCardId` but not the card
 * this question actually deals. A flipped signature is `tampered`.
 */
export function classifyRevealToken(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  cardId: string;
  exp: number;
  binder: string;
  token: string;
  nowSec?: number;
  otherCardId?: string;
}): RevealTokenStatus {
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(args.exp)) return "tampered";
  const matchesThisCard = safeTokenEqual(
    revealToken({ ...args, exp: args.exp }),
    args.token,
  );
  if (matchesThisCard) {
    return args.exp < nowSec ? "expired" : "valid";
  }
  if (args.otherCardId && args.otherCardId !== args.cardId) {
    const matchesOther = safeTokenEqual(
      revealToken({ ...args, cardId: args.otherCardId, exp: args.exp }),
      args.token,
    );
    if (matchesOther) return "other-card";
  }
  return "tampered";
}
