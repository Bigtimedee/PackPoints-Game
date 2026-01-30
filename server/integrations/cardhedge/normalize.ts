import type { CardSearchCard } from "../../../shared/cardhedge/types";

export function normalizeImageUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  
  let normalized = url.trim();
  
  // Reject obviously invalid URL strings
  if (normalized === "null" || normalized === "undefined" || normalized === "") {
    return "";
  }
  
  // Handle protocol-relative URLs
  if (normalized.startsWith("//")) {
    normalized = "https:" + normalized;
  }
  
  // Upgrade http:// to https:// for better security and consistency
  if (normalized.startsWith("http://")) {
    normalized = "https://" + normalized.slice(7);
  }
  
  // Must start with https:// and have a valid host (more than just the protocol)
  if (!normalized.startsWith("https://")) {
    return "";
  }
  
  // Reject malformed URLs like "https:null", "https://null", "https://"
  const afterProtocol = normalized.slice(8); // Remove "https://"
  if (!afterProtocol || afterProtocol === "null" || afterProtocol.length === 0) {
    return "";
  }
  
  return normalized;
}

export function pickCardFields(raw: Record<string, unknown>): CardSearchCard {
  const rookieValue = raw.rookie;
  let rookie = false;
  if (rookieValue === true || rookieValue === "Rookie" || rookieValue === "true") {
    rookie = true;
  }

  return {
    card_id: String(raw.card_id || raw.product_id || ""),
    category: String(raw.category || ""),
    category_group: raw.category_group ? String(raw.category_group) : undefined,
    description: String(raw.description || ""),
    player: String(raw.player || ""),
    set: String(raw.set || ""),
    set_type: raw.set_type ? String(raw.set_type) : undefined,
    number: raw.number ? String(raw.number) : undefined,
    variant: raw.variant ? String(raw.variant) : undefined,
    rookie,
    image: normalizeImageUrl(raw.image as string),
    sales_7day: parseNumber(raw["7 Day Sales"] ?? raw.sales_7day),
    sales_30day: parseNumber(raw["30 Day Sales"] ?? raw.sales_30day),
    gain: parseNumber(raw.gain),
    gain_30day: parseNumber(raw.gain_30day),
  };
}

function parseNumber(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
}

const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /example/i,
  /appforest_uf\/example/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /silhouette/i,
  /generic[-_]?card/i,
  /coming[-_]?soon/i,
  /not[-_]?available/i,
  /fallback/i,
  /blank[-_]?card/i,
  /unavailable/i,
  /stock[-_]?photo/i,
  /template/i,
  // Generic sport placeholders from Card Hedge
  /\d{2}-Baseball\.jpg$/i,
  /\d{2}-Football\.jpg$/i,
  /\d{2}-Basketball\.jpg$/i,
  /\d{2}-Hockey\.jpg$/i,
  // Sport silhouette images (common Card Hedge patterns)
  /basketball[-_]?silhouette/i,
  /football[-_]?silhouette/i,
  /baseball[-_]?silhouette/i,
  /player[-_]?silhouette/i,
  /generic[-_]?player/i,
  /default[-_]?card/i,
  // Card Hedge specific patterns for missing images
  /appforest_uf.*silhouette/i,
  /appforest_uf.*default/i,
  /appforest_uf.*placeholder/i,
];

export function isLikelyPlaceholderImage(card: CardSearchCard): boolean {
  if (!card.image || card.image === "") {
    return true;
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(card.image)) {
      return true;
    }
  }

  if (card.description && /illustration/i.test(card.description)) {
    return true;
  }

  return false;
}

export function filterPlaceholderCards(cards: CardSearchCard[]): CardSearchCard[] {
  return cards.filter(card => !isLikelyPlaceholderImage(card));
}

export function normalizeBase64(input: string): string {
  if (!input) return "";
  
  const prefixMatch = input.match(/^data:image\/[^;]+;base64,/);
  if (prefixMatch) {
    return input.slice(prefixMatch[0].length);
  }
  
  return input;
}

export function approxBytesFromBase64(b64: string): number {
  const normalized = normalizeBase64(b64);
  const padding = (normalized.match(/=+$/) || [""])[0].length;
  return Math.floor((normalized.length * 3) / 4) - padding;
}
