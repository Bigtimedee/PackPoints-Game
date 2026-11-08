/**
 * Canonical integrated-set identity.
 * Sport, year, brand, and product must all match. Substring overlap is not a match:
 * 1986 Topps Traded is a different product from 1986 Topps Baseball.
 * Case, hyphens, and Upper Deck aliases normalize. User-created rows are ignored.
 */
import { createHash } from "crypto";

export interface IdentityRow {
  id: string;
  sport: string;
  year: number;
  brand: string;
  setName: string;
  isActive: boolean;
  isUserCreated: boolean;
  cards: number;
}

const BRANDS = ["upper deck", "donruss", "fleer", "topps"] as const;

export function squashName(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bupperdeck\b/g, "upper deck")
    .replace(/\bud\b/g, "upper deck");
}

export function canonicalSport(value: string | null | undefined): string {
  const sport = squashName(value);
  if (sport === "baseball" || sport === "mlb") return "baseball";
  return sport;
}

function splitBrand(value: string): { brand: string; extra: string } {
  const text = squashName(value);
  for (const brand of BRANDS) {
    if (text === brand) return { brand, extra: "" };
    if (text.startsWith(`${brand} `)) return { brand, extra: text.slice(brand.length).trim() };
  }
  return { brand: text, extra: "" };
}

/** `base` is the flagship. Anything left after year, brand, and sport is a different product. */
export function canonicalProduct(input: { year: number; brand: string; setName: string }): { brand: string; product: string } | null {
  const fromBrand = splitBrand(input.brand);
  const fromName = splitBrand(input.setName);
  const brand = fromBrand.brand || fromName.brand;
  if (!brand) return null;
  let rest = `${fromBrand.extra} ${fromName.extra} ${squashName(input.setName)}`;
  rest = rest.replace(new RegExp(`\\b${input.year}\\b`, "g"), " ");
  rest = rest.replace(new RegExp(`\\b${brand.replace(/ /g, "\\s+")}\\b`, "g"), " ");
  rest = rest.replace(/\b(baseball|mlb|base)\b/g, " ");
  const tokens = rest.split(" ").map((token) => token.trim()).filter(Boolean);
  const product = [...new Set(tokens)].sort().join(" ");
  return { brand, product: product || "base" };
}

/** Null when this row is not a baseball integrated identity. */
export function canonicalSetKey(input: { sport: string; year: number; brand: string; setName: string }): string | null {
  if (canonicalSport(input.sport) !== "baseball") return null;
  if (!Number.isInteger(input.year)) return null;
  const product = canonicalProduct(input);
  if (!product) return null;
  return `baseball|${input.year}|${product.brand}|${product.product}`;
}

export function collidingIdentities(
  target: { sport: string; year: number; brand: string; setName: string },
  rows: readonly IdentityRow[],
  proposedId: string,
): IdentityRow[] {
  const key = canonicalSetKey(target);
  if (!key) return [];
  const proposed = proposedId.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.id.trim().toLowerCase() === proposed) return false;
    if (row.isUserCreated) return false;
    return canonicalSetKey(row) === key;
  });
}

/** Sorted id membership. Same count with different ids does not match. */
export function canonicalMembership(ids: readonly string[]): { ids: string[]; hash: string; count: number } {
  const sorted = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))].sort();
  const hash = createHash("sha256").update(sorted.join("\n")).digest("hex");
  return { ids: sorted, hash, count: sorted.length };
}

export function membershipMatches(
  stored: { ids: readonly string[]; hash: string },
  incoming: { ids: readonly string[]; hash: string },
): boolean {
  if (stored.hash !== incoming.hash || stored.ids.length !== incoming.ids.length) return false;
  return stored.ids.every((id, index) => id === incoming.ids[index]);
}

/** Hash of id plus source url plus mask revision. The url itself is not returned. */
export function sourceWitness(rows: readonly { id: string; sourceUrl: string }[], maskVersion: string): string {
  const lines = [...rows]
    .map((row) => `${row.id.trim().toLowerCase()}|${maskVersion}|${createHash("sha256").update(row.sourceUrl).digest("hex")}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
