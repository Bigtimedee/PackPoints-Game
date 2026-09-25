import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { replaySoloAnswer, soloAnswerAlreadyRecorded } from "../services/soloAnswerReplay";

const routesSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");

describe("solo answer replay", () => {
  it("returns the stored result and does not change the session score", () => {
    const session = {
      score: 40,
      correctAnswers: 1,
      questions: [{
        answered: true,
        userAnswer: "Ken Phelps",
        correctAnswer: "Ken Phelps",
        pointValue: 175,
        pointsEarned: 40,
        card: { id: "card-1" },
      }],
    };
    expect(soloAnswerAlreadyRecorded(session.questions[0])).toBe(true);
    const replay = replaySoloAnswer(session.questions[0]);
    expect(replay).toEqual({
      correct: true,
      correctAnswer: "Ken Phelps",
      pointsEarned: 40,
      cardId: "card-1",
    });
    expect(session.score).toBe(40);
    expect(session.correctAnswers).toBe(1);
  });

  it("does not treat a fresh question as a replay", () => {
    expect(soloAnswerAlreadyRecorded({ correctAnswer: "Ken Phelps", pointValue: 175 })).toBe(false);
    const wrong = replaySoloAnswer({
      answered: true,
      userAnswer: "Someone Else",
      correctAnswer: "Ken Phelps",
      pointsEarned: 0,
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.pointsEarned).toBe(0);
  });

  it("checks the stored answer before awarding points", () => {
    const handler = routesSrc.slice(
      routesSrc.indexOf('app.post("/api/game/answer"'),
      routesSrc.indexOf('app.post("/api/game/next"'),
    );
    const replay = handler.indexOf("soloAnswerAlreadyRecorded");
    const award = handler.indexOf("awardDailyBaseForCorrectCard");
    expect(replay).toBeGreaterThan(-1);
    expect(award).toBeGreaterThan(replay);
    expect(handler).toContain("pointsEarned = pointsEarned");
    expect(handler).toContain("idempotent: true");
  });
});