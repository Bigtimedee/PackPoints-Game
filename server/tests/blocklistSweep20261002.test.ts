/**
 * Mask v4.6 sweep 2026-10-02: 26 cards with a readable name are blocked by id
 * on every deal path (solo, Daily 5 new and stored hands, Beat-me, which plays
 * the stored hand, 1v1, replacements, set covers). Card-pool refresh cannot
 * restore them, and a purge-and-reimport row with a new id is still blocked.
 * The 1987 Topps number-28 rule is gone, so Rick Dempsey #28 deals again and
 * Mike Schmidt #28 stays blocked.
 */
import { mkdtemp, rm, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { dailyChallengeCards, dailyChallenges, gameSessionsTable, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { daily5Service } from "../services/daily5Service";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { setPinnedCoversForTests } from "../config/pinnedCovers";
import { clearReadyCoverIndexForTests, eligibleCoverFile, resolvePinnedCoverReports } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import { cardPoolRefreshCandidateFilter, restorePlayableIfMaskAllows } from "../services/cardPoolRefresh";
import { eligibleDealFilter, maskNameStillCovered } from "../services/playableSetEligibility";
import {
  BLOCKED_CARD_ID_RULES,
  BLOCKED_SET_NUMBERS,
  TOPPS_1987_SCHMIDT_CARD_ID,
  TOPPS_1989_DWAYNE_HENRY_CARD_ID,
  cardBlocklistWhereBody,
  cardNotBlockedSql,
  isBlockedCard,
  isBlockedCardIdRow,
  replaceBlockedDaily5Cards,
} from "../lib/cardBlocklist";

type Sweep = { id: string; set: "1989-topps" | "1987-topps-football" | "1994-topps-football"; player: string; number: string; variant: string };

/** The 26 ids in BLOCKLIST-20261002.json, with the player and number each set's REPORT.md lists. */
const SWEEP: readonly Sweep[] = [
  { set: "1989-topps", id: "18976a3d-478e-472b-b953-dbbc25916f02", player: "Bobby Bonilla", number: "15", variant: "Base" },
  { set: "1989-topps", id: "4a8f5876-b655-4b87-8a26-f4bfeed8b418", player: "Kal Daniels", number: "45", variant: "Base" },
  { set: "1989-topps", id: "e907ca50-88fb-40f8-887c-38193c400c18", player: "Gerald Young", number: "95", variant: "Base" },
  { set: "1989-topps", id: "5f68eda8-0d8c-4f62-a867-8ecd5e7bce48", player: "Terry Clark", number: "129", variant: "Base" },
  { set: "1989-topps", id: "100d23d5-9200-4300-8169-d409b00f4a49", player: "Larry McWilliams", number: "259", variant: "Base" },
  { set: "1989-topps", id: "7908759d-1957-4f5d-8427-f4b17e4b994e", player: "Ron Gant", number: "296", variant: "Base" },
  { set: "1989-topps", id: "786aa786-621c-4332-9f0d-8ca968299694", player: "Mitch Williams", number: "411", variant: "Base" },
  { set: "1989-topps", id: "a59829d3-1b95-403d-8b27-12d794aebde0", player: "Bobby Bonilla", number: "440", variant: "Base" },
  { set: "1989-topps", id: "c866179d-e613-443f-a6ea-07d93dee3c03", player: "Dwayne Henry", number: "496", variant: "Base" },
  { set: "1989-topps", id: "77895a70-ac35-4abb-aee8-da8852c083e6", player: "Chet Lemon", number: "514", variant: "Base " },
  { set: "1989-topps", id: "486a5772-726c-40a5-95f3-61331619e151", player: "Mickey Tettleton", number: "521", variant: "Base" },
  { set: "1989-topps", id: "8ebd3d73-20d5-4dc4-bfff-4dc4bad2e3f7", player: "Randy Ready", number: "551", variant: "Base" },
  { set: "1989-topps", id: "8af3429e-3b98-4a14-b4a7-227b7437a2da", player: "Bert Blyleven", number: "555", variant: "Base" },
  { set: "1989-topps", id: "959f997a-4c85-49be-a47d-9b9668f49189", player: "Hank Aaron", number: "663", variant: "Base" },
  { set: "1989-topps", id: "63887679-9e66-4e82-a10c-6d10147ee322", player: "Gil Hodges", number: "664", variant: "Base" },
  { set: "1989-topps", id: "a4d47aae-6e59-4259-95e9-ef857038135f", player: "Steve Buechele", number: "732", variant: "Base" },
  { set: "1989-topps", id: "ee1f2993-acfd-431a-8ac0-70fe05a87b1e", player: "Alan Trammell", number: "770", variant: "Base" },
  { set: "1987-topps-football", id: "1df06ad0-500b-4548-aa24-50eb0b04c9bf", player: "Roger Craig", number: "113", variant: "Base" },
  { set: "1994-topps-football", id: "99b4021a-a4b2-43aa-b996-8b185e117715", player: "Willie Roaf", number: "19", variant: "Base" },
  { set: "1994-topps-football", id: "4c14660f-2245-42f7-ba63-ede3c1533e8e", player: "Morten Andersen", number: "71", variant: "Refractor" },
  { set: "1994-topps-football", id: "81aee6e1-667a-437e-94fa-30b1512ed892", player: "Tim Brown", number: "116", variant: "Base" },
  { set: "1994-topps-football", id: "f64270f3-35f1-458e-95fb-c3c422c92836", player: "Ernest Givins", number: "144", variant: "Refractor" },
  { set: "1994-topps-football", id: "04a80e83-905e-408d-9cb7-e93263333471", player: "Drew Bledsoe", number: "146", variant: "Base" },
  { set: "1994-topps-football", id: "1188d0ca-4421-4364-90ea-3543ee575fa0", player: "Victor Bailey", number: "196", variant: "Refractor" },
  { set: "1994-topps-football", id: "6c369ab7-3826-4f7a-be33-3b645e7bb225", player: "Victor Bailey", number: "196", variant: "Base" },
  { set: "1994-topps-football", id: "c19b9f98-d2c7-4a4a-86e7-92972ba654b7", player: "George Teague", number: "205", variant: "Base" },
];
const SWEEP_IDS = SWEEP.map((row) => row.id);

const stamp = randomUUID().slice(0, 8);
const prefix = `blocklist26:${stamp}:`;
/** Set ids keep the live 8-char prefix so set-scoped rules apply; the tail is unique to this run. */
function scopedSetId(prefix8: string): string {
  return `${prefix8}${randomUUID().slice(8)}`;
}
const SETS = {
  "1989-topps": { id: scopedSetId("352b33d1"), sport: "baseball", year: 1989, name: "1989 Topps" },
  "1987-topps-football": { id: scopedSetId("91cfdf3f"), sport: "football", year: 1987, name: "1987 Topps Football" },
  "1994-topps-football": { id: scopedSetId("a09b2fe7"), sport: "football", year: 1994, name: "1994 Topps Football" },
  "1987-topps": { id: scopedSetId("37fd025d"), sport: "baseball", year: 1987, name: "1987 Topps" },
} as const;
type SetKey = keyof typeof SETS;

const live1987FootballId = "91cfdf3f-a620-4e73-adc8-22b8df221716";
const fillerIds = new Map<SetKey, string[]>();
const allCardIds: string[] = [];
const challengeIds: string[] = [];
const sessionIds: string[] = [];
const dempseyId = randomUUID();
const schmidtReimportId = randomUUID();
const henryReimportId = randomUUID();
const andersenBaseId = randomUUID();
let dir = "";

function row(id: string, setKey: SetKey, player: string, number: string, variant: string | null, extra: Record<string, unknown> = {}) {
  const set = SETS[setKey];
  allCardIds.push(id);
  return {
    id,
    gameSetId: set.id,
    cardhedgeCardId: `${prefix}${id}`,
    player,
    set: `${set.name} ${stamp}`,
    description: player,
    number,
    variant,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: set.sport,
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
    ...extra,
  };
}

async function bake(cardId: string) {
  await writeFile(path.join(dir, warmOkMarkerFilename(cardId)), "ok\n");
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from(`masked-${cardId}`));
}

async function dealableAmong(ids: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ id: playableCards.id })
    .from(playableCards)
    .where(and(inArray(playableCards.id, ids), eligibleDealFilter("playable_cards")));
  return new Set(rows.map((r) => r.id));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "blocklist26-"));
  setMaskReadySidecarDirForTests(dir);
  // The live ids may exist from another test run; this file owns them while it runs.
  await db.delete(playableCards).where(inArray(playableCards.id, SWEEP_IDS));
  for (const set of Object.values(SETS)) {
    await db.insert(gameSets).values({
      id: set.id,
      sport: set.sport,
      brand: "Topps",
      year: set.year,
      setName: `${set.name} ${stamp}`,
      isUserCreated: true,
      isActive: true,
    });
  }
  const rows = SWEEP.map((card) => row(card.id, card.set, card.player, card.number, card.variant));
  for (const key of Object.keys(SETS) as SetKey[]) {
    const ids = Array.from({ length: 8 }, () => randomUUID());
    fillerIds.set(key, ids);
    ids.forEach((id, i) => rows.push(row(id, key, `Filler ${key} ${i + 1}`, String(900 + i), "Base")));
  }
  rows.push(row(dempseyId, "1987-topps", "Rick Dempsey", "28", "Base"));
  rows.push(row(andersenBaseId, "1994-topps-football", "Morten Andersen", "71", "Base"));
  await db.insert(playableCards).values(rows);
  for (const id of allCardIds) await bake(id);
  clearReadyCoverIndexForTests();
});

afterAll(async () => {
  for (const key of Object.keys(SETS) as SetKey[]) setPinnedCoversForTests(SETS[key].id, null);
  if (challengeIds.length > 0) {
    await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds)).catch(() => null);
    await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds)).catch(() => null);
  }
  if (sessionIds.length > 0) await db.delete(gameSessionsTable).where(inArray(gameSessionsTable.id, sessionIds)).catch(() => null);
  await db.delete(playableCards).where(like(playableCards.cardhedgeCardId, `${prefix}%`)).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, Object.values(SETS).map((set) => set.id))).catch(() => null);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

describe("v4.6 sweep blocklist: the 26 ids", () => {
  it("lists exactly the 26 sweep ids plus Schmidt, each with the set and number from the report", () => {
    const rules = new Map(BLOCKED_CARD_ID_RULES.map((rule) => [rule.id, rule]));
    expect(BLOCKED_CARD_ID_RULES).toHaveLength(27);
    expect(rules.has(TOPPS_1987_SCHMIDT_CARD_ID)).toBe(true);
    const prefixes: Record<Sweep["set"], string> = { "1989-topps": "352b33d1", "1987-topps-football": "91cfdf3f", "1994-topps-football": "a09b2fe7" };
    for (const card of SWEEP) {
      const rule = rules.get(card.id);
      expect(rule, card.id).toBeTruthy();
      expect(rule!.gameSetId).toBe(prefixes[card.set]);
      expect(rule!.number).toBe(card.number);
      expect(card.player.toLowerCase()).toContain(rule!.surname);
      expect(rule!.variant).toBe(card.variant.trim().toLowerCase());
    }
    expect(SWEEP.filter((c) => c.set === "1989-topps")).toHaveLength(17);
    expect(SWEEP.filter((c) => c.set === "1987-topps-football")).toHaveLength(1);
    expect(SWEEP.filter((c) => c.set === "1994-topps-football")).toHaveLength(8);
    expect(TOPPS_1989_DWAYNE_HENRY_CARD_ID).toBe("c866179d-e613-443f-a6ea-07d93dee3c03");
  });

  it("blocks each id in isBlockedCard and in the SQL predicate, whatever the player field says", () => {
    const body = cardBlocklistWhereBody("playable_cards");
    const pcBody = cardBlocklistWhereBody("pc");
    for (const card of SWEEP) {
      expect(isBlockedCard(SETS[card.set].id, card.player, { id: card.id, number: card.number, variant: card.variant }), card.id).toBe(true);
      expect(isBlockedCard(SETS[card.set].id, "Someone Else", { id: card.id }), card.id).toBe(true);
      expect(isBlockedCard(SETS[card.set].id, card.player, { cardId: card.id }), card.id).toBe(true);
      expect(body).toContain(`lower(playable_cards.id) = '${card.id}'`);
      expect(pcBody).toContain(`lower(pc.id) = '${card.id}'`);
    }
  });

  it("drops every id from the shared deal filter (solo shelf count, covers, QA dealable list)", async () => {
    const kept = await dealableAmong([...SWEEP_IDS, ...fillerIds.get("1989-topps")!]);
    for (const id of SWEEP_IDS) expect(kept.has(id), id).toBe(false);
    for (const id of fillerIds.get("1989-topps")!) expect(kept.has(id)).toBe(true);
  });

  it("never deals a blocked id in a solo stack", async () => {
    for (const key of ["1989-topps", "1987-topps-football", "1994-topps-football"] as const) {
      for (let i = 0; i < 3; i++) {
        const dealt = await storage.getRandomCardsFromSet(SETS[key].id, 40);
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.some((card) => SWEEP_IDS.includes(card.id)), key).toBe(false);
      }
    }
  });

  it("never draws a blocked id into a new Daily 5 hand", async () => {
    let day = 1;
    for (const key of ["1989-topps", "1987-topps-football", "1994-topps-football"] as const) {
      const date = `2098-03-${String(day++).padStart(2, "0")}`;
      const [challenge] = await db.insert(dailyChallenges).values({
        date,
        mode: "DAILY5",
        setId: SETS[key].id,
        seed: `blocklist26-${stamp}-${key}`,
        startsAt: new Date(`${date}T00:00:00.000Z`),
        endsAt: new Date(`${date}T23:00:00.000Z`),
        status: "SCHEDULED",
      }).returning();
      challengeIds.push(challenge.id);
      await daily5Service.selectCardsForChallenge(challenge, SETS[key].id, challenge.seed);
      const dealt = await db
        .select({ cardId: dailyChallengeCards.cardId, choices: dailyChallengeCards.choices })
        .from(dailyChallengeCards)
        .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
      expect(dealt).toHaveLength(5);
      expect(dealt.some((card) => SWEEP_IDS.includes(card.cardId)), key).toBe(false);
    }

    // With every filler unplayable, the Daily 5 pool in each set is the blocked ids alone.
    // The draw must see zero candidates, so no single blocked id can slip into a hand.
    const sweepSetFillers = (["1989-topps", "1987-topps-football", "1994-topps-football"] as const).flatMap((key) => fillerIds.get(key)!);
    await db.update(playableCards).set({ isPlayable: false }).where(inArray(playableCards.id, sweepSetFillers));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const key of ["1989-topps", "1987-topps-football", "1994-topps-football"] as const) {
        const date = `2098-03-${String(day++).padStart(2, "0")}`;
        const [challenge] = await db.insert(dailyChallenges).values({
          date,
          mode: "DAILY5",
          setId: SETS[key].id,
          seed: `blocklist26-empty-${stamp}-${key}`,
          startsAt: new Date(`${date}T00:00:00.000Z`),
          endsAt: new Date(`${date}T23:00:00.000Z`),
          status: "SCHEDULED",
        }).returning();
        challengeIds.push(challenge.id);
        spy.mockClear();
        await daily5Service.selectCardsForChallenge(challenge, SETS[key].id, challenge.seed);
        // 1994 keeps the Andersen #71 base card, which is not blocked; only its refractor is.
        const expected = key === "1994-topps-football" ? 1 : 0;
        expect(spy.mock.calls.map((call) => String(call[0])).join("\n"), key).toContain(`Not enough playable cards (${expected}) for date ${date}`);
        const dealt = await db.select({ cardId: dailyChallengeCards.cardId }).from(dailyChallengeCards)
          .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id));
        expect(dealt).toHaveLength(0);
      }
    } finally {
      spy.mockRestore();
      await db.update(playableCards).set({ isPlayable: true }).where(inArray(playableCards.id, sweepSetFillers));
    }
  });

  it("rewrites a stored Daily 5 hand (the hand Beat-me and signed-out Daily 5 serve) that holds blocked ids", async () => {
    const hands: Array<[SetKey, string[]]> = [
      ["1989-topps", SWEEP.filter((c) => c.set === "1989-topps").slice(0, 5).map((c) => c.id)],
      ["1989-topps", [TOPPS_1989_DWAYNE_HENRY_CARD_ID, ...SWEEP.filter((c) => c.set === "1989-topps").slice(12, 16).map((c) => c.id)]],
      ["1994-topps-football", SWEEP.filter((c) => c.set === "1994-topps-football").slice(0, 5).map((c) => c.id)],
      ["1994-topps-football", [...SWEEP.filter((c) => c.set === "1994-topps-football").slice(5).map((c) => c.id), ...fillerIds.get("1994-topps-football")!.slice(0, 2)]],
      ["1987-topps-football", ["1df06ad0-500b-4548-aa24-50eb0b04c9bf", ...fillerIds.get("1987-topps-football")!.slice(0, 4)]],
      ["1989-topps", [...SWEEP.filter((c) => c.set === "1989-topps").slice(5, 9).map((c) => c.id), SWEEP[16].id]],
      ["1989-topps", [...SWEEP.filter((c) => c.set === "1989-topps").slice(9, 12).map((c) => c.id), ...fillerIds.get("1989-topps")!.slice(0, 2)]],
    ];
    const covered = new Set(hands.flatMap(([, ids]) => ids).filter((id) => SWEEP_IDS.includes(id)));
    expect([...covered].sort()).toEqual([...SWEEP_IDS].sort());

    let day = 10;
    for (const [key, ids] of hands) {
      const date = `2098-04-${String(day++).padStart(2, "0")}`;
      const [challenge] = await db.insert(dailyChallenges).values({
        date,
        mode: "DAILY5",
        setId: SETS[key].id,
        seed: `blocklist26-stored-${stamp}-${date}`,
        startsAt: new Date(`${date}T00:00:00.000Z`),
        endsAt: new Date(`${date}T23:00:00.000Z`),
        status: "ACTIVE",
      }).returning();
      challengeIds.push(challenge.id);
      await db.insert(dailyChallengeCards).values(ids.map((cardId, index) => ({
        dailyChallengeId: challenge.id,
        position: index + 1,
        cardId,
        correctAnswer: SWEEP.find((c) => c.id === cardId)?.player ?? `Filler ${index}`,
        choices: [SWEEP.find((c) => c.id === cardId)?.player ?? `Filler ${index}`, "Other One", "Other Two", "Other Three"],
        pointValue: 100,
      })));
      const left = await replaceBlockedDaily5Cards(challenge.id, date);
      expect(left).toBe(0);
      const served = await db
        .select({ cardId: dailyChallengeCards.cardId })
        .from(dailyChallengeCards)
        .where(eq(dailyChallengeCards.dailyChallengeId, challenge.id))
        .orderBy(asc(dailyChallengeCards.position));
      expect(served).toHaveLength(5);
      expect(served.some((card) => SWEEP_IDS.includes(card.cardId)), date).toBe(false);
    }
  });

  it("keeps blocked ids out of the 1v1 and replacement queries", async () => {
    // generateQuestions, the 1v1 database fallback, and findReplacementCard share these SQL conditions
    // and then re-check isBlockedCard on each row.
    const rows = await db
      .select()
      .from(playableCards)
      .where(and(
        inArray(playableCards.id, [...SWEEP_IDS, ...fillerIds.get("1994-topps-football")!]),
        eq(playableCards.isPlayable, true),
        inArray(playableCards.quarantineStatus, ["OK", "SUSPECT_TRANSIENT"]),
        maskNameStillCovered("playable_cards"),
        cardNotBlockedSql("playable_cards"),
      ));
    expect(rows.some((card) => SWEEP_IDS.includes(card.id))).toBe(false);
    expect(rows.length).toBe(8);
    for (const card of SWEEP) {
      const full = { ...card, gameSetId: SETS[card.set].id };
      expect(isBlockedCard(full.gameSetId, full.player, full)).toBe(true);
    }

    const match = readFileSync(new URL("../services/matchService.ts", import.meta.url), "utf8");
    const gen = match.slice(match.indexOf("private async generateQuestions"));
    expect(gen.slice(0, 2500)).toContain('cardNotBlockedSql("playable_cards")');
    expect(gen.slice(0, 2500)).toContain("isBlockedCard(card.gameSetId, card.player, card)");
    expect(match).toContain("isBlockedCard(row.gameSetId, row.player, row)");
    const replace = readFileSync(new URL("../services/matches/replaceQuestion.ts", import.meta.url), "utf8");
    const find = replace.slice(replace.indexOf("async function findReplacementCard"));
    expect(find.slice(0, 1500)).toContain('cardNotBlockedSql("playable_cards")');
    expect(find.slice(0, 1500)).toContain("isBlockedCard(c.gameSetId, c.player, c)");
  });

  it("never offers a blocked id as a solo replacement", async () => {
    for (const key of ["1989-topps", "1994-topps-football"] as const) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      const failedId = fillerIds.get(key)![0];
      await db.insert(gameSessionsTable).values({
        id: sessionId,
        mode: "solo",
        questions: [{
          card: {
            id: failedId,
            playableCardId: failedId,
            gameSetId: SETS[key].id,
            playerName: "Filler",
            team: "",
            year: SETS[key].year,
            cardNumber: "900",
            imageUrl: `https://packpts.com/cards/${failedId}.jpg`,
            popularity: 50,
            imageVerified: true,
            setName: SETS[key].name,
            position: "",
          },
          options: ["Filler", "A", "B", "C"],
          correctAnswer: "Filler",
          pointValue: 100,
        }],
        currentQuestionIndex: 0,
        score: 0,
        correctAnswers: 0,
        totalQuestions: 1,
        skippedQuestions: 0,
        status: "active",
        startedAt: "2026-10-02T00:00:00.000Z",
      });
      for (let i = 0; i < 10; i++) {
        const result = await storage.getReplacementCardForSession(sessionId, failedId, []);
        expect(result).toBeTruthy();
        const id = result!.question.card.playableCardId || String(result!.question.card.id);
        expect(SWEEP_IDS.includes(id), id).toBe(false);
      }

      // Only blocked ids left in the set. Same-set candidates come first, so a leaked id would be
      // picked here; the cross-set fallback may still answer with a card from another set.
      const others = [...fillerIds.get(key)!.slice(1), andersenBaseId];
      await db.update(playableCards).set({ isPlayable: false }).where(inArray(playableCards.id, others));
      try {
        const none = await storage.getReplacementCardForSession(sessionId, failedId, []);
        const id = none ? (none.question.card.playableCardId || String(none.question.card.id)) : null;
        expect(id === null || !SWEEP_IDS.includes(id), String(id)).toBe(true);
        if (none) expect(none.question.card.gameSetId).not.toBe(SETS[key].id);
      } finally {
        await db.update(playableCards).set({ isPlayable: true }).where(inArray(playableCards.id, others));
      }
    }
  });

  it("drops a pinned set cover that is one of the blocked ids and never serves its file", async () => {
    for (const key of ["1989-topps", "1987-topps-football", "1994-topps-football"] as const) {
      const blocked = SWEEP.filter((c) => c.set === key).map((c) => c.id);
      const good = fillerIds.get(key)!.slice(0, 2);
      setPinnedCoversForTests(SETS[key].id, [...blocked.slice(0, 6), ...good]);
      clearReadyCoverIndexForTests();
      const report = (await resolvePinnedCoverReports([SETS[key].id])).get(SETS[key].id)!;
      expect(report.validIds).toEqual(good);
      const reasons = new Map(report.dropped.map((drop) => [drop.cardId, drop.reason]));
      for (const id of blocked.slice(0, 6)) expect(reasons.get(id), id).toBe("blocked");
      setPinnedCoversForTests(SETS[key].id, null);
    }
    for (const id of SWEEP_IDS) expect(await eligibleCoverFile(id), id).toBeNull();
    expect(await eligibleCoverFile(fillerIds.get("1989-topps")![0])).not.toBeNull();
  });
});

describe("v4.6 sweep blocklist: refresh and re-import", () => {
  it("leaves blocked ids out of card-pool refresh and refuses to restore them", async () => {
    await db.update(playableCards)
      .set({ isPlayable: false, imageFailureCount: 1, quarantineStatus: "QUARANTINED_ADMIN_REVIEW" })
      .where(inArray(playableCards.id, [...SWEEP_IDS, fillerIds.get("1989-topps")![7]]));
    try {
      const candidates = await db
        .select({ id: playableCards.id })
        .from(playableCards)
        .where(and(inArray(playableCards.id, [...SWEEP_IDS, fillerIds.get("1989-topps")![7]]), cardPoolRefreshCandidateFilter()));
      expect(candidates.map((c) => c.id)).toEqual([fillerIds.get("1989-topps")![7]]);

      for (const card of SWEEP) {
        const [stored] = await db.select().from(playableCards).where(eq(playableCards.id, card.id));
        expect(await restorePlayableIfMaskAllows(stored, `https://packpts.com/cards/${card.id}-new.jpg`)).toBe(false);
      }
      const after = await db
        .select({ id: playableCards.id, isPlayable: playableCards.isPlayable })
        .from(playableCards)
        .where(inArray(playableCards.id, SWEEP_IDS));
      expect(after.every((c) => c.isPlayable === false)).toBe(true);

      const [control] = await db.select().from(playableCards).where(eq(playableCards.id, fillerIds.get("1989-topps")![7]));
      expect(await restorePlayableIfMaskAllows(control, control.imageUrl!)).toBe(true);
    } finally {
      await db.update(playableCards)
        .set({ isPlayable: true, imageFailureCount: 0, quarantineStatus: "OK" })
        .where(inArray(playableCards.id, SWEEP_IDS));
    }
    expect((await dealableAmong(SWEEP_IDS)).size).toBe(0);
  });

  it("still blocks a sweep card, Henry #496, and Schmidt #28 after a purge-and-reimport gives them new ids", async () => {
    const reimported = [
      row(henryReimportId, "1989-topps", "Dwayne Henry", "496", "Base"),
      row(schmidtReimportId, "1987-topps", "Mike Schmidt", "#028", null),
    ];
    const moreIds = SWEEP.map(() => randomUUID());
    SWEEP.forEach((card, i) => {
      if (card.id === TOPPS_1989_DWAYNE_HENRY_CARD_ID) return;
      reimported.push(row(moreIds[i], card.set, card.player, `#${card.number}`, card.variant.trim().toUpperCase()));
    });
    await db.insert(playableCards).values(reimported);
    const ids = reimported.map((r) => r.id);
    expect(ids).toHaveLength(27);
    for (const r of reimported) {
      expect(isBlockedCard(r.gameSetId, r.player, r), `${r.player} ${r.number}`).toBe(true);
      expect(isBlockedCardIdRow(r), `${r.player} ${r.number}`).toBe(true);
    }
    expect((await dealableAmong(ids)).size).toBe(0);
    const candidates = await db.select({ id: playableCards.id }).from(playableCards)
      .where(and(inArray(playableCards.id, ids), cardPoolRefreshCandidateFilter()));
    expect(candidates).toHaveLength(0);
  });

  it("keeps the base card when only the refractor of that number is blocked", async () => {
    expect(isBlockedCard(SETS["1994-topps-football"].id, "Morten Andersen", { id: andersenBaseId, number: "71", variant: "Base" })).toBe(false);
    expect((await dealableAmong([andersenBaseId])).has(andersenBaseId)).toBe(true);
  });
});

describe("1987 Topps number-28 rule removed", () => {
  it("has no whole-number rule left", () => {
    expect(BLOCKED_SET_NUMBERS).toEqual([]);
  });

  it("deals Rick Dempsey #28 again", async () => {
    expect(isBlockedCard(SETS["1987-topps"].id, "Rick Dempsey", { id: dempseyId, number: "28", variant: "Base" })).toBe(false);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Rick Dempsey", { number: "28" })).toBe(false);
    expect((await dealableAmong([dempseyId])).has(dempseyId)).toBe(true);
    let seen = false;
    for (let i = 0; i < 5 && !seen; i++) {
      const dealt = await storage.getRandomCardsFromSet(SETS["1987-topps"].id, 20);
      seen = dealt.some((card) => card.id === dempseyId);
    }
    expect(seen).toBe(true);
  });

  it("keeps Mike Schmidt #28 blocked by id", () => {
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Mike Schmidt", { id: TOPPS_1987_SCHMIDT_CARD_ID, number: "28" })).toBe(true);
    expect(isBlockedCard(live1987FootballId, "Anyone", { id: TOPPS_1987_SCHMIDT_CARD_ID })).toBe(true);
    expect(cardBlocklistWhereBody("playable_cards")).toContain(`lower(playable_cards.id) = '${TOPPS_1987_SCHMIDT_CARD_ID}'`);
    expect(isBlockedCard("37fd025d-2ae1-4c92-b8ad-133375d0c722", "Mike Schmidt", { number: "430" })).toBe(false);
  });
});
