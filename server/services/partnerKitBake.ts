/**
 * Renders the next CT days of no-shop kit composites and writes a hash manifest
 * for Design. Serving stays off until those hashes are listed in APPROVED.json.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { addPackptsDays } from "@shared/packptsDay";
import { KIT_ASSET_KINDS, kitPlayUrl, parseKitSlug, type KitAssetKind } from "@shared/partnerKit";
import { renderPartnerKitAsset, sha256Hex } from "./partnerKitRender";

export type KitBakeAsset = {
  template: KitAssetKind;
  sha256: string;
  file: string;
  width: number;
  height: number;
};

export type KitBakeManifest = {
  created: string;
  status: string;
  slug: string;
  days: Array<{
    day: string;
    cardId: string | null;
    assets: KitBakeAsset[];
    skipped: string[];
  }>;
};

const SIZES: Record<KitAssetKind, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  results: { width: 1080, height: 1080 },
  qrsheet: { width: 2550, height: 3300 },
};

export async function bakePartnerKit(opts: {
  startDay: string;
  days: number;
  slug: string;
  outDir: string;
  now?: Date;
  cardForDay: (day: string) => Promise<{ cardId: string; bytes: Buffer } | null>;
}): Promise<KitBakeManifest> {
  const slug = parseKitSlug(opts.slug);
  if (!slug) throw new Error("bad kit slug");
  const count = Math.max(1, Math.min(14, Math.floor(opts.days)));
  mkdirSync(opts.outDir, { recursive: true });
  const qrUrl = kitPlayUrl(slug, "qr");
  const days: KitBakeManifest["days"] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addPackptsDays(opts.startDay, i);
    const card = await opts.cardForDay(day);
    const dir = path.join(opts.outDir, day);
    mkdirSync(dir, { recursive: true });
    const assets: KitBakeAsset[] = [];
    const skipped: string[] = [];
    for (const template of KIT_ASSET_KINDS) {
      if ((template === "feed" || template === "story") && !card) {
        skipped.push(template);
        continue;
      }
      const rendered = await renderPartnerKitAsset({
        kind: template,
        slug,
        shopName: null,
        card: card?.bytes ?? null,
        qrUrl,
      });
      const name = `${template}.png`;
      writeFileSync(path.join(dir, name), rendered.base);
      assets.push({
        template,
        sha256: sha256Hex(rendered.base),
        file: `${day}/${name}`,
        width: SIZES[template].width,
        height: SIZES[template].height,
      });
    }
    days.push({ day, cardId: card?.cardId ?? null, assets, skipped });
  }
  const manifest: KitBakeManifest = {
    created: (opts.now ?? new Date()).toISOString(),
    status: "Hashes for Design. Not served until listed in server/assets/share/APPROVED.json.",
    slug,
    days,
  };
  writeFileSync(path.join(opts.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
