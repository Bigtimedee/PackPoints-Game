/**
 * Public partner kit. Captions and the play link are always available.
 * Composite images stay unserved until their no-shop sha256 is in
 * server/assets/share/APPROVED.json. KIT_ASSET_GATE=frame is the unwired
 * alternative for feed and story. The default is strict.
 */
import type { Express, Request, Response } from "express";
import { getPackptsDayKey } from "@shared/packptsDay";
import {
  KIT_ASSET_KINDS,
  KIT_INDEX_SLUG,
  KIT_PAGE_DESCRIPTION,
  KIT_PAGE_LEAD,
  KIT_PAGE_TITLE,
  kitAssetGateFromEnv,
  kitCaptions,
  kitCompositeServable,
  kitPlayUrl,
  parseKitSlug,
  resolveKitShopName,
  type KitAssetKind,
} from "@shared/partnerKit";
import { applyNoStoreHeaders, sendNoStoreBody, stripConditionalValidators } from "../lib/noStoreResponse";
import { currentShareAllowlist } from "../services/partnerKitAllowlist";
import { PARTNER_SHOP_NAMES } from "../services/partnerKitPartners";
import { renderPartnerKitAsset, renderQrPng, renderQrSvg, sha256Hex } from "../services/partnerKitRender";

/** Internal only. The public page and API do not show this. */
export const KIT_ASSET_PENDING = "kit coming soon for this asset";

type KitCard = { cardId: string; bytes: Buffer };
type CardSource = (dayKey: string) => Promise<KitCard | null>;

let cardSourceOverride: CardSource | null = null;

export function setKitCardSourceForTests(next: CardSource | null): void {
  cardSourceOverride = next;
}

async function cardForDay(dayKey: string): Promise<KitCard | null> {
  if (cardSourceOverride) return cardSourceOverride(dayKey);
  const { loadKitMaskedCard } = await import("../services/partnerKitPool");
  return loadKitMaskedCard(dayKey);
}

export async function decideKitAsset(input: {
  kind: KitAssetKind;
  slug: string;
  shopName: string | null;
  dayKey: string;
}): Promise<{ serve: true; bytes: Buffer } | { serve: false; reason: typeof KIT_ASSET_PENDING }> {
  const gate = kitAssetGateFromEnv(process.env.KIT_ASSET_GATE);
  const allow = currentShareAllowlist();
  const needsCard = input.kind === "feed" || input.kind === "story";
  if (!needsCard && allow.size === 0) return { serve: false, reason: KIT_ASSET_PENDING };
  if (needsCard && gate === "strict" && allow.size === 0) return { serve: false, reason: KIT_ASSET_PENDING };

  let card: Buffer | null = null;
  if (needsCard) {
    const loaded = await cardForDay(input.dayKey);
    if (!loaded) return { serve: false, reason: KIT_ASSET_PENDING };
    card = loaded.bytes;
  }
  const rendered = await renderPartnerKitAsset({
    kind: input.kind,
    slug: input.slug,
    shopName: input.shopName,
    card,
    qrUrl: kitPlayUrl(input.slug, "qr"),
  });
  const hash = sha256Hex(rendered.base);
  if (!kitCompositeServable(input.kind, gate, hash, allow)) return { serve: false, reason: KIT_ASSET_PENDING };
  return { serve: true, bytes: rendered.bytes };
}

function shopFrom(req: Request, slug: string): string | null {
  const raw = typeof req.query.shop === "string" ? req.query.shop : null;
  return resolveKitShopName(slug, raw, PARTNER_SHOP_NAMES);
}

function sendPng(req: Request, res: Response, body: Buffer): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.status(200);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", body.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("X-Robots-Tag", "noindex");
  res.removeHeader("X-Card-Id");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function notFound(req: Request, res: Response): void {
  sendNoStoreBody(req, res, JSON.stringify({ error: "Not found" }), "application/json; charset=utf-8", 404);
}

export function registerPartnerKitRoutes(app: Express): void {
  app.get("/api/kit/meta/:slug", (req, res) => {
    const slug = parseKitSlug(req.params.slug);
    if (!slug) {
      notFound(req, res);
      return;
    }
    const shopName = shopFrom(req, slug);
    const day = getPackptsDayKey();
    const captions = kitCaptions(day, shopName);
    sendNoStoreBody(req, res, JSON.stringify({
      slug,
      shopName,
      day,
      title: KIT_PAGE_TITLE,
      lead: KIT_PAGE_LEAD,
      description: KIT_PAGE_DESCRIPTION,
      captions,
      links: {
        qr: kitPlayUrl(slug, "qr"),
        copy: kitPlayUrl(slug, "link"),
      },
      qr: {
        png: `/api/kit/qr.png?slug=${encodeURIComponent(slug)}`,
        svg: `/api/kit/qr.svg?slug=${encodeURIComponent(slug)}`,
      },
    }), "application/json; charset=utf-8");
  });

  app.get("/api/kit/qr.png", async (req, res) => {
    const slug = parseKitSlug(typeof req.query.slug === "string" ? req.query.slug : "");
    if (!slug) {
      notFound(req, res);
      return;
    }
    try {
      sendPng(req, res, await renderQrPng(kitPlayUrl(slug, "qr"), 512));
    } catch {
      if (!res.headersSent) notFound(req, res);
    }
  });

  app.get("/api/kit/qr.svg", (req, res) => {
    const slug = parseKitSlug(typeof req.query.slug === "string" ? req.query.slug : "");
    if (!slug) {
      notFound(req, res);
      return;
    }
    const svg = renderQrSvg(kitPlayUrl(slug, "qr"));
    stripConditionalValidators(req);
    applyNoStoreHeaders(res);
    res.status(200);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Content-Length", Buffer.byteLength(svg));
    res.end(svg);
  });

  app.get("/api/kit/asset/:kind", (req, res) => {
    const kind = req.params.kind;
    if (!KIT_ASSET_KINDS.includes(kind as KitAssetKind)) {
      notFound(req, res);
      return;
    }
    const slug = parseKitSlug(typeof req.query.slug === "string" ? req.query.slug : KIT_INDEX_SLUG);
    if (!slug) {
      notFound(req, res);
      return;
    }
    void decideKitAsset({
      kind: kind as KitAssetKind,
      slug,
      shopName: shopFrom(req, slug),
      dayKey: getPackptsDayKey(),
    }).then((decision) => {
      if (res.headersSent) return;
      if (!decision.serve) {
        notFound(req, res);
        return;
      }
      sendPng(req, res, decision.bytes);
    }).catch(() => {
      if (!res.headersSent) notFound(req, res);
    });
  });
}
