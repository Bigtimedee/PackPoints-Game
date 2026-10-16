/**
 * Public /sets cover URLs. A cover is a baked masked JPEG slot, never a card id.
 */
const MASKED_SET_COVER = /^\/api\/sets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/covers\/([0-7])$/i;

export const SET_COVER_SLOT_COUNT = 8;

export function maskedSetCoverUrl(setId: string, slot: number): string {
  return `/api/sets/${setId}/covers/${slot}`;
}

/** Responsive webp widths for /sets covers (?w=). Downscales of the baked masked JPEG only. */
export const SET_COVER_WIDTHS = [120, 180, 240, 320] as const;

/** Short public version of a cover slot: a hash prefix, never a card id. */
export function setCoverVersionFromEtag(etag: string): string {
  return etag.replace(/"/g, "").slice(0, 12);
}

/** Variant URL: masked cover slot, resized webp, versioned so it can be cached for a year. */
export function setCoverVariantUrl(base: string, width: number, version?: string): string {
  return `${base}?w=${width}&f=webp${version && /^[0-9a-f]{12}$/.test(version) ? `&v=${version}` : ""}`;
}

export function setCoverSrcSet(base: string, version?: string): string {
  return SET_COVER_WIDTHS.map((w) => `${setCoverVariantUrl(base, w, version)} ${w}w`).join(", ");
}

/** Rendered fan thumbs are about 20% of the row: ~72px on a phone, ~135px on desktop. */
export const SET_COVER_SIZES = "(max-width: 640px) 22vw, 140px";

export function isMaskedSetCoverUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return MASKED_SET_COVER.test(value.trim());
}

/** Raw scans and routes that can return an unmasked card. */
export function isExposedCardPhotoUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("bubble.io") ||
    lower.includes("/api/images/card") ||
    lower.includes("/api/cards/") ||
    lower.includes("/api/play/r/")
  );
}

/** Surface A share crop. Stock fan and raw card photos are not a public cover. */
export function publicSetShareUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase().includes("maker-set-1080.png")) return undefined;
  if (isExposedCardPhotoUrl(trimmed)) return undefined;
  if (
    !(
      trimmed.startsWith("/") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://")
    )
  ) {
    return undefined;
  }
  return trimmed;
}
