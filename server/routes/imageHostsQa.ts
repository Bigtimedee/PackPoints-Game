/**
 * GET /api/qa/image-hosts: playable_cards counted by image host, with the
 * third-party photo hosts (PSA, Beckett, eBay) flagged. Read-only. Same QA
 * token as /api/qa/signups (header X-QA-Token).
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";

function send(req: Request, res: Response, status: number, payload: unknown): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).json(payload);
}

export function registerImageHostsQaRoute(app: Express): void {
  app.get("/api/qa/image-hosts", (req, res) => {
    if (!(coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token")))) return send(req, res, 401, { error: "Unauthorized" });
    void (async () => {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const { eligibleDealFilter } = await import("../services/playableSetEligibility");
      const { THIRD_PARTY_PHOTO_HOSTS } = await import("../services/cards/imageQuality");
      const host = sql.raw(`lower(substring(playable_cards.image_url from '^https?://([^/:?#]+)'))`);
      const rows = (await db.execute(sql`
        SELECT ${host} AS host, count(*)::int AS cards,
          count(*) FILTER (WHERE playable_cards.is_playable)::int AS playable,
          count(*) FILTER (WHERE ${eligibleDealFilter("playable_cards")})::int AS dealable
        FROM playable_cards GROUP BY 1 ORDER BY 2 DESC`)).rows as any[];
      const third = (h: string | null) => !!h && THIRD_PARTY_PHOTO_HOSTS.some((t) => h === t || h.endsWith("." + t));
      const byHost = rows.map((r) => ({ host: r.host, cards: Number(r.cards), playable: Number(r.playable), dealable: Number(r.dealable), thirdPartyPhotoHost: third(r.host) }));
      const sum = (k: "cards" | "playable" | "dealable") => byHost.filter((r) => r.thirdPartyPhotoHost).reduce((a, r) => a + r[k], 0);
      send(req, res, 200, { generatedAt: new Date().toISOString(), thirdPartyHosts: THIRD_PARTY_PHOTO_HOSTS, thirdPartyTotals: { cards: sum("cards"), playable: sum("playable"), dealable: sum("dealable") }, byHost });
    })().catch((err) => {
      console.error("[qa/image-hosts] failed", err?.code || err?.message);
      if (!res.headersSent) send(req, res, 500, { error: "Failed" });
    });
  });
}
