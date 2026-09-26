/**
 * In-memory drawings of a stored refusal. Nothing here is written under the
 * masked-card directory or inserted into card_image_mask_cache.
 */
import sharp from "sharp";
import type { MaskPlateBox } from "@shared/maskRefusal";
import type { MaskRegion } from "@shared/schema";
import { applyPercentRegions } from "./maskCardImage";
import type { StoredRefusalImage } from "./maskRefusalLog";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rect(box: MaskPlateBox, stroke: string, label: string): string {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const textY = Math.max(12, y + 14);
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="3"/>`,
    `<text x="${x + 4}" y="${textY}" fill="${stroke}" font-size="12" font-family="sans-serif">${escapeXml(label)}</text>`,
  ].join("");
}

export async function renderRefusalDebugPng(row: StoredRefusalImage): Promise<Buffer> {
  const meta = await sharp(row.sourceImage).metadata();
  const width = meta.width || row.imageWidth || 1;
  const height = meta.height || row.imageHeight || 1;
  const parts: string[] = [];
  if (row.expectedPlate) parts.push(rect(row.expectedPlate, "#f5c518", "expected"));
  for (const candidate of row.candidates) {
    if (!candidate.box) continue;
    if (candidate.id === "expected_profile") continue;
    const label = candidate.accepted ? candidate.id : `${candidate.id} fail`;
    parts.push(rect(candidate.box, "#22d3ee", label));
  }
  for (const word of row.ocrBoxes) {
    const conf = word.confidence == null ? "" : ` ${word.confidence}`;
    parts.push(rect(word, "#e879f9", `${word.text}${conf}`));
  }
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`,
  );
  return sharp(row.sourceImage)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** What v4.6 would have painted if the plate box on this refusal had been accepted. */
export async function renderRefusalAttemptPng(
  sourceImage: Buffer,
  paintRegions: MaskRegion[],
): Promise<Buffer> {
  const painted = await applyPercentRegions(sourceImage, paintRegions);
  return sharp(painted).png().toBuffer();
}
