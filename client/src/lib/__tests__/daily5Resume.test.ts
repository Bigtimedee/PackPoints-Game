import { describe, expect, it } from "vitest";
import {
  answeredDaily5Positions,
  isDaily5PositionAnswered,
  nextUnansweredDaily5Position,
  resolveDaily5Resume,
} from "../daily5Resume";

describe("resolveDaily5Resume", () => {
  it("starts a fresh entry at position 1", () => {
    expect(resolveDaily5Resume(null)).toEqual({
      phase: "playing",
      currentPosition: 1,
      score: 0,
      correctCount: 0,
      answeredPositions: [],
    });
    expect(resolveDaily5Resume({ answers: [], score: 0, correctCount: 0 })).toMatchObject({
      phase: "playing",
      currentPosition: 1,
    });
  });

  it("resumes at the next unanswered position after card 1 (and optionally 2)", () => {
    const afterOne = resolveDaily5Resume({
      score: 100,
      correctCount: 1,
      completedAt: null,
      answers: [{ position: 1, selected: "Josh Hart", correct: true }],
    });
    expect(afterOne).toEqual({
      phase: "playing",
      currentPosition: 2,
      score: 100,
      correctCount: 1,
      answeredPositions: [1],
    });

    const afterTwo = resolveDaily5Resume({
      score: 200,
      correctCount: 2,
      completedAt: null,
      answers: [
        { position: 1, selected: "Josh Hart", correct: true },
        { position: 2, selected: "Shawn Kemp", correct: true },
      ],
    });
    expect(afterTwo.phase).toBe("playing");
    expect(afterTwo.currentPosition).toBe(3);
    expect(afterTwo.score).toBe(200);
    expect(afterTwo.answeredPositions).toEqual([1, 2]);
  });

  it("treats all five answered as complete even without completedAt", () => {
    const answers = [1, 2, 3, 4, 5].map((position) => ({
      position,
      selected: `p${position}`,
      correct: position <= 2,
    }));
    const resume = resolveDaily5Resume({
      score: 200,
      correctCount: 2,
      completedAt: null,
      answers,
    });
    expect(resume.phase).toBe("complete");
    expect(resume.currentPosition).toBe(5);
    expect(resume.answeredPositions).toEqual([1, 2, 3, 4, 5]);
  });

  it("treats a server-completed entry as Game Complete", () => {
    const resume = resolveDaily5Resume({
      score: 200,
      correctCount: 2,
      completedAt: "2026-09-08T16:00:00.000Z",
      answers: [
        { position: 1, selected: "Josh Hart", correct: true },
        { position: 2, selected: "A", correct: true },
        { position: 3, selected: "B", correct: false },
        { position: 4, selected: "C", correct: false },
        { position: 5, selected: "D", correct: false },
      ],
    });
    expect(resume.phase).toBe("complete");
    expect(resume.score).toBe(200);
    expect(resume.correctCount).toBe(2);
  });

  it("skips holes and lands on the first unanswered 1-indexed position", () => {
    const resume = resolveDaily5Resume({
      score: 100,
      correctCount: 1,
      answers: [{ position: 2, selected: "Kemp", correct: true }],
    });
    expect(resume.currentPosition).toBe(1);
    expect(resume.phase).toBe("playing");
  });
});

describe("answeredDaily5Positions / nextUnansweredDaily5Position", () => {
  it("ignores out-of-range and non-integer positions", () => {
    expect(
      answeredDaily5Positions([
        { position: 0 },
        { position: 6 },
        { position: 1.5 },
        { position: 1 },
        { position: 1 },
      ]),
    ).toEqual([1]);
  });

  it("returns null when every card is answered", () => {
    expect(nextUnansweredDaily5Position([1, 2, 3, 4, 5])).toBeNull();
    expect(nextUnansweredDaily5Position([1, 2])).toBe(3);
  });

  it("does not treat an already-answered position as playable", () => {
    expect(isDaily5PositionAnswered([1, 2], 1)).toBe(true);
    expect(isDaily5PositionAnswered([1, 2], 3)).toBe(false);
  });
});
