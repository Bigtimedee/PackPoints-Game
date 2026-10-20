import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ONBOARDING, tourEarnStep } from "../pointsCopy";

const card = readFileSync(new URL("../../components/onboarding-points-card.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../../pages/home.tsx", import.meta.url), "utf8");

describe("first-run points card", () => {
  it("uses the deck copy and key, and stays out of play", () => {
    expect(ONBOARDING.title).toBe("Name the player. Earn points.");
    expect(card).toContain('"pp_onboard_points_v1"');
    expect(card).toContain("const visible = show && !playActive;");
    // Inline, never a fixed sheet over the home card's answer buttons (390px bug).
    expect(card).not.toMatch(/className="[^"]*\bfixed\b/);
    expect(card).not.toContain("bottom-[calc(4rem");
    expect(card).toContain("setOnboardingCardOpen(visible)");
    expect(card).toContain('data-testid="card-onboarding-points"');
    expect(card).toContain('data-testid="button-onboarding-skip"');
    expect(home).not.toContain("<OnboardingPointsCard />");
    expect(home).not.toContain("Earn points.");
  });
  it("tour step 2 switches on rebateLive", () => {
    expect(tourEarnStep(false)).toBe(tourEarnStep(true));
    expect(tourEarnStep(true)).toContain("cash back");
    for (const s of [tourEarnStep(true), tourEarnStep(false)]) expect(s).not.toMatch(/[\u2013\u2014]/);
  });
});
