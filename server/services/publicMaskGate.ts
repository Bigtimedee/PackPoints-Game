/**
 * Public /api/play/m/ must not send a cached JPEG until the card and its set
 * still exist, the set is not held, and the card has no refusal.
 * The set lookup is cached for about a minute and dropped on delete or when
 * the hold list changes. The card row and the fail sidecar are read every time.
 */
import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { holdReasonForIdentity } from "../config/heldSets";
import { refusedAtCurrentMask } from "../masking/maskDealRefusal";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";

/** Short private lifetime so a browser cannot keep a revoked bake for a day. */
export const PUBLIC_MASK_CACHE_CONTROL = "private, max-age=300";

const SET_GATE_TTL_MS = 60_000;

export type PublicMaskDeny = "missing" | "held" | "refused";

interface SetGate {
  exists: boolean;
  held: boolean;
  at: number;
}

const setGates = new Map<string, SetGate>();

export function invalidatePublicMaskSetCache(setId?: string): void {
  if (!setId) {
    setGates.clear();
    return;
  }
  setGates.delete(setId.trim().toLowerCase());
}

export function resetPublicMaskSetCacheForTests(): void {
  setGates.clear();
}

async function setGate(setId: string): Promise<SetGate> {
  const key = setId.trim().toLowerCase();
  const now = Date.now();
  const hit = setGates.get(key);
  if (hit && now - hit.at < SET_GATE_TTL_MS) return hit;
  const [row] = await db
    .select({
      id: gameSets.id,
      year: gameSets.year,
      brand: gameSets.brand,
      sport: gameSets.sport,
      setName: gameSets.setName,
      isActive: gameSets.isActive,
      isUserCreated: gameSets.isUserCreated,
    })
    .from(gameSets)
    .where(eq(gameSets.id, setId))
    .limit(1);
  const entry: SetGate = !row
    ? { exists: false, held: false, at: now }
    : {
      exists: true,
      held: holdReasonForIdentity({
        id: row.id,
        year: row.year,
        brand: row.brand,
        sport: row.sport,
        setName: row.setName,
        isActive: row.isActive,
        isUserCreated: row.isUserCreated,
      }) != null,
      at: now,
    };
  setGates.set(key, entry);
  return entry;
}

/**
 * Why this card must not be sent on the public play path.
 * allowHeld is for an admin review route. QA does not use this function.
 * A lookup error fails closed.
 */
export async function publicMaskDenyReason(
  cardId: string,
  opts?: { allowHeld?: boolean },
): Promise<PublicMaskDeny | null> {
  if (!cardId || cardId.length > 100 || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..") || cardId.includes("\0")) {
    return "missing";
  }
  try {
    const [card] = await db
      .select({
        id: playableCards.id,
        gameSetId: playableCards.gameSetId,
        blockedReason: playableCards.blockedReason,
        lifecycleManaged: sql<boolean>`EXISTS (SELECT 1 FROM admin_set_lifecycles asl WHERE asl.set_id = ${playableCards.gameSetId})`,
      })
      .from(playableCards)
      .where(eq(playableCards.id, cardId))
      .limit(1);
    if (!card) return "missing";
    if (refusedAtCurrentMask({ id: card.id, blockedReason: card.blockedReason })) return "refused";
    if (!card.gameSetId) return "missing";
    if (card.lifecycleManaged) {
      const { lifecycleCardAllowed } = await import("./setLifecycle");
      if (!await lifecycleCardAllowed(cardId)) return "refused";
    }
    const gate = await setGate(card.gameSetId);
    if (!gate.exists) return "missing";
    if (gate.held && !opts?.allowHeld) return "held";
    return null;
  } catch (error) {
    console.error("[MaskGate] lookup failed", error instanceof Error ? error.message : error);
    return "missing";
  }
}

/** 404 with no image bytes. Conditional validators are stripped so a 304 cannot replay the JPEG. */
export function denyPublicMask(req: Request, res: Response): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.removeHeader("X-Mask-Cache");
  res.removeHeader("x-mask-cache");
  res.removeHeader("X-Card-Id");
  res.removeHeader("x-card-id");
  const body = JSON.stringify({ error: "Masked image not found" });
  res.status(404);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

/** Sends 404 and returns true when the public path must not serve this card. */
export async function rejectPublicMask(
  req: Request,
  res: Response,
  cardId: string,
  opts?: { allowHeld?: boolean },
): Promise<boolean> {
  const deny = await publicMaskDenyReason(cardId, opts);
  if (!deny) return false;
  denyPublicMask(req, res);
  return true;
}
