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

  it("keeps the 250 PackPTS signup promo only because register still credits 250", () => {
    expect(registerSrc).toMatch(/walletService\.earn\(\s*user\.id,\s*250,/);
    expect(registerSrc).toMatch(/welcome_bonus:\$\{user\.id\}/);
    expect(registerSrc).toMatch(/source:\s*["']signup_bonus["']/);
    expect(homeSrc).toMatch(/250 free PackPTS/);
    expect(homeSrc).toMatch(/Start with 250 Free PackPTS/);
    expect(homeSrc).toMatch(/data-testid=["']button-signup-bonus["']/);
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
