/**
 * Build the 16 link-preview PNGs (1200x630).
 *
 * Set art is the public cover slot 0 for that set: a baked mask from the set's
 * registered profile. The cover route already drops blocklisted cards, including
 * jersey-back name leaks. Files are named by set id or page slug. Nothing here
 * writes server/assets/share/APPROVED.json.
 *
 * Usage: npx tsx scripts/render-share-previews.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { getMaskProfile, profileIsRegistered } from "../server/masking/maskProfiles";
import { renderSharePreviewPng, setYearLabel } from "../server/contentFactory/renderSharePreview";
import {
  SET_SHARE_PAGES,
  STATIC_SHARE_PAGES,
  shareImagePublicPath,
} from "../shared/sharePreview";

const OUT = path.join(process.cwd(), "client", "public", "og", "share");

async function coverJpeg(setId: string): Promise<Buffer> {
  const url = `https://packpts.com/api/sets/${setId}/covers/0`;
  const res = await fetch(url, { headers: { "user-agent": "packpts-share-preview" } });
  if (!res.ok) throw new Error(`cover ${setId} ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error(`cover ${setId} not an image`);
  if (!res.headers.get("x-mask-version")) throw new Error(`cover ${setId} missing mask version`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const covers = new Map<string, Buffer>();
  for (const set of SET_SHARE_PAGES) {
    const profile = getMaskProfile(set.setName, set.setId);
    if (!profileIsRegistered(profile, set.setId)) {
      throw new Error(`no registered mask profile for ${set.setId}`);
    }
    covers.set(set.setId, await coverJpeg(set.setId));
    const png = await renderSharePreviewPng({
      kind: "set",
      eyebrow: setYearLabel(set.setName, set.year),
      title: set.setName,
      line: "Name the player.",
      footer: `packpts.com${set.pagePath}`,
      cardJpeg: covers.get(set.setId),
    });
    const dest = path.join(OUT, set.file);
    writeFileSync(dest, png);
    console.log(set.pagePath, shareImagePublicPath(set.file), profile.id);
  }
  for (const page of STATIC_SHARE_PAGES) {
    const card = covers.get(page.cardSetId);
    if (!card) throw new Error(`missing card for ${page.pagePath}`);
    const png = await renderSharePreviewPng({
      kind: "static",
      eyebrow: "PACKPTS",
      title: page.shareTitle.replace(" | PackPTS", ""),
      line: page.pagePath === "/points"
        ? "Earn points for eBay rebates."
        : page.pagePath === "/about"
          ? "Built by collectors."
          : page.pagePath === "/how-to-play"
            ? "Name the player."
            : "Real cards. Names masked.",
      footer: `packpts.com${page.pagePath}`,
      cardJpeg: card,
    });
    writeFileSync(path.join(OUT, page.file), png);
    console.log(page.pagePath, shareImagePublicPath(page.file));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
