import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  HOME_PLAY_VANITY_FLAG,
  HOME_PLAY_VANITY_MIN_GAMES,
  shouldShowHomePlayVanity,
} from "@shared/homePlayVanity";

const homeSrc = readFileSync(new URL("../../pages/home.tsx", import.meta.url), "utf8");
const registerSrc = readFileSync(new URL("../../../../server/routes.ts", import.meta.url), "utf8");
const vanitySrc = readFileSync(new URL("../../../../shared/homePlayVanity.ts", import.meta.url), "utf8");

describe("HOME_PLAY_VANITY gate", () => {
  it("is named 500 games plus staff flag home.show_play_vanity", () => {
    expect(HOME_PLAY_VANITY_MIN_GAMES).toBe(500);
    expect(HOME_PLAY_VANITY_FLAG).toBe("home.show_play_vanity");
    expect(vanitySrc).toContain("HOME_PLAY_VANITY_MIN_GAMES = 500");
  });

  it("omits below the gate and shows at 500 or with staff override", () => {
    expect(shouldShowHomePlayVanity({})).toBe(false);
    expect(shouldShowHomePlayVanity({ totalGames: 0 })).toBe(false);
    expect(shouldShowHomePlayVanity({ totalGames: 2 })).toBe(false);
    expect(shouldShowHomePlayVanity({ totalGames: 499 })).toBe(false);
    expect(shouldShowHomePlayVanity({ totalGames: 500 })).toBe(true);
    expect(shouldShowHomePlayVanity({ totalGames: 12_000 })).toBe(true);
    expect(shouldShowHomePlayVanity({ totalGames: 2, staffOverride: true })).toBe(true);
    expect(shouldShowHomePlayVanity({ totalGames: undefined, staffOverride: true })).toBe(true);
    expect(shouldShowHomePlayVanity({ staffOverride: false })).toBe(false);
  });
});

/** Home-surface signup-bonus ads. Register still credits 250; home must not say so. */
const HOME_VANITY_250_BANNED = [
  "New players get 250 free PackPTS on signup",
  "Claim 250 Free PackPTS",
  "Start with 250 Free PackPTS",
  "we'll credit 250",
  "250 free PackPTS",
  "250 PackPTS",
  "free PackPTS",
  "no purchase needed",
  "button-claim-bonus",
  "button-signup-bonus",
  "signup bonus",
  "welcome bonus",
  "Claim Bonus",
  "No credit card required",
  "Free forever",
];

describe("home quarantine surfaces", () => {
  it("omits vanity rows while loading and never uses an em-dash placeholder", () => {
    expect(homeSrc).toContain("shouldShowHomePlayVanity");
    expect(homeSrc).toContain("quickStats.length > 0");
    expect(homeSrc).not.toMatch(/value:\s*homeStats \? homeStats\.totalGames\.toLocaleString\(\) : ["']—["']/);
    expect(homeSrc).not.toMatch(/Total Games Played[\s\S]{0,80}["']—["']/);
    expect(homeSrc).not.toMatch(/Coming soon["'][\s\S]{0,80}Cards Guessed/);
  });

  it("hides Founders FOMO / spots-remaining theater on home", () => {
    expect(homeSrc).not.toMatch(/FoundersCounter/);
    expect(homeSrc).not.toMatch(/Limited Founder spots/);
    expect(homeSrc).not.toMatch(/\/api\/access\/cap/);
    expect(homeSrc).not.toMatch(/Claim Your Spot/);
  });

  it("keeps the register welcome credit and does not advertise it on home", () => {
    expect(registerSrc).toMatch(/walletService\.earn\(\s*user\.id,\s*250,/);
    expect(registerSrc).toMatch(/welcome_bonus:\$\{user\.id\}/);
    expect(registerSrc).toMatch(/source:\s*["']signup_bonus["']/);
    const lower = homeSrc.toLowerCase();
    for (const phrase of HOME_VANITY_250_BANNED) {
      expect(lower.includes(phrase.toLowerCase()), phrase).toBe(false);
    }
    expect(homeSrc).not.toMatch(/\b250\b/);
    expect(homeSrc).toContain("Create a Free Account");
    expect(homeSrc).toContain("Create free account");
    expect(homeSrc).toContain("Play a round first");
    expect(homeSrc).toContain('data-testid="button-create-free-account"');
    expect(homeSrc).toContain('data-testid="button-home-create-account"');
    expect(homeSrc).not.toMatch(/PackPoints/);
    const vanityBlock = homeSrc.slice(
      homeSrc.indexOf("quickStats.length > 0"),
      homeSrc.indexOf("Choose Your Game Mode"),
    );
    expect(vanityBlock).not.toMatch(/250/);
  });

  it("does not reopen product locks on home", () => {
    expect(homeSrc).not.toMatch(/Maker Rate/i);
    expect(homeSrc).not.toMatch(/FireMarket|Norma/);
    expect(homeSrc).not.toMatch(/href=["']\/make["']/);
  });
});
