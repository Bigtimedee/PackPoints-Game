/**
 * Deterministic source fixes for card scans that were refused for layout, not
 * for their content: scanner frames around 1988 Topps scans and 705x1200
 * vertically stretched 1986 Topps scans. Each entry pins the exact upstream
 * bytes (sha256) and a crop and/or resize. Applied only to the mask bake
 * source. If the upstream bytes change the override does not apply and the
 * bake gets null (fail closed: no bake, card stays refused).
 *
 * An override never approves a card. Re-baked cards stay held behind the card
 * review guard until Design approves them by eye.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";

export interface MaskSourceOverride {
  setId: string;
  number: string;
  player: string;
  inputSha256: string;
  extract?: { left: number; top: number; width: number; height: number };
  resize?: { width: number; height: number };
  why: string;
}

let cache: Record<string, MaskSourceOverride> | null = null;

export function maskSourceOverrides(): Record<string, MaskSourceOverride> {
  if (cache) return cache;
  try {
    const file = path.join(process.cwd(), "server", "data", "maskSourceOverrides.json");
    cache = JSON.parse(readFileSync(file, "utf8")) as Record<string, MaskSourceOverride>;
  } catch {
    cache = {};
  }
  return cache;
}

export function setMaskSourceOverridesForTests(next: Record<string, MaskSourceOverride> | null): void {
  cache = next;
}

/** Stable digest of the overrides for one set; part of the profile rebuild signature. */
export function maskSourceOverrideDigest(setId: string): string {
  const entries = Object.entries(maskSourceOverrides())
    .filter(([, o]) => o.setId === setId)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
}

export function hasMaskSourceOverride(cardId: string): boolean {
  return Boolean(maskSourceOverrides()[cardId]);
}

/**
 * Returns the fixed buffer, the raw buffer when the card has no override, or
 * null when an override exists but the upstream bytes no longer match.
 */
export async function applyMaskSourceOverride(cardId: string, raw: Buffer): Promise<Buffer | null> {
  const o = maskSourceOverrides()[cardId];
  if (!o) return raw;
  if (createHash("sha256").update(raw).digest("hex") !== o.inputSha256) {
    console.warn(`[MaskSourceOverride] card=${cardId} upstream changed; override not applied, bake refused`);
    return null;
  }
  let img = sharp(raw).rotate(0);
  if (o.extract) img = img.extract(o.extract);
  if (o.resize) img = img.resize(o.resize.width, o.resize.height, { fit: "fill", kernel: "lanczos3" });
  return img.jpeg({ quality: 95 }).toBuffer();
}
