/**
 * Pre-bake the next 7 CT days of no-shop partner kit composites.
 * Usage: npx tsx scripts/bake-partner-kit.ts [--slug kit] [--days 7] [--out server/assets/share/bake-out]
 */
import path from "path";
import { getPackptsDayKey } from "@shared/packptsDay";
import { bakePartnerKit } from "../server/services/partnerKitBake";
import { loadKitMaskedCard } from "../server/services/partnerKitPool";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

const slug = arg("--slug", "kit");
const days = Number(arg("--days", "7"));
const outDir = path.resolve(arg("--out", "server/assets/share/bake-out"));
const startDay = getPackptsDayKey();

const manifest = await bakePartnerKit({
  startDay,
  days: Number.isFinite(days) ? days : 7,
  slug,
  outDir,
  cardForDay: (day) => loadKitMaskedCard(day),
});

const hashes = new Set(manifest.days.flatMap((day) => day.assets.map((asset) => asset.sha256)));
console.log(`[partner-kit] days=${manifest.days.length} hashes=${hashes.size} out=${outDir}`);
