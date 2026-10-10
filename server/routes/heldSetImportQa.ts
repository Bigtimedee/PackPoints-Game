/**
 * Token-gated tools for a set that is imported HELD (no mask profile, not cleared).
 * Same COVER_QA_TOKEN + X-QA-Token header gate as the other /api/qa routes.
 * A query param token is ignored. Unset, blank, or a bad header is 404.
 *
 * POST /api/qa/held-imports/:setId/create
 *   Inserts the game_sets row for an allowlisted identity (FILL_MISSING_SETS
 *   createIdentity) with a fixed id, then refreshes the hold list. Idempotent.
 *   Never clears, approves, registers a profile, or pins covers.
 * GET /api/qa/sets/:setId/cards?offset&limit
 *   Every row in a HELD set: card id, number, player, playable/blocked state,
 *   review approval, and the QA image paths. Design-approved sets are 404.
 * GET /api/qa/sets/:setId/source/:cardId
 *   The RAW unmasked source image for a card in a HELD set (server-side fetch
 *   of image_url). Design-approved sets are 404, so this can never serve an
 *   unmasked image for a public set. no-store + noindex.
 */
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { heldSetReason, isDesignApprovedSetId, refreshHeldSets } from "../config/heldSets";
import { FILL_MISSING_SETS } from "../services/setFillMissing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/i;

function headers(req: Request, res: Response): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
}

function json(req: Request, res: Response, status: number, payload: unknown): void {
  headers(req, res);
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function notFound(req: Request, res: Response): void {
  json(req, res, 404, { error: "Not found" });
}

function tokenOk(req: Request): boolean {
  return coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));
}

/** A set Design has not approved and that the hold list currently holds. */
export function isHeldForQa(setId: string): boolean {
  return UUID.test(setId) && !isDesignApprovedSetId(setId) && heldSetReason(setId) != null;
}

function pageInt(raw: unknown, def: number, max: number): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
}

export function registerHeldSetImportQaRoutes(app: Express): void {
  app.post("/api/qa/held-imports/:setId/create", (req, res) => {
    const setId = req.params.setId;
    const config = FILL_MISSING_SETS[setId];
    if (!tokenOk(req) || !config?.createIdentity || isDesignApprovedSetId(setId)) return notFound(req, res);
    const identity = config.createIdentity;
    void (async () => {
      const inserted = await db.insert(gameSets).values({
        id: setId,
        sport: identity.sport,
        brand: identity.brand,
        year: identity.year,
        setName: identity.setName,
        cardhedgeSetQuery: identity.cardhedgeSetQuery,
        cardhedgeCategory: identity.cardhedgeCategory,
        marketplaceKeywords: [],
        isActive: true,
      }).onConflictDoNothing({ target: gameSets.id }).returning({ id: gameSets.id });
      await refreshHeldSets();
      json(req, res, 200, { setId, created: inserted.length > 0, holdReason: heldSetReason(setId) });
    })().catch(() => { if (!res.headersSent) json(req, res, 500, { error: "create failed" }); });
  });

  app.get("/api/qa/sets/:setId/cards", (req, res) => {
    const setId = req.params.setId;
    if (!tokenOk(req) || !isHeldForQa(setId)) return notFound(req, res);
    const offset = pageInt(req.query.offset, 0, 100000);
    const limit = Math.max(1, pageInt(req.query.limit, 500, 1000));
    void (async () => {
      const total = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM playable_cards WHERE game_set_id = ${setId}`);
      const rows = await db.execute<{ id: string; number: string | null; player: string | null; variant: string | null; set: string | null;
        is_playable: boolean; blocked_reason: string | null; has_image: boolean; approved: boolean }>(sql`
        SELECT pc.id, pc.number, pc.player, pc.variant, pc.set, pc.is_playable, pc.blocked_reason,
          (pc.image_url LIKE 'https://%') AS has_image,
          EXISTS (SELECT 1 FROM card_review_approvals cra WHERE cra.card_id = pc.id) AS approved
        FROM playable_cards pc WHERE pc.game_set_id = ${setId}
        ORDER BY NULLIF(regexp_replace(coalesce(pc.number, ''), '[^0-9]', '', 'g'), '')::int NULLS LAST, pc.id
        OFFSET ${offset} LIMIT ${limit}`);
      json(req, res, 200, {
        setId,
        holdReason: heldSetReason(setId),
        total: Number(total.rows?.[0]?.n) || 0,
        offset,
        limit,
        cards: (rows.rows ?? []).map((r) => ({
          cardId: r.id, number: r.number, player: r.player, variant: r.variant, set: r.set,
          isPlayable: Boolean(r.is_playable), blockedReason: r.blocked_reason, hasImage: Boolean(r.has_image),
          approved: Boolean(r.approved),
          sourcePath: `/api/qa/sets/${setId}/source/${r.id}`,
          maskedPath: `/api/qa/cover-image/${r.id}`,
        })),
      });
    })().catch(() => { if (!res.headersSent) notFound(req, res); });
  });

  app.get("/api/qa/sets/:setId/source/:cardId", (req, res) => {
    const { setId, cardId } = req.params;
    if (!tokenOk(req) || !isHeldForQa(setId) || !UUID.test(cardId)) return notFound(req, res);
    void (async () => {
      const r = await db.execute<{ image_url: string | null }>(sql`
        SELECT image_url FROM playable_cards WHERE id = ${cardId} AND game_set_id = ${setId} LIMIT 1`);
      const url = r.rows?.[0]?.image_url;
      if (!url || !url.startsWith("https://")) return notFound(req, res);
      const upstream = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      const type = (upstream.headers.get("content-type") || "").split(";")[0].trim();
      if (!upstream.ok || !IMAGE_TYPES.test(type)) return notFound(req, res);
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length === 0 || body.length > MAX_SOURCE_BYTES) return notFound(req, res);
      headers(req, res);
      res.status(200);
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", body.length);
      res.setHeader("X-Card-Id", cardId);
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(body);
    })().catch(() => { if (!res.headersSent) notFound(req, res); });
  });
}
