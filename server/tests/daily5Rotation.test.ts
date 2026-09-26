/**
 * Daily 5 set rotation. Pure cases do not touch the database.
 * Stored-deal and eligibility cases use the test database. No shell commands.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { addPackptsDays, getDailyStartEnd, getPackptsDayKey, packptsMidnightUtc } from "@shared/packptsDay";
import { isNonPlayerCard } from "@shared/nonPlayerCard";
import {
  dailyChallengeCards,
  dailyChallengeEntries,
  dailyChallenges,
  gameSets,
  playableCards,
  users,
} from "@shared/schema";
import { db } from "../db";
import { buildScoreCardSvg, scoreCardEyebrow } from "../contentFactory/generateScoreCard";
import { createBeatMeFromSession } from "../services/daily5BeatMe";
import {
  DAILY5_ROTATION_EPOCH,
  daily5RotationCandidates,
  daysSinceDaily5Epoch,
  orderDaily5RotationSets,
  pickDaily5RotationSet,
  type Daily5RotationCandidate,
} from "../services/daily5Rotation";
import { PUBLIC_SET_MIN_ELIGIBLE_CARDS } from "../services/playableSetEligibility";
import { loadActiveIntegratedSets } from "../services/integratedDealSets";
import {
  daily5Service,
  daily5StatusForNow,
  loadDaily5DealCards,
  toPublicDaily5Status,
} from "../services/daily5Service";
import { verifiedGameSetTitle } from "../services/gameSetTitles";

const stamp = randomUUID().slice(0, 8);
const alphaId = randomUUID();
const betaId = randomUUID();
const thinId = randomUUID();
const ugcId = randomUUID();
const inactiveId = randomUUID();
const storedSetId = randomUUID();
const setIds = [alphaId, betaId, thinId, ugcId, inactiveId, storedSetId];
const challengeIds: string[] = [];

const PLAYERS = [
  "Ken Griffey Jr",
  "Nolan Ryan",
  "Cal Ripken Jr",
  "Tony Gwynn",
  "Ozzie Smith",
  "Rickey Henderson",
] as const;

function track(challenge: { id: string } | null | undefined) {
  if (challenge) challengeIds.push(challenge.id);
}

function goodCard(setId: string, player: string, imageUrl?: string) {
  return {
    gameSetId: setId,
    cardhedgeCardId: `d5rot:${randomUUID()}`,
    player,
    set: `Rotation ${stamp}`,
    description: `Rotation ${stamp} ${player}`,
    imageUrl: imageUrl ?? `https://packpts.com/cards/${randomUUID()}.jpg`,
    category: "baseball",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
  };
}

const roster: Daily5RotationCandidate[] = [
  { id: "alpha", createdAt: "2020-01-02T00:00:00.000Z", cardCount: 12 },
  { id: "beta", createdAt: "2020-06-01T00:00:00.000Z", cardCount: 8 },
  { id: "gamma", createdAt: "2021-01-01T00:00:00.000Z", cardCount: 9 },
];

function expectCtBoundary(late: Date, early: Date, lateKey: string, earlyKey: string) {
  expect(getPackptsDayKey(late)).toBe(lateKey);
  expect(getPackptsDayKey(early)).toBe(earlyKey);
  expect(earlyKey).toBe(addPackptsDays(lateKey, 1));
  const window = getDailyStartEnd(lateKey);
  expect(daily5StatusForNow(window.startsAt, window.endsAt, late)).toBe("ACTIVE");
  expect(late.getTime()).toBeLessThan(window.endsAt.getTime());
  expect(early.getTime()).toBeGreaterThanOrEqual(window.endsAt.getTime());
  expect(getDailyStartEnd(earlyKey).startsAt.toISOString()).toBe(window.endsAt.toISOString());
  const lateSet = pickDaily5RotationSet(roster, lateKey);
  const earlySet = pickDaily5RotationSet(roster, earlyKey);
  expect(lateSet?.id).toBeTruthy();
  expect(earlySet?.id).toBeTruthy();
  expect(lateSet?.id).not.toBe(earlySet?.id);
}

describe("Daily 5 rotation math", () => {
  it("picks different sets on consecutive CT days and is deterministic", () => {
    const day = "2026-09-26";
    const next = addPackptsDays(day, 1);
    const first = pickDaily5RotationSet(roster, day);
    const second = pickDaily5RotationSet(roster, next);
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
    expect(pickDaily5RotationSet(roster, day)?.id).toBe(first?.id);
    expect(pickDaily5RotationSet([...roster].reverse(), day)?.id).toBe(first?.id);
    expect(daysSinceDaily5Epoch(next)).toBe(daysSinceDaily5Epoch(day) + 1);
    expect(orderDaily5RotationSets(roster).map((set) => set.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("skips a set with fewer than 5 eligible cards and uses the next", () => {
    const sets: Daily5RotationCandidate[] = [
      { id: "thin", createdAt: "2020-01-01T00:00:00.000Z", cardCount: PUBLIC_SET_MIN_ELIGIBLE_CARDS - 1 },
      { id: "ready", createdAt: "2020-02-01T00:00:00.000Z", cardCount: PUBLIC_SET_MIN_ELIGIBLE_CARDS },
      { id: "later", createdAt: "2020-03-01T00:00:00.000Z", cardCount: 11 },
    ];
    expect(daysSinceDaily5Epoch(DAILY5_ROTATION_EPOCH)).toBe(0);
    expect(daily5RotationCandidates(sets, DAILY5_ROTATION_EPOCH)[0]?.id).toBe("thin");
    expect(pickDaily5RotationSet(sets, DAILY5_ROTATION_EPOCH)?.id).toBe("ready");
    expect(pickDaily5RotationSet([
      { id: "only-thin", createdAt: "2020-01-01T00:00:00.000Z", cardCount: 3 },
    ], DAILY5_ROTATION_EPOCH)).toBeNull();
  });

  it("keeps the CT midnight boundary, including a DST date", () => {
    expect(packptsMidnightUtc("2026-07-16").toISOString()).toBe("2026-07-16T05:00:00.000Z");
    expect(packptsMidnightUtc("2026-01-16").toISOString()).toBe("2026-01-16T06:00:00.000Z");
    expect(packptsMidnightUtc("2026-03-08").toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(packptsMidnightUtc("2026-03-09").toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(packptsMidnightUtc("2026-11-01").toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(packptsMidnightUtc("2026-11-02").toISOString()).toBe("2026-11-02T06:00:00.000Z");

    expectCtBoundary(
      new Date("2026-07-16T04:30:00.000Z"),
      new Date("2026-07-16T05:30:00.000Z"),
      "2026-07-15",
      "2026-07-16",
    );
    expectCtBoundary(
      new Date("2026-01-16T05:30:00.000Z"),
      new Date("2026-01-16T06:30:00.000Z"),
      "2026-01-15",
      "2026-01-16",
    );
    expectCtBoundary(
      new Date("2026-03-09T04:30:00.000Z"),
      new Date("2026-03-09T05:30:00.000Z"),
      "2026-03-08",
      "2026-03-09",
    );
    expectCtBoundary(
      new Date("2026-11-02T05:30:00.000Z"),
      new Date("2026-11-02T06:30:00.000Z"),
      "2026-11-01",
      "2026-11-02",
    );
  });

  it("strips the deal seed, adds the set name, and does not add card ids", () => {
    const body = toPublicDaily5Status({
      challenge: {
        id: "challenge-1",
        date: "2026-09-26",
        seed: "deal-seed-secret",
        setId: "set-1",
        status: "ACTIVE",
      },
      setName: "1986 Topps",
      hasPlayed: false,
      entry: null,
    });
    expect(body.setName).toBe("1986 Topps");
    expect(body.challenge?.setName).toBe("1986 Topps");
    expect(body.challenge).not.toHaveProperty("seed");
    expect(JSON.stringify(body)).not.toContain("deal-seed-secret");
    expect(JSON.stringify(body)).not.toContain("cardId");
    expect(body.challenge).not.toHaveProperty("cards");
    expect(body.challenge).not.toHaveProperty("player");
  });

  it("share chrome says Daily 5 and matches the scored total; 1v1 keeps its own label", () => {
    const scored = { correctCount: 2, score: 200, totalQuestions: 5, date: "2026-09-26", username: "collector" };
    const daily = buildScoreCardSvg({ ...scored, mode: "daily5" });
    const match = buildScoreCardSvg({ ...scored, mode: "1v1" });
    expect(scoreCardEyebrow("daily5")).toBe("DAILY 5");
    expect(daily).toContain("DAILY 5");
    expect(daily).toContain("2/5");
    expect(daily).toContain("200 pts");
    expect(daily).toContain("Two locked. Three open.");
    expect(scoreCardEyebrow("1v1")).toBe("1V1 MATCH");
    expect(match).toContain("1V1 MATCH");
    expect(match).toContain("2/5");
    expect(match).toContain("200 pts");
    expect(match).not.toContain("DAILY 5");
  });

  it("deals through the shared eligibility module", () => {
    const service = readFileSync(new URL("../services/daily5Service.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    expect(service).toContain("verifiedGameSetTitle");
    expect(service).toContain("loadActiveIntegratedSets");
    expect(service).toContain('eligibleDealFilter("playable_cards")');
    expect(service).not.toContain("cardsImportedCount");
    expect(service).toContain('kickPreMask(selected.map((card) => card.id), "daily5-create")');
    expect(service).toContain("pointValue: 100");
    const start = route.indexOf('app.get("/api/daily5/status"');
    const slice = route.slice(start, start + 700);
    expect(slice).toContain("toPublicDaily5Status");
  });
});

describe("Daily 5 rotation against the shared roster", () => {
  let beatUserId = "";
  let beatChallengeId: string | null = null;
  let createdToday = false;

  beforeAll(async () => {
    await db.insert(gameSets).values([
      { id: alphaId, sport: "baseball", brand: "Topps", year: 1891, setName: `D5 Alpha ${stamp}`, isUserCreated: false, isActive: true, titleVerified: true, createdAt: new Date("2024-01-01T00:00:00.000Z") },
      { id: betaId, sport: "baseball", brand: "Topps", year: 1892, setName: `D5 Beta ${stamp}`, isUserCreated: false, isActive: true, titleVerified: true, createdAt: new Date("2024-06-01T00:00:00.000Z") },
      { id: thinId, sport: "baseball", brand: "Topps", year: 1893, setName: `D5 Thin ${stamp}`, isUserCreated: false, isActive: true, titleVerified: true, createdAt: new Date("2024-02-01T00:00:00.000Z") },
      { id: ugcId, sport: "baseball", brand: "Topps", year: 1894, setName: `D5 UGC ${stamp}`, isUserCreated: true, isActive: true, titleVerified: true, createdAt: new Date("2024-01-15T00:00:00.000Z") },
      { id: inactiveId, sport: "baseball", brand: "Topps", year: 1895, setName: `D5 Inactive ${stamp}`, isUserCreated: false, isActive: false, titleVerified: true, createdAt: new Date("2024-01-20T00:00:00.000Z") },
      { id: storedSetId, sport: "baseball", brand: "Topps", year: 1896, setName: `D5 Stored ${stamp}`, isUserCreated: false, isActive: true, titleVerified: true, createdAt: new Date("2023-01-01T00:00:00.000Z") },
    ]);

    await db.insert(playableCards).values([
      ...PLAYERS.map((player) => goodCard(alphaId, player)),
      goodCard(alphaId, "Team Checklist"),
      { ...goodCard(alphaId, "Placeholder Pete"), imageUrl: "https://packpts.com/cards/placeholder-card.jpg" },
      { ...goodCard(alphaId, "Not Playable"), isPlayable: false },
      { ...goodCard(alphaId, "Wrong Sport"), category: "football" },
      { ...goodCard(alphaId, "Http Image"), imageUrl: "http://packpts.com/cards/plain.jpg" },
      { ...goodCard(alphaId, "Rejected Scan"), imageReviewStatus: "rejected" },
      { ...goodCard(alphaId, "Failed Verify"), contentVerified: false },
      { ...goodCard(alphaId, "Quarantine Card"), quarantineStatus: "QUARANTINED_ADMIN_REVIEW", proposedUnplayable: true },
      { ...goodCard(alphaId, "Blank Name"), player: "  " },
      ...PLAYERS.slice(0, 5).map((player) => goodCard(betaId, player)),
      ...PLAYERS.slice(0, 4).map((player) => goodCard(thinId, player)),
      ...PLAYERS.map((player) => goodCard(ugcId, player)),
      ...PLAYERS.map((player) => goodCard(inactiveId, player)),
      ...PLAYERS.map((player) => goodCard(storedSetId, player)),
    ]);
  });

  afterAll(async () => {
    if (beatUserId && beatChallengeId) {
      await db.delete(dailyChallengeEntries).where(and(
        eq(dailyChallengeEntries.dailyChallengeId, beatChallengeId),
        eq(dailyChallengeEntries.userId, beatUserId),
      )).catch(() => null);
    }
    if (challengeIds.length > 0) {
      await db.delete(dailyChallengeEntries).where(inArray(dailyChallengeEntries.dailyChallengeId, challengeIds)).catch(() => null);
      await db.delete(dailyChallengeCards).where(inArray(dailyChallengeCards.dailyChallengeId, challengeIds)).catch(() => null);
      await db.delete(dailyChallenges).where(inArray(dailyChallenges.id, challengeIds)).catch(() => null);
    }
    await db.delete(playableCards).where(inArray(playableCards.gameSetId, setIds)).catch(() => null);
    await db.delete(gameSets).where(inArray(gameSets.id, setIds)).catch(() => null);
    if (beatUserId) {
      await db.delete(users).where(eq(users.id, beatUserId)).catch(() => null);
    }
  });

  it("counts eligible cards with the shared query and skips a thin set", async () => {
    const live = await loadActiveIntegratedSets();
    const thin = live.find((set) => set.id === thinId);
    const alpha = live.find((set) => set.id === alphaId);
    expect(thin?.cardCount).toBe(4);
    expect(alpha?.cardCount).toBe(8);
    expect(live.some((set) => set.id === ugcId)).toBe(false);
    expect(live.some((set) => set.id === inactiveId)).toBe(false);

    const dealt = await loadDaily5DealCards(alphaId, "baseball");
    const names = dealt.map((card) => card.player);
    expect(dealt).toHaveLength(PLAYERS.length);
    expect(names).toEqual(expect.arrayContaining([...PLAYERS]));
    expect(names).not.toContain("Team Checklist");
    expect(names).not.toContain("Placeholder Pete");
    expect(names).not.toContain("Not Playable");
    expect(names).not.toContain("Wrong Sport");
    expect(dealt.every((card) => !isNonPlayerCard(card.player, card.description))).toBe(true);
    expect(dealt.every((card) => (card.imageUrl || "").includes("placeholder") === false)).toBe(true);

    const ordered = orderDaily5RotationSets(live);
    const thinPos = ordered.findIndex((set) => set.id === thinId);
    expect(thinPos).toBeGreaterThanOrEqual(0);
    const count = ordered.length;
    const origin = daysSinceDaily5Epoch("2099-02-01");
    const delta = (thinPos - (origin % count) + count) % count;
    const day = addPackptsDays("2099-02-01", delta);
    expect(daily5RotationCandidates(live, day)[0]?.id).toBe(thinId);
    const picked = pickDaily5RotationSet(live, day);
    expect(picked?.id).not.toBe(thinId);
    expect(picked?.cardCount).toBeGreaterThanOrEqual(PUBLIC_SET_MIN_ELIGIBLE_CARDS);

    const challenge = await daily5Service.createChallengeForDate(day);
    track(challenge);
    expect(challenge?.setId).toBe(picked?.id);
    expect(challenge?.setId).not.toBe(thinId);
    expect(challenge?.date).toBe(day);
  });

  it("uses the CT day key at 11:30 PM and 12:30 AM, including the DST change", async () => {
    const late = new Date("2026-11-02T05:30:00.000Z");
    const early = new Date("2026-11-02T06:30:00.000Z");
    const lateChallenge = await daily5Service.getOrCreateTodayChallenge(late);
    const earlyChallenge = await daily5Service.getOrCreateTodayChallenge(early);
    track(lateChallenge);
    track(earlyChallenge);
    expect(lateChallenge?.date).toBe("2026-11-01");
    expect(earlyChallenge?.date).toBe("2026-11-02");
    expect(getPackptsDayKey(late)).toBe(lateChallenge?.date);
    expect(getPackptsDayKey(early)).toBe(earlyChallenge?.date);

    const summerLate = await daily5Service.getOrCreateTodayChallenge(new Date("2026-07-16T04:30:00.000Z"));
    const summerEarly = await daily5Service.getOrCreateTodayChallenge(new Date("2026-07-16T05:30:00.000Z"));
    track(summerLate);
    track(summerEarly);
    expect(summerLate?.date).toBe("2026-07-15");
    expect(summerEarly?.date).toBe("2026-07-16");
  });

  it("is deterministic for a date and does not change a stored deal", async () => {
    const date = "2099-04-04";
    const first = await daily5Service.createChallengeForDate(date);
    track(first);
    expect(first?.setId).toBeTruthy();
    const firstCards = await db
      .select()
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, first!.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(firstCards).toHaveLength(5);
    expect(new Set(firstCards.map((row) => row.cardId)).size).toBe(5);

    const again = await daily5Service.createChallengeForDate(date);
    expect(again?.id).toBe(first?.id);
    expect(again?.setId).toBe(first?.setId);
    const againCards = await db
      .select()
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, first!.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(againCards.map((row) => row.id)).toEqual(firstCards.map((row) => row.id));
    expect(againCards.map((row) => row.cardId)).toEqual(firstCards.map((row) => row.cardId));

    await db.delete(dailyChallengeCards).where(eq(dailyChallengeCards.dailyChallengeId, first!.id));
    await db.delete(dailyChallenges).where(eq(dailyChallenges.id, first!.id));
    const rebuilt = await daily5Service.createChallengeForDate(date);
    track(rebuilt);
    const rebuiltCards = await db
      .select()
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, rebuilt!.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(rebuilt?.setId).toBe(first?.setId);
    expect(rebuiltCards.map((row) => row.cardId)).toEqual(firstCards.map((row) => row.cardId));
    expect(rebuiltCards.map((row) => row.position)).toEqual([1, 2, 3, 4, 5]);

    const storedDate = "2099-03-03";
    const storedCards = await db.select({ id: playableCards.id, player: playableCards.player })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, storedSetId))
      .limit(5);
    const [stored] = await db.insert(dailyChallenges).values({
      date: storedDate,
      mode: "DAILY5",
      setId: storedSetId,
      seed: "stored-seed-not-regenerated",
      startsAt: packptsMidnightUtc(storedDate),
      endsAt: packptsMidnightUtc(addPackptsDays(storedDate, 1)),
      status: "SCHEDULED",
    }).returning();
    track(stored);
    const inserted = await db.insert(dailyChallengeCards).values(
      storedCards.map((card, index) => ({
        dailyChallengeId: stored.id,
        position: index + 1,
        cardId: card.id,
        correctAnswer: card.player || "Unknown",
        choices: [card.player || "Unknown", "Other One", "Other Two", "Other Three"],
        pointValue: 100,
      })),
    ).returning();

    const extraId = randomUUID();
    setIds.push(extraId);
    await db.insert(gameSets).values({
      id: extraId,
      sport: "baseball",
      brand: "Topps",
      year: 1890,
      setName: `D5 Late Add ${stamp}`,
      isUserCreated: false,
      isActive: true,
      titleVerified: true,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(playableCards).values(PLAYERS.map((player) => goodCard(extraId, player)));

    const kept = await daily5Service.createChallengeForDate(storedDate);
    expect(kept?.id).toBe(stored.id);
    expect(kept?.setId).toBe(storedSetId);
    expect(kept?.seed).toBe("stored-seed-not-regenerated");
    const keptCards = await db
      .select()
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, stored.id))
      .orderBy(asc(dailyChallengeCards.position));
    expect(keptCards.map((row) => row.id)).toEqual(inserted.map((row) => row.id));
    expect(keptCards.map((row) => row.cardId)).toEqual(inserted.map((row) => row.cardId));
  });

  it("exposes the set name on status and keeps Beat-me on that CT day's score", async () => {
    const at = new Date("2099-06-15T18:00:00.000Z");
    const status = await daily5Service.getStatus(undefined, at);
    track(status.challenge);
    const body = toPublicDaily5Status(status);
    expect(getPackptsDayKey(at)).toBe("2099-06-15");
    expect(body.challenge?.date).toBe("2099-06-15");
    expect(body.setName).toBeTruthy();
    expect(body.challenge?.setName).toBe(body.setName);
    expect(body.setName).not.toMatch(/\d+\s+cards/);
    expect(body.challenge).not.toHaveProperty("seed");
    expect(JSON.stringify(body)).not.toContain("cardId");
    for (const name of PLAYERS) {
      expect(JSON.stringify(body)).not.toContain(name);
    }
    const dealt = await db
      .select({ cardId: dailyChallengeCards.cardId })
      .from(dailyChallengeCards)
      .where(eq(dailyChallengeCards.dailyChallengeId, status.challenge!.id));
    for (const row of dealt) {
      expect(JSON.stringify(body)).not.toContain(row.cardId);
    }

    const today = getPackptsDayKey();
    const [existingToday] = await db.select({ id: dailyChallenges.id }).from(dailyChallenges).where(eq(dailyChallenges.date, today)).limit(1);
    createdToday = !existingToday;
    const todayChallenge = await daily5Service.getOrCreateTodayChallenge();
    if (createdToday) track(todayChallenge);
    expect(todayChallenge?.date).toBe(today);
    beatChallengeId = todayChallenge!.id;

    beatUserId = `d5rot-${randomUUID()}`;
    await db.insert(users).values({
      id: beatUserId,
      username: `d5rot_${stamp}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
    await db.insert(dailyChallengeEntries).values({
      dailyChallengeId: todayChallenge!.id,
      userId: beatUserId,
      score: 200,
      correctCount: 2,
      completedAt: new Date(),
      answers: [],
    });

    const beat = await createBeatMeFromSession(beatUserId);
    expect(beat.puzzleDay).toBe(today);
    expect(beat.correctCount).toBe(2);
    expect(beat.puzzleDay).toBe(todayChallenge?.date);

    const dailyCard = buildScoreCardSvg({
      username: "collector",
      score: 200,
      correctCount: beat.correctCount,
      totalQuestions: 5,
      mode: "daily5",
      date: beat.puzzleDay,
    });
    const matchCard = buildScoreCardSvg({
      username: "collector",
      score: 200,
      correctCount: beat.correctCount,
      totalQuestions: 5,
      mode: "1v1",
      date: beat.puzzleDay,
    });
    expect(dailyCard).toContain("DAILY 5");
    expect(dailyCard).toContain("2/5");
    expect(dailyCard).toContain("200 pts");
    expect(matchCard).toContain("1V1 MATCH");
    expect(matchCard).toContain("2/5");
    expect(matchCard).not.toContain("DAILY 5");
  });

  it("returns null for a set whose title is not verified", async () => {
    const hiddenId = randomUUID();
    setIds.push(hiddenId);
    await db.insert(gameSets).values({
      id: hiddenId,
      sport: "baseball",
      brand: "Topps",
      year: 1897,
      setName: `D5 Unverified ${stamp}`,
      isUserCreated: false,
      isActive: true,
      titleVerified: false,
    });
    expect(await verifiedGameSetTitle(hiddenId)).toBeNull();
    expect(await verifiedGameSetTitle(alphaId)).toBe(`D5 Alpha ${stamp}`);
  });
});
