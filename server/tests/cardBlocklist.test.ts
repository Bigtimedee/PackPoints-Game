/**
 * Hardcoded card blocklist: blocked players stay out of solo deals, Daily 5
 * deals, set covers, and replacement candidates. A stored Daily 5 card is swapped
 * before it is served.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSessionsTable, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { daily5Service } from "../services/daily5Service";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { setPinnedCoversForTests } from "../config/pinnedCovers";
import { clearReadyCoverIndexForTests, handlePublicSetCover, readyMaskedCoverUrls } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import { BASKETBALL_2024_H_INSERT_NUMBER, TOPPS_1987_SCHMIDT_CARD_ID, cardBlocklistWhereBody, cardNotBlockedSql, isBlockedCard, leakBlocklistLogLines, logCardBlocklist, multiPlayerBlocklistLogLines, replaceBlockedDaily5Cards, sweepBlockedDaily5Deals } from "../lib/cardBlocklist";
import { eligibleDealFilter } from "../services/playableSetEligibility";

const stamp = randomUUID().slice(0, 8);
const prefix = `blocklist:${stamp}:`;
const basketballSetId = "229f0379-1111-4111-8111-111111111111";
const footballSetId = "91cfdf3f-a620-4e73-adc8-22b8df221716";
const fleerSetId = "aea515e2-2222-4222-8222-222222222222";
const fleerOnlySetId = "aea515e2-3333-4333-8333-333333333333";
const coverPlayers = [
  "Art Shell",
  "Kevin Johnson",
  "Joe Montana",
  "Walter Payton",
  "Jerry Rice",
  "Barry Sanders",
  "Emmitt Smith",
  "Marcus Allen",
];

const cardIds: string[] = [];
const challengeIds: string[] = [];
let sessionId = "";
let dir = "";
let createdSets: string[] = [];

function card(setId: string, player: string, createdAt: string, sport: string) {
  const id = randomUUID();
  cardIds.push(id);
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `${prefix}${id}`,
    player,
    set: `Blocklist ${stamp}`,
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: sport,
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
    createdAt: new Date(createdAt),
  };
}

async function ensureSet(id: string, sport: string, year: number, setName: string) {
  const [existing] = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, id)).limit(1);
  if (existing) return;
  await db.insert(gameSets).values({
    id,
    sport,
    brand: "Topps",
    year,
    setName,
    isUserCreated: true,
    isActive: true,
  });
  createdSets.push(id);
}

describe("isBlockedCard", () => {
  it("matches the four leaks and leaves other players", () => {
    expect(isBlockedCard("229f0379-1111-4111-8111-111111111111", "Giannis Antetokounmpo")).toBe(true);
    expect(isBlockedCard("229f0379-1111-4111-8111-111111111111", "ANTETOKOUNMPO")).toBe(true);
    expect(isBlockedCard(fleerSetId, "Giannis Antetokounmpo")).toBe(false);

    expect(isBlockedCard(footballSetId, "Donnie Shell")).toBe(true);
    expect(isBlockedCard(footballSetId, "Shell, Donnie")).toBe(true);
    expect(isBlockedCard(footballSetId, "donnie l. shell")).toBe(true);
    expect(isBlockedCard(footballSetId, "Art Shell")).toBe(false);
    expect(isBlockedCard(basketballSetId, "Donnie Shell")).toBe(false);

    expect(isBlockedCard(footballSetId, "Mark Duper")).toBe(true);
    expect(isBlockedCard(footballSetId, "MARK DUPER")).toBe(true);
    expect(isBlockedCard(footballSetId, "mark duper")).toBe(true);
    expect(isBlockedCard(basketballSetId, "Mark Duper")).toBe(false);
    expect(isBlockedCard(fleerSetId, "Mark Duper")).toBe(false);

    expect(isBlockedCard(footballSetId, "Charles Haley")).toBe(true);
    expect(isBlockedCard(footballSetId, "CHARLES HALEY")).toBe(true);
    expect(isBlockedCard(footballSetId, "Haley, Charles")).toBe(true);
    expect(isBlockedCard(basketballSetId, "Charles Haley")).toBe(false);
    expect(isBlockedCard(fleerSetId, "Charles Haley")).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Charles Haley")).toBe(false);

    expect(isBlockedCard(fleerSetId, "Kevin Johnson")).toBe(true);
    expect(isBlockedCard(fleerOnlySetId, "KEVIN JOHNSON")).toBe(true);
    expect(isBlockedCard(footballSetId, "Kevin Johnson")).toBe(false);
  });

  it("blocks every 1987 Topps Football Record Breaker by player name", () => {
    for (const player of [
      "Todd Christensen",
      "Christensen, Todd",
      "Dave Jennings",
      "Charlie Joiner",
      "Steve Largent",
      "Dan Marino",
      "MARINO, DAN",
      "Phil Simms",
      "Simms, Phil",
    ]) {
      expect(isBlockedCard(footballSetId, player)).toBe(true);
    }
    expect(isBlockedCard(footballSetId, "Jerry Rice")).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana")).toBe(false);
    expect(isBlockedCard(basketballSetId, "Dan Marino")).toBe(false);
    expect(isBlockedCard(footballSetId, "Art Shell")).toBe(false);
  });

  it("blocks 1987 Topps Football Record Breaker card numbers after normalization", () => {
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "#2" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "02" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "  #007 " })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "8" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "10" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "9" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "236" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "2a" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Joe Montana", { number: "#2" })).toBe(false);
    expect(isBlockedCard(footballSetId, "", { number: "4" })).toBe(true);
  });

  it("blocks 1987 Topps Football cards whose variant or description says Record Breaker", () => {
    expect(isBlockedCard(footballSetId, "Joe Montana", { variant: "Record Breaker" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "recordbreaker" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "Record  Breaker" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { variant: "RB" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { variant: "rb" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "rb" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Some Back", { description: "RB" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Walter Payton RB Chicago Bears")).toBe(false);
    expect(isBlockedCard(footballSetId, "Walter Payton - RB")).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "running back" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "Herb" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { description: "RBI" })).toBe(false);
    expect(isBlockedCard(fleerSetId, "Joe Montana", { variant: "Record Breaker" })).toBe(false);
    expect(isBlockedCard(fleerSetId, "Joe Montana", { description: "RB" })).toBe(false);
  });

  it("blocks multi-player text on every set and keeps single-player All-Star labels", () => {
    const other = "bbbbbbbb-1111-4111-8111-111111111111";
    for (const text of ["Team Leaders", "League Leaders", "Leaders", "Checklist", "Combo", "Combos", "Tandem", "Tandems", "Duo", "Duos", "Trio", "Trios", "vs."]) {
      expect(isBlockedCard(other, "Joe Montana", { description: text })).toBe(true);
    }
    for (const text of ["All-Star", "All Star", "All-Stars", "All Stars", "Future Stars", "Rookie Stars", "Prospects", "Highlights", "Super Bowl"]) {
      expect(isBlockedCard(other, "Joe Montana", { variant: text })).toBe(false);
      expect(isBlockedCard(other, "Joe Montana", { description: text })).toBe(false);
    }
    expect(isBlockedCard(other, "Joe Montana", { variant: "VS" })).toBe(false);
    expect(isBlockedCard(other, "Joe Montana", { variant: "vs" })).toBe(false);
    expect(isBlockedCard(other, "Joe Montana", { description: "vs" })).toBe(false);
    expect(isBlockedCard(other, "Karl Malone vs John Stockton")).toBe(true);
    expect(isBlockedCard(other, "Karl Malone vs. John Stockton")).toBe(true);
    expect(isBlockedCard(other, "Karl Malone / John Stockton", { variant: "All-Star" })).toBe(true);
    expect(isBlockedCard(other, "Ken Griffey / Barry Bonds", { variant: "Future Stars" })).toBe(true);
    expect(isBlockedCard(other, "Ken Griffey Jr. / Chipper Jones", { description: "Prospects" })).toBe(true);
    expect(isBlockedCard(other, "Joe Montana", { description: "Highlights" })).toBe(false);
  });

  it("keeps a single-player 1989 Topps All-Star and a single-player 2024 Basketball insert", () => {
    const topps1989 = "352b33d1-1111-4111-8111-111111111111";
    expect(isBlockedCard(topps1989, "Ozzie Smith", { number: "400", variant: "All-Star", description: "All Star" })).toBe(false);
    expect(isBlockedCard(topps1989, "Ozzie Smith", { number: "386", variant: "All-Stars", description: "1989 Topps All-Star" })).toBe(false);
    expect(isBlockedCard(topps1989, "Nolan Ryan", { number: "3", variant: "Record Breaker", description: "Record Breaker" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Luka Doncic", { number: "12", variant: "insert", description: "Highlights" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Luka Doncic", { variant: "All-Star", description: "Prospects" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Giannis Antetokounmpo", { variant: "insert", description: "Highlights" })).toBe(true);
    expect(isBlockedCard(topps1989, "Wade Boggs / Tony Gwynn", { variant: "All-Star" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Spud Webb", { number: "163", variant: "All-Star" })).toBe(true);
  });

  it("blocks a player field that names more than one person and keeps suffixes and hyphenated surnames", () => {
    const other = "bbbbbbbb-1111-4111-8111-111111111111";
    expect(isBlockedCard(other, "Karl Malone / John Stockton")).toBe(true);
    expect(isBlockedCard(other, "Malone & Stockton")).toBe(true);
    expect(isBlockedCard(other, "Karl Malone and John Stockton")).toBe(true);
    expect(isBlockedCard(other, "Karl Malone, John Stockton")).toBe(true);
    expect(isBlockedCard(other, "Malone, Stockton, Eaton")).toBe(true);
    expect(isBlockedCard(other, "Ken Griffey - Barry Bonds")).toBe(true);
    expect(isBlockedCard(other, "Smith, John Paul")).toBe(false);
    expect(isBlockedCard(other, "Tony Gwynn - All-Star")).toBe(false);
    expect(isBlockedCard(other, "Ken Griffey Jr.")).toBe(false);
    expect(isBlockedCard(other, "Cal Ripken, Jr.")).toBe(false);
    expect(isBlockedCard(other, "Ken Griffey III")).toBe(false);
    expect(isBlockedCard(other, "Jackie Joyner-Kersee")).toBe(false);
    expect(isBlockedCard(other, "Dee Brown")).toBe(false);
    expect(isBlockedCard(other, "Shell, Donnie")).toBe(false);
  });

  it("blocks vintage multi-player card numbers and leaves single-player numbers", () => {
    expect(isBlockedCard(fleerSetId, "Nobody Special", { number: "163" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Nobody Special", { number: "#168" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Spud Webb", { number: "6" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Isiah Thomas", { number: "6" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Chris Mullin", { number: "9" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Isiah Thomas", { number: "50" })).toBe(false);
    expect(isBlockedCard(fleerSetId, "Chris Mullin", { number: "55" })).toBe(false);
    expect(isBlockedCard(fleerSetId, "Tom Chambers", { number: "11" })).toBe(true);
    expect(isBlockedCard(fleerSetId, "Robert Parish", { number: "12" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Mark McGwire", { number: "366" })).toBe(true);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Mark McGwire", { number: "100" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Jeff Lahti", { number: "367" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Mark McGwire", { number: "366" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Pete Rose", { number: "281" })).toBe(true);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Wade Boggs", { number: "150" })).toBe(false);
    expect(isBlockedCard("352b33d1-1111-4111-8111-111111111111", "Mets Leaders", { number: "291" })).toBe(true);
    expect(isBlockedCard("352b33d1-1111-4111-8111-111111111111", "Tim Raines", { number: "81" })).toBe(false);
    expect(isBlockedCard("a09b2fe7-728e-431b-9df8-bbf2652aa3b2", "Eugene Robinson / Nate Odomes", { number: "119" })).toBe(true);
    expect(isBlockedCard("a09b2fe7-728e-431b-9df8-bbf2652aa3b2", "Jerry Rice", { number: "116" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "9" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "227" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Joe Montana", { number: "394" })).toBe(true);
  });

  it("blocks 1987 Topps Football Charles Haley by name and checklist number 125 only", () => {
    expect(isBlockedCard(footballSetId, "Charles Haley", { number: "94", variant: "Topps Super Rookie" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Roster Filler", { number: "125" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Roster Filler", { number: "#125" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Roster Filler", { number: "0125" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Gerald McNeil", { number: "94", variant: "Topps Super Rookie" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Jerry Rice", { number: "115", variant: "Topps Super Rookie" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Charles Haley", { number: "125" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Roster Filler", { number: "125" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Charles Haley", { number: "125" })).toBe(false);
  });

  it("logs the record breaker subset in one boot line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logCardBlocklist();
    expect(spy).toHaveBeenCalledWith(
      "[blocklist] set=91cfdf3f recordBreakerNumbers=2,3,4,5,6,7,8 haleyNumber=125 players=Todd Christensen,Dave Jennings,Charlie Joiner,Steve Largent,Dan Marino,Donnie Shell,Phil Simms,Mark Duper,Charles Haley",
    );
    for (const line of multiPlayerBlocklistLogLines()) {
      expect(line).toMatch(/^\[blocklist\] set=[0-9a-f]{8} multiPlayerNumbers=\d+(?:,\d+)*(?: allStarNumbers=\d+(?:,\d+)*| mcgwireNumber=\d+)? textRules=on$/);
      expect(spy).toHaveBeenCalledWith(line);
    }
    expect(multiPlayerBlocklistLogLines()).toHaveLength(5);
    expect(multiPlayerBlocklistLogLines().some((line) => line.includes("set=aea515e2") && line.includes("allStarNumbers=1,2,3,4,5,6,7,8,9,10,11"))).toBe(true);
    expect(multiPlayerBlocklistLogLines().some((line) => line.includes("set=37fd025d") && line.includes("mcgwireNumber=366"))).toBe(true);
    expect(leakBlocklistLogLines()).toEqual([
      "[blocklist] set=37fd025d blockedIds=1 blockedNumbers=1 blockedPatterns=0",
      "[blocklist] set=229f0379 blockedIds=0 blockedNumbers=0 blockedPatterns=1",
    ]);
    for (const line of leakBlocklistLogLines()) expect(spy).toHaveBeenCalledWith(line);
    spy.mockRestore();
  });

  it("blocks 2024 Basketball H inserts by number pattern and leaves other families", () => {
    const hoop = "229f0379-aa56-40a8-abe3-1af217a397e8";
    for (const number of ["H-1", "H-3", "h-12"]) {
      expect(BASKETBALL_2024_H_INSERT_NUMBER.test(number)).toBe(true);
      expect(isBlockedCard(hoop, "Stephen Curry", { number })).toBe(true);
      expect(isBlockedCard(basketballSetId, "Stephen Curry", { number })).toBe(true);
    }
    for (const number of ["BOD-5", "ST-7", "H", "3", "HR-1"]) {
      expect(BASKETBALL_2024_H_INSERT_NUMBER.test(number)).toBe(false);
      expect(isBlockedCard(hoop, "Stephen Curry", { number })).toBe(false);
    }
    expect(isBlockedCard(footballSetId, "Stephen Curry", { number: "H-3" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Stephen Curry", { number: "H-1" })).toBe(false);
    expect(isBlockedCard(fleerSetId, "Stephen Curry", { number: "h-12" })).toBe(false);
  });

  it("blocks 1987 Topps Mike Schmidt #28 by id and by number, and leaves #430", () => {
    const baseball = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    expect(isBlockedCard(baseball, "Mike Schmidt", { id: TOPPS_1987_SCHMIDT_CARD_ID, number: "28" })).toBe(true);
    expect(isBlockedCard(baseball, "Roster Filler", { id: TOPPS_1987_SCHMIDT_CARD_ID, number: "430" })).toBe(true);
    expect(isBlockedCard(baseball, "Roster Filler", { cardId: TOPPS_1987_SCHMIDT_CARD_ID, number: "100" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Jerry Rice", { id: TOPPS_1987_SCHMIDT_CARD_ID })).toBe(true);
    expect(isBlockedCard(baseball, "Mike Schmidt", { number: "28" })).toBe(true);
    expect(isBlockedCard(baseball, "Mike Schmidt", { number: "#28" })).toBe(true);
    expect(isBlockedCard(baseball, "Mike Schmidt", { number: "028" })).toBe(true);
    expect(isBlockedCard(baseball, "Mike Schmidt", { number: "430" })).toBe(false);
    expect(isBlockedCard(baseball, "Mike Schmidt")).toBe(false);
    expect(isBlockedCard(baseball, "Mike Schmidt", { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", number: "430" })).toBe(false);
    expect(isBlockedCard(basketballSetId, "Mike Schmidt", { number: "28" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Mike Schmidt", { number: "28" })).toBe(false);
    expect(isBlockedCard(footballSetId, "Charles Haley")).toBe(true);
    expect(isBlockedCard(footballSetId, "Haley, Charles")).toBe(true);
    expect(isBlockedCard(footballSetId, "Roster Filler", { number: "125" })).toBe(true);
    expect(isBlockedCard(footballSetId, "Gerald McNeil", { number: "94" })).toBe(false);
  });

  it("puts number and record-breaker text into the same SQL predicate", () => {
    const body = cardBlocklistWhereBody("playable_cards");
    expect(body).toContain("lower(playable_cards.game_set_id) = '91cfdf3f-a620-4e73-adc8-22b8df221716'");
    for (const number of ["2", "3", "4", "5", "6", "7", "8"]) {
      expect(body).toContain(`'${number}'`);
    }
    expect(body).toContain("record[[:space:]]*breaker");
    expect(body).toContain("strpos(lower(playable_cards.player), 'charles haley') > 0");
    expect(body).toContain("= '125'");
    expect(body).toContain("lower(playable_cards.id) = '36f1d909-2fdb-4b78-bb36-e7f5c088380a'");
    expect(body).toContain("lower(playable_cards.game_set_id) LIKE '37fd025d%'");
    expect(body).toContain("= '28'");
    expect(body).toContain("lower(playable_cards.game_set_id) LIKE '229f0379%'");
    expect(body).toContain("~* '^H-[0-9]+$'");
    expect(body).not.toContain("\\mRB\\M");
    expect(body).toContain("playable_cards.number");
    expect(body).toContain("playable_cards.variant");
    expect(body).toContain("playable_cards.description");
  });
});

describe("blocked cards stay out of deals, covers, and replacements", () => {
  const bytes = new Map<string, Buffer>();
  let footballCards: ReturnType<typeof card>[] = [];
  let donnieId = "";
  let fleerOnlyId = "";
  let artBytes = Buffer.alloc(0);
  let lastBytes = Buffer.alloc(0);

  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);
  let base = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-blocklist-"));
    setMaskReadySidecarDirForTests(dir);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await ensureSet(basketballSetId, "basketball", 2024, `2024 Basketball ${stamp}`);
    await ensureSet(footballSetId, "football", 1987, `1987 Topps Football ${stamp}`);
    await ensureSet(fleerSetId, "basketball", 1989, `1989 Fleer ${stamp}`);
    await ensureSet(fleerOnlySetId, "basketball", 1989, `1989 Fleer only ${stamp}`);

    const basketball = [
      card(basketballSetId, "Giannis Antetokounmpo", "2020-01-01T00:00:00.000Z", "basketball"),
      ...Array.from({ length: 6 }, (_, i) => card(basketballSetId, `Basket Player ${i + 1}`, `2020-02-0${i + 1}T00:00:00.000Z`, "basketball")),
    ];
    const donnie = card(footballSetId, "Donnie Shell", "2020-01-01T00:00:00.000Z", "football");
    const shellDonnie = card(footballSetId, "Shell, Donnie", "2020-01-02T00:00:00.000Z", "football");
    donnieId = donnie.id;
    footballCards = [
      donnie,
      shellDonnie,
      ...coverPlayers.map((player, i) => card(footballSetId, player, `2020-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, "football")),
    ];
    const fleer = [
      card(fleerSetId, "Kevin Johnson", "2020-01-01T00:00:00.000Z", "basketball"),
      card(fleerSetId, "Giannis Antetokounmpo", "2020-01-02T00:00:00.000Z", "basketball"),
      ...Array.from({ length: 6 }, (_, i) => card(fleerSetId, `Fleer Player ${i + 1}`, `2020-04-0${i + 1}T00:00:00.000Z`, "basketball")),
    ];
    const fleerOnly = [card(fleerOnlySetId, "Kevin Johnson", "2020-01-01T00:00:00.000Z", "basketball")];
    fleerOnlyId = fleerOnly[0].id;

    for (const row of footballCards) {
      const body = Buffer.from(`masked-${row.player}-${row.id}`);
      bytes.set(row.id, body);
      await writeFile(path.join(dir, warmOkMarkerFilename(row.id)), "ok\n");
      await writeFile(path.join(dir, `${row.id}_${CURRENT_MASK_VERSION}.jpg`), body);
    }
    artBytes = bytes.get(footballCards[2].id)!;
    lastBytes = bytes.get(footballCards[footballCards.length - 1].id)!;
    clearReadyCoverIndexForTests();

    await db.insert(playableCards).values([...basketball, ...footballCards, ...fleer, ...fleerOnly]);
  });

  afterAll(async () => {
    setPinnedCoversForTests(footballSetId, null);
    setMaskReadySidecarDirForTests(null);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (challengeIds.length > 0) {
      await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds)).catch(() => null);
      await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds)).catch(() => null);
    }
    if (sessionId) await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id, sessionId)).catch(() => null);
    if (cardIds.length > 0) await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(playableCards).where(like(playableCards.cardhedgeCardId, `${prefix}%`)).catch(() => null);
    if (createdSets.length > 0) await db.delete(gameSets).where(inArray(gameSets.id, createdSets)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("keeps Schmidt #430 and non-H numbers in the shared deal filter", async () => {
    const baseball = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    await ensureSet(baseball, "baseball", 1987, `1987 Topps ${stamp}`);
    const schmidtId = TOPPS_1987_SCHMIDT_CARD_ID;
    const samples: Array<{ setId: string; player: string; number: string; id?: string; keep: boolean }> = [
      { setId: basketballSetId, player: "Stephen Curry", number: "H-1", keep: false },
      { setId: basketballSetId, player: "Stephen Curry", number: "H-3", keep: false },
      { setId: basketballSetId, player: "Stephen Curry", number: "h-12", keep: false },
      { setId: basketballSetId, player: "Stephen Curry", number: "BOD-5", keep: true },
      { setId: basketballSetId, player: "Stephen Curry", number: "ST-7", keep: true },
      { setId: basketballSetId, player: "Stephen Curry", number: "H", keep: true },
      { setId: basketballSetId, player: "Stephen Curry", number: "3", keep: true },
      { setId: basketballSetId, player: "Stephen Curry", number: "HR-1", keep: true },
      { setId: footballSetId, player: "Stephen Curry", number: "H-3", keep: true },
      { setId: baseball, player: "Mike Schmidt", number: "28", keep: false },
      { setId: baseball, player: "Mike Schmidt", number: "#028", keep: false },
      { setId: baseball, player: "Mike Schmidt", number: "430", keep: true },
      { setId: baseball, player: "Roster Filler", number: "430", id: schmidtId, keep: false },
      { setId: basketballSetId, player: "Mike Schmidt", number: "28", keep: true },
    ];
    const rows = samples.map((sample, i) => {
      const sport = sample.setId === baseball ? "baseball" : sample.setId === footballSetId ? "football" : "basketball";
      const row = {
        ...card(sample.setId, sample.player, `2023-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, sport),
        number: sample.number,
        description: sample.player,
        keep: sample.keep,
      };
      if (sample.id) {
        const idx = cardIds.lastIndexOf(row.id);
        if (idx >= 0) cardIds.splice(idx, 1);
        row.id = sample.id;
        cardIds.push(sample.id);
      }
      return row;
    });
    await db.delete(playableCards).where(eq(playableCards.id, schmidtId));
    await db.insert(playableCards).values(rows);
    try {
      const kept = await db
        .select({ id: playableCards.id })
        .from(playableCards)
        .where(and(inArray(playableCards.id, rows.map((row) => row.id)), eligibleDealFilter("playable_cards")));
      const keptIds = new Set(kept.map((row) => row.id));
      for (const row of rows) {
        expect(isBlockedCard(row.gameSetId, row.player, row), `${row.player} ${row.number}`).toBe(!row.keep);
        expect(keptIds.has(row.id), `${row.player} ${row.number}`).toBe(row.keep);
      }
      expect(keptIds.has(schmidtId)).toBe(false);
    } finally {
      await db.delete(playableCards).where(inArray(playableCards.id, rows.map((row) => row.id)));
    }
  });

  it("drops record breakers by number, name, and text in the deal predicate", async () => {
    const rows = [
      { ...card(footballSetId, "Roster Filler", "2021-01-01T00:00:00.000Z", "football"), number: "#02", description: "Roster Filler", variant: null },
      { ...card(footballSetId, "Phil Simms", "2021-01-02T00:00:00.000Z", "football"), number: "10", description: "Phil Simms", variant: null },
      { ...card(footballSetId, "Banner Name", "2021-01-03T00:00:00.000Z", "football"), number: "99", description: "Banner Name", variant: "Record Breaker" },
      { ...card(footballSetId, "Some Back", "2021-01-04T00:00:00.000Z", "football"), number: "50", description: "RB", variant: null },
      { ...card(footballSetId, "Jerry Rice", "2021-01-05T00:00:00.000Z", "football"), number: "115", description: "Jerry Rice", variant: "Topps Super Rookie" },
      { ...card(footballSetId, "Charles Haley", "2021-01-06T00:00:00.000Z", "football"), number: "94", description: "Charles Haley", variant: "Topps Super Rookie" },
      { ...card(footballSetId, "Jersey Back", "2021-01-07T00:00:00.000Z", "football"), number: "#125", description: "Jersey Back", variant: null },
      { ...card(basketballSetId, "Charles Haley", "2021-01-08T00:00:00.000Z", "basketball"), number: "125", description: "Charles Haley", variant: null },
      { ...card(footballSetId, "Gerald McNeil", "2021-01-09T00:00:00.000Z", "football"), number: "94", description: "Gerald McNeil", variant: "Topps Super Rookie" },
    ];
    await db.insert(playableCards).values(rows);
    try {
      const kept = await db
        .select({ player: playableCards.player })
        .from(playableCards)
        .where(and(inArray(playableCards.id, rows.map((row) => row.id)), cardNotBlockedSql("playable_cards")));
      expect(kept.map((row) => row.player).sort()).toEqual(["Charles Haley", "Gerald McNeil", "Jerry Rice", "Some Back"]);
    } finally {
      await db.delete(playableCards).where(inArray(playableCards.id, rows.map((row) => row.id)));
    }
  });

  it("drops multi-player cards in the deal predicate and keeps suffixes and hyphenated surnames", async () => {
    const topps1989 = "352b33d1-1111-4111-8111-111111111111";
    const topps1987 = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    await ensureSet(topps1989, "baseball", 1989, `1989 Topps ${stamp}`);
    await ensureSet(topps1987, "baseball", 1987, `1987 Topps ${stamp}`);
    const samples: Array<{ setId: string; player: string; number: string; variant: string | null; description: string; keep: boolean }> = [
      { setId: basketballSetId, player: "Dee Brown", number: "6", variant: null, description: "Dee Brown", keep: true },
      { setId: basketballSetId, player: "Ken Griffey Jr.", number: "12", variant: null, description: "Ken Griffey Jr.", keep: true },
      { setId: basketballSetId, player: "Cal Ripken, Jr.", number: "13", variant: null, description: "Cal Ripken, Jr.", keep: true },
      { setId: basketballSetId, player: "Jackie Joyner-Kersee", number: "14", variant: null, description: "Jackie Joyner-Kersee", keep: true },
      { setId: basketballSetId, player: "Shell, Donnie", number: "15", variant: null, description: "Shell, Donnie", keep: true },
      { setId: basketballSetId, player: "Magic Johnson", number: "16", variant: "All-Star", description: "Magic Johnson", keep: true },
      { setId: basketballSetId, player: "Ken Griffey Jr.", number: "17", variant: "Future Stars", description: "Ken Griffey Jr.", keep: true },
      { setId: basketballSetId, player: "Karl Malone / John Stockton", number: "20", variant: null, description: "Karl Malone / John Stockton", keep: false },
      { setId: basketballSetId, player: "Malone & Stockton", number: "21", variant: null, description: "Malone & Stockton", keep: false },
      { setId: basketballSetId, player: "Karl Malone and John Stockton", number: "22", variant: null, description: "Karl Malone and John Stockton", keep: false },
      { setId: basketballSetId, player: "Karl Malone, John Stockton", number: "23", variant: null, description: "Karl Malone, John Stockton", keep: false },
      { setId: basketballSetId, player: "Malone, Stockton, Eaton", number: "24", variant: null, description: "Malone, Stockton, Eaton", keep: false },
      { setId: basketballSetId, player: "Ken Griffey - Barry Bonds", number: "25", variant: null, description: "Ken Griffey - Barry Bonds", keep: false },
      { setId: basketballSetId, player: "Joe Montana", number: "26", variant: null, description: "Checklist", keep: false },
      { setId: basketballSetId, player: "Magic Johnson", number: "27", variant: "All-Stars", description: "Magic Johnson", keep: true },
      { setId: topps1989, player: "Ozzie Smith", number: "400", variant: "All-Star", description: "All Star", keep: true },
      { setId: basketballSetId, player: "Luka Doncic", number: "12", variant: "insert", description: "Highlights", keep: true },
      { setId: basketballSetId, player: "Ken Griffey / Barry Bonds", number: "28", variant: "Future Stars", description: "Ken Griffey / Barry Bonds", keep: false },
      { setId: fleerSetId, player: "Nobody Special", number: "163", variant: null, description: "Nobody Special", keep: false },
      { setId: fleerSetId, player: "Spud Webb", number: "6", variant: null, description: "Spud Webb", keep: false },
      { setId: fleerSetId, player: "Isiah Thomas", number: "50", variant: null, description: "Isiah Thomas", keep: true },
      { setId: topps1987, player: "Mark McGwire", number: "366", variant: null, description: "Mark McGwire", keep: false },
      { setId: basketballSetId, player: "Mark McGwire", number: "366", variant: null, description: "Mark McGwire", keep: true },
      { setId: basketballSetId, player: "Smith, John Paul", number: "40", variant: null, description: "Smith, John Paul", keep: true },
      { setId: basketballSetId, player: "Tony Gwynn - All-Star", number: "41", variant: null, description: "Tony Gwynn - All-Star", keep: true },
      { setId: basketballSetId, player: "Walter Payton RB Chicago Bears", number: "42", variant: "rb", description: "Walter Payton RB Chicago Bears", keep: true },
    ];
    const rows = samples.map((sample, i) => ({
      ...card(sample.setId, sample.player, `2022-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, "basketball"),
      number: sample.number,
      variant: sample.variant,
      description: sample.description,
      keep: sample.keep,
    }));
    await db.insert(playableCards).values(rows);
    try {
      const kept = await db
        .select({ id: playableCards.id })
        .from(playableCards)
        .where(and(inArray(playableCards.id, rows.map((row) => row.id)), cardNotBlockedSql("playable_cards")));
      const keptIds = new Set(kept.map((row) => row.id));
      for (const row of rows) {
        expect(isBlockedCard(row.gameSetId, row.player, row)).toBe(!row.keep);
        expect(keptIds.has(row.id)).toBe(row.keep);
      }
    } finally {
      await db.delete(playableCards).where(inArray(playableCards.id, rows.map((row) => row.id)));
    }
  });

  it("keeps blocked players out of solo deals and still deals the rest", async () => {
    const basketball = await storage.getRandomCardsFromSet(basketballSetId, 20);
    expect(basketball.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(basketball.some((row) => row.player === "Giannis Antetokounmpo")).toBe(false);
    expect(basketball.length).toBe(6);

    const football = await storage.getRandomCardsFromSet(footballSetId, 20);
    expect(football.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(football.map((row) => row.player).sort()).toEqual([...coverPlayers].sort());

    const fleer = await storage.getRandomCardsFromSet(fleerSetId, 20);
    expect(fleer.some((row) => row.player === "Kevin Johnson")).toBe(false);
    expect(fleer.some((row) => row.player === "Giannis Antetokounmpo")).toBe(true);
    expect(fleer.length).toBe(7);
  });

  it("keeps blocked players out of new Daily 5 deals", async () => {
    const deals: Array<[string, string, string]> = [
      ["2099-11-01", basketballSetId, "Giannis Antetokounmpo"],
      ["2099-11-02", footballSetId, "Donnie Shell"],
      ["2099-11-03", fleerSetId, "Kevin Johnson"],
    ];
    for (const [date, setId, blockedName] of deals) {
      const [challenge] = await db.insert(dailyChallenges).values({
        date,
        mode: "DAILY5",
        setId,
        seed: `blocklist-${date}`,
        startsAt: new Date(`${date}T00:00:00.000Z`),
        endsAt: new Date(`${date}T23:00:00.000Z`),
        status: "SCHEDULED",
      }).returning();
      challengeIds.push(challenge.id);
      await daily5Service.selectCardsForChallenge(challenge, setId, challenge.seed);
      const dealt = await db
        .select({ player: playableCards.player, gameSetId: playableCards.gameSetId, correctAnswer: dailyChallengeCards.correctAnswer })
        .from(dailyChallengeCards)
        .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
        .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
      expect(dealt.length).toBe(5);
      expect(dealt.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
      expect(dealt.some((row) => row.correctAnswer.toLowerCase().includes(blockedName.toLowerCase()))).toBe(false);
    }
  });

  it("deals the initial Daily 5 hand through the blocklist, including H inserts and Schmidt #28", async () => {
    const src = readFileSync(new URL("../services/daily5Service.ts", import.meta.url), "utf8");
    const draw = src.slice(src.indexOf("async selectCardsForChallenge"), src.indexOf("async updateChallengeStatuses"));
    expect(draw).toContain('cardNotBlockedSql("playable_cards")');
    expect(draw).toContain("isBlockedCard(");
    const create = src.slice(src.indexOf("async createChallengeForDate"), src.indexOf("async selectCardsForChallenge"));
    expect(create).toContain("selectCardsForChallenge");
    const serve = src.slice(src.indexOf("async getOrCreateTodayChallenge"), src.indexOf("async createChallengeForDate"));
    expect(serve).toContain("createChallengeForDate");
    expect(serve).toContain("sweepBlockedDaily5Deals");

    const baseball = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    await ensureSet(baseball, "baseball", 1987, `1987 Topps ${stamp}`);
    const h3 = card(basketballSetId, "Stephen Curry", "2024-03-01T00:00:00.000Z", "basketball");
    const bod = card(basketballSetId, "BOD Keeper", "2024-03-02T00:00:00.000Z", "basketball");
    const fillers = Array.from({ length: 4 }, (_, i) => card(baseball, `Schmidt Pool ${i + 1}`, `2024-03-0${i + 3}T00:00:00.000Z`, "baseball"));
    const number28 = card(baseball, "Number Twenty Eight", "2024-03-07T00:00:00.000Z", "baseball");
    const schmidt430 = card(baseball, "Mike Schmidt", "2024-03-08T00:00:00.000Z", "baseball");
    const schmidt28 = {
      ...card(baseball, "Mike Schmidt", "2024-03-09T00:00:00.000Z", "baseball"),
    };
    const stray = cardIds.lastIndexOf(schmidt28.id);
    if (stray >= 0) cardIds.splice(stray, 1);
    schmidt28.id = TOPPS_1987_SCHMIDT_CARD_ID;
    cardIds.push(TOPPS_1987_SCHMIDT_CARD_ID);
    const inserted = [
      { ...h3, number: "H-3" },
      { ...bod, number: "BOD-5" },
      { ...number28, number: "28" },
      { ...schmidt430, number: "430" },
      { ...schmidt28, number: "28" },
      ...fillers.map((row, i) => ({ ...row, number: String(500 + i) })),
    ];
    await db.delete(playableCards).where(eq(playableCards.id, TOPPS_1987_SCHMIDT_CARD_ID));
    await db.insert(playableCards).values(inserted);

    const [hoop] = await db.insert(dailyChallenges).values({
      date: "2099-11-20",
      mode: "DAILY5",
      setId: basketballSetId,
      seed: "blocklist-initial-h",
      startsAt: new Date("2099-11-20T00:00:00.000Z"),
      endsAt: new Date("2099-11-21T00:00:00.000Z"),
      status: "SCHEDULED",
    }).returning();
    challengeIds.push(hoop.id);
    await daily5Service.selectCardsForChallenge(hoop, basketballSetId, hoop.seed);

    const [base] = await db.insert(dailyChallenges).values({
      date: "2099-11-21",
      mode: "DAILY5",
      setId: baseball,
      seed: "blocklist-initial-schmidt",
      startsAt: new Date("2099-11-21T00:00:00.000Z"),
      endsAt: new Date("2099-11-22T00:00:00.000Z"),
      status: "SCHEDULED",
    }).returning();
    challengeIds.push(base.id);
    await daily5Service.selectCardsForChallenge(base, baseball, base.seed);

    const dealt = await db
      .select({
        challengeId: dailyChallengeCards.dailyChallengeId,
        cardId: dailyChallengeCards.cardId,
        number: playableCards.number,
        player: playableCards.player,
      })
      .from(dailyChallengeCards)
      .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
      .where(inArray(dailyChallengeCards.dailyChallengeId, [hoop.id, base.id]));
    const hoopDealt = dealt.filter((row) => row.challengeId === hoop.id);
    const baseDealt = dealt.filter((row) => row.challengeId === base.id);
    expect(hoopDealt).toHaveLength(5);
    expect(hoopDealt.some((row) => row.cardId === h3.id)).toBe(false);
    expect(hoopDealt.some((row) => BASKETBALL_2024_H_INSERT_NUMBER.test(row.number || ""))).toBe(false);
    expect(baseDealt).toHaveLength(5);
    expect(baseDealt.map((row) => row.cardId).sort()).toEqual([...fillers.map((row) => row.id), schmidt430.id].sort());
    expect(baseDealt.some((row) => row.cardId === TOPPS_1987_SCHMIDT_CARD_ID)).toBe(false);
    expect(baseDealt.some((row) => row.number === "28")).toBe(false);
    expect(baseDealt.some((row) => row.number === "430")).toBe(true);
  });

  it("serves pinned covers in order and does not fill from blocked cards", async () => {
    setPinnedCoversForTests(footballSetId, footballCards.slice(2).map((row) => row.id));
    const urls = await readyMaskedCoverUrls([footballSetId]);
    expect(urls.get(footballSetId)).toHaveLength(8);

    const slot0 = await fetch(`${base}/api/sets/${footballSetId}/covers/0`);
    expect(slot0.status).toBe(200);
    expect(Buffer.from(await slot0.arrayBuffer())).toEqual(artBytes);
    expect(slot0.headers.get("x-card-id")).toBe(footballCards[2].id);

    const slot7 = await fetch(`${base}/api/sets/${footballSetId}/covers/7`);
    expect(slot7.status).toBe(200);
    expect(Buffer.from(await slot7.arrayBuffer())).toEqual(lastBytes);
    expect(donnieId.length).toBeGreaterThan(0);
    expect(slot7.headers.get("x-card-id")).not.toBe(donnieId);
    setPinnedCoversForTests(footballSetId, null);
  });

  it("skips blocked cards when choosing a replacement", async () => {
    sessionId = randomUUID();
    const failedId = footballCards[0].id;
    await db.insert(gameSessionsTable).values({
      id: sessionId,
      mode: "solo",
      questions: [{
        card: {
          id: failedId,
          playableCardId: failedId,
          gameSetId: footballSetId,
          playerName: "Donnie Shell",
          team: "",
          year: 1987,
          cardNumber: "1",
          imageUrl: "https://packpts.com/cards/failed.jpg",
          popularity: 50,
          imageVerified: true,
          setName: "1987 Topps Football",
          position: "",
        },
        options: ["Donnie Shell", "Art Shell", "Joe Montana", "Jerry Rice"],
        correctAnswer: "Donnie Shell",
        pointValue: 100,
      }],
      currentQuestionIndex: 0,
      score: 0,
      correctAnswers: 0,
      totalQuestions: 1,
      skippedQuestions: 0,
      status: "active",
      startedAt: "2026-09-26T00:00:00.000Z",
    });

    for (let i = 0; i < 8; i++) {
      const result = await storage.getReplacementCardForSession(sessionId, failedId, []);
      expect(result).toBeTruthy();
      expect(isBlockedCard(footballSetId, result!.question.correctAnswer)).toBe(false);
      expect(result!.question.correctAnswer.toLowerCase()).not.toContain("donnie");
      expect(result!.question.card.id).not.toBe(failedId);
    }
  });

  it("swaps a stored Daily 5 card instead of serving the blocked answer", async () => {
    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-04",
      mode: "DAILY5",
      setId: footballSetId,
      seed: "blocklist-stored",
      startsAt: new Date("2099-11-04T00:00:00.000Z"),
      endsAt: new Date("2099-11-05T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);

    const hand = footballCards.slice(0, 5);
    await db.insert(dailyChallengeCards).values(hand.map((row, index) => ({
      dailyChallengeId: challenge.id,
      position: index + 1,
      cardId: row.id,
      correctAnswer: row.player,
      choices: [row.player, "Other One", "Other Two", "Other Three"],
      pointValue: 100,
    })));

    const untouched = await replaceBlockedDaily5Cards(challenge.id, "2099-12-01");
    expect(untouched).toBe(0);
    const [before] = await db
      .select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(before.cardId).toBe(donnieId);

    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-04");
    expect(left).toBe(0);
    const dealt = await db
      .select({
        cardId: dailyChallengeCards.cardId,
        correctAnswer: dailyChallengeCards.correctAnswer,
        choices: dailyChallengeCards.choices,
        player: playableCards.player,
        gameSetId: playableCards.gameSetId,
      })
      .from(dailyChallengeCards)
      .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
    expect(dealt.some((row) => isBlockedCard(row.gameSetId, row.player))).toBe(false);
    expect(dealt.some((row) => row.cardId === donnieId)).toBe(false);
    for (const row of dealt) {
      expect(row.correctAnswer.toLowerCase()).not.toContain("donnie");
      expect((row.choices as string[]).join(" ").toLowerCase()).not.toContain("donnie");
    }

    const again = await replaceBlockedDaily5Cards(challenge.id, "2099-11-04");
    expect(again).toBe(0);
  });

  it("rewrites a stored future Daily 5 hand and leaves a past hand", async () => {
    const futureDate = "2099-12-15";
    const pastDate = "2099-12-01";
    const today = "2099-12-10";
    const blocked = card(footballSetId, "Charles Haley", "2024-04-01T00:00:00.000Z", "football");
    const futureSpare = card(footballSetId, "Future Spare", "2024-04-02T00:00:00.000Z", "football");
    const pastBlocked = card(footballSetId, "Charles Haley", "2024-04-03T00:00:00.000Z", "football");
    await db.insert(playableCards).values([
      { ...blocked, number: "125" },
      { ...futureSpare, number: "501" },
      { ...pastBlocked, number: "125" },
    ]);

    const [future] = await db.insert(dailyChallenges).values({
      date: futureDate,
      mode: "DAILY5",
      setId: footballSetId,
      seed: "blocklist-future",
      startsAt: new Date(`${futureDate}T00:00:00.000Z`),
      endsAt: new Date("2099-12-16T00:00:00.000Z"),
      status: "SCHEDULED",
    }).returning();
    const [past] = await db.insert(dailyChallenges).values({
      date: pastDate,
      mode: "DAILY5",
      setId: footballSetId,
      seed: "blocklist-past",
      startsAt: new Date(`${pastDate}T00:00:00.000Z`),
      endsAt: new Date("2099-12-02T00:00:00.000Z"),
      status: "CLOSED",
    }).returning();
    challengeIds.push(future.id, past.id);
    await db.insert(dailyChallengeCards).values([
      {
        dailyChallengeId: future.id,
        position: 2,
        cardId: blocked.id,
        correctAnswer: "Charles Haley",
        choices: ["Charles Haley", "Art Shell", "Joe Montana", "Jerry Rice"],
        pointValue: 100,
      },
      {
        dailyChallengeId: past.id,
        position: 1,
        cardId: pastBlocked.id,
        correctAnswer: "Charles Haley",
        choices: ["Charles Haley", "Art Shell", "Joe Montana", "Jerry Rice"],
        pointValue: 100,
      },
    ]);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const futureLeft = await replaceBlockedDaily5Cards(future.id, today);
    const pastLeft = await replaceBlockedDaily5Cards(past.id, today);
    const lines = spy.mock.calls.map((call) => String(call[0]));
    spy.mockRestore();
    expect(futureLeft).toBe(0);
    expect(pastLeft).toBe(0);
    const swapped = lines.find((line) => line.startsWith(`[Daily5] blocklist swapped date=${futureDate} `));
    expect(swapped).toMatch(new RegExp(`^\\[Daily5\\] blocklist swapped date=${futureDate} slot=2 old=${blocked.id} new=[0-9a-f-]{36}$`));
    expect(lines.some((line) => line.includes(pastDate))).toBe(false);
    expect(sweepBlockedDaily5Deals).toBeTypeOf("function");

    const [futureRow] = await db
      .select({ cardId: dailyChallengeCards.cardId, player: playableCards.player, number: playableCards.number, gameSetId: playableCards.gameSetId })
      .from(dailyChallengeCards)
      .innerJoin(playableCards, eq(playableCards.id, dailyChallengeCards.cardId))
      .where(eq(dailyChallengeCards.dailyChallengeId, future.id));
    const [pastRow] = await db
      .select({ cardId: dailyChallengeCards.cardId })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, past.id));
    expect(futureRow.cardId).toBe(swapped!.split(" new=")[1]);
    expect(futureRow.cardId).not.toBe(blocked.id);
    expect(isBlockedCard(futureRow.gameSetId, futureRow.player, futureRow)).toBe(false);
    expect(pastRow.cardId).toBe(pastBlocked.id);
    expect(isBlockedCard(footballSetId, "Charles Haley", { number: "125" })).toBe(true);
  });

  it("does not hang or rewrite a Daily 5 hand that has no eligible replacement", async () => {
    const [challenge] = await db.insert(dailyChallenges).values({
      date: "2099-11-05",
      mode: "DAILY5",
      setId: fleerOnlySetId,
      seed: "blocklist-empty",
      startsAt: new Date("2099-11-05T00:00:00.000Z"),
      endsAt: new Date("2099-11-06T00:00:00.000Z"),
      status: "ACTIVE",
    }).returning();
    challengeIds.push(challenge.id);
    const only = fleerOnlyId;
    await db.insert(dailyChallengeCards).values({
      dailyChallengeId: challenge.id,
      position: 1,
      cardId: only,
      correctAnswer: "Kevin Johnson",
      choices: ["Kevin Johnson", "A", "B", "C"],
      pointValue: 100,
    });

    const started = Date.now();
    const left = await replaceBlockedDaily5Cards(challenge.id, "2099-11-05");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(left).toBe(1);
    const [row] = await db
      .select({ cardId: dailyChallengeCards.cardId, correctAnswer: dailyChallengeCards.correctAnswer })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
    expect(row.cardId).toBe(only);
    expect(row.correctAnswer).toBe("Kevin Johnson");
  });
});
