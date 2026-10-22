import { describe, expect, it } from "vitest";
import { signupSavedLine } from "@shared/signupSaved";

describe("signup saved line", () => {
  it("names the points, the streak, and midnight CT", () => {
    expect(signupSavedLine(250, 1)).toBe("Points saved: 250. Streak 1. New five at midnight CT.");
    expect(signupSavedLine(-4, Number.NaN)).toBe("Points saved: 0. Streak 0. New five at midnight CT.");
    expect(signupSavedLine(250, 1)).not.toMatch(/[—–]/);
  });
});
