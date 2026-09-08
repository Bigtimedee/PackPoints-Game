/**
 * Maker share Surface A — design asset hooks.
 *
 * v1 ships without Design polish. Swap tokens here (crop, cream, bar, grid)
 * without rewriting compose. Forbidden: stock fan `maker-set-1080.png`.
 */
export const MAKER_SHARE_ASSETS = {
  canvas: 1080,
  background: "#0b0f16",
  glow: "#1e3a5f",
  cream: "#F3E6C8",
  creamPortrait: "#E2D3B3",
  /** Solid black name-band on thumbs (Daily 5 language, v1 bar). */
  redactionBar: "#000000",
  redactionBandPct: 46,
  textPrimary: "#FFFFFF",
  textMuted: "#9CA3AF",
  textNote: "#C5CBD6",
  /** card = 2.5×3.5 trading-card crop; square optional later. */
  crop: "card" as "card" | "square",
  cardAspectW: 2.5,
  cardAspectH: 3.5,
  /** v1 compose uses a grid (fan/row tokens kept for Design). */
  layout: "grid" as "grid" | "fan" | "row",
  cardMin: 3,
  cardMax: 8,
  fonts: {
    primary: "Inter",
    fallback: "DejaVu Sans",
  },
  eyebrow: "I MADE THIS SET",
  stockFanAsset: "maker-set-1080.png",
  footerHost: "packpts.com/sets",
  /** Layout slots — Design can nudge without touching SVG builders. */
  headerY: 72,
  titleY: 124,
  noteY: 172,
  gridTop: 230,
  gridBottom: 860,
  gridInsetX: 56,
  gridGap: 16,
  footerY: 978,
  markX: 80,
  markY: 940,
} as const;

export type MakerShareAssets = typeof MAKER_SHARE_ASSETS;

export interface MakerShareSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Card-aspect (2.5:3.5) or square thumb size for a slot. */
export function makerThumbSize(
  maxW: number,
  maxH: number,
  crop: "card" | "square" = MAKER_SHARE_ASSETS.crop,
): { w: number; h: number } {
  if (crop === "square") {
    const s = Math.floor(Math.min(maxW, maxH));
    return { w: s, h: s };
  }
  const ratio = MAKER_SHARE_ASSETS.cardAspectW / MAKER_SHARE_ASSETS.cardAspectH;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/**
 * v1 card grid: 1 row for ≤4 cards, 2 rows for 5–8 (3+2, 3+3, 4+3, 4+4).
 * Prefer 3–8 thumbs. Positions are centered in the grid band.
 */
export function makerShareGridSlots(
  count: number,
  assets: MakerShareAssets = MAKER_SHARE_ASSETS,
): MakerShareSlot[] {
  const n = Math.max(0, Math.min(assets.cardMax, Math.floor(count)));
  if (n <= 0) return [];
  const areaX = assets.gridInsetX;
  const areaY = assets.gridTop;
  const areaW = assets.canvas - assets.gridInsetX * 2;
  const areaH = assets.gridBottom - assets.gridTop;
  const gap = assets.gridGap;
  const rows = n <= 4 ? 1 : 2;
  const topCount = rows === 1 ? n : Math.ceil(n / 2);
  const botCount = n - topCount;
  const rowH = rows === 1 ? areaH : (areaH - gap) / 2;

  const placeRow = (rowCount: number, y: number, maxH: number): MakerShareSlot[] => {
    const maxW = (areaW - gap * Math.max(0, rowCount - 1)) / rowCount;
    const { w, h } = makerThumbSize(maxW, maxH, assets.crop);
    const totalW = rowCount * w + Math.max(0, rowCount - 1) * gap;
    const startX = areaX + (areaW - totalW) / 2;
    const startY = y + (maxH - h) / 2;
    return Array.from({ length: rowCount }, (_, i) => ({
      x: Math.round(startX + i * (w + gap)),
      y: Math.round(startY),
      w,
      h,
    }));
  };

  if (rows === 1) return placeRow(topCount, areaY, rowH);
  return [
    ...placeRow(topCount, areaY, rowH),
    ...placeRow(botCount, areaY + rowH + gap, rowH),
  ];
}

export const MAKER_INPUT_IMAGE_FORMATS = ["jpeg", "jpg", "png", "webp"] as const;

export function isMakerShareRasterFormat(format: string | undefined): boolean {
  if (!format) return false;
  return (MAKER_INPUT_IMAGE_FORMATS as readonly string[]).includes(format.toLowerCase());
}
