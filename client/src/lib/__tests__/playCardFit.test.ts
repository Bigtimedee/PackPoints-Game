/**
 * Design QA 2026-10-03: at 375x667 and 390x664 the 4th answer and Submit
 * started below the screen during play. The card slot now fits the viewport
 * height (index.css .play-card-fit). Layout is measured by Playwright at
 * 375x667, 390x664, 390x844 and 430x932; these lock the numbers and paths.
 */
import { readFileSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAILY5_PLAY_CARD_FIT_CLASS,
  MATCH_PLAY_CARD_FIT_CLASS,
  PLAY_CARD_RESERVE_PX,
  SOLO_PLAY_CARD_FIT_CLASS,
  playCardSlotHeight,
} from "../playCardFit";
import { acquirePlayChrome, playChromeActive } from "../playChrome";
import { setsMainClassName } from "../setsPolish";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("play card fit", () => {
  it("keeps the card at least 300px tall at 375x667 and 390x664", () => {
    expect(playCardSlotHeight(667, 280, PLAY_CARD_RESERVE_PX.solo)).toBeGreaterThanOrEqual(300);
    expect(playCardSlotHeight(664, 280, PLAY_CARD_RESERVE_PX.solo)).toBeGreaterThanOrEqual(300);
    expect(playCardSlotHeight(667, 320, PLAY_CARD_RESERVE_PX.daily5)).toBeGreaterThanOrEqual(300);
    expect(playCardSlotHeight(664, 320, PLAY_CARD_RESERVE_PX.daily5)).toBeGreaterThanOrEqual(300);
    expect(playCardSlotHeight(667, 320, PLAY_CARD_RESERVE_PX.match)).toBeGreaterThanOrEqual(300);
  });

  it("keeps the old size on tall phones", () => {
    expect(playCardSlotHeight(844, 280, PLAY_CARD_RESERVE_PX.solo)).toBe(392);
    expect(playCardSlotHeight(932, 280, PLAY_CARD_RESERVE_PX.solo)).toBe(392);
  });

  it("uses the same reserve in the CSS variables", () => {
    expect(SOLO_PLAY_CARD_FIT_CLASS).toContain(`[--pc-reserve:${PLAY_CARD_RESERVE_PX.solo}px]`);
    expect(DAILY5_PLAY_CARD_FIT_CLASS).toContain(`[--pc-reserve:${PLAY_CARD_RESERVE_PX.daily5}px]`);
    expect(MATCH_PLAY_CARD_FIT_CLASS).toContain(`[--pc-reserve:${PLAY_CARD_RESERVE_PX.match}px]`);
  });

  it("fits every play screen and keeps the image uncropped", () => {
    expect(read("../../pages/game.tsx")).toContain("fitToViewport");
    expect(read("../../pages/daily5.tsx")).toContain("fitToViewport");
    expect(read("../../pages/match.tsx")).toContain("fitToViewport");
    const card = read("../../components/GameCard.tsx");
    expect(card.match(/absolute inset-0 h-full w-full object-contain pointer-events-none/g)?.length).toBe(2);
    const css = read("../../index.css");
    expect(css).toContain(".play-card-fit {");
    expect(css).toContain("100dvh - var(--pc-reserve");
  });
});

describe("Daily 5 play chrome", () => {
  let release: (() => void) | null = null;
  afterEach(() => {
    release?.();
    release = null;
  });

  it("hides the bottom nav and its pad while Daily 5 is in play", () => {
    expect(playChromeActive()).toBe(false);
    release = acquirePlayChrome();
    expect(playChromeActive()).toBe(true);
    release();
    release = null;
    expect(playChromeActive()).toBe(false);
    expect(setsMainClassName("/daily", true)).toBe("flex-1 overflow-y-auto");
    expect(setsMainClassName("/daily")).toContain("pb-[calc(5rem+env(safe-area-inset-bottom))]");
    expect(read("../../pages/daily5.tsx")).toContain('usePlayChrome(gameState === "playing")');
  });

  it("draws the bottom nav solid so nothing shows through it", () => {
    const nav = read("../../components/mobile-nav.tsx");
    expect(nav).toContain("border-t bg-background");
    expect(nav).not.toContain("bg-background/60");
    expect(nav).not.toContain("backdrop-blur");
  });
});
