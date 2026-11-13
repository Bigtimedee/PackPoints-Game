/**
 * Public partner kit copy, links, and layout. No card names and no tagged URLs
 * inside captions. The play link is only the QR target and the copy button.
 */

export const KIT_ORIGIN = "https://packpts.com";
export const KIT_SLUG_MAX = 40;
export const KIT_SHOP_NAME_MAX = 24;
export const KIT_INDEX_SLUG = "kit";

/** One character, or a longer slug that starts and ends with a letter or digit. */
export const KIT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const KIT_COLORS = {
  bg: "#0B0F16",
  bar: "#0A0C12",
  ink: "#FFFFFF",
  gold: "#F5C518",
} as const;

export const KIT_PAGE_TITLE = "Partner kit";
export const KIT_PAGE_LEAD = "A masked card, plus thousands more to play free.";
export const KIT_PAGE_DESCRIPTION = "A masked card, plus thousands more to play free at PackPTS.";

export const FEED_CAPTIONS = [
  "Who is it? Drop your guess below. Thousands more masked cards to play free at PackPTS.",
  "Masked card, one name. Think you know your vintage? Tell us who it is.",
  "Pulled this one from the archives. Name the player, then play thousands more free.",
] as const;

export const STORY_CAPTION = "Who is it? Tap to play free.";
export const RESULTS_CAPTION = "Today's Daily 5 is in. How many did you get?";
export const STORY_BAKED_LINE = "Play free at packpts.com";

export const KIT_ASSET_KINDS = ["feed", "story", "results", "qrsheet"] as const;
export type KitAssetKind = (typeof KIT_ASSET_KINDS)[number];

export const KIT_FEED = { width: 1080, height: 1350, slot: { x: 257, y: 390, w: 565, h: 780 }, lockup: { y: 1200, h: 120 } } as const;
export const KIT_STORY = { width: 1080, height: 1920, slot: { x: 221, y: 640, w: 637, h: 880 }, lockup: { y: 1560, h: 120 } } as const;
export const KIT_RESULTS = { width: 1080, height: 1080, lockup: { y: 40, h: 100 } } as const;
export const KIT_QRSHEET = {
  width: 2550,
  height: 3300,
  qr: { x: 675, y: 900, size: 1200 },
  quietModules: 4,
} as const;

export type KitAssetGate = "strict" | "frame";

export function parseKitSlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().toLowerCase();
  if (!KIT_SLUG_RE.test(slug)) return null;
  return slug;
}

export function kitPlayUrl(slug: string, medium: "qr" | "link"): string {
  const safe = parseKitSlug(slug);
  if (!safe) throw new Error("bad kit slug");
  return `${KIT_ORIGIN}/?utm_source=kit&utm_medium=${medium}&utm_campaign=shop_${safe}`;
}

export function feedCaptionForDay(dayKey: string): string {
  const parts = dayKey.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return FEED_CAPTIONS[0];
  const [year, month, day] = parts;
  const utcDays = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const index = ((utcDays % FEED_CAPTIONS.length) + FEED_CAPTIONS.length) % FEED_CAPTIONS.length;
  return FEED_CAPTIONS[index];
}

export function sanitizeShopName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>$%]/g, " ")
    .replace(/[\u2013\u2014]/g, " ")
    .replace(/[^\p{L}\p{N} '&.,-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const sliced = [...cleaned].slice(0, KIT_SHOP_NAME_MAX).join("").trim();
  return sliced || null;
}

export function shopLine(shopName: string): string {
  return `${shopName} x PackPTS. Stop by and tell us your guess.`;
}

export function resolveKitShopName(
  slug: string,
  query: string | null | undefined,
  map: Readonly<Record<string, string>>,
): string | null {
  const fromQuery = sanitizeShopName(query);
  if (fromQuery) return fromQuery;
  return sanitizeShopName(map[slug] ?? null);
}

export type KitCaptions = {
  feed: string;
  story: string;
  results: string;
  shop: string | null;
};

export function kitCaptions(dayKey: string, shopName: string | null): KitCaptions {
  return {
    feed: feedCaptionForDay(dayKey),
    story: STORY_CAPTION,
    results: RESULTS_CAPTION,
    shop: shopName ? shopLine(shopName) : null,
  };
}

/** Strings the page and captions may show. The tagged play link is not in here. */
export function kitPublicCopy(dayKey: string, shopName: string | null): string {
  const captions = kitCaptions(dayKey, shopName);
  return [
    KIT_PAGE_TITLE,
    KIT_PAGE_LEAD,
    KIT_PAGE_DESCRIPTION,
    captions.feed,
    captions.story,
    captions.results,
    captions.shop ?? "",
    STORY_BAKED_LINE,
    "Copy caption",
    "Copy link",
    "Download PNG",
    "Download SVG",
    "Feed caption",
    "Story",
    "Results",
    "Play link",
    "QR code",
  ].join("\n");
}

export const KIT_FORBIDDEN_PHRASES = ["today's card", "a new card every day"] as const;

export function kitCopyProblem(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of KIT_FORBIDDEN_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  if (text.includes("\u2013") || text.includes("\u2014")) return "dash";
  if (/utm_source=email/i.test(text)) return "email-utm";
  if (lower.includes("coming soon")) return "coming-soon";
  if (text.includes("$") || text.includes("%")) return "money";
  if (/\bcommission\b/i.test(text)) return "commission";
  return null;
}

export type LockupPart = { text: string; fill: "ink" | "gold" };

export type ShopLockup = {
  wrapped: boolean;
  size: number;
  parts: LockupPart[];
};

/**
 * One line when it fits. The QR sheet wraps to two lines when the one-liner
 * is wider than the limit. Shop name stays ink. "x PackPTS" stays gold.
 */
export function shopLockup(
  shop: string,
  measure: (text: string, size: number) => number,
  opts: { startSize: number; limit: number; wrap?: boolean; wrapSize?: number; minSize?: number },
): ShopLockup {
  const min = opts.minSize ?? 16;
  const one = `${shop} x PackPTS`;
  if (opts.wrap && measure(one, opts.startSize) > opts.limit) {
    let size = opts.wrapSize ?? opts.startSize;
    while (size > min && measure(shop, size) > opts.limit) size -= 2;
    return {
      wrapped: true,
      size,
      parts: [
        { text: shop, fill: "ink" },
        { text: "x PackPTS", fill: "gold" },
      ],
    };
  }
  let size = opts.startSize;
  while (size > min && measure(`${shop} x PackPTS`, size) > opts.limit) size -= 2;
  return {
    wrapped: false,
    size,
    parts: [
      { text: `${shop} `, fill: "ink" },
      { text: "x PackPTS", fill: "gold" },
    ],
  };
}

export function kitAssetGateFromEnv(value: string | undefined): KitAssetGate {
  return value === "frame" ? "frame" : "strict";
}

/** Feed and story may skip the hash only in frame mode. Results and the QR sheet stay on the hash. */
export function kitCompositeServable(kind: KitAssetKind, gate: KitAssetGate, baseHash: string, allowlist: ReadonlySet<string>): boolean {
  if ((kind === "feed" || kind === "story") && gate === "frame") return true;
  return allowlist.has(baseHash);
}

export function pickKitCardId(dayKey: string, ids: readonly string[]): string | null {
  const pool = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))].sort();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || pool.length === 0) return null;
  const index = kitDayHash(dayKey) % pool.length;
  return pool[index];
}

export function kitDayHash(dayKey: string): number {
  let h = 2166136261;
  const text = `packpts-partner-kit|${dayKey}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type KitCardRef = { id: string; setId: string };

export function eligibleKitCardIds(input: {
  cards: readonly KitCardRef[];
  clearedSetIds: ReadonlySet<string>;
  heldSetIds: ReadonlySet<string>;
  daily5CardIds: ReadonlySet<string>;
  coverCardIds: ReadonlySet<string>;
  maskedCardIds: ReadonlySet<string>;
}): string[] {
  const cleared = new Set([...input.clearedSetIds].map((id) => id.toLowerCase()));
  const held = new Set([...input.heldSetIds].map((id) => id.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const card of input.cards) {
    const setId = card.setId.trim().toLowerCase();
    if (!cleared.has(setId)) continue;
    if (held.has(setId)) continue;
    if (input.daily5CardIds.has(card.id) || input.coverCardIds.has(card.id)) continue;
    if (!input.maskedCardIds.has(card.id)) continue;
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card.id);
  }
  return out;
}
