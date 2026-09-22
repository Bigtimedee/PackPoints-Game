/**
 * First-visit home onboarding must stay quiet.
 * Welcome credit still posts on POST /api/auth/register. This modal does not advertise it.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const onboardingSrc = readFileSync(new URL("../../components/OnboardingModal.tsx", import.meta.url), "utf8");

/** Signup-bonus FOMO that used to close the first-visit tour. */
const ONBOARDING_BANNED = [
  "Get 250 Bonus Points Free",
  "Get 250 Bonus",
  "250 Bonus Points",
  "250 free PackPTS",
  "250 free PackPTS on signup",
  "250 PackPTS",
  "Bonus Points Free",
  "Claim Bonus",
  "credited instantly",
  "No purchase, no catch",
  "bonus PackPTS",
  "free PackPTS",
  "on signup",
  "signup bonus",
  "welcome bonus",
];

describe("first-visit onboarding copy", () => {
  it("welcomes with a quiet account step", () => {
    expect(onboardingSrc).toContain("Welcome to PackPTS!");
    expect(onboardingSrc).toContain("Create a Free Account");
    expect(onboardingSrc).toContain("Create free account");
    expect(onboardingSrc).toContain("Play First");
    expect(onboardingSrc).toContain('href="/auth"');
  });

  it("does not advertise a signup bonus", () => {
    const lower = onboardingSrc.toLowerCase();
    for (const phrase of ONBOARDING_BANNED) {
      expect(lower.includes(phrase.toLowerCase())).toBe(false);
    }
    expect(onboardingSrc).not.toMatch(/\b250\b/);
    expect(onboardingSrc).not.toMatch(/isBonusStep/);
    expect(onboardingSrc).not.toMatch(/Claim Bonus/);
  });
});
