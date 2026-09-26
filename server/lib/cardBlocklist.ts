/**
 * Cards that must not be dealt, offered as a replacement, or used as a set cover.
 * Match game_set_id (exact, or prefix) and a case-insensitive substring of player.
 * Over-blocking every card of that player in the set is intended.
 *
 * 1987 Topps Football Record Breakers are also blocked by normalized card number
 * and by Record Breaker text on player, variant, or description, same set id.
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

const RECORD_BREAKER_TEXT = /record\s*breaker/i;
const RECORD_BREAKER_NUMBERS = new Set(TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.number));

/**
 * Text that drops a card on its own, on every set. All-Star, Future Stars,
 * Rookie Stars, Prospects, and Highlights do not. Those drop only when the
 * player field names more than one person, or the number is on a vintage list.
 * Record Breaker text is limited to 1987 Topps Football below. Super Bowl is not
 * text-only. "vs." needs the period; bare "VS" does not drop a card.
 */
const MULTI_PLAYER_TEXT = /\b(?:team\s+leaders|league\s+leaders|leaders|check\s*lists?|combos?|tandems?|duos?|trios?)\b|\bvs\./i;

/** Whole side of a " - " or " vs " split that is a subset or position, not a person. */
const SUBSET_OR_POSITION_LABELS = [
  "all-star", "all star", "all-stars", "all stars",
  "future stars", "rookie stars", "rookie", "rookies",
  "prospect", "prospects", "highlight", "highlights",
  "record breaker", "record breakers",
  "team leaders", "league leaders", "leaders",
  "checklist", "checklists",
  "combo", "combos", "tandem", "tandems", "duo", "duos", "trio", "trios",
  "super bowl", "insert", "inserts",
  "rb", "qb", "wr", "te", "fb", "ol", "dl", "lb", "cb", "db", "de", "dt", "nt", "fs", "ss",
  "pg", "sg", "sf", "pf", "guard", "forward", "center",
  "pitcher", "catcher", "infielder", "outfielder",
  "k", "p", "c", "g", "f",
] as const;
const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv|v)\.?$/i;

/**
 * Cards that picture more than one player, by normalized number.
 * Prefix match on game_sets.id (first 8 chars). Sources are in the comments.
 * Single-player All-Star, Record Breaker, and one-name Team Leader cards are
 * not in these lists.
 */
export const MULTI_PLAYER_NUMBER_SETS: readonly { id: string; numbers: readonly string[] }[] = [
  {
    // 1989-90 Fleer Basketball All-Star combos 163-167 and checklist 168.
    // https://images.oldbaseball.com/Common/ChecklistSet.php?genre=Basketball&setname=1989-90+Fleer&year=1989
    // https://www.deanscards.com/c/2061/1989-90-Fleer-Basketball-Cards (All-Star Combos 163-167)
    // https://www.tradercracks.com/1989-90-fleer-basketball-cards-checklist (168 Checklist)
    id: "aea515e2",
    numbers: ["163", "164", "165", "166", "167", "168"],
  },
  {
    // 1987 Topps Baseball team leaders (26) and checklists (6). Both card-level
    // lists agree on these numbers.
    // https://baseballcardpedia.com/index.php/1987_Topps
    // https://www.collectors-network.com/series/2059/1987_Topps_Tiffany_Baseball
    id: "37fd025d",
    numbers: [
      "11", "31", "56", "81", "106", "128", "131", "156", "181", "206", "231", "256", "264",
      "281", "306", "331", "356", "381", "392", "406", "431", "456", "481", "506", "522",
      "531", "556", "581", "631", "654", "656", "792",
    ],
  },
  {
    // 1989 Topps Baseball: multi-name team leaders and the six checklists.
    // One-name Team Leader cards are omitted. Card-level list:
    // https://baseballcardpedia.com/index.php/1989_Topps
    // #291 Mets Leaders (Strawberry / McReynolds / Hernandez):
    // https://nymhall.com/players/S/darstr.html
    id: "352b33d1",
    numbers: ["118", "258", "291", "351", "378", "524", "609", "619", "669", "699", "782"],
  },
  {
    // 1994 Topps Football: #119 Robinson / Odomes and four checklists.
    // https://www.retroseasons.com/leagues/nfl/1994/sports-cards/topps/
    // https://www.sportlots.com/Football/card_values/1994-Topps-Base-Set.tpl
    // https://www.deanscards.com/p/130282/1994-Topps-119-Eugene-Robinson-Nate-Odomes
    id: "a09b2fe7",
    numbers: ["119", "329", "330", "659", "660"],
  },
  {
    // 1987 Topps Football: Super Bowl XXI, 28 team cards, league leaders 227-231,
    // checklists 394-396. Record Breakers 2-8 are single-player and stay on the
    // record-breaker list above.
    // https://www.cardboardconnection.com/1987-topps-football-cards
    // https://www.deanscards.com/c/1794/1987-Topps-Football (#1 Super Bowl XXI, #9 Giants Leaders)
    // https://www.oldsportscards.com/1987-topps-football-cards/ (League Leaders 227-231)
    id: "91cfdf3f",
    numbers: [
      "1", "9", "30", "43", "63", "79", "96", "111", "126", "144", "160", "172", "184", "198",
      "213", "227", "228", "229", "230", "231", "232", "248", "260", "272", "283", "294", "306",
      "317", "328", "339", "350", "361", "372", "383", "394", "395", "396",
    ],
  },
];

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

/**
 * 1989-90 Fleer All-Star stickers, 11 cards, one per pack. The star border prints
 * the name and position where the mask misses it. Isiah Thomas is sticker 6 and
 * Chris Mullin is sticker 9 (live cover leaks). Trader Cracks lists 1-11;
 * Beckett's set note is the same 11-sticker All-Star insert and lists Magic
 * Johnson as 5. PSA prices Tom Chambers as 8, which Trader Cracks assigns to
 * Dale Ellis (Chambers is 11 there). Both numberings sit inside 1-11, so the
 * blocked set is that whole range. Base cards that share a number in 1-11 are
 * blocked with the sticker; Isiah's base 50 and Mullin's base 55 stay playable.
 * - https://www.tradercracks.com/1989-90-fleer-basketball-cards-checklist
 * - https://marketplace.beckett.com/thefairfieldcompany_941/item/1989-90-fleer-stickers-5-magic-johnson_58762749
 * - https://www.slamtradingcards.com.au/shop/nba/set/nba-1980s/1989-90-fleer/1989-90-fleer-all-stars-sticker-06-isiah-thomas-detroit-pistons
 * - https://www.psacard.com/auctionprices/basketball-cards/1990-fleer-all-stars/tom-chambers/307741
 */
export const FLEER_1989_ALL_STAR_NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] as const;
const FLEER_1989_SET_PREFIX = "aea515e2";

/**
 * 1987 Topps baseball #366 Mark McGwire. The jersey back prints McGWIRE. Other
 * McGwire cards in other sets stay playable.
 * - https://www.cardboardconnection.com/1987-topps-baseball-cards
 * - https://www.tcdb.com/ViewCard.cfm/sid/117/cid/35618/1987-Topps-366-Mark-McGwire
 * - https://www.collectors-network.com/series/2059/1987_Topps_Tiffany_Baseball
 */
export const TOPPS_1987_BASEBALL_SET_PREFIX = "37fd025d";
export const TOPPS_1987_MCGWIRE_NUMBER = "366";

export function multiPlayerBlocklistLogLines(): string[] {
  return MULTI_PLAYER_NUMBER_SETS.map((set) => {
    const numbers = [...set.numbers].sort((a, b) => Number(a) - Number(b)).join(",");
    const extra = set.id === FLEER_1989_SET_PREFIX
      ? ` allStarNumbers=${FLEER_1989_ALL_STAR_NUMBERS.join(",")}`
      : set.id === TOPPS_1987_BASEBALL_SET_PREFIX
        ? ` mcgwireNumber=${TOPPS_1987_MCGWIRE_NUMBER}`
        : "";
    return `[blocklist] set=${set.id} multiPlayerNumbers=${numbers}${extra} textRules=on`;
  });
}

/** Boot lines: the 1987 Record Breaker subset, then one multi-player line per vintage set. */
export function logCardBlocklist(): void {
  console.log(recordBreakerBlocklistLogLine());
  for (const line of multiPlayerBlocklistLogLines()) console.log(line);
}

function isSubsetOrPositionLabel(side: string): boolean {
  const key = side.trim().toLowerCase().replace(/\s+/g, " ");
  return (SUBSET_OR_POSITION_LABELS as readonly string[]).includes(key);
}

function looksLikePersonName(side: string): boolean {
  if (isSubsetOrPositionLabel(side)) return false;
  const words = side.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((word) => NAME_SUFFIX.test(word) || /^[A-Za-z][A-Za-z'.-]*$/.test(word));
}

/** " - " splits two people only when neither side is a subset or position label. */
function dashNamesTwoPeople(text: string): boolean {
  if (!/\s-\s/.test(text)) return false;
  const sides = text.split(/\s-\s/).map((side) => side.trim()).filter(Boolean);
  if (sides.length < 2) return false;
  const people = sides.filter((side) => looksLikePersonName(side));
  if (sides.length === 2) return people.length === 2;
  return people.length >= 2;
}

/** " vs " or " vs. " between two person names in the player field. */
function vsBetweenNames(text: string): boolean {
  const sides = text.split(/\s+vs\.?\s+/i).map((side) => side.trim()).filter(Boolean);
  if (sides.length < 2) return false;
  return sides.filter((side) => looksLikePersonName(side)).length >= 2;
}

/** More than one person in the player field. "Last, First" and suffixes stay single. */
export function playerNamesManyPeople(player: string | null | undefined): boolean {
  const text = (player || "").trim();
  if (!text) return false;
  if (text.includes("/")) {
    const sides = text.split("/").map((side) => side.trim()).filter(Boolean);
    if (sides.length >= 2 && sides.every((side) => /[A-Za-z]/.test(side))) return true;
  }
  if (/\s&\s/.test(text) || /\sand\s/i.test(text) || dashNamesTwoPeople(text) || vsBetweenNames(text)) return true;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const people = parts.filter((part) => !NAME_SUFFIX.test(part));
  if (people.length >= 3) return true;
  if (people.length === 2) {
    const words = (part: string) => part.split(/\s+/).filter((word) => word && !NAME_SUFFIX.test(word));
    const left = words(people[0]);
    const right = words(people[1]);
    // "Smith, John Paul" is one person. Two full names ("Karl Malone, John Stockton") are not.
    if (left.length >= 2 && right.length >= 1) return true;
  }
  return false;
}

function multiPlayerText(player: string | null | undefined, fields?: BlocklistCardFields | null): boolean {
  const blob = `${player || ""}\n${fields?.variant || ""}\n${fields?.description || ""}`;
  return MULTI_PLAYER_TEXT.test(blob);
}

function multiPlayerNumber(setId: string, number: string): boolean {
  if (!number) return false;
  return MULTI_PLAYER_NUMBER_SETS.some((set) => setId.startsWith(set.id) && set.numbers.includes(number));
}

function leakedChecklistNumber(setId: string, number: string): boolean {
  if (!number) return false;
  if (setId.startsWith(FLEER_1989_SET_PREFIX) && (FLEER_1989_ALL_STAR_NUMBERS as readonly string[]).includes(number)) return true;
  return setId.startsWith(TOPPS_1987_BASEBALL_SET_PREFIX) && number === TOPPS_1987_MCGWIRE_NUMBER;
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
  if (playerNamesManyPeople(player) || multiPlayerText(player, fields)) return true;
  const number = normalizeCardNumber(fields?.number);
  if (setId && (multiPlayerNumber(setId, number) || leakedChecklistNumber(setId, number))) return true;
  if (setId !== TOPPS_1987_FOOTBALL_SET_ID) return false;
  if (number && RECORD_BREAKER_NUMBERS.has(number)) return true;
  const text = `${player || ""}\n${fields?.variant || ""}\n${fields?.description || ""}`;
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
  const pattern = sqlQuote("record[[:space:]]*breaker");
  const blob = `COALESCE(${alias}.player, '') || ' ' || COALESCE(${alias}.variant, '') || ' ' || COALESCE(${alias}.description, '')`;
  return `(lower(${alias}.game_set_id) = ${sqlQuote(TOPPS_1987_FOOTBALL_SET_ID)} AND (${blob}) ~* ${pattern})`;
}

const MULTI_PLAYER_TEXT_SQL = String.raw`\mteam[[:space:]]+leaders\M|\mleague[[:space:]]+leaders\M|\mleaders\M|\mcheck[[:space:]]*lists?\M|\mcombos?\M|\mtandems?\M|\mduos?\M|\mtrios?\M|\mvs\.`;

/**
 * Same comma rule as playerNamesManyPeople: three or more names, or two names
 * where one side has two or more words. "Last, First" and a trailing Jr/Sr/III
 * stay one person. A slash counts only when both sides contain a letter.
 */
function labelArraySql(): string {
  return `ARRAY[${SUBSET_OR_POSITION_LABELS.map((label) => sqlQuote(label)).join(", ")}]`;
}

function namedSidesSql(splitCall: string): string {
  const namePattern = sqlQuote(String.raw`^[[:alpha:]][[:alpha:][:space:]'.-]*$`);
  return `COALESCE((
    SELECT (count(*) = 2 AND count(*) FILTER (WHERE is_name) = 2)
      OR (count(*) > 2 AND count(*) FILTER (WHERE is_name) >= 2)
    FROM (
      SELECT lower(btrim(part)) <> ALL (${labelArraySql()})
        AND btrim(part) ~ ${namePattern} AS is_name
      FROM unnest(${splitCall}) AS part
      WHERE btrim(part) <> ''
    ) sides
  ), false)`;
}

function multiPlayerPeopleClause(alias: CardAlias): string {
  const player = `COALESCE(${alias}.player, '')`;
  const suffixToken = String.raw`(iii|ii|iv|jr|sr|v)\.?`;
  const comma = `COALESCE((
    SELECT (count(*) >= 3) OR (
      count(*) = 2
      AND (array_agg(words ORDER BY ord))[1] >= 2
      AND (array_agg(words ORDER BY ord))[2] >= 1
    )
    FROM (
      SELECT ord, (
        SELECT count(*)::int
        FROM unnest(regexp_split_to_array(
          btrim(regexp_replace(btrim(part), ${sqlQuote(String.raw`(^|[[:space:]]+)${suffixToken}($|[[:space:]]+)`)}, ' ', 'gi')),
          '[[:space:]]+'
        )) AS w
        WHERE w <> ''
      ) AS words
      FROM unnest(regexp_split_to_array(${player}, ',')) WITH ORDINALITY AS u(part, ord)
      WHERE btrim(part) <> ''
        AND btrim(part) !~* ${sqlQuote(String.raw`^(jr|sr|ii|iii|iv|v)\.?$`)}
    ) people
  ), false)`;
  const dash = namedSidesSql(`regexp_split_to_array(${player}, ' - ')`);
  const vs = namedSidesSql(`regexp_split_to_array(${player}, '[[:space:]]+vs\\.?[[:space:]]+', 'i')`);
  return `(${player} ~ '[[:alpha:]][^/]*/[^/]*[[:alpha:]]' OR strpos(lower(${player}), ' & ') > 0 OR strpos(lower(${player}), ' and ') > 0 OR ${dash} OR ${vs} OR ${comma})`;
}

function multiPlayerTextClause(alias: CardAlias): string {
  const blob = `COALESCE(${alias}.player, '') || ' ' || COALESCE(${alias}.variant, '') || ' ' || COALESCE(${alias}.description, '')`;
  return `(${blob} ~* ${sqlQuote(MULTI_PLAYER_TEXT_SQL)})`;
}

function multiPlayerNumberClause(alias: CardAlias): string {
  const sets = MULTI_PLAYER_NUMBER_SETS.map((set) => {
    const numbers = set.numbers.map((number) => sqlQuote(number)).join(", ");
    return `(lower(${alias}.game_set_id) LIKE ${sqlQuote(`${set.id}%`)} AND ${normalizedNumberSql(alias)} IN (${numbers}))`;
  });
  const fleerStars = FLEER_1989_ALL_STAR_NUMBERS.map((number) => sqlQuote(number)).join(", ");
  sets.push(`(lower(${alias}.game_set_id) LIKE ${sqlQuote(`${FLEER_1989_SET_PREFIX}%`)} AND ${normalizedNumberSql(alias)} IN (${fleerStars}))`);
  sets.push(`(lower(${alias}.game_set_id) LIKE ${sqlQuote(`${TOPPS_1987_BASEBALL_SET_PREFIX}%`)} AND ${normalizedNumberSql(alias)} = ${sqlQuote(TOPPS_1987_MCGWIRE_NUMBER)})`);
  return sets.join(" OR ");
}

/** OR-clauses for a deal WHERE body. True when any blocklist rule hits. */
export function cardBlocklistWhereBody(alias: CardAlias): string {
  const clauses = [
    ...CARD_BLOCKLIST.map((entry) => blockClause(alias, entry)),
    recordBreakerNumberClause(alias),
    recordBreakerTextClause(alias),
    multiPlayerTextClause(alias),
    multiPlayerPeopleClause(alias),
    multiPlayerNumberClause(alias),
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
