import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  SETS_POLISH,
  containsForbiddenPublicSetsCopy,
  formatAuthoredDate,
  formatDetailMetaLine,
  formatSetMetaLine,
  honestCardCountLabel,
  isStockFanUrl,
  playQuestionCount,
  publicSetDisplayUrl,
  resolveSetCover,
  shouldShowPlayTodayCue,
  shouldShowShortShelf,
} from "../setsPolish";

describe("resolveSetCover", () => {
  it("prefers runtime Surface A over the set’s card stack", () => {
    const cover = resolveSetCover("/generated/share/2026-09-08/qa.png", [
      "https://packpts.com/api/card-photos/a",
    ]);
    expect(cover).toEqual({ kind: "surfaceA", src: "/generated/share/2026-09-08/qa.png" });
  });

  it("never treats stock fan as a cover once we can stack real cards", () => {
    const cover = resolveSetCover("/assets/maker-set-1080.png", [
      "https://packpts.com/api/card-photos/a",
      "https://packpts.com/api/card-photos/b",
    ]);
    expect(cover.kind).toBe("stack");
    if (cover.kind === "stack") {
      expect(cover.urls).toHaveLength(2);
    }
  });

  it("falls back to an empty stack when there is no usable cover", () => {
    expect(resolveSetCover(undefined, [])).toEqual({ kind: "stack", urls: [] });
    expect(resolveSetCover("javascript:alert(1)", ["not-a-url"]).kind).toBe("stack");
  });
});

describe("set meta", () => {
  it("formats honest maker + card count + optional date + AUTHORED", () => {
    expect(
      formatSetMetaLine({
        makerUsername: "Bigtimedee",
        cardCount: 5,
        createdAt: "2026-09-08T12:00:00.000Z",
      }),
    ).toBe("by Bigtimedee · 5 cards · SEP 8 · AUTHORED");
  });

  it("does not invent a maker name beyond the Maker fallback", () => {
    expect(formatSetMetaLine({ cardCount: 1 })).toBe("by Maker · 1 card · AUTHORED");
  });

  it("keeps co-creator provenance on detail without play counts", () => {
    expect(
      formatDetailMetaLine({
        makerUsername: "Bigtimedee",
        coCreatorUsername: "Pat",
        createdAt: "2026-09-08T17:38:58.989Z",
      }),
    ).toBe("by Bigtimedee & Pat · SEP 8 · AUTHORED");
  });

  it("shows the same CT day for browse naive timestamp and detail ISO", () => {
    const browse = "2026-09-08 17:38:58.989524";
    const detail = "2026-09-08T17:38:58.989Z";
    expect(formatAuthoredDate(browse)).toBe("SEP 8");
    expect(formatAuthoredDate(detail)).toBe("SEP 8");
    expect(formatSetMetaLine({ makerUsername: "Bigtimedee", cardCount: 5, createdAt: browse })).toBe(
      formatSetMetaLine({ makerUsername: "Bigtimedee", cardCount: 5, createdAt: detail }),
    );
    expect(
      formatDetailMetaLine({ makerUsername: "Bigtimedee", createdAt: browse }),
    ).toBe(formatDetailMetaLine({ makerUsername: "Bigtimedee", createdAt: detail }));
  });

  it("uses America/Chicago, not UTC, across the CT/UTC date line", () => {
    // 2026-09-09 03:00 UTC = 2026-09-08 22:00 CDT
    expect(formatAuthoredDate("2026-09-09T03:00:00.000Z")).toBe("SEP 8");
    expect(formatAuthoredDate("2026-09-09 03:00:00")).toBe("SEP 8");
  });

  it("labels 0 cards honestly", () => {
    expect(honestCardCountLabel(0)).toBe("0 cards");
    expect(honestCardCountLabel("5")).toBe("5 cards");
  });

  it("returns null for unparseable dates instead of inventing one", () => {
    expect(formatAuthoredDate("not-a-date")).toBeNull();
    expect(formatAuthoredDate(null)).toBeNull();
  });
});

describe("gates and play", () => {
  it("shows the short-shelf banner only for a real, sub-gate list", () => {
    expect(shouldShowShortShelf(0)).toBe(false);
    expect(shouldShowShortShelf(2)).toBe(true);
    expect(shouldShowShortShelf(9)).toBe(true);
    expect(shouldShowShortShelf(10)).toBe(false);
    expect(SETS_POLISH.volumeGate).toBe(10);
  });

  it("shows Play today’s stack unless this set was already played today", () => {
    expect(shouldShowPlayTodayCue(false)).toBe(true);
    expect(shouldShowPlayTodayCue(undefined)).toBe(true);
    expect(shouldShowPlayTodayCue(true)).toBe(false);
  });

  it("starts play with the set’s real stack size inside 5–20", () => {
    expect(playQuestionCount(5)).toBe(5);
    expect(playQuestionCount(12)).toBe(12);
    expect(playQuestionCount(20)).toBe(20);
    expect(playQuestionCount(21)).toBe(20);
    expect(playQuestionCount(4)).toBeNull();
    expect(playQuestionCount(0)).toBeNull();
  });
});

describe("display url + forbidden copy", () => {
  it("builds packpts.com/sets/{slug} from name + id prefix", () => {
    expect(publicSetDisplayUrl("Design QA Sep8 Stack", "17e5d554-aaaa-bbbb-cccc-ddddeeeeffff"))
      .toBe("packpts.com/sets/design-qa-sep8-stack-17e5d554");
  });

  it("flags vanity / volume copy that must stay off public /sets", () => {
    expect(containsForbiddenPublicSetsCopy("0 Times Played")).toBe(true);
    expect(containsForbiddenPublicSetsCopy("Maker Rate 12%")).toBe(true);
    expect(containsForbiddenPublicSetsCopy("Trending this week")).toBe(true);
    expect(isStockFanUrl("/cdn/maker-set-1080.png")).toBe(true);
    expect(containsForbiddenPublicSetsCopy("by Bigtimedee · 5 cards · AUTHORED")).toBe(false);
  });

  it("does not push Snap-to-Set publish copy on the public shelf", () => {
    expect(SETS_POLISH.indexTitle).toBe("Sets");
    expect(SETS_POLISH.indexSub).toBe("Play sets already in PackPTS.");
    expect(SETS_POLISH.shortShelfBody.toLowerCase()).not.toContain("/make");
    expect(SETS_POLISH.shortShelfBody.toLowerCase()).not.toContain("snap yours");
  });

  it("keeps browse and detail pages free of vanity copy", () => {
    const pages = [
      readFileSync(new URL("../../pages/browse-sets.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../pages/set-page.tsx", import.meta.url), "utf8"),
    ];
    for (const src of pages) {
      expect(containsForbiddenPublicSetsCopy(src)).toBe(false);
      expect(src).not.toContain("playCount");
      expect(src).not.toContain("Times Played");
      expect(src).not.toMatch(/href=["']\/make/);
      expect(src).not.toContain("Make a set");
      expect(src).not.toContain("Snap-to-Set");
    }
  });

  it("wires set-page share to locked play_sets UTMs", () => {
    const src = readFileSync(new URL("../../pages/set-page.tsx", import.meta.url), "utf8");
    expect(src).toContain("playSetsShareUrl");
    expect(src).toContain("@shared/playSetsShare");
  });
});
