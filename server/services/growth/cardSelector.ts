import { db } from "../../db";
import { playableCards, gameSets } from "@shared/schema";
import { eq, and, sql, isNull, not } from "drizzle-orm";
import { isPlaceholderUrl, quickValidateImageUrl } from "../../videoFactory/validate";
import crypto from "crypto";

export type DifficultyTag = "easy" | "medium" | "hard";
export type EraTag = "70s" | "80s" | "90s" | "00s" | "10s" | "20s";

export interface SelectedCard {
  id: string;
  player: string;
  set: string;
  year: number;
  imageUrl: string;
  difficulty: DifficultyTag;
  era: EraTag;
  gameSetId: string;
}

const FAMOUS_PLAYERS = new Set([
  "ken griffey jr", "cal ripken jr", "nolan ryan", "derek jeter",
  "barry bonds", "mark mcgwire", "sammy sosa", "mike piazza",
  "roger clemens", "greg maddux", "tom seaver", "hank aaron",
  "willie mays", "babe ruth", "mickey mantle", "sandy koufax",
  "roberto clemente", "johnny bench", "pete rose", "mike schmidt",
  "tony gwynn", "kirby puckett", "wade boggs", "ryne sandberg",
  "jose canseco", "rickey henderson", "ozzie smith", "don mattingly",
  "darryl strawberry", "dwight gooden", "bo jackson", "frank thomas",
  "chipper jones", "randy johnson", "pedro martinez", "ivan rodriguez",
  "vladimir guerrero", "albert pujols", "ichiro suzuki", "alex rodriguez",
  "david ortiz", "mariano rivera", "mike trout", "bryce harper",
  "mookie betts", "shohei ohtani", "juan soto", "ronald acuna jr",
]);

const WELL_KNOWN_PLAYERS = new Set([
  "jose canseco", "bo jackson", "will clark", "don mattingly",
  "darryl strawberry", "dwight gooden", "orel hershiser",
  "robin yount", "paul molitor", "dave winfield", "eddie murray",
  "jack clark", "kevin mitchell", "benito santiago", "matt williams",
  "cecil fielder", "juan gonzalez", "jeff bagwell", "craig biggio",
  "john smoltz", "kenny lofton", "bernie williams", "tim salmon",
  "jay buhner", "tino martinez", "larry walker", "dante bichette",
  "andres galarraga", "moises alou", "gary sheffield",
]);

function seededRng(seed: string): () => number {
  let hash = crypto.createHash("sha256").update(seed).digest();
  let offset = 0;
  return () => {
    if (offset + 4 > hash.length) {
      hash = crypto.createHash("sha256").update(hash).digest();
      offset = 0;
    }
    const val = hash.readUInt32BE(offset) / 0xFFFFFFFF;
    offset += 4;
    return val;
  };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function detectEra(year: number): EraTag {
  if (year < 1980) return "70s";
  if (year < 1990) return "80s";
  if (year < 2000) return "90s";
  if (year < 2010) return "00s";
  if (year < 2020) return "10s";
  return "20s";
}

export function classifyDifficulty(playerName: string, isRookie: boolean): DifficultyTag {
  const normalized = playerName.toLowerCase().trim();
  if (FAMOUS_PLAYERS.has(normalized)) return "easy";
  if (WELL_KNOWN_PLAYERS.has(normalized) || isRookie) return "medium";
  return "hard";
}

function parseYearFromSetName(setName: string): number | null {
  const match = setName.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

interface CardRow {
  id: string;
  player: string | null;
  set: string | null;
  imageUrl: string | null;
  rookie: boolean | null;
  gameSetId: string;
  isPlayable: boolean;
  quarantineStatus: string;
  proposedUnplayable: boolean;
  setYear: number;
}

async function fetchEligibleCards(options?: {
  setId?: string;
  era?: EraTag;
  limit?: number;
}): Promise<CardRow[]> {
  const conditions = [
    eq(playableCards.isPlayable, true),
    eq(playableCards.quarantineStatus, "OK"),
    eq(playableCards.proposedUnplayable, false),
    not(isNull(playableCards.player)),
    not(isNull(playableCards.imageUrl)),
  ];

  if (options?.setId) {
    conditions.push(eq(playableCards.gameSetId, options.setId));
  }

  const rows = await db.select({
    id: playableCards.id,
    player: playableCards.player,
    set: playableCards.set,
    imageUrl: playableCards.imageUrl,
    rookie: playableCards.rookie,
    gameSetId: playableCards.gameSetId,
    isPlayable: playableCards.isPlayable,
    quarantineStatus: playableCards.quarantineStatus,
    proposedUnplayable: playableCards.proposedUnplayable,
    setYear: gameSets.year,
  })
    .from(playableCards)
    .innerJoin(gameSets, eq(playableCards.gameSetId, gameSets.id))
    .where(and(...conditions))
    .limit(options?.limit || 500);

  return rows.filter(r => r.imageUrl && !isPlaceholderUrl(r.imageUrl)) as CardRow[];
}

function toSelectedCard(row: CardRow): SelectedCard {
  const year = row.setYear;
  return {
    id: row.id,
    player: row.player!,
    set: row.set || "Unknown Set",
    year,
    imageUrl: row.imageUrl!,
    difficulty: classifyDifficulty(row.player!, row.rookie === true),
    era: detectEra(year),
    gameSetId: row.gameSetId,
  };
}

async function validateCardImages(cards: SelectedCard[]): Promise<SelectedCard[]> {
  const validated: SelectedCard[] = [];
  for (const card of cards) {
    const check = await quickValidateImageUrl(card.imageUrl);
    if (check.valid) {
      validated.push(card);
    } else {
      console.warn(`[CardSelector] Rejected card ${card.id} (${card.player}): ${check.error}`);
    }
  }
  return validated;
}

export async function selectCardsForFormat(
  formatId: string,
  date: string,
  options?: { setId?: string }
): Promise<SelectedCard[]> {
  const salt = process.env.GROWTH_CARD_SALT || "packpts-growth-2025";
  const seed = `${date}:${formatId}:${options?.setId || "any"}:${salt}`;
  const rng = seededRng(seed);

  const rows = await fetchEligibleCards({ setId: options?.setId, limit: 500 });
  if (rows.length === 0) return [];

  const shuffled = seededShuffle(rows, rng);
  const cards = shuffled.map(toSelectedCard);

  if (cards.length === 0) {
    console.warn(`[CardSelector] No eligible cards for format ${formatId}`);
    return [];
  }

  let selected: SelectedCard[];
  switch (formatId) {
    case "only_real_fans":
      selected = pickByDifficulty(cards, ["medium", "hard"], 1, rng);
      break;
    case "difficulty_ladder":
      selected = pickDifficultyLadder(cards, rng);
      break;
    case "memory_shock":
      selected = pickMemoryShock(cards, rng);
      break;
    case "pack_pull_drama":
      selected = pickByDifficulty(cards, ["medium", "hard"], 1, rng);
      break;
    case "leaderboard_flex":
      selected = pickByDifficulty(cards, ["easy", "medium"], 1, rng);
      break;
    case "era_wars":
      selected = pickEraWars(cards, rng);
      break;
    default:
      selected = pickByDifficulty(cards, ["medium"], 1, rng);
      break;
  }

  const validated = await validateCardImages(selected);
  if (validated.length === 0 && selected.length > 0) {
    console.warn(`[CardSelector] All ${selected.length} selected cards failed image validation for format ${formatId}`);
  }
  return validated;
}

function pickByDifficulty(
  cards: SelectedCard[],
  preferredDifficulties: DifficultyTag[],
  count: number,
  _rng: () => number
): SelectedCard[] {
  const preferred = cards.filter(c => preferredDifficulties.includes(c.difficulty));
  if (preferred.length >= count) return preferred.slice(0, count);
  return cards.slice(0, count);
}

function pickDifficultyLadder(cards: SelectedCard[], _rng: () => number): SelectedCard[] {
  const easy = cards.find(c => c.difficulty === "easy");
  const medium = cards.find(c => c.difficulty === "medium");
  const hard = cards.find(c => c.difficulty === "hard");

  const result: SelectedCard[] = [];
  if (easy) result.push(easy);
  else if (cards.length > 0) result.push(cards[0]);

  if (medium && medium.id !== result[0]?.id) result.push(medium);
  else {
    const fallback = cards.find(c => !result.find(r => r.id === c.id));
    if (fallback) result.push(fallback);
  }

  if (hard && !result.find(r => r.id === hard.id)) result.push(hard);
  else {
    const fallback = cards.find(c => !result.find(r => r.id === c.id));
    if (fallback) result.push(fallback);
  }

  return result.slice(0, 3);
}

function pickMemoryShock(cards: SelectedCard[], _rng: () => number): SelectedCard[] {
  const midTier = cards.filter(c => c.difficulty === "medium");
  if (midTier.length > 0) return [midTier[0]];
  const nonFamous = cards.filter(c => c.difficulty !== "easy");
  if (nonFamous.length > 0) return [nonFamous[0]];
  return cards.slice(0, 1);
}

function pickEraWars(cards: SelectedCard[], _rng: () => number): SelectedCard[] {
  const eras = new Map<EraTag, SelectedCard[]>();
  for (const c of cards) {
    if (!eras.has(c.era)) eras.set(c.era, []);
    eras.get(c.era)!.push(c);
  }

  const eraKeys = Array.from(eras.keys());
  if (eraKeys.length < 2) {
    return cards.slice(0, 2);
  }

  const era1 = eraKeys[0];
  const era2 = eraKeys.find(e => e !== era1)!;

  return [eras.get(era1)![0], eras.get(era2)![0]];
}

export async function getAvailableEras(): Promise<{ era: EraTag; count: number }[]> {
  const sets = await db.select({
    year: gameSets.year,
    count: sql<number>`count(*)::int`,
  })
    .from(gameSets)
    .where(eq(gameSets.isActive, true))
    .groupBy(gameSets.year);

  const eraCounts = new Map<EraTag, number>();
  for (const s of sets) {
    const era = detectEra(s.year);
    eraCounts.set(era, (eraCounts.get(era) || 0) + s.count);
  }

  return Array.from(eraCounts.entries())
    .map(([era, count]) => ({ era, count }))
    .sort((a, b) => a.era.localeCompare(b.era));
}
