import { describe, expect, it } from "vitest";
import {
  findQuestionIndexByCardId,
  replacementSetLookup,
} from "../lib/cardReplacement";

describe("solo replace-card index + set lookup", () => {
  const questions = [
    { card: { id: "card-0", playableCardId: "pc-0", gameSetId: "set-a", setName: "1994 Topps" } },
    { card: { id: "card-1", playableCardId: "pc-1", gameSetId: "set-a", setName: "1994 Topps" } },
    { card: { id: "card-2", playableCardId: "pc-2", gameSetId: "set-b", setName: "" } },
  ];

  it("stamps the failed card's index, not a raced current index", () => {
    expect(findQuestionIndexByCardId(questions, "pc-1", 2)).toBe(1);
    expect(findQuestionIndexByCardId(questions, "card-0", 2)).toBe(0);
    expect(findQuestionIndexByCardId(questions, "missing", 2)).toBe(2);
  });

  it("prefers gameSetId over a fragile setName string", () => {
    expect(replacementSetLookup(questions[2].card)).toEqual({
      gameSetId: "set-b",
      setName: null,
    });
    expect(replacementSetLookup(questions[0].card).gameSetId).toBe("set-a");
  });
});
