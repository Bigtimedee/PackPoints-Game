import type { Request, Response } from "express";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { classifyRevealToken, isPlayScope, maskTokenMatches, type PlayScope, type RevealTokenStatus } from "./playImageToken";

/** Unmasked bytes are per player. A shared cache must not replay one player's 200. */
export function setUnmaskedHeaders(res: Response): void {
  if (res.req) stripConditionalValidators(res.req);
  applyNoStoreHeaders(res);
  res.setHeader("Vary", "Cookie");
  res.removeHeader("X-Card-Id");
  res.removeHeader("x-card-id");
}

export function denyUnmasked(res: Response, status: 403 | 404 = 403): void {
  setUnmaskedHeaders(res);
  res.status(status).json({ error: "Card not revealed" });
}

export type CardIdGrant = "admin" | "answered" | "denied";

export type RevealResolution =
  | { ok: true; cardId: string }
  | { ok: false; reason: RevealTokenStatus | "unanswered" | "bad" };

export interface PlayImageDeps {
  authorizeCardId: (req: Request, cardId: string) => Promise<CardIdGrant>;
  resolveReveal: (
    req: Request,
    scope: PlayScope,
    sessionId: string,
    index: number,
    exp: number,
    token: string,
  ) => Promise<RevealResolution>;
  resolveMask: (scope: PlayScope, sessionId: string, index: number, token: string) => Promise<string | null>;
  sendUnmasked: (res: Response, cardId: string) => Promise<void>;
  sendMasked: (req: Request, res: Response, cardId: string) => Promise<void>;
}

function parseIndex(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index > 200) return null;
  return index;
}

export async function handleCardIdUnmasked(req: Request, res: Response, deps: PlayImageDeps): Promise<void> {
  const cardId = req.params.cardId;
  if (!cardId || cardId.length > 100) {
    setUnmaskedHeaders(res);
    res.status(400).json({ error: "Invalid card ID" });
    return;
  }
  const grant = await deps.authorizeCardId(req, cardId);
  if (grant === "denied") {
    denyUnmasked(res, 403);
    return;
  }
  setUnmaskedHeaders(res);
  await deps.sendUnmasked(res, cardId);
}

export async function handleRevealToken(req: Request, res: Response, deps: PlayImageDeps): Promise<void> {
  const { scope, sessionId, index: indexRaw, exp: expRaw, token } = req.params;
  if (!scope || !isPlayScope(scope) || !sessionId || !token) {
    denyUnmasked(res, 403);
    return;
  }
  const index = parseIndex(indexRaw);
  const exp = Number(expRaw);
  if (index === null || !Number.isFinite(exp)) {
    denyUnmasked(res, 403);
    return;
  }
  const resolved = await deps.resolveReveal(req, scope, sessionId, index, exp, token);
  if (!resolved.ok) {
    denyUnmasked(res, 403);
    return;
  }
  setUnmaskedHeaders(res);
  await deps.sendUnmasked(res, resolved.cardId);
}

export async function handleMaskedToken(req: Request, res: Response, deps: PlayImageDeps): Promise<void> {
  const { scope, sessionId, index: indexRaw, token } = req.params;
  if (!scope || !isPlayScope(scope) || !sessionId || !token) {
    res.status(404).json({ error: "Masked image not found" });
    return;
  }
  const index = parseIndex(indexRaw);
  if (index === null) {
    res.status(404).json({ error: "Masked image not found" });
    return;
  }
  const cardId = await deps.resolveMask(scope, sessionId, index, token);
  if (!cardId) {
    res.status(404).json({ error: "Masked image not found" });
    return;
  }
  await deps.sendMasked(req, res, cardId);
}

export function revealStatusForCard(args: {
  scope: PlayScope;
  sessionId: string;
  index: number;
  cardId: string;
  exp: number;
  binder: string;
  token: string;
  otherCardId?: string;
  nowSec?: number;
}): RevealTokenStatus {
  return classifyRevealToken(args);
}

export function maskedTokenOk(
  scope: PlayScope,
  sessionId: string,
  index: number,
  cardId: string,
  token: string,
): boolean {
  return maskTokenMatches(scope, sessionId, index, cardId, token);
}
