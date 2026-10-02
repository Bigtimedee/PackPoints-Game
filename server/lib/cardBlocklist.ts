/**
 * Cards that must not be dealt, offered as a replacement, or used as a set cover.
 * Match game_set_id (exact, or prefix) and a case-insensitive substring of player.
 * Over-blocking every card of that player in the set is intended.
 *
 * 1987 Topps Football Record Breakers are also blocked by normalized card number
 * and by Record Breaker text on player, variant, or description, same set id.
 */
import { and, asc, eq, gte, notInArray, sql, type SQL } from "drizzle-orm";
import { dailyChallengeCards, dailyChallenges, playableCards } from "@shared/schema";
import { getPackptsDayKey } from "@shared/packptsDay";
import { isNonPlayerCard } from "@shared/nonPlayerCard";
import { db } from "../db";
import { currentHeldSetIds, isHeldSet } from "../config/heldSets";
import { isMaskBandExcluded } from "../masking/maskBandLimit";
import { refusedAtCurrentMask } from "../masking/maskDealRefusal";

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
  id?: string | null;
  /** Daily 5 rows name the playable card `cardId` rather than `id`. */
  cardId?: string | null;
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

/**
 * 1987 Topps Football #125 Charles Haley. The 49ers jersey is 94 and prints
 * HALEY on the back. The checklist number is 125, not 94. "Topps Super Rookie"
 * is the banner on this card, not a reason to drop every Super Rookie in the set.
 * Other sets stay playable.
 * - https://www.cardboardconnection.com/1987-topps-football-cards (125 Charles Haley RC)
 * - https://www.sportscardchecklist.com/set-12009/1987-topps-football-trading-card-checklist (#125 Charles Haley)
 */
export const TOPPS_1987_FOOTBALL_HALEY_NUMBER = "125";
const TOPPS_1987_FOOTBALL_HALEY_PLAYER = "Charles Haley";

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
  footballNameEntry(TOPPS_1987_FOOTBALL_HALEY_PLAYER),
  // 1989 Fleer: belt-and-braces for the earlier Kevin Johnson leak.
  { gameSetId: "aea515e2", prefix: true, playerIncludes: "kevin johnson" },
];

export function recordBreakerBlocklistLogLine(): string {
  const numbers = TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.number).join(",");
  const players = [
    ...TOPPS_1987_FOOTBALL_RECORD_BREAKERS.map((row) => row.player),
    ...TOPPS_1987_FOOTBALL_EXTRA_PLAYERS,
    TOPPS_1987_FOOTBALL_HALEY_PLAYER,
  ].join(",");
  return `[blocklist] set=91cfdf3f recordBreakerNumbers=${numbers} haleyNumber=${TOPPS_1987_FOOTBALL_HALEY_NUMBER} players=${players}`;
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

/**
 * 1987 Topps baseball #28 Mike Schmidt. The jersey back prints HMIDT.
 * Blocked by this card id, and after a re-import by set + number 28 + surname
 * Schmidt. There is no bare number-28 rule: it also caught Rick Dempsey #28.
 * #430 is a Design-pinned cover, so Schmidt is not name-blocked in this set.
 */
export const TOPPS_1987_SCHMIDT_CARD_ID = "36f1d909-2fdb-4b78-bb36-e7f5c088380a";
export const TOPPS_1987_SCHMIDT_NUMBER = "28";

/** 2024 Basketball. H inserts are the only number family added here. */
export const BASKETBALL_2024_SET_PREFIX = "229f0379";

/**
 * 2024 Basketball H inserts print the full name in a vertical strip down the
 * left edge. The mask has no geometry for that strip.
 * Stays until a side-strip mask profile exists.
 * BOD-, ST-, base numbers, and other prefixes (HR-) stay playable.
 */
export const BASKETBALL_2024_H_INSERT_NUMBER = /^H-\d+$/i;

/**
 * 2024 Basketball UVAS subset. The art prints the surname in giant vertical
 * letters down the left side, which the bottom plaque mask cannot reach
 * (Design sweep 2026-10-02: UVAS-1, 5, 7, 10, 11, 15). Blocked as a number
 * family so a purge-and-reimport cannot bring the subset back. Stays until a
 * mask template exists for this art.
 */
export const BASKETBALL_2024_UVAS_NUMBER = /^UVAS-\d+$/i;

export type BlockedCardIdRule = {
  /** game_sets.id prefix (8 chars). Boot log attributes the id to this set. */
  gameSetId: string;
  /** playable_cards.id. Matches on any set. */
  id: string;
  /** Normalized checklist number of the blocked row. */
  number: string;
  /** Lowercase surname. The re-import match needs it in the player field. */
  surname: string;
  /**
   * Variant of the blocked row, lowercase. "base" also matches an empty variant.
   * Other variants of the same number stay playable.
   */
  variant: string;
  /** Why this one card is blocked. Not shown to players. */
  reason: string;
};

/** 1989 Topps baseball. */
export const TOPPS_1989_SET_PREFIX = "352b33d1";
/** 1994 Topps Football. */
export const TOPPS_1994_FOOTBALL_SET_PREFIX = "a09b2fe7";
/** 2022 Panini Chronicles Football. */
export const CHRONICLES_2022_FOOTBALL_SET_PREFIX = "74885a41";
const TOPPS_1987_FOOTBALL_SET_PREFIX = TOPPS_1987_FOOTBALL_SET_ID.slice(0, 8);
/**
 * 1990 Hoops Basketball as re-added 2026-10-02. A later re-import mints a new
 * set id, so only the card-id match below survives that; re-add these rows
 * with the new prefix if the set is purged and imported again.
 */
export const HOOPS_1990_SET_PREFIX = "d226801a";

/**
 * 1989 Topps #496 Dwayne Henry. The stored image is a modern Bowman Chrome
 * autograph of another player, and that signature is readable. Blocked until
 * a correct 1989 Topps image replaces it.
 */
export const TOPPS_1989_DWAYNE_HENRY_CARD_ID = "c866179d-e613-443f-a6ea-07d93dee3c03";

/**
 * Single cards blocked by playable_cards.id. A refresh or an upsert re-import
 * keeps the id, so the id match holds. A purge-and-reimport inserts a new id;
 * the same row is then matched by set prefix + normalized number + surname +
 * variant. The deal predicate, the Daily 5 sweep, covers, and card-pool
 * refresh all read this list.
 *
 * Mask v4.6 sweep 2026-10-02 (Marketing): a surname or full name is readable
 * outside the mask on each of these 26 cards. Per-card crops are in each set's
 * sweep REPORT.md. 1994 Topps Football Roaf, Tim Brown, and Bledsoe are small
 * or off-center in the scan, so the fixed band misses the nameplate. That
 * geometry fallback is a follow-up; the cards are blocked until then.
 *
 * Design full-pool sweep 2026-10-02 (68): 2024 Basketball 19, 1987 Topps 37,
 * 2022 Chronicles 12. Each card is either a name leak (surname readable
 * outside the mask) or BLOCK-CRAFT: the wrong player's image, or a landscape
 * scan the mask blacks out entirely. Ten 2024 Basketball Refractors share one
 * promo-collage image, which points at an image-ingest bug on that variant.
 * Verdicts and crops: sweep-design-20261002/<set>/BLOCKS.json and EVIDENCE.png.
 */
export const BLOCKED_CARD_ID_RULES: readonly BlockedCardIdRule[] = [
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: TOPPS_1987_SCHMIDT_CARD_ID, number: TOPPS_1987_SCHMIDT_NUMBER, surname: "schmidt", variant: "base", reason: "jersey back HMIDT" },

  // 1989 Topps, Marketing sweep (17)
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "18976a3d-478e-472b-b953-dbbc25916f02", number: "15", surname: "bonilla", variant: "base", reason: "jersey nameplate BONILLA" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "4a8f5876-b655-4b87-8a26-f4bfeed8b418", number: "45", surname: "daniels", variant: "base", reason: "jersey nameplate DANIELS" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "e907ca50-88fb-40f8-887c-38193c400c18", number: "95", surname: "young", variant: "base", reason: "jersey nameplate YOUNG" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "5f68eda8-0d8c-4f62-a867-8ecd5e7bce48", number: "129", surname: "clark", variant: "base", reason: "jersey nameplate CLAR" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "100d23d5-9200-4300-8169-d409b00f4a49", number: "259", surname: "mcwilliams", variant: "base", reason: "jersey nameplate McWI" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "7908759d-1957-4f5d-8427-f4b17e4b994e", number: "296", surname: "gant", variant: "base", reason: "jersey GANT" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "786aa786-621c-4332-9f0d-8ca968299694", number: "411", surname: "williams", variant: "base", reason: "jersey WILLIA" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "a59829d3-1b95-403d-8b27-12d794aebde0", number: "440", surname: "bonilla", variant: "base", reason: "nameplate BOBBY BONILLA" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: TOPPS_1989_DWAYNE_HENRY_CARD_ID, number: "496", surname: "henry", variant: "base", reason: "wrong image: another player's autograph card" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "77895a70-ac35-4abb-aee8-da8852c083e6", number: "514", surname: "lemon", variant: "base", reason: "nameplate EMON" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "486a5772-726c-40a5-95f3-61331619e151", number: "521", surname: "tettleton", variant: "base", reason: "nameplate LETON" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "8ebd3d73-20d5-4dc4-bfff-4dc4bad2e3f7", number: "551", surname: "ready", variant: "base", reason: "READY readable" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "8af3429e-3b98-4a14-b4a7-227b7437a2da", number: "555", surname: "blyleven", variant: "base", reason: "BLYLEV readable" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "959f997a-4c85-49be-a47d-9b9668f49189", number: "663", surname: "aaron", variant: "base", reason: "hank aaron readable" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "63887679-9e66-4e82-a10c-6d10147ee322", number: "664", surname: "hodges", variant: "base", reason: "GIL HODGES readable" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "a4d47aae-6e59-4259-95e9-ef857038135f", number: "732", surname: "buechele", variant: "base", reason: "jersey nameplate CHELE" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "ee1f2993-acfd-431a-8ac0-70fe05a87b1e", number: "770", surname: "trammell", variant: "base", reason: "nameplate MELL" },

  // 1989 Topps, Design watch review 2026-10-02 (5): two name leaks and three
  // landscape scans the mask covers almost entirely. Landscape-aware geometry
  // and a full-height plate band are a follow-up.
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "17f64efb-450d-44a7-8562-2300ff495e9c", number: "286", surname: "jackson", variant: "base", reason: "plate only partly masked: DARRIN JACK" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "b348a75c-808b-4d23-be10-e8fc0036271f", number: "505", surname: "rose", variant: "base", reason: "jersey back ROSE" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "40d0d345-6b42-44eb-a96e-e324ef3b20bf", number: "65", surname: "reuschel", variant: "base", reason: "landscape scan almost fully masked" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "ef288978-d6bb-46b3-9385-7e9d59263271", number: "245", surname: "rice", variant: "base", reason: "landscape scan almost fully masked" },
  { gameSetId: TOPPS_1989_SET_PREFIX, id: "c0517235-6ab4-4790-ad6c-9cf9a9517494", number: "407", surname: "winfield", variant: "base", reason: "landscape scan almost fully masked" },

  // 1987 Topps Football (1)
  { gameSetId: TOPPS_1987_FOOTBALL_SET_PREFIX, id: "1df06ad0-500b-4548-aa24-50eb0b04c9bf", number: "113", surname: "craig", variant: "base", reason: "jersey nameplate CRAIG" },

  // 1994 Topps Football (8)
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "99b4021a-a4b2-43aa-b996-8b185e117715", number: "19", surname: "roaf", variant: "base", reason: "full name readable; off-center scan" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "4c14660f-2245-42f7-ba63-ede3c1533e8e", number: "71", surname: "andersen", variant: "refractor", reason: "slab label MORTEN ANDERSEN" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "81aee6e1-667a-437e-94fa-30b1512ed892", number: "116", surname: "brown", variant: "base", reason: "nameplate TIM BROWN; small card in scan" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "f64270f3-35f1-458e-95fb-c3c422c92836", number: "144", surname: "givins", variant: "refractor", reason: "nameplate GIVINS" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "04a80e83-905e-408d-9cb7-e93263333471", number: "146", surname: "bledsoe", variant: "base", reason: "nameplate BLEDSOE; off-center scan" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "1188d0ca-4421-4364-90ea-3543ee575fa0", number: "196", surname: "bailey", variant: "refractor", reason: "helmet tape BAILEY" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "6c369ab7-3826-4f7a-be33-3b645e7bb225", number: "196", surname: "bailey", variant: "base", reason: "helmet tape BAILEY" },
  { gameSetId: TOPPS_1994_FOOTBALL_SET_PREFIX, id: "c19b9f98-d2c7-4a4a-86e7-92972ba654b7", number: "205", surname: "teague", variant: "base", reason: "helmet tape EAGU" },
  // 2024 Basketball, Design full-pool sweep 2026-10-02 (19)
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "346cdebd-eda1-4a12-a723-ec64e25a323a", number: "22", surname: "james", variant: "refractor", reason: "Wrong player: image is a promo collage of tilted cards" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "d3c1ba34-7e6f-473f-9f62-697f4cf528e3", number: "32", surname: "bird", variant: "refractor", reason: "Wrong player: same promo collage image as LeBron #22 Refractor" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "175376f0-c51b-4d72-ac72-49ebe9c49c2a", number: "54", surname: "carter", variant: "orange geometric refractor", reason: "Vertical name plate on left edge reads VINCE CARTE" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "0d172f5a-6948-4783-b916-6fbf37e42762", number: "62", surname: "gordon", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "2654adcc-9364-4a5f-958e-0b3224321986", number: "68", surname: "hardaway", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "d6faed92-494a-4ab7-8313-94b01d315945", number: "89", surname: "barnes", variant: "negative refractor", reason: "Vertical name bar on left edge reads SCOTTIE BARNES in full" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "b3f5c0d2-6813-43b3-be49-29907036f670", number: "98", surname: "johnson", variant: "refractor", reason: "Wrong player: promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "5994c0a4-a95e-4b9a-8ede-36415ca0d535", number: "100", surname: "haliburton", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "02893810-01b0-4476-b478-77da70b38256", number: "101", surname: "durant", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "ac9ec93c-088e-4ee4-afcd-d680ca4875b6", number: "101", surname: "durant", variant: "magenta speckle refractor", reason: "Jersey front lettering DURANT fully legible above number 35" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "fa4302a4-245c-4575-addd-d4c6dd00d6c6", number: "115", surname: "olajuwon", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "2d4c92ea-f166-422d-815c-aad223a9d38b", number: "188", surname: "morant", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "80f42d00-b89a-4afe-b04c-78ded35ab344", number: "193", surname: "wembanyama", variant: "refractor", reason: "Wrong player: shared promo-collage image" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "7b14cfc2-370e-4528-a126-f894f5c2378e", number: "UVAS-1", surname: "wembanyama", variant: "base", reason: "UVAS art: huge vertical surname text on left reads ...ANYAMA" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "88b16fa0-b6c6-41b6-a770-a871857dbb4a", number: "UVAS-10", surname: "morant", variant: "base", reason: "UVAS art: vertical surname text reads ...ORANT" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "bb5f7b28-04f1-47cd-81a6-d512f8423fa8", number: "UVAS-11", surname: "edwards", variant: "base", reason: "UVAS art: vertical surname text reads ...WARDS" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "32b6710c-47ba-4b92-88f3-dbcce6b88df3", number: "UVAS-15", surname: "irving", variant: "base", reason: "UVAS art: vertical surname text reads IRVING in full plus first name KYRIE" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "dae3a6dc-b639-4171-a453-b5e7e623242e", number: "UVAS-5", surname: "brunson", variant: "base", reason: "UVAS art: vertical surname text reads ...UNSON" },
  { gameSetId: BASKETBALL_2024_SET_PREFIX, id: "4f7c5789-d5a8-4266-a17d-920cfb636bb5", number: "UVAS-7", surname: "jokic", variant: "base", reason: "UVAS art: vertical surname text reads JOKIC in full plus first name NIKOLA" },

  // 1987 Topps, Design full-pool sweep 2026-10-02 (37)
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "e6ea8202-b91f-4554-b1db-3f9b8f1a942f", number: "4", surname: "lopes", variant: "base", reason: "Name plate DAVE LOPES / HOUSTON ASTROS fully visible above the mask" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "a3f75e8e-23e8-49e7-aeb3-28b1e4c82af5", number: "13", surname: "esasky", variant: "base", reason: "Jersey back reads SASKY" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "bddc0554-76ac-48e3-9922-cfad7cb13dbc", number: "88", surname: "wojna", variant: "base", reason: "Whole card masked" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "3195b243-01d2-4df8-9ebc-02b393812767", number: "103", surname: "aguilera", variant: "base", reason: "Whole card masked" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "66186732-4d73-4c0b-ba1e-08a7bf79e4e0", number: "173", surname: "trevino", variant: "base", reason: "Jersey back reads" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "fdc3b1f6-6532-4d1d-b415-0394f109ec06", number: "303", surname: "berenguer", variant: "base", reason: "Jersey back reads BERENG above the #48" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "296e9366-3f07-44ab-b4b1-39175946d816", number: "311", surname: "henderson", variant: "base", reason: "Facsimile autograph Rickey Henderson on the inset 1982 card fully readable above" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "7b979f64-ba9e-44fc-bded-26a59e882afc", number: "312", surname: "jackson", variant: "base", reason: "Name plate YANKEES / REGGIE JACKSON / OUTFIELD fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "66a039a7-f233-447e-be90-240a376f9d3f", number: "315", surname: "wills", variant: "turn back the clock", reason: "Inset 1962 card caption MAURY fully readable and WILLS top halves readable right" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "0dce6af1-da04-454c-875f-f0ac4869065f", number: "323", surname: "newman", variant: "base", reason: "Jersey back reads NEWMAN" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "cb6d792d-b7ef-41b6-931a-cf525bd4b9e5", number: "345", surname: "dawson", variant: "autographs", reason: "Gold on-card autograph Andre Dawson" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "2f0d763e-55ab-4338-a814-5827d0190465", number: "377", surname: "johnson", variant: "base", reason: "Whole card masked" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "b2cbb699-730b-4d7d-ab96-ff8ea6f37b74", number: "461", surname: "mcmurtry", variant: "base", reason: "Jersey back reads McMURTR above the #29" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "128ce6d6-483d-4615-8524-34c34cdc5caf", number: "536", surname: "mulholland", variant: "base", reason: "Jersey back reads MULHOLLAND" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "95bfd0e8-72a4-41d1-aa7a-63cf68fdfb0e", number: "538", surname: "niedenfuer", variant: "base", reason: "Whole card masked" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "36daf665-d782-4df8-804b-d736309b1c15", number: "580", surname: "krukow", variant: "base", reason: "Jersey back reads KRUKOW above the #39" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "f1ba4fda-3293-4835-bbdc-80c03e55f539", number: "596", surname: "sax", variant: "base", reason: "All-Star name plate STEVE SAX fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "115a5770-e624-439c-8209-94b78c149389", number: "597", surname: "schmidt", variant: "all-star", reason: "All-Star name plate MIKE SCHMIDT fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "5357cba3-f14f-4136-9a0a-c263080128e0", number: "597", surname: "schmidt", variant: "base", reason: "All-Star name plate MIKE SCHMIDT fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "586f60c7-d209-43a1-b90a-f2d9ec2d0392", number: "598", surname: "smith", variant: "base", reason: "All-Star name plate OZZIE SMITH fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "63194380-7063-4626-8d69-bcb7342c3ff4", number: "599", surname: "gwynn", variant: "base", reason: "All-Star name plate TONY GWYNN fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "87c2944e-66cf-4cc4-a872-15cec25a98a8", number: "599", surname: "gwynn", variant: "all-star", reason: "All-Star name plate TONY GWYNN fully visible at top" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "ffaa271d-f0fd-4474-b4e8-624e048498f2", number: "600", surname: "parker", variant: "base", reason: "All-Star name plate DAVE PARKER fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "b69cf76b-f82a-4688-aae7-12fc56bb06b3", number: "603", surname: "gooden", variant: "no trademark", reason: "All-Star name plate DWIGHT GOODEN fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "e844f82c-dda2-4497-a956-572623ae8d61", number: "603", surname: "gooden", variant: "all-star", reason: "All-Star name plate DWIGHT GOODEN fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "acf579a3-b01d-4a9f-8a0b-0aebfb8664e8", number: "604", surname: "valenzuela", variant: "base", reason: "All-Star name plate FERNANDO VALENZUELA fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "1d0d1365-87e4-406d-96c2-94e0b224f4ec", number: "606", surname: "mattingly", variant: "no trademark", reason: "All-Star name plate DON MATTINGLY fully visible at top" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "65d3a13e-98f0-4404-aa4d-02b7df0ef016", number: "606", surname: "mattingly", variant: "base", reason: "All-Star name plate DON MATTINGLY fully visible at top" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "1556f885-0521-4cf8-a87c-51cdce912bcb", number: "609", surname: "ripken", variant: "base", reason: "All-Star name plate CAL RIPKEN fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "58650c14-7ee5-4b48-8073-ca02991236e5", number: "610", surname: "rice", variant: "all-star", reason: "All-Star name plate JIM RICE fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "d0a3473c-d15e-4012-a742-8b6bf8a43f21", number: "610", surname: "rice", variant: "base", reason: "Whole card masked" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "b10d0bd9-47f2-4472-8865-771377427760", number: "612", surname: "bell", variant: "base", reason: "All-Star name plate GEORGE BELL fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "2232bdaa-1a23-47d8-8b04-cfe89fceb09b", number: "616", surname: "righetti", variant: "base", reason: "All-Star name plate DAVE RIGHETTI fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "b7eea490-3bcc-4c2b-b7cb-3749a7c3ec0b", number: "616", surname: "righetti", variant: "all-star", reason: "All-Star name plate DAVE RIGHETTI fully visible at top of card" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "4914a815-0ad6-4ef5-8307-9321b4f2c011", number: "650", surname: "brooks", variant: "base", reason: "Jersey back reads BROOKS above the #7" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "f23d2f7a-00c6-430c-b7e7-1933dc211123", number: "739", surname: "lemon", variant: "base", reason: "Jersey back reads" },
  { gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, id: "5b4b7ebf-2474-4a5e-9927-be2d81e07c3c", number: "789", surname: "schatzeder", variant: "base", reason: "Whole card masked" },

  // 2022 Panini Chronicles Football, Design full-pool sweep 2026-10-02 (12)
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "8a7ea95e-c625-487b-ae32-5b55254fbb44", number: "8", surname: "watson", variant: "base", reason: "SGC slab label at top fully legible: #8 DESHAUN WATSON" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "1571856a-a375-4082-adfe-2062351c03a4", number: "38", surname: "gardner", variant: "base", reason: "Wrong player: image is Garrett Wilsons Photogenic PH-38 photo" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "f40cf68c-1bc2-4db8-848d-da5ab5056b40", number: "205", surname: "dotson", variant: "base", reason: "SGC slab label at top fully legible: #205 JAHAN DOTSON LUMINANCE" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "61e6a223-5fc3-4a2e-9c32-39215078de7c", number: "214", surname: "thibodeaux", variant: "base", reason: "SGC slab label at top fully legible: #214 KAYVON THIBODEAUX LEGACY" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "8c42a171-7128-4273-a348-c82e23967596", number: "218", surname: "olave", variant: "teal", reason: "Luminance script name on left side reads Chris Olave in full" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "ac66b3f1-7e37-4416-9d1b-c3c747689235", number: "219", surname: "hutchinson", variant: "base", reason: "Legacy script name on right edge reads ...tchinson" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "1f351ccb-ac0a-42d8-a2e5-a6f54d785770", number: "220", surname: "pierce", variant: "base", reason: "SGC slab label at top fully legible: #220 DAMEON PIERCE LEGACY" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "df2524dc-0dec-4161-94e7-0c8028471c47", number: "220", surname: "hall", variant: "base", reason: "Legacy script name on right edge reads Hall in full" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "b3a69477-9131-438d-ac9e-4de93b830993", number: "222", surname: "watson", variant: "base", reason: "Legacy script name on right edge reads Watso" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "fcf37481-2634-4661-8710-8c3d3239fac9", number: "PH-15", surname: "donald", variant: "base", reason: "Jersey back fully legible: DONALD 99 above the bottom mask" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "61a65ae7-4952-4e2b-8e4c-f04d0ac3ac4c", number: "PH-9", surname: "jacobs", variant: "base", reason: "SGC slab label at top fully legible: PH-9 JOSH JACOBS PHOTOGENIC" },
  { gameSetId: CHRONICLES_2022_FOOTBALL_SET_PREFIX, id: "9c6ccbd7-b564-46ef-9f8f-629fcda6a882", number: "PP-RAW", surname: "white", variant: "base", reason: "Vertical name strip on left edge reads RACHAAD WHITE in full" },

  // 1990 Hoops Basketball (12). Coach cards 343-354 print the coach's playing
  // name diagonally across the top and below the 18% band, with playing years.
  // The trusted profile band leaves part of it readable, and OCR does not read
  // the diagonal text. Every coach-legend card in the deal pool is blocked.
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "551ee60e-478f-4c75-b0ab-41c7217d00da", number: "343", surname: "jones", variant: "base", reason: "coach legend diagonal name JO + years" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "467667f7-1149-4270-a568-187ddb9b0ed1", number: "344", surname: "unseld", variant: "base", reason: "coach legend diagonal name UN + years" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "0a468fe3-721d-4e83-a580-cf3df5fc321b", number: "345", surname: "nelson", variant: "base", reason: "coach legend diagonal name NELS" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "41758b03-4135-4593-9fea-a63e2a38d5b6", number: "346", surname: "weiss", variant: "base", reason: "coach legend diagonal name WE + years" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "b077f597-97dd-49f5-800c-341fdda7f2a8", number: "347", surname: "ford", variant: "base", reason: "coach legend diagonal name FO + years" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "63e1216f-0d38-4239-af92-9bd067588c67", number: "348", surname: "jackson", variant: "base", reason: "coach legend diagonal name JACK" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "ffea1480-e2b9-485d-9f6e-6b9f7d12134d", number: "350", surname: "chaney", variant: "base", reason: "coach legend diagonal name CHA" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "a949ea98-bf2d-49fa-b51b-caf592986d81", number: "354", surname: "sloan", variant: "base", reason: "coach legend diagonal name SLO" },
  // Name printed outside the top plate. The OCR check refuses three of these
  // today; the block keeps them out if a later mask version re-bakes them.
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "2d9492f0-6f04-4a42-9ad6-cf2385938613", number: "382", surname: "jordan", variant: "base", reason: "vertical MICHAEL JORDAN'S PLAYGROUND strip" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "0a61f1ce-6a84-438f-acf6-d6d8c5e9d2c1", number: "391", surname: "payton", variant: "base", reason: "lottery pick GARY PAYTON bottom name" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "349a5190-a09e-4804-bd32-e2bcd50ed9cd", number: "63", surname: "grant", variant: "base", reason: "autograph across the photo" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "8aa2109c-53d4-4417-9cf9-0aae98e59de7", number: "NNO", surname: "robinson", variant: "base", reason: "ROOKIE OF THE YEAR DAVID ROBINSON mid-card text" },
  // Design clearance 2026-10-02 (4): Hoops goes GREEN on condition these are blocked.
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "fa62eec8-75b8-4624-ba6b-85b37dacf621", number: "110", surname: "salley", variant: "base", reason: "Knicks jersey back reads ..KLEY 34 (LEY ends SALLEY)" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "2d7222b3-9acf-4d5d-9b71-c700e22d535e", number: "339", surname: "pistons", variant: "base", reason: "team card: Portland jersey back reads PETROVIC 44" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "9e6319f6-40d3-4695-89c1-9c03d45a298d", number: "109", surname: "rodman", variant: "base", reason: "BLJH SPORTS seller watermark on the scan" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "badf917b-8887-4cd9-b923-5ab703592ca9", number: "422", surname: "westhead", variant: "base", reason: "band hides the coach's whole head (playability)" },
  // 1990 Hoops All-Star subset #1-26 (23 ids). Card-pool revalidation made these playable at the
  // clearance boot, after Design reviewed the 107-card pool. Two show a readable name on a jersey
  // back (#17 Green, #24 Robinson); all are held until Design reviews them.
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "941433b8-f6ba-417c-973b-33fc35d6325a", number: "1", surname: "barkley", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "07a77a6d-2948-476f-8f92-4a48218eea9b", number: "2", surname: "bird", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "7c628f44-b527-47e4-a7c6-b121fb2274ce", number: "3", surname: "dumars", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "95eaec4e-5570-444d-8267-9389510f3d57", number: "4", surname: "ewing", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "3ad93f9b-a88c-4ea7-a871-631f4d7a48cd", number: "5", surname: "jordan", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "8e49902d-ed15-4521-bbbf-918a164889d4", number: "6", surname: "mchale", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "0b59775d-9a4c-459c-8152-ff4a794cd2b9", number: "7", surname: "miller", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "cb9cf3eb-b8c1-4ef8-81cd-6ac2bccb76dd", number: "8", surname: "parish", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "cec031ac-781d-44a8-8fa0-6547f006e6c6", number: "8", surname: "parish", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "ccb8adde-c761-43b4-a41e-aa60686a2299", number: "9", surname: "pippen", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "0958ffad-e8c7-445d-a8ad-14380ec9457c", number: "11", surname: "thomas", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "248dcd40-29ac-483d-897b-71c119a1c3bd", number: "15", surname: "chambers", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "593b50f4-44d4-47af-8324-6f9274376813", number: "16", surname: "drexler", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "3905b67e-e6cf-413d-90c0-05997d4caddc", number: "17", surname: "green", variant: "base", reason: "teammate jersey back reads BARKLEY" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "5648feda-8ff0-4c69-8276-d675a933aa20", number: "18", surname: "johnson", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "7eb0eaa5-5f85-4cd9-ab61-59d7894ed74e", number: "19", surname: "johnson", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "0705b462-06a6-4258-a038-461660da7e04", number: "20", surname: "lever", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "7cdc6abb-5679-4830-95c9-e3041057f73f", number: "21", surname: "malone", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "775e6ba0-abf6-46a6-9d36-a998d16903f3", number: "23", surname: "olajuwon", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "ae15a554-385d-43d7-8bde-4ad06e932f31", number: "23", surname: "olajuwon", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "c197de24-b783-465a-ae95-06fbd3975975", number: "24", surname: "robinson", variant: "base", reason: "opponent jersey back reads BARKL" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "a8ccae95-5f14-49b5-b98c-d43f8dd379b0", number: "25", surname: "stockton", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
  { gameSetId: HOOPS_1990_SET_PREFIX, id: "a0f0f135-eb0f-4436-b022-ab3d73699be0", number: "26", surname: "worthy", variant: "base", reason: "All-Star subset card revalidated at the clearance boot; not in Design's 107-card review, held pending review" },
];

export type BlockedSetNumberRule = {
  gameSetId: string;
  prefix?: boolean;
  number: string;
};

/**
 * 1987 Topps baseball All-Star subset, #595-616. The All-Star design puts the
 * name plate at the top of the card, and the mask covers only the bottom, so
 * every card in the range leaks (Design sweep 2026-10-02). Blocked by number
 * on this set only, so a re-import with new ids stays blocked. Base cards of
 * the same players (Schmidt #430, Mattingly #500, ...) stay playable.
 */
export const TOPPS_1987_ALL_STAR_FIRST = 595;
export const TOPPS_1987_ALL_STAR_LAST = 616;

/**
 * Whole checklist numbers blocked on one set. The old 1987 Topps number-28
 * rule is gone (it also caught Rick Dempsey #28); Schmidt stays blocked by id.
 */
export const BLOCKED_SET_NUMBERS: readonly BlockedSetNumberRule[] = Array.from(
  { length: TOPPS_1987_ALL_STAR_LAST - TOPPS_1987_ALL_STAR_FIRST + 1 },
  (_, i) => ({ gameSetId: TOPPS_1987_BASEBALL_SET_PREFIX, prefix: true, number: String(TOPPS_1987_ALL_STAR_FIRST + i) }),
);

export type CardNumberPatternRule = {
  gameSetId: string;
  prefix?: boolean;
  numberPattern: RegExp;
  /** POSIX form of `numberPattern`, matched with `~*` on the normalized number. */
  sqlPattern: string;
};

export const CARD_NUMBER_PATTERN_RULES: readonly CardNumberPatternRule[] = [
  {
    // Stays until a side-strip mask profile exists.
    gameSetId: BASKETBALL_2024_SET_PREFIX,
    prefix: true,
    numberPattern: BASKETBALL_2024_H_INSERT_NUMBER,
    sqlPattern: "^H-[0-9]+$",
  },
  {
    // Stays until a mask template exists for the UVAS vertical surname art.
    gameSetId: BASKETBALL_2024_SET_PREFIX,
    prefix: true,
    numberPattern: BASKETBALL_2024_UVAS_NUMBER,
    sqlPattern: "^UVAS-[0-9]+$",
  },
];

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

/**
 * One boot line per set that has an id, checklist-number, or number-pattern
 * leak rule. Counts are the rules on that set, same `[blocklist] set=` shape
 * as the Record Breaker and multi-player lines.
 */
export function leakBlocklistLogLines(): string[] {
  const counts = new Map<string, { ids: number; numbers: number; patterns: number }>();
  const touch = (setId: string) => {
    const key = setId.slice(0, 8).toLowerCase();
    let row = counts.get(key);
    if (!row) {
      row = { ids: 0, numbers: 0, patterns: 0 };
      counts.set(key, row);
    }
    return row;
  };
  for (const rule of BLOCKED_CARD_ID_RULES) touch(rule.gameSetId).ids += 1;
  for (const rule of BLOCKED_SET_NUMBERS) touch(rule.gameSetId).numbers += 1;
  for (const rule of CARD_NUMBER_PATTERN_RULES) touch(rule.gameSetId).patterns += 1;
  return [...counts.entries()].map(([setId, row]) =>
    `[blocklist] set=${setId} blockedIds=${row.ids} blockedNumbers=${row.numbers} blockedPatterns=${row.patterns}`,
  );
}

/** Boot lines: the 1987 Record Breaker subset, then one multi-player line per vintage set. */
export function logCardBlocklist(): void {
  console.log(recordBreakerBlocklistLogLine());
  for (const line of multiPlayerBlocklistLogLines()) console.log(line);
  for (const line of leakBlocklistLogLines()) console.log(line);
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

function rowCardId(fields?: BlocklistCardFields | null): string {
  return norm(fields?.id || fields?.cardId);
}

function variantMatches(ruleVariant: string, variant: string | null | undefined): boolean {
  const value = (variant || "").trim().toLowerCase();
  if (ruleVariant === "base") return value === "" || value === "base";
  return value === ruleVariant;
}

/** Same row after a purge-and-reimport gave it a new id. */
function reimportedBlockedRow(setId: string, player: string, fields?: BlocklistCardFields | null): boolean {
  if (!setId || !player) return false;
  const number = normalizeCardNumber(fields?.number);
  if (!number) return false;
  return BLOCKED_CARD_ID_RULES.some((rule) =>
    sameSet(setId, rule.gameSetId, true)
    && number === rule.number
    && player.includes(rule.surname)
    && variantMatches(rule.variant, fields?.variant));
}

function blockedByCardId(fields?: BlocklistCardFields | null): boolean {
  const id = rowCardId(fields);
  return id.length > 0 && BLOCKED_CARD_ID_RULES.some((rule) => rule.id.toLowerCase() === id);
}

/**
 * True when a BLOCKED_CARD_ID_RULES row matches this card by id, or by set +
 * number + surname + variant after a re-import. Card-pool refresh uses this
 * so it never restores one of those cards.
 */
export function isBlockedCardIdRow(card: {
  id?: string | null;
  gameSetId?: string | null;
  player?: string | null;
  number?: string | null;
  variant?: string | null;
}): boolean {
  return blockedByCardId(card) || reimportedBlockedRow(norm(card.gameSetId), norm(card.player), card);
}

function blockedSetNumber(setId: string, number: string): boolean {
  if (!setId || !number) return false;
  return BLOCKED_SET_NUMBERS.some((rule) => sameSet(setId, rule.gameSetId, rule.prefix) && number === rule.number);
}

function blockedNumberPattern(setId: string, number: string): boolean {
  if (!setId || !number) return false;
  return CARD_NUMBER_PATTERN_RULES.some((rule) => sameSet(setId, rule.gameSetId, rule.prefix) && rule.numberPattern.test(number));
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
  if (isHeldSet(gameSetId)) return true;
  const setId = norm(gameSetId);
  const name = norm(player);
  if (blockedByCardId(fields) || reimportedBlockedRow(setId, name, fields)) return true;
  if (setId && name && CARD_BLOCKLIST.some((entry) => sameSet(setId, entry.gameSetId, entry.prefix) && playerMatchesEntry(name, entry))) {
    return true;
  }
  if (playerNamesManyPeople(player) || multiPlayerText(player, fields)) return true;
  const number = normalizeCardNumber(fields?.number);
  if (setId && (multiPlayerNumber(setId, number) || leakedChecklistNumber(setId, number) || blockedSetNumber(setId, number) || blockedNumberPattern(setId, number))) return true;
  if (setId !== TOPPS_1987_FOOTBALL_SET_ID) return false;
  if (number && (RECORD_BREAKER_NUMBERS.has(number) || number === TOPPS_1987_FOOTBALL_HALEY_NUMBER)) return true;
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

function haleyNumberClause(alias: CardAlias): string {
  return `(lower(${alias}.game_set_id) = ${sqlQuote(TOPPS_1987_FOOTBALL_SET_ID)} AND ${normalizedNumberSql(alias)} = ${sqlQuote(TOPPS_1987_FOOTBALL_HALEY_NUMBER)})`;
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

function variantClause(alias: CardAlias, ruleVariant: string): string {
  const col = `lower(btrim(COALESCE(${alias}.variant, '')))`;
  return ruleVariant === "base"
    ? `${col} IN ('', 'base')`
    : `${col} = ${sqlQuote(ruleVariant)}`;
}

/**
 * Blocked card ids, plus the same rows after a purge-and-reimport (set prefix +
 * normalized number + surname + variant). Mirrors isBlockedCardIdRow.
 */
export function blockedCardIdClause(alias: CardAlias): string {
  return BLOCKED_CARD_ID_RULES
    .map((rule) => {
      const byId = `lower(${alias}.id) = ${sqlQuote(rule.id.toLowerCase())}`;
      const byRow = `(lower(${alias}.game_set_id) LIKE ${sqlQuote(`${rule.gameSetId.toLowerCase()}%`)}`
        + ` AND ${normalizedNumberSql(alias)} = ${sqlQuote(rule.number)}`
        + ` AND strpos(lower(COALESCE(${alias}.player, '')), ${sqlQuote(rule.surname)}) > 0`
        + ` AND ${variantClause(alias, rule.variant)})`;
      return `${byId} OR ${byRow}`;
    })
    .join(" OR ");
}

function blockedSetNumberClause(alias: CardAlias): string {
  return BLOCKED_SET_NUMBERS.map((rule) => {
    const setMatch = rule.prefix
      ? `lower(${alias}.game_set_id) LIKE ${sqlQuote(`${rule.gameSetId.toLowerCase()}%`)}`
      : `lower(${alias}.game_set_id) = ${sqlQuote(rule.gameSetId.toLowerCase())}`;
    return `(${setMatch} AND ${normalizedNumberSql(alias)} = ${sqlQuote(rule.number)})`;
  }).join(" OR ");
}

function numberPatternClause(alias: CardAlias): string {
  return CARD_NUMBER_PATTERN_RULES.map((rule) => {
    const setMatch = rule.prefix
      ? `lower(${alias}.game_set_id) LIKE ${sqlQuote(`${rule.gameSetId.toLowerCase()}%`)}`
      : `lower(${alias}.game_set_id) = ${sqlQuote(rule.gameSetId.toLowerCase())}`;
    return `(${setMatch} AND ${normalizedNumberSql(alias)} ~* ${sqlQuote(rule.sqlPattern)})`;
  }).join(" OR ");
}

function heldSetClause(alias: CardAlias): string | null {
  const ids: readonly string[] = currentHeldSetIds();
  if (ids.length === 0) return null;
  const list = ids.map((id) => sqlQuote(id.toLowerCase())).join(", ");
  return `lower(${alias}.game_set_id) IN (${list})`;
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

export type BlocklistSqlOpts = {
  /** QA review lists cards as they would deal if the hold were lifted. */
  ignoreHeldSets?: boolean;
};

/** OR-clauses for a deal WHERE body. True when any blocklist rule hits. */
export function cardBlocklistWhereBody(alias: CardAlias, opts?: BlocklistSqlOpts): string {
  const clauses = [
    ...CARD_BLOCKLIST.map((entry) => blockClause(alias, entry)),
    recordBreakerNumberClause(alias),
    haleyNumberClause(alias),
    blockedCardIdClause(alias),
    blockedSetNumberClause(alias),
    numberPatternClause(alias),
    recordBreakerTextClause(alias),
    multiPlayerTextClause(alias),
    multiPlayerPeopleClause(alias),
    multiPlayerNumberClause(alias),
  ];
  if (!opts?.ignoreHeldSets) {
    const held = heldSetClause(alias);
    if (held) clauses.push(held);
  }
  // An empty rule list renders "". Joining it would leave a bare "OR OR".
  return clauses.filter((clause) => clause.trim().length > 0).join(" OR ");
}

/** SQL body for a deal WHERE clause. True when the card is not on the blocklist. */
export function cardNotBlockedSql(alias: CardAlias, opts?: BlocklistSqlOpts): SQL {
  return sql`NOT (${sql.raw(cardBlocklistWhereBody(alias, opts))})`;
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
  blockedReason?: string | null;
  number?: string | null;
  variant?: string | null;
  description?: string | null;
}): boolean {
  return isBlockedCard(row.gameSetId, row.player, row)
    || isMaskBandExcluded(row.cardId)
    || refusedAtCurrentMask({ id: row.cardId, blockedReason: row.blockedReason }) != null;
}

/**
 * A stored Daily 5 hand for today or a later date. A blocked, oversized-band,
 * or current-mask-version refused card is rewritten to the next eligible card
 * in the set before the client sees it. A past date is left alone. Returns
 * how many unservable cards remain.
 */
export async function replaceBlockedDaily5Cards(challengeId: string, today = getPackptsDayKey()): Promise<number> {
  const [challenge] = await db
    .select({ id: dailyChallenges.id, date: dailyChallenges.date, setId: dailyChallenges.setId })
    .from(dailyChallenges)
    .where(eq(dailyChallenges.id, challengeId))
    .limit(1);
  if (!challenge || challenge.date < today) return 0;

  const rows = await db
    .select({
      id: dailyChallengeCards.id,
      position: dailyChallengeCards.position,
      cardId: dailyChallengeCards.cardId,
      correctAnswer: dailyChallengeCards.correctAnswer,
      choices: dailyChallengeCards.choices,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      blockedReason: playableCards.blockedReason,
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
      && refusedAtCurrentMask(card) == null
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
    const maskRefusal = refusedAtCurrentMask({ id: row.cardId, blockedReason: row.blockedReason });
    if (maskRefusal) {
      console.log(`[Daily5] mask refusal swapped date=${challenge.date} slot=${row.position} old=${row.cardId} new=${next.id} reason=${maskRefusal}`);
    } else {
      console.log(`[Daily5] blocklist swapped date=${challenge.date} slot=${row.position} old=${row.cardId} new=${next.id}`);
    }
  }

  const left = await db
    .select({
      cardId: dailyChallengeCards.cardId,
      gameSetId: playableCards.gameSetId,
      player: playableCards.player,
      blockedReason: playableCards.blockedReason,
      number: playableCards.number,
      variant: playableCards.variant,
      description: playableCards.description,
    })
    .from(dailyChallengeCards)
    .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
    .where(eq(dailyChallengeCards.dailyChallengeId, challengeId));
  return left.filter((row) => cardUnservable(row)).length;
}

/**
 * Serve-time pass for every stored Daily 5 whose date is today or later.
 * A hand saved before a blocklist rule, or still pointing at a card the
 * current mask version refused, is rewritten here. Past dates are not selected.
 */
export async function sweepBlockedDaily5Deals(today = getPackptsDayKey()): Promise<number> {
  const open = await db
    .select({ id: dailyChallenges.id })
    .from(dailyChallenges)
    .where(gte(dailyChallenges.date, today));
  let left = 0;
  for (const row of open) {
    left += await replaceBlockedDaily5Cards(row.id, today);
  }
  return left;
}
