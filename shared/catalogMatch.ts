/**
 * Snap-to-Set catalog match — pure, read-only.
 * User media never becomes a playable card or a user set.
 * Integrated sets only: active game sets that are not user-created.
 */

export const CATALOG_MATCH_MIN_SCORE = 4;
export const CATALOG_MATCH_WIN_GAP = 3;
export const CATALOG_MATCH_MAX_SETS = 5;

export const USER_SET_PUBLISH_CLOSED = {
  status: 410 as const,
  error: "Publishing a set from a photo is closed. Play a set already in PackPTS.",
};

export type MatchStatus = "matched" | "ambiguous" | "none";

export type IdentifyFields = {
  playerName: string;
  year: number;
  brand: string;
  setName: string;
  sport?: string;
  cardNumber?: string | null;
};

export type CatalogCardRow = {
  id: string;
  player: string | null;
  year: number | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
};

export type IntegratedMembership = {
  setId: string;
  setName: string;
  year: number;
  brand: string;
  isUserCreated: boolean;
  isActive: boolean;
  cardCount: number;
  player: string | null;
  cardNumber: string | null;
  cardSet: string | null;
};

export type CatalogCandidate = {
  catalogCardId: string;
  playerName: string;
  year: number | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  label: string;
};

export type CatalogMatchSetCore = {
  id: string;
  name: string;
  cardCount: number;
  tease: string;
};

export type CatalogMatchSet = CatalogMatchSetCore & {
  slug: string;
};

export type CatalogMatchCard = {
  playerName: string;
  year: number | null;
  brand: string | null;
  setName: string | null;
  label: string;
};

export type CatalogMatchCore = {
  catalogCardId: string | null;
  candidates: CatalogCandidate[];
  card: CatalogMatchCard | null;
  match: {
    status: MatchStatus;
    sets: CatalogMatchSetCore[];
  };
};

export type CatalogMatchResponse = {
  confidence: "high" | "medium" | "low" | null;
  catalogCardId: string | null;
  candidates: CatalogCandidate[];
  card: CatalogMatchCard | null;
  match: {
    status: MatchStatus;
    sets: CatalogMatchSet[];
  };
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const SET_STOP = new Set([
  "the",
  "a",
  "of",
  "and",
  "base",
  "baseball",
  "basketball",
  "football",
  "hockey",
  "card",
  "cards",
  "set",
]);

export function normalizeHobbyText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function playerTokens(name: string): string[] {
  return normalizeHobbyText(name)
    .split(" ")
    .filter((token) => token.length > 0 && !SUFFIXES.has(token));
}

export function playersMatch(a: string, b: string): boolean {
  const left = playerTokens(a);
  const right = playerTokens(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = new Set(left.length <= right.length ? right : left);
  if (!shorter.every((token) => longer.has(token))) return false;
  return shorter.some((token) => token.length >= 3);
}

/** Longest name token, used as a read-only ILIKE needle. Null when too short to search. */
export function playerSearchToken(name: string): string | null {
  const tokens = playerTokens(name).filter((token) => token.length >= 3);
  if (tokens.length === 0) return null;
  return tokens.reduce((best, token) => (token.length > best.length ? token : best), tokens[0]);
}

export function significantSetTokens(value: string): string[] {
  return normalizeHobbyText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !SET_STOP.has(token) && !/^\d+$/.test(token));
}

export function setNamesOverlap(a: string, b: string): boolean {
  const left = significantSetTokens(a);
  const right = new Set(significantSetTokens(b));
  if (left.length === 0 || right.size === 0) return false;
  const hits = left.filter((token) => right.has(token));
  return hits.length >= 2 || hits.some((token) => token.length >= 4);
}

function yearsMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a < 1800 || b < 1800) return false;
  return a === b;
}

function brandsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeHobbyText(a ?? "");
  const right = normalizeHobbyText(b ?? "");
  if (left.length < 3 || right.length < 3) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function cardNumbersMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const left = a.replace(/^#/, "").replace(/^0+/, "").trim().toLowerCase();
  const right = b.replace(/^#/, "").replace(/^0+/, "").trim().toLowerCase();
  return left.length > 0 && left === right;
}

export function catalogMatchTease(cardCount: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(cardCount) ? cardCount : 0));
  const noun = n === 1 ? "card" : "cards";
  return `${n} ${noun} · already live`;
}

export function formatCatalogCardLabel(parts: {
  year?: number | null;
  brand?: string | null;
  cardNumber?: string | null;
  setName?: string | null;
  playerName?: string | null;
}): string {
  const year = parts.year && parts.year >= 1800 ? String(parts.year) : "";
  const brand = (parts.brand || "").trim();
  const number = (parts.cardNumber || "").replace(/^#/, "").trim();
  const head = [year, brand].filter(Boolean).join(" ");
  if (head && number) return `${head} #${number}`;
  if (head) return head;
  if (parts.setName?.trim()) return parts.setName.trim();
  return (parts.playerName || "").trim() || "Card";
}

/** In-app play target. Only `/sets/{slug}`. Anything else falls back to the shelf. */
export function catalogMatchPlayPath(slug: string): "/sets" | `/sets/${string}` {
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) return "/sets";
  return `/sets/${clean}`;
}

type ScoreTarget = {
  player: string | null;
  year: number | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  extraSetName?: string | null;
};

export function scoreIdentity(identified: IdentifyFields, candidate: ScoreTarget): number {
  if (!candidate.player || !playersMatch(identified.playerName, candidate.player)) return 0;
  let score = 0;
  if (yearsMatch(identified.year, candidate.year)) score += 4;
  if (brandsMatch(identified.brand, candidate.brand)) score += 3;
  const setHit =
    (!!candidate.setName && setNamesOverlap(identified.setName, candidate.setName)) ||
    (!!candidate.extraSetName && setNamesOverlap(identified.setName, candidate.extraSetName));
  if (setHit) score += 3;
  if (cardNumbersMatch(identified.cardNumber, candidate.cardNumber)) score += 2;
  return score;
}

export function emptyCatalogMatch(): CatalogMatchCore {
  return {
    catalogCardId: null,
    candidates: [],
    card: null,
    match: { status: "none", sets: [] },
  };
}

function isIntegrated(row: IntegratedMembership): boolean {
  return row.isUserCreated === false && row.isActive === true && row.cardCount > 0;
}

/**
 * Map an identification onto catalog rows and set memberships.
 * User-created and inactive sets are dropped even if the caller passes them.
 */
export function resolveCatalogMatch(input: {
  identified: IdentifyFields;
  catalog: CatalogCardRow[];
  memberships: IntegratedMembership[];
}): CatalogMatchCore {
  const identified = input.identified;
  if (!playerSearchToken(identified.playerName)) return emptyCatalogMatch();

  const catalogScored = input.catalog
    .map((row) => ({
      row,
      score: scoreIdentity(identified, {
        player: row.player,
        year: row.year,
        brand: row.brand,
        setName: row.setName,
        cardNumber: row.cardNumber,
      }),
    }))
    .filter((item) => item.score >= CATALOG_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  const candidates: CatalogCandidate[] = catalogScored.slice(0, CATALOG_MATCH_MAX_SETS).map((item) => ({
    catalogCardId: item.row.id,
    playerName: item.row.player || identified.playerName,
    year: item.row.year,
    brand: item.row.brand,
    setName: item.row.setName,
    cardNumber: item.row.cardNumber,
    label: formatCatalogCardLabel({
      year: item.row.year,
      brand: item.row.brand,
      cardNumber: item.row.cardNumber,
      setName: item.row.setName,
      playerName: item.row.player,
    }),
  }));

  const bestCatalog = candidates[0] ?? null;

  type Bucket = {
    id: string;
    name: string;
    cardCount: number;
    score: number;
    cardNumber: string | null;
    year: number;
    brand: string;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of input.memberships) {
    if (!isIntegrated(row)) continue;
    const score = scoreIdentity(identified, {
      player: row.player,
      year: row.year,
      brand: row.brand,
      setName: row.setName,
      extraSetName: row.cardSet,
      cardNumber: row.cardNumber,
    });
    if (score < CATALOG_MATCH_MIN_SCORE) continue;
    const prev = buckets.get(row.setId);
    if (!prev || score > prev.score) {
      buckets.set(row.setId, {
        id: row.setId,
        name: row.setName,
        cardCount: row.cardCount,
        score,
        cardNumber: row.cardNumber,
        year: row.year,
        brand: row.brand,
      });
    }
  }

  const ranked = [...buckets.values()].sort(
    (a, b) => b.score - a.score || b.cardCount - a.cardCount || a.name.localeCompare(b.name),
  );

  let status: MatchStatus = "none";
  let chosen: Bucket[] = [];
  if (ranked.length === 1) {
    status = "matched";
    chosen = ranked;
  } else if (ranked.length > 1) {
    if (ranked[0].score >= ranked[1].score + CATALOG_MATCH_WIN_GAP) {
      status = "matched";
      chosen = [ranked[0]];
    } else {
      status = "ambiguous";
      chosen = ranked.slice(0, CATALOG_MATCH_MAX_SETS);
    }
  }

  const sets: CatalogMatchSetCore[] = chosen.map((set) => ({
    id: set.id,
    name: set.name,
    cardCount: set.cardCount,
    tease: catalogMatchTease(set.cardCount),
  }));

  const labelSource = bestCatalog
    ? {
        year: bestCatalog.year,
        brand: bestCatalog.brand,
        cardNumber: bestCatalog.cardNumber,
        setName: bestCatalog.setName,
        playerName: bestCatalog.playerName,
      }
    : {
        year: identified.year,
        brand: identified.brand,
        cardNumber: identified.cardNumber ?? chosen[0]?.cardNumber ?? null,
        setName: identified.setName,
        playerName: identified.playerName,
      };

  const card: CatalogMatchCard | null =
    status === "none" && !bestCatalog
      ? null
      : {
          playerName: bestCatalog?.playerName || identified.playerName,
          year: labelSource.year && labelSource.year >= 1800 ? labelSource.year : null,
          brand: labelSource.brand || null,
          setName: labelSource.setName || null,
          label: formatCatalogCardLabel(labelSource),
        };

  return {
    catalogCardId: bestCatalog?.catalogCardId ?? null,
    candidates,
    card: status === "none" && !bestCatalog ? null : card,
    match: { status, sets },
  };
}
