/**
 * Cards that must not be dealt, offered as a replacement, or used as a set cover.
 * Match game_set_id (exact, or prefix) and a case-insensitive substring of player.
 * Over-blocking every card of that player in the set is intended.
 *
 * 1987 Topps Football Record Breakers are also blocked by normalized card number
 * and by variant/description text, same set id.
 */
import { and, asc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { dailyChallengeCards, dailyChallenges, playableCards } from "@shared/schema";
import { getPackptsDayKey } from "@shared/packptsDay";
import { isNonPlayerCard } from "@shared/nonPlayerCard";
import { db } from "../db";
import { isMaskBandExcluded } from "../masking/maskBandLimit";

type CardAlias = "pc" | "playable_cards";

export type CardBlocklistEntry = {
  /** Stored game_sets.id. Prefix match when `prefix` is set. */
  gameSetId: string;
  prefix?: boolean;
  /** Case-insensitive substring of playable_cards.player. */
  playerIncludes: string;
  /** Also block `includes` when the player field has this first name as its own word. */
  also?: { includes: string; firstName: string };
};

export type BlocklistCardFields = {
  number?: string | null;
  variant?: string | null;
  description?: string | null;
};

/** 1987 Topps Football. Exact game_sets.id match, same as the other rows for this set. */
export const TOPPS_1987_FOOTBALL_SET_ID = "91cfdf3f-a620-4e73-adc8-22b8df221716";

/**
 * 1987 Topps Football Record Breaker subset, cards 2-8. Both checklists name the
 * same seven cards. PSA states the subset is cards 2-8 and does not list names.
 * - https://www.cardboardconnection.com/1987-topps-football-cards
 * - https://www.deanscards.com/c/1794/1987-Topps-Football
 * - https://www.psacard.com/cardfacts/football-cards/1987-topps/702
 * Mark Duper is not in this subset (Cardboard Connection: base #236 and 1000 Yard
 * Club #9). He is name-blocked anyway: the live /sets cover showed his full name.
 */
export const TOPPS_1987_FOOTBALL_RECORD_BREAKERS: readonly { number: string; player: string }[] = [
  { number: "2", player: "Todd Christensen" },
  { number: "3", player: "Dave Jennings" },
  { number: "4", player: "Charlie Joiner" },
  { number: "5", player: "Steve Largent" },
  { number: "6", player: "Dan Marino" },
  { number: "7", player: "Donnie Shell" },
  { number: "8", player: "Phil Simms" },
];

/** Name-only. Not a Record Breaker card number on the checklists above. */
const TOPPS_1987_FOOTBALL_EXTRA_PLAYERS = ["Mark Duper"] as const;

const RECORD_BREAKER_TEXT = /record\s*breaker|\bRB\b/i;
const RECORD_BREAKER_NUMBERS = new Set(TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.number));

function footballNameEntry(player: string): CardBlocklistEntry {
  const parts = player.toLowerCase().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts[parts.length - 1] || "";
  return {
    gameSetId: TOPPS_1987_FOOTBALL_SET_ID,
    playerIncludes: player.toLowerCase(),
    also: firstName && lastName && firstName !== lastName ? { includes: lastName, firstName } : undefined,
  };
}

export const CARD_BLOCKLIST: readonly CardBlocklistEntry[] = [
  // 2024 Basketball: surname is readable on the jersey back.
  { gameSetId: "229f0379", prefix: true, playerIncludes: "antetokounmpo" },
  ...TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => footballNameEntry(row.player)),
  ...TOPPS_1987_FOOTBALL_EXTRA_PLAYERS.map((player) => footballNameEntry(player)),
  // 1989 Fleer: belt-and-braces for the earlier Kevin Johnson leak.
  { gameSetId: "aea515e2", prefix: true, playerIncludes: "kevin johnson" },
];

export function recordBreakerBlocklistLogLine(): string {
  const numbers = TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.number).join(",");
  const players = [
    ...TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.player),
    ...TOPPS_1987_FOOTBALL_EXTRA_PLAYERS,
  ].join(",");
  return `[blocklist] set=91cfdf3f recordBreakerNumbers=${numbers} players=${players}`;
}

/** One boot line naming the 1987 Topps Football Record Breaker numbers and players. */
export function logCardBlocklist(): void {
  console.log(recordBreakerBlocklistLogLine());
}

function norm(value: string | null | undefined): string {
  return (value || "").toLowerCase();
}

function hasWord(player: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(player);
}

/** Strip '#', whitespace, and leading zeros. " #007 " and "07" both become "7". */
export function normalizeCardNumber(value: string | null | undefined): string {
  return (value || "").replace(/#/g, "").replace(/\s+/g, "").replace(/^0+/, "");
}

function sameSet(setId: string, gameSetId: string, prefix?: boolean): boolean {
  const expected = gameSetId.toLowerCase();
  return prefix ? setId.startsWith(expected) : setId === expected;
}

function playerMatchesEntry(name: string, entry: CardBlocklistEntry): boolean {
  if (name.includes(entry.playerIncludes.toLowerCase())) return true;
  if (!entry.also) return false;
  return name.includes(entry.also.includes.toLowerCase()) && hasWord(name, entry.also.firstName.toLowerCase());
}

export function isBlockedCard(
  gameSetId: string | null | undefined,
  player: string | null | undefined,
  fields?: BlocklistCardFields | null,
): boolean {
  const setId = norm(gameSetId);
  const name = norm(player);
  if (setId && name && CARD_BLOCKLIST.some((entry) => sameSet(setId, entry.gameSetId, entry.prefix) && playerMatchesEntry(name, entry))) {
    return true;
  }
  if (setId !== TOPPS_1987_FOOTBALL_SET_ID) return false;
  const number = normalizeCardNumber(fields?.number);
  if (number && RECORD_BREAKER_NUMBERS.has(number)) return true;
  const text = `${fields?.variant || ""}\n${fields?.description || ""}`;
  return RECORD_BREAKER_TEXT.test(text);
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function blockClause(alias: CardAlias, entry: CardBlocklistEntry): string {
  const setCol = `lower(${alias}.game_set_id)`;
  const playerCol = `lower(${alias}.player)`;
  const setMatch = entry.prefix
    ? `${setCol} LIKE ${sqlQuote(`${entry.gameSetId.toLowerCase()}%`)}`
    : `${setCol} = ${sqlQuote(entry.gameSetId.toLowerCase())}`;
  const playerMatch = `strpos(${playerCol}, ${sqlQuote(entry.playerIncludes.toLowerCase())}) > 0`;
  const extra = entry.also
    ? ` OR (strpos(${playerCol}, ${sqlQuote(entry.also.includes.toLowerCase())}) > 0 AND ${playerCol} ~ ${sqlQuote(`(^|[^a-z])${entry.also.firstName.toLowerCase()}([^a-z]|$)`)})`
    : "";
  return `(${setMatch} AND (${playerMatch}${extra}))`;
}

function normalizedNumberSql(alias: CardAlias): string {
  return `regexp_replace(regexp_replace(replace(COALESCE(${alias}.number, ''), '#', ''), '[[:space:]]', '', 'g'), '^0+', '')`;
}

function recordBreakerNumberClause(alias: CardAlias): string {
  const numbers = TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => sqlQuote(row.number)).join(", ");
  return `(lower(${alias}.game_set_id) = ${sqlQuote(TOPPS_1987_FOOTBALL_SET_ID)} AND ${normalizedNumberSql(alias)} IN (${numbers}))`;
}

function recordBreakerTextClause(alias: CardAlias): string {
  const pattern = sqlQuote("record[[:space:]]*breaker|\\mRB\\M");
  return `(lower(${alias}.game_set_id) = ${sqlQuote(TOPPS_1987_FOOTBALL_SET_ID)} AND (COALESCE(${alias}.variant, '') ~* ${pattern} OR COALESCE(${alias}.description, '') ~* ${pattern}))`;
}

/** OR-clauses for a deal WHERE body. True when any blocklist rule hits. */
export function cardBlocklistWhereBody(alias: CardAlias): string {
  const clauses = [
    ...CARD_BLOCKLIST.map((entry) => blockClause(alias, entry)),
    recordBreakerNumberClause(alias),
    recordBreakerTextClause(alias),
  ];
  return clauses.join(" OR ");
}

/** SQL body for a deal WHERE clause. True when the card is not on the blocklist. */
export function cardNotBlockedSql(alias: CardAlias): SQL {
  return sql`NOT (${sql.raw(cardBlocklistWhereBody(alias))})`;
}

function swappedChoices(choices: string[], oldAnswer: string, oldPlayer: string, newPlayer: string): string[] {
  const blocked = new Set([oldAnswer, oldPlayer].map((value) => value.trim().toLowerCase()).filter(Boolean));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const choice of choices) {
    const value = blocked.has(choice.trim().toLowerCase()) ? newPlayer : choice;
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  if (!seen.has(newPlayer.trim().toLowerCase())) next.unshift(newPlayer);
  return next.slice(0, 4);
}

function cardUnservable(row: {
  cardId: string;
  gameSetId: string | null;
  player: string | null;
  number?: string | null;
  variant?: string | null;
  description?: string | null;
}): boolean {
  return isBlockedCard(row.gameSetId, row.player, row) || isMaskBandExcluded(row.cardId);
}

/**
 * Today's stored Daily 5 hand. A blocked or oversized-band card is rewritten to
 * the next eligible card in the set before the client sees it. Returns how many
 * unservable cards remain.
 */
export async function replaceBlockedDaily5Cards(challengeId: string, today = getPackptsDayKey()): Promise<number> {
  const [challenge] = await db
    .select({ id: dailyChallenges.id, date: dailyChallenges.date, setId: dailyChallenges.setId })
    .from(dailyChallenges)
    .where(eq(dailyChallenges.id, challengeId))
    .limit(1);
  if (!challenge || challenge.date !== today) return 0;

  const rows = await db
    .select({
      id: dailyChallengeCards.id,
      cardId: dailyChallengeCards.cardId,
      correctAnswer: dailyChallengeCards.correctAnswer,
      choices: dailyChallengeCards.choices,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
      description: playableCards.description,
    })
    .from(dailyChallengeCards)
    .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
    .where(eq(dailyChallengeCards.dailyChallengeId, challengeId))
    .orderBy(asc(dailyChallengeCards.position));

  const blocked = rows.filter((row) => cardUnservable(row));
  if (blocked.length === 0) return 0;

  const { eligibleDealFilter } = await import("../services/playableSetEligibility");
  const { isKnownSilhouetteUrl } = await import("../storage");
  const used = new Set(rows.map((row) => row.cardId));
  const setId = challenge.setId || blocked[0]?.gameSetId;
  if (!setId) return blocked.length;

  for (const row of blocked) {
    used.delete(row.cardId);
    const filters = [
      eq(playableCards.gameSetId, setId),
      eligibleDealFilter("playable_cards"),
    ];
    if (used.size > 0) filters.push(notInArray(playableCards.id, [...used]));
    const candidates = await db
      .select()
      .from(playableCards)
      .where(and(...filters))
      .limit(40);
    const next = candidates.find((card) =>
      !!card.player
      && !isBlockedCard(card.gameSetId, card.player, card)
      && !isMaskBandExcluded(card.id)
      && !isNonPlayerCard(card.player, card.description)
      && !isKnownSilhouetteUrl(card.imageUrl));
    if (!next?.player) {
      used.add(row.cardId);
      console.error(`[CardBlocklist] No Daily 5 replacement for challenge ${challengeId}`);
      continue;
    }
    const choices = swappedChoices(row.choices as string[], row.correctAnswer, row.player || "", next.player);
    await db
      .update(dailyChallengeCards)
      .set({ cardId: next.id, correctAnswer: next.player, choices })
      .where(and(eq(dailyChallengeCards.id, row.id), eq(dailyChallengeCards.cardId, row.cardId)));
    used.add(next.id);
  }

  const left = await db
    .select({
      cardId: dailyChallengeCards.cardId,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      number: playableCards.number,
      variant: playableCards.variant,
      description: playableCards.description,
    })
    .from(dailyChallengeCards)
    .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
    .where(eq(dailyChallengeCards.dailyChallengeId, challengeId));
  return left.filter((row) => cardUnservable(row)).length;
}
