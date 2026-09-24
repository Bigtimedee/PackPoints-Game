/**
 * Why solo does not show "Worth N pts".
 *
 * Playable-set deals store question.pointValue from computeReward without year
 * or rarity. A missing fame row is 0.5, and the default policy turns that into
 * exactly 175. Authenticated credit is awardDailyBaseForCorrectCard (set bonus
 * and the daily cap), not that stored number. The badge implied a per-card
 * price. It is removed. The post-ACK animation still shows server pointsEarned.
 */
import { readFileSync } from "fs";
import { vi, describe, it, expect } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import {
  computeBasePts,
  computeFinalPts,
  getRarityMultiplier,
  getVintageMultiplier,
} from "../services/rewardEngine";
import type { RewardPolicy } from "@shared/schema";

const DEFAULT_POLICY: RewardPolicy = {
  id: "default",
  effectiveFrom: new Date(),
  enabled: true,
  minPts: 100,
  maxPts: 200,
  gamma: 2.0,
  maxAwardCap: 250,
  vintageMultipliers: { pre1980: 1.15, "1980_1999": 1.05, "2000_2019": 1.0, "2020_plus": 0.9 },
  rarityMultipliers: { base: 1.0, insert: 1.1, parallel: 1.2, sp: 1.3 },
  dailyPointsCap: 5000,
  perMatchPointsCap: 1000,
  createdAt: new Date(),
};

const storageSrc = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");
const routesSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
const gameSrc = readFileSync(new URL("../../client/src/pages/game.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../client/src/pages/match.tsx", import.meta.url), "utf8");
const daily5ServiceSrc = readFileSync(new URL("../services/daily5Service.ts", import.meta.url), "utf8");
const matchServiceSrc = readFileSync(new URL("../services/matchService.ts", import.meta.url), "utf8");

describe("solo point label vs credited award", () => {
  it("default fame with no year and no rarity is exactly 175", () => {
    const fame = 0.5;
    const base = computeBasePts(fame, DEFAULT_POLICY);
    expect(base).toBe(175);
    expect(getVintageMultiplier(undefined, DEFAULT_POLICY)).toBe(1);
    expect(getVintageMultiplier(0, DEFAULT_POLICY)).toBe(1);
    expect(getRarityMultiplier(undefined, DEFAULT_POLICY)).toBe(1);
    expect(computeFinalPts(base, 1, 1, DEFAULT_POLICY)).toBe(175);
  });

  it("playable-set questions omit year and rarity, so the stored value cannot vary by card", () => {
    const fn = storageSrc.slice(
      storageSrc.indexOf("private async generateQuestionFromPlayableCard"),
      storageSrc.indexOf("private generateQuestion("),
    );
    const rewardCall = fn.slice(fn.indexOf("computeReward({"), fn.indexOf("});") + 3);
    expect(rewardCall).toContain('sport: "baseball"');
    expect(rewardCall).not.toContain("year");
    expect(rewardCall).not.toContain("rarityType");
    expect(fn).toContain("year: 0");
    expect(fn).toContain("pointValue = reward.finalPts");
  });

  it("authenticated credit is deltaPts; only a signed-out session uses question.pointValue", () => {
    const answer = routesSrc.slice(
      routesSrc.indexOf('app.post("/api/game/answer"'),
      routesSrc.indexOf('app.post("/api/game/next"'),
    );
    expect(answer).toContain("awardDailyBaseForCorrectCard");
    expect(answer).toContain("pointsEarned = dailyBaseResult.deltaPts");
    expect(answer).toContain("year: card?.year || undefined");
    expect(answer).toContain("pointsEarned = freshCurrentQuestion.pointValue");
  });

  it("the client does not render a per-card worth badge", () => {
    expect(gameSrc).not.toContain("badge-point-value");
    expect(gameSrc).not.toContain("Worth ");
    expect(gameSrc).not.toContain("currentQuestion.pointValue");
    expect(matchSrc).not.toContain("{currentQuestion.pointValue} pts");
  });

  it("Daily 5 credits a flat 100 and 1v1 stamps popularity 50", () => {
    expect(daily5ServiceSrc).toContain("pointValue: 100");
    const adapter = matchServiceSrc.slice(
      matchServiceSrc.indexOf("function playableCardToBaseballCard"),
      matchServiceSrc.indexOf("class MatchService"),
    );
    expect(adapter).toContain("popularity: 50");
    expect(adapter).toContain("year: 0");
    const points = matchServiceSrc.slice(
      matchServiceSrc.indexOf("const pointsEarned = isCorrect"),
      matchServiceSrc.indexOf("const pointsEarned = isCorrect") + 80,
    );
    expect(points).toContain("currentQuestion.pointValue");
  });
});
