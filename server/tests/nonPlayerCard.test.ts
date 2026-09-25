import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { isNonPlayerCard, omitNonPlayerNames } from "@shared/nonPlayerCard";

const DEAL_FILES = [
  "server/storage.ts",
  "server/services/daily5Service.ts",
  "server/services/matchService.ts",
  "server/services/matches/replaceQuestion.ts",
];

describe("isNonPlayerCard", () => {
  it("excludes checklist labels in any case", () => {
    for (const label of [
      "Checklist",
      "checklist",
      "CHECKLIST",
      "Checklist 1-132",
      "CL",
      "cl",
      "C.L.",
      "Team Checklist",
      "Checklist Card",
    ]) {
      expect(isNonPlayerCard(label), label).toBe(true);
      expect(isNonPlayerCard("Willie Wilson", label), label).toBe(true);
    }
  });

  it("excludes team cards, league leaders, and record breakers that are not one player", () => {
    expect(isNonPlayerCard("Team")).toBe(true);
    expect(isNonPlayerCard("Team Card")).toBe(true);
    expect(isNonPlayerCard("Yankees Team Card")).toBe(true);
    expect(isNonPlayerCard("League Leaders")).toBe(true);
    expect(isNonPlayerCard("AL Home Run Leaders")).toBe(true);
    expect(isNonPlayerCard("Record Breaker")).toBe(true);
    expect(isNonPlayerCard("Record Breakers")).toBe(true);
    expect(isNonPlayerCard("Nolan Ryan / Roger Clemens")).toBe(true);
    expect(isNonPlayerCard("Wade Boggs & Don Mattingly")).toBe(true);
    expect(isNonPlayerCard("Boggs, Mattingly, and Puckett")).toBe(true);
  });

  it("keeps a single player, including a Record Breaker card whose name is that player", () => {
    expect(isNonPlayerCard("Willie Wilson")).toBe(false);
    expect(isNonPlayerCard("Nolan Ryan", "Record Breaker")).toBe(false);
    expect(isNonPlayerCard("Cal Ripken Jr.")).toBe(false);
    expect(isNonPlayerCard("Cliff Lee")).toBe(false);
    expect(isNonPlayerCard("Ken Griffey Jr.")).toBe(false);
    expect(isNonPlayerCard("Ichiro")).toBe(false);
  });

  it("drops those names from a distractor pool", () => {
    expect(omitNonPlayerNames([
      "Willie Wilson",
      "Checklist",
      "Checklist 1-132",
      "League Leaders",
      "Nolan Ryan",
      "Team Card",
    ])).toEqual(["Willie Wilson", "Nolan Ryan"]);
  });

  it("is used by solo, Daily 5, 1v1, and replace-card", () => {
    for (const file of DEAL_FILES) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(src, file).toContain("isNonPlayerCard");
    }
  });
});
