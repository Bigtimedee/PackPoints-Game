import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { pointsChipHidden } from "../pointsChipVisibility";

describe("points chip during play", () => {
  it("hides on active play, shows elsewhere", () => {
    expect(pointsChipHidden("/daily", true)).toBe(true);
    expect(pointsChipHidden("/game/solo", false)).toBe(true);
    expect(pointsChipHidden("/match/abc", false)).toBe(true);
    expect(pointsChipHidden("/daily", false)).toBe(false);
    expect(pointsChipHidden("/", false)).toBe(false);
    expect(pointsChipHidden("/points", false)).toBe(false);
    expect(pointsChipHidden("/beat-mex", false)).toBe(false);
  });
  it("header gates the chip on it", () => {
    const src = readFileSync(new URL("../../components/header.tsx", import.meta.url), "utf8");
    expect(src).toContain("pointsChipHidden(location, playActive)");
    expect(src).toContain("{hideChip ? null : isRestricted ? (");
  });
});
