/**
 * Design full-pool sweep 2026-10-02: 68 cards blocked by id (2024 Basketball 19,
 * 1987 Topps 37, 2022 Chronicles 12) on every deal path, the 1987 Topps
 * All-Star range #595-616 blocked by number on that set, and the 2024
 * Basketball UVAS subset blocked as a number family. Refresh cannot restore
 * any of them and a purge-and-reimport row with a new id stays blocked.
 */
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { daily5Service } from "../services/daily5Service";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { setPinnedCoversForTests } from "../config/pinnedCovers";
import { clearReadyCoverIndexForTests, eligibleCoverFile, resolvePinnedCoverReports } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import { cardPoolRefreshCandidateFilter, restorePlayableIfMaskAllows } from "../services/cardPoolRefresh";
import { eligibleDealFilter } from "../services/playableSetEligibility";
import {
  BLOCKED_CARD_ID_RULES,
  BLOCKED_SET_NUMBERS,
  CARD_NUMBER_PATTERN_RULES,
  cardBlocklistWhereBody,
  isBlockedCard,
  isBlockedCardIdRow,
  leakBlocklistLogLines,
  replaceBlockedDaily5Cards,
} from "../lib/cardBlocklist";

type SetKey = "2024-basketball" | "1987-topps" | "2022-chronicles";
type Sweep = { id: string; set: SetKey; player: string; number: string; variant: string };

/** sweep-design-20261002/<set>/BLOCKS.json, in file order. */
const SWEEP: readonly Sweep[] = [
  { set: "2024-basketball", id: "346cdebd-eda1-4a12-a723-ec64e25a323a", player: "LeBron James", number: "22", variant: "Refractor" },
  { set: "2024-basketball", id: "d3c1ba34-7e6f-473f-9f62-697f4cf528e3", player: "Larry Bird", number: "32", variant: "Refractor" },
  { set: "2024-basketball", id: "175376f0-c51b-4d72-ac72-49ebe9c49c2a", player: "Vince Carter", number: "54", variant: "Orange Geometric Refractor" },
  { set: "2024-basketball", id: "0d172f5a-6948-4783-b916-6fbf37e42762", player: "Aaron Gordon", number: "62", variant: "Refractor" },
  { set: "2024-basketball", id: "2654adcc-9364-4a5f-958e-0b3224321986", player: "Anfernee Hardaway", number: "68", variant: "Refractor" },
  { set: "2024-basketball", id: "d6faed92-494a-4ab7-8313-94b01d315945", player: "Scottie Barnes", number: "89", variant: "Negative Refractor" },
  { set: "2024-basketball", id: "b3f5c0d2-6813-43b3-be49-29907036f670", player: "Larry Johnson", number: "98", variant: "Refractor" },
  { set: "2024-basketball", id: "5994c0a4-a95e-4b9a-8ede-36415ca0d535", player: "Tyrese Haliburton", number: "100", variant: "Refractor" },
  { set: "2024-basketball", id: "02893810-01b0-4476-b478-77da70b38256", player: "Kevin Durant", number: "101", variant: "Refractor" },
  { set: "2024-basketball", id: "ac9ec93c-088e-4ee4-afcd-d680ca4875b6", player: "Kevin Durant", number: "101", variant: "Magenta Speckle Refractor" },
  { set: "2024-basketball", id: "fa4302a4-245c-4575-addd-d4c6dd00d6c6", player: "Hakeem Olajuwon", number: "115", variant: "Refractor" },
  { set: "2024-basketball", id: "2d4c92ea-f166-422d-815c-aad223a9d38b", player: "Ja Morant", number: "188", variant: "Refractor" },
  { set: "2024-basketball", id: "80f42d00-b89a-4afe-b04c-78ded35ab344", player: "Victor Wembanyama", number: "193", variant: "Refractor" },
  { set: "2024-basketball", id: "7b14cfc2-370e-4528-a126-f894f5c2378e", player: "Victor Wembanyama", number: "UVAS-1", variant: "Base" },
  { set: "2024-basketball", id: "88b16fa0-b6c6-41b6-a770-a871857dbb4a", player: "Ja Morant", number: "UVAS-10", variant: "Base" },
  { set: "2024-basketball", id: "bb5f7b28-04f1-47cd-81a6-d512f8423fa8", player: "Anthony Edwards", number: "UVAS-11", variant: "Base" },
  { set: "2024-basketball", id: "32b6710c-47ba-4b92-88f3-dbcce6b88df3", player: "Kyrie Irving", number: "UVAS-15", variant: "Base" },
  { set: "2024-basketball", id: "dae3a6dc-b639-4171-a453-b5e7e623242e", player: "Jalen Brunson", number: "UVAS-5", variant: "Base" },
  { set: "2024-basketball", id: "4f7c5789-d5a8-4266-a17d-920cfb636bb5", player: "Nikola Jokic", number: "UVAS-7", variant: "Base" },
  { set: "1987-topps", id: "e6ea8202-b91f-4554-b1db-3f9b8f1a942f", player: "Dave Lopes", number: "4", variant: "Base" },
  { set: "1987-topps", id: "a3f75e8e-23e8-49e7-aeb3-28b1e4c82af5", player: "Nick Esasky", number: "13", variant: "Base" },
  { set: "1987-topps", id: "bddc0554-76ac-48e3-9922-cfad7cb13dbc", player: "Ed Wojna", number: "88", variant: "Base" },
  { set: "1987-topps", id: "3195b243-01d2-4df8-9ebc-02b393812767", player: "Rick Aguilera", number: "103", variant: "Base" },
  { set: "1987-topps", id: "66186732-4d73-4c0b-ba1e-08a7bf79e4e0", player: "Alex Trevino", number: "173", variant: "Base" },
  { set: "1987-topps", id: "fdc3b1f6-6532-4d1d-b415-0394f109ec06", player: "Juan Berenguer", number: "303", variant: "Base" },
  { set: "1987-topps", id: "296e9366-3f07-44ab-b4b1-39175946d816", player: "Rickey Henderson", number: "311", variant: "Base" },
  { set: "1987-topps", id: "7b979f64-ba9e-44fc-bded-26a59e882afc", player: "Reggie Jackson", number: "312", variant: "Base" },
  { set: "1987-topps", id: "66a039a7-f233-447e-be90-240a376f9d3f", player: "Maury Wills", number: "315", variant: "Turn Back the Clock" },
  { set: "1987-topps", id: "0dce6af1-da04-454c-875f-f0ac4869065f", player: "Al Newman", number: "323", variant: "Base" },
  { set: "1987-topps", id: "cb6d792d-b7ef-41b6-931a-cf525bd4b9e5", player: "Andre Dawson", number: "345", variant: "Autographs" },
  { set: "1987-topps", id: "2f0d763e-55ab-4338-a814-5827d0190465", player: "John Henry Johnson", number: "377", variant: "Base" },
  { set: "1987-topps", id: "b2cbb699-730b-4d7d-ab96-ff8ea6f37b74", player: "Craig McMurtry", number: "461", variant: "Base" },
  { set: "1987-topps", id: "128ce6d6-483d-4615-8524-34c34cdc5caf", player: "Terry Mulholland", number: "536", variant: "Base" },
  { set: "1987-topps", id: "95bfd0e8-72a4-41d1-aa7a-63cf68fdfb0e", player: "Tom Niedenfuer", number: "538", variant: "Base" },
  { set: "1987-topps", id: "36daf665-d782-4df8-804b-d736309b1c15", player: "Mike Krukow", number: "580", variant: "Base" },
  { set: "1987-topps", id: "f1ba4fda-3293-4835-bbdc-80c03e55f539", player: "Steve Sax", number: "596", variant: "Base" },
  { set: "1987-topps", id: "115a5770-e624-439c-8209-94b78c149389", player: "Mike Schmidt", number: "597", variant: "All-Star" },
  { set: "1987-topps", id: "5357cba3-f14f-4136-9a0a-c263080128e0", player: "Mike Schmidt", number: "597", variant: "Base" },
  { set: "1987-topps", id: "586f60c7-d209-43a1-b90a-f2d9ec2d0392", player: "Ozzie Smith", number: "598", variant: "Base" },
  { set: "1987-topps", id: "63194380-7063-4626-8d69-bcb7342c3ff4", player: "Tony Gwynn", number: "599", variant: "Base" },
  { set: "1987-topps", id: "87c2944e-66cf-4cc4-a872-15cec25a98a8", player: "Tony Gwynn", number: "599", variant: "All-Star" },
  { set: "1987-topps", id: "ffaa271d-f0fd-4474-b4e8-624e048498f2", player: "Dave Parker", number: "600", variant: "Base" },
  { set: "1987-topps", id: "b69cf76b-f82a-4688-aae7-12fc56bb06b3", player: "Dwight Gooden", number: "603", variant: "No Trademark" },
  { set: "1987-topps", id: "e844f82c-dda2-4497-a956-572623ae8d61", player: "Dwight Gooden", number: "603", variant: "All-Star" },
  { set: "1987-topps", id: "acf579a3-b01d-4a9f-8a0b-0aebfb8664e8", player: "Fernando Valenzuela", number: "604", variant: "Base" },
  { set: "1987-topps", id: "1d0d1365-87e4-406d-96c2-94e0b224f4ec", player: "Don Mattingly", number: "606", variant: "No Trademark" },
  { set: "1987-topps", id: "65d3a13e-98f0-4404-aa4d-02b7df0ef016", player: "Don Mattingly", number: "606", variant: "Base" },
  { set: "1987-topps", id: "1556f885-0521-4cf8-a87c-51cdce912bcb", player: "Cal Ripken Jr.", number: "609", variant: "Base" },
  { set: "1987-topps", id: "58650c14-7ee5-4b48-8073-ca02991236e5", player: "Jim Rice", number: "610", variant: "All-Star" },
  { set: "1987-topps", id: "d0a3473c-d15e-4012-a742-8b6bf8a43f21", player: "Jim Rice", number: "610", variant: "Base" },
  { set: "1987-topps", id: "b10d0bd9-47f2-4472-8865-771377427760", player: "George Bell", number: "612", variant: "Base" },
  { set: "1987-topps", id: "2232bdaa-1a23-47d8-8b04-cfe89fceb09b", player: "Dave Righetti", number: "616", variant: "Base" },
  { set: "1987-topps", id: "b7eea490-3bcc-4c2b-b7cb-3749a7c3ec0b", player: "Dave Righetti", number: "616", variant: "All-Star" },
  { set: "1987-topps", id: "4914a815-0ad6-4ef5-8307-9321b4f2c011", player: "Hubie Brooks", number: "650", variant: "Base" },
  { set: "1987-topps", id: "f23d2f7a-00c6-430c-b7e7-1933dc211123", player: "Chet Lemon", number: "739", variant: "Base" },
  { set: "1987-topps", id: "5b4b7ebf-2474-4a5e-9927-be2d81e07c3c", player: "Dan Schatzeder", number: "789", variant: "Base" },
  { set: "2022-chronicles", id: "8a7ea95e-c625-487b-ae32-5b55254fbb44", player: "Deshaun Watson", number: "8", variant: "Base" },
  { set: "2022-chronicles", id: "1571856a-a375-4082-adfe-2062351c03a4", player: "Ahmad \"Sauce\" Gardner", number: "38", variant: "Base" },
  { set: "2022-chronicles", id: "f40cf68c-1bc2-4db8-848d-da5ab5056b40", player: "Jahan Dotson", number: "205", variant: "Base" },
  { set: "2022-chronicles", id: "61e6a223-5fc3-4a2e-9c32-39215078de7c", player: "Kayvon Thibodeaux", number: "214", variant: "Base" },
  { set: "2022-chronicles", id: "8c42a171-7128-4273-a348-c82e23967596", player: "Chris Olave", number: "218", variant: "Teal" },
  { set: "2022-chronicles", id: "ac66b3f1-7e37-4416-9d1b-c3c747689235", player: "Aidan Hutchinson", number: "219", variant: "Base" },
  { set: "2022-chronicles", id: "1f351ccb-ac0a-42d8-a2e5-a6f54d785770", player: "Dameon Pierce", number: "220", variant: "Base" },
  { set: "2022-chronicles", id: "df2524dc-0dec-4161-94e7-0c8028471c47", player: "Breece Hall", number: "220", variant: "Base" },
  { set: "2022-chronicles", id: "b3a69477-9131-438d-ac9e-4de93b830993", player: "Christian Watson", number: "222", variant: "Base" },
  { set: "2022-chronicles", id: "fcf37481-2634-4661-8710-8c3d3239fac9", player: "Aaron Donald", number: "PH-15", variant: "Base" },
  { set: "2022-chronicles", id: "61a65ae7-4952-4e2b-8e4c-f04d0ac3ac4c", player: "Josh Jacobs", number: "PH-9", variant: "Base" },
  { set: "2022-chronicles", id: "9c6ccbd7-b564-46ef-9f8f-629fcda6a882", player: "Rachaad White", number: "PP-RAW", variant: "Base" },
];
const SWEEP_IDS = SWEEP.map((row) => row.id);
const LIVE_PREFIX: Record<SetKey, string> = { "2024-basketball": "229f0379", "1987-topps": "37fd025d", "2022-chronicles": "74885a41" };
const KEYS = Object.keys(LIVE_PREFIX) as SetKey[];

const stamp = randomUUID().slice(0, 8);
const prefix = `bldesign:${stamp}:`;
function scopedSetId(prefix8: string): string {
  return `${prefix8}${randomUUID().slice(8)}`;
}
const SETS: Record<SetKey, { id: string; sport: string; year: number; name: string }> = {
  "2024-basketball": { id: scopedSetId("229f0379"), sport: "basketball", year: 2024, name: "2024 Basketball" },
  "1987-topps": { id: scopedSetId("37fd025d"), sport: "baseball", year: 1987, name: "1987 Topps" },
  "2022-chronicles": { id: scopedSetId("74885a41"), sport: "football", year: 2022, name: "2022 Panini Chronicles Football" },
};
/** A set whose prefix has none of these rules: the same numbers stay playable there. */
const OTHER_SET = { id: scopedSetId("aea515e2"), sport: "basketball", year: 1989, name: "1989 Fleer" };

const fillerIds = new Map<SetKey, string[]>();
const challengeIds: string[] = [];
const ids = {
  parrish613: randomUUID(),
  allStar595: randomUUID(),
  base594: randomUUID(),
  base617: randomUUID(),
  schmidt430: randomUUID(),
  mattingly500: randomUUID(),
  uvas3: randomUUID(),
  durantBase: randomUUID(),
  jamesBase: randomUUID(),
  otherSet600: randomUUID(),
  otherSetUvas: randomUUID(),
};
let dir = "";

function row(id: string, setId: string, setName: string, sport: string, player: string, number: string, variant: string | null) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `${prefix}${id}`,
    player,
    set: `${setName} ${stamp}`,
    description: player,
    number,
    variant,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: sport,
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
  };
}
function setRow(id: string, key: SetKey, player: string, number: string, variant: string | null) {
  const set = SETS[key];
  return row(id, set.id, set.name, set.sport, player, number, variant);
}

async function bake(cardId: string) {
  await writeFile(path.join(dir, warmOkMarkerFilename(cardId)), "ok\n");
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from(`masked-${cardId}`));
}

async function dealableAmong(list: string[]): Promise<Set<string>> {
  const rows = await db.select({ id: playableCards.id }).from(playableCards)
    .where(and(inArray(playableCards.id, list), eligibleDealFilter("playable_cards")));
  return new Set(rows.map((r) => r.id));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bldesign-"));
  setMaskReadySidecarDirForTests(dir);
  await db.delete(playableCards).where(inArray(playableCards.id, SWEEP_IDS));
  for (const set of [...Object.values(SETS), OTHER_SET]) {
    await db.insert(gameSets).values({
      id: set.id, sport: set.sport, brand: "Topps", year: set.year,
      setName: `${set.name} ${stamp}`, isUserCreated: true, isActive: true,
    });
  }
  const rows = SWEEP.map((card) => setRow(card.id, card.set, card.player, card.number, card.variant));
  for (const key of KEYS) {
    const list = Array.from({ length: 8 }, () => randomUUID());
    fillerIds.set(key, list);
    list.forEach((id, i) => rows.push(setRow(id, key, `Filler ${key} ${i + 1}`, String(900 + i), "Base")));
  }
  rows.push(setRow(ids.parrish613, "1987-topps", "Lance Parrish", "613", "Base"));
  rows.push(setRow(ids.allStar595, "1987-topps", "Some All-Star", "#595", "Base"));
  rows.push(setRow(ids.base594, "1987-topps", "Card Ninety Four", "594", "Base"));
  rows.push(setRow(ids.base617, "1987-topps", "Card Seventeen", "617", "Base"));
  rows.push(setRow(ids.schmidt430, "1987-topps", "Mike Schmidt", "430", "Base"));
  rows.push(setRow(ids.mattingly500, "1987-topps", "Don Mattingly", "500", "Base"));
  rows.push(setRow(ids.uvas3, "2024-basketball", "Luka Doncic", "UVAS-3", "Base"));
  rows.push(setRow(ids.durantBase, "2024-basketball", "Kevin Durant", "101", "Base"));
  rows.push(setRow(ids.jamesBase, "2024-basketball", "LeBron James", "22", "Base"));
  rows.push(row(ids.otherSet600, OTHER_SET.id, OTHER_SET.name, OTHER_SET.sport, "Other Set Player", "600", "Base"));
  rows.push(row(ids.otherSetUvas, OTHER_SET.id, OTHER_SET.name, OTHER_SET.sport, "Other Set Uvas", "UVAS-1", "Base"));
  await db.insert(playableCards).values(rows);
  for (const r of rows) await bake(r.id);
  clearReadyCoverIndexForTests();
});

afterAll(async () => {
  for (const key of KEYS) setPinnedCoversForTests(SETS[key].id, null);
  if (challengeIds.length > 0) {
    await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds)).catch(() => null);
    await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds)).catch(() => null);
  }
  await db.delete(playableCards).where(like(playableCards.cardhedgeCardId, `${prefix}%`)).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, [...Object.values(SETS), OTHER_SET].map((set) => set.id))).catch(() => null);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

describe("Design full-pool sweep: the 68 ids", () => {
  it("lists every Design id with its set, number, surname, and variant", () => {
    expect(SWEEP).toHaveLength(68);
    expect(new Set(SWEEP_IDS).size).toBe(68);
    expect(SWEEP.filter((c) => c.set === "2024-basketball")).toHaveLength(19);
    expect(SWEEP.filter((c) => c.set === "1987-topps")).toHaveLength(37);
    expect(SWEEP.filter((c) => c.set === "2022-chronicles")).toHaveLength(12);
    const rules = new Map(BLOCKED_CARD_ID_RULES.map((rule) => [rule.id, rule]));
    for (const card of SWEEP) {
      const rule = rules.get(card.id);
      expect(rule, card.id).toBeTruthy();
      expect(rule!.gameSetId).toBe(LIVE_PREFIX[card.set]);
      expect(rule!.number).toBe(card.number);
      expect(card.player.toLowerCase()).toContain(rule!.surname);
      expect(rule!.variant).toBe(card.variant.toLowerCase());
    }
  });

  it("blocks each id in isBlockedCard and in the SQL predicate, whatever the player field says", () => {
    const body = cardBlocklistWhereBody("playable_cards");
    for (const card of SWEEP) {
      expect(isBlockedCard(SETS[card.set].id, card.player, { id: card.id, number: card.number, variant: card.variant }), card.id).toBe(true);
      expect(isBlockedCard(SETS[card.set].id, "Someone Else", { id: card.id }), card.id).toBe(true);
      expect(isBlockedCard(SETS[card.set].id, card.player, { cardId: card.id }), card.id).toBe(true);
      expect(body).toContain(`lower(playable_cards.id) = '${card.id}'`);
    }
  });

  it("drops every id from the shared deal filter and keeps the fillers", async () => {
    const fillers = KEYS.flatMap((key) => fillerIds.get(key)!);
    const kept = await dealableAmong([...SWEEP_IDS, ...fillers]);
    for (const id of SWEEP_IDS) expect(kept.has(id), id).toBe(false);
    for (const id of fillers) expect(kept.has(id), id).toBe(true);
  });

  it("never deals a blocked id in a solo stack", async () => {
    for (const key of KEYS) {
      for (let i = 0; i < 3; i++) {
        const dealt = await storage.getRandomCardsFromSet(SETS[key].id, 60);
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.some((card) => SWEEP_IDS.includes(card.id)), key).toBe(false);
      }
    }
  });

  it("never draws a blocked id into a new Daily 5 hand", async () => {
    let day = 1;
    for (const key of KEYS) {
      const date = `2097-03-${String(day++).padStart(2, "0")}`;
      const [challenge] = await db.insert(dailyChallenges).values({
        date, mode: "DAILY5", setId: SETS[key].id, seed: `bldesign-${stamp}-${key}`,
        startsAt: new Date(`${date}T00:00:00.000Z`), endsAt: new Date(`${date}T23:00:00.000Z`), status: "SCHEDULED",
      }).returning();
      challengeIds.push(challenge.id);
      await daily5Service.selectCardsForChallenge(challenge, SETS[key].id, challenge.seed);
      const dealt = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
        .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
      expect(dealt).toHaveLength(5);
      expect(dealt.some((card) => SWEEP_IDS.includes(card.cardId)), key).toBe(false);
    }
  });

  it("swaps blocked ids out of a stored Daily 5 hand (signed-out Daily 5 and Beat-me serve it)", async () => {
    let day = 10;
    for (const key of KEYS) {
      const blocked = SWEEP.filter((c) => c.set === key);
      for (let start = 0; start < blocked.length; start += 5) {
        const chunk = blocked.slice(start, start + 5).map((c) => c.id);
        const hand = [...chunk, ...fillerIds.get(key)!.slice(0, 5 - chunk.length)];
        const date = `2097-04-${String(day++).padStart(2, "0")}`;
        const [challenge] = await db.insert(dailyChallenges).values({
          date, mode: "DAILY5", setId: SETS[key].id, seed: `bldesign-stored-${stamp}-${date}`,
          startsAt: new Date(`${date}T00:00:00.000Z`), endsAt: new Date(`${date}T23:00:00.000Z`), status: "ACTIVE",
        }).returning();
        challengeIds.push(challenge.id);
        await db.insert(dailyChallengeCards).values(hand.map((cardId, index) => {
          const name = SWEEP.find((c) => c.id === cardId)?.player ?? `Filler ${index}`;
          return { dailyChallengeId: challenge.id, position: index + 1, cardId, correctAnswer: name, choices: [name, "Other One", "Other Two", "Other Three"], pointValue: 100 };
        }));
        expect(await replaceBlockedDaily5Cards(challenge.id, date)).toBe(0);
        const served = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
          .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id)).orderBy(asc(dailyChallengeCards.position));
        expect(served).toHaveLength(5);
        expect(served.some((card) => SWEEP_IDS.includes(card.cardId)), date).toBe(false);
      }
    }
  });

  it("drops a pinned set cover that is one of the blocked ids and never serves its file", async () => {
    for (const key of KEYS) {
      const blocked = SWEEP.filter((c) => c.set === key).slice(0, 6).map((c) => c.id);
      const good = fillerIds.get(key)!.slice(0, 2);
      setPinnedCoversForTests(SETS[key].id, [...blocked, ...good]);
      clearReadyCoverIndexForTests();
      const report = (await resolvePinnedCoverReports([SETS[key].id])).get(SETS[key].id)!;
      expect(report.validIds).toEqual(good);
      setPinnedCoversForTests(SETS[key].id, null);
    }
    for (const id of SWEEP_IDS) expect(await eligibleCoverFile(id), id).toBeNull();
  });

  it("leaves blocked ids out of card-pool refresh and refuses to restore them", async () => {
    const control = fillerIds.get("2024-basketball")![7];
    await db.update(playableCards)
      .set({ isPlayable: false, imageFailureCount: 1, quarantineStatus: "QUARANTINED_ADMIN_REVIEW" })
      .where(inArray(playableCards.id, [...SWEEP_IDS, control]));
    try {
      const candidates = await db.select({ id: playableCards.id }).from(playableCards)
        .where(and(inArray(playableCards.id, [...SWEEP_IDS, control]), cardPoolRefreshCandidateFilter()));
      expect(candidates.map((c) => c.id)).toEqual([control]);
      for (const card of SWEEP) {
        const [stored] = await db.select().from(playableCards).where(eq(playableCards.id, card.id));
        expect(await restorePlayableIfMaskAllows(stored, `https://packpts.com/cards/${card.id}-new.jpg`), card.id).toBe(false);
      }
    } finally {
      await db.update(playableCards).set({ isPlayable: true, imageFailureCount: 0, quarantineStatus: "OK" })
        .where(inArray(playableCards.id, [...SWEEP_IDS, control]));
    }
    expect((await dealableAmong(SWEEP_IDS)).size).toBe(0);
  });

  it("still blocks every Design card after a purge-and-reimport gives it a new id", async () => {
    const reimported = SWEEP.map((card) => setRow(randomUUID(), card.set, card.player, ` #${card.number} `, card.variant.toUpperCase()));
    await db.insert(playableCards).values(reimported);
    for (const r of reimported) {
      expect(isBlockedCard(r.gameSetId, r.player, r), `${r.player} ${r.number}`).toBe(true);
      expect(isBlockedCardIdRow(r), `${r.player} ${r.number}`).toBe(true);
    }
    const newIds = reimported.map((r) => r.id);
    expect((await dealableAmong(newIds)).size).toBe(0);
    const candidates = await db.select({ id: playableCards.id }).from(playableCards)
      .where(and(inArray(playableCards.id, newIds), cardPoolRefreshCandidateFilter()));
    expect(candidates).toHaveLength(0);
  });

  it("keeps another variant of a blocked number playable (Durant #101 Base, LeBron #22 Base)", async () => {
    const kept = await dealableAmong([ids.durantBase, ids.jamesBase]);
    expect(kept.has(ids.durantBase)).toBe(true);
    expect(kept.has(ids.jamesBase)).toBe(true);
  });
});

describe("1987 Topps All-Star range #595-616 by number", () => {
  it("has one number rule per card in the range, on the 1987 Topps set only", () => {
    const numbers = BLOCKED_SET_NUMBERS.map((rule) => rule.number);
    expect(numbers).toEqual(Array.from({ length: 22 }, (_, i) => String(595 + i)));
    expect(BLOCKED_SET_NUMBERS.every((rule) => rule.gameSetId === "37fd025d" && rule.prefix === true)).toBe(true);
    expect(leakBlocklistLogLines()).toContain("[blocklist] set=37fd025d blockedIds=38 blockedNumbers=22 blockedPatterns=0");
  });

  it("blocks any card in the range, including one not on the id list and a new id after a re-import", async () => {
    for (let n = 595; n <= 616; n++) {
      expect(isBlockedCard(SETS["1987-topps"].id, "Anyone", { id: randomUUID(), number: String(n), variant: "Base" }), String(n)).toBe(true);
      expect(isBlockedCard(SETS["1987-topps"].id, "Anyone", { number: `#0${n}` }), String(n)).toBe(true);
    }
    const kept = await dealableAmong([ids.parrish613, ids.allStar595, ids.base594, ids.base617, ids.schmidt430, ids.mattingly500]);
    expect(kept.has(ids.parrish613)).toBe(false);
    expect(kept.has(ids.allStar595)).toBe(false);
    expect(kept.has(ids.base594)).toBe(true);
    expect(kept.has(ids.base617)).toBe(true);
    expect(kept.has(ids.schmidt430)).toBe(true);
    expect(kept.has(ids.mattingly500)).toBe(true);
  });

  it("does not block the same numbers in another set", async () => {
    expect(isBlockedCard(SETS["2024-basketball"].id, "Anyone", { number: "600" })).toBe(false);
    expect((await dealableAmong([ids.otherSet600])).has(ids.otherSet600)).toBe(true);
  });
});

describe("2024 Basketball UVAS subset by number pattern", () => {
  it("blocks every UVAS number on 2024 Basketball, including one not on the id list", async () => {
    const rule = CARD_NUMBER_PATTERN_RULES.find((r) => r.sqlPattern === "^UVAS-[0-9]+$");
    expect(rule?.gameSetId).toBe("229f0379");
    for (const number of ["UVAS-1", "UVAS-3", "uvas-15", " UVAS-99 "]) {
      expect(isBlockedCard(SETS["2024-basketball"].id, "Anyone", { id: randomUUID(), number }), number).toBe(true);
    }
    expect(isBlockedCard(SETS["2024-basketball"].id, "Anyone", { number: "UV-3" })).toBe(false);
    expect(isBlockedCard(SETS["2024-basketball"].id, "Anyone", { number: "3" })).toBe(false);
    expect((await dealableAmong([ids.uvas3])).has(ids.uvas3)).toBe(false);
    expect(leakBlocklistLogLines()).toContain("[blocklist] set=229f0379 blockedIds=19 blockedNumbers=0 blockedPatterns=2");
  });

  it("does not block UVAS numbers in another set", async () => {
    expect((await dealableAmong([ids.otherSetUvas])).has(ids.otherSetUvas)).toBe(true);
  });
});
