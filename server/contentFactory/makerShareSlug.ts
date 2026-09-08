/**
 * Pure helpers for maker-share URLs and the public volume gate.
 * Kept free of sharp/db so routes and tests can import them cheaply.
 */

export const MAKER_SHARE_VOLUME_GATE = 10;
export const STOCK_FAN_ASSET = "maker-set-1080.png";
export const WHO_IS_THIS_PLAYER = "WHO IS THIS PLAYER?";
export const CREAM_SILHOUETTE = "#F3E6C8";
export const MAKER_SHARE_MIN_STACK = 3;
export const MAKER_SHARE_MAX_STACK = 8;

export function setShareSlug(setName: string, setId: string): string {
  const kebab = (setName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const idPart = setId.replace(/-/g, "").slice(0, 8).toLowerCase();
  return kebab ? `${kebab}-${idPart}` : idPart;
}

export function makerShareFooterUrl(setName: string, setId: string): string {
  return `packpts.com/sets/${setShareSlug(setName, setId)}`;
}

/** Last 8 hex chars of a share slug (`name-a1b2c3d4`) → uuid prefix without dashes. */
export function setIdPrefixFromShareSlug(slug: string): string | null {
  const match = slug.toLowerCase().match(/-([a-f0-9]{8})$/);
  return match?.[1] ?? null;
}

export function clampMakerStackCount(cardCount: number): number {
  const n = Number.isFinite(cardCount) ? Math.floor(cardCount) : 0;
  if (n <= 0) return 0;
  return Math.min(MAKER_SHARE_MAX_STACK, Math.max(n, 0));
}

export function setsMadeLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return n === 1 ? "1 set made" : `${n} sets made`;
}
