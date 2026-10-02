import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import {
  remainingPlayCardUrls,
  prefetchMaskedPlayCards,
  prefetchRevealPlayCard,
  resetPrefetchForTests,
  retainedPrefetchCount,
} from "../prefetchPlayCardImages";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");

const masked = (id: string) => `/api/play/m/solo/sess/${id}/tok?v=${CURRENT_MASK_VERSION}`;

describe("remainingPlayCardUrls", () => {
  it("keeps the current card and every later url", () => {
    expect(remainingPlayCardUrls(["a", "b", "c", "d"], 1)).toEqual(["b", "c", "d"]);
  });

  it("drops blanks", () => {
    expect(remainingPlayCardUrls(["a", "", null, "d"], 0)).toEqual(["a", "d"]);
  });
});

describe("prefetchMaskedPlayCards", () => {
  it("returns masked play URLs only and drops raw card-id proxies", () => {
    const urls = prefetchMaskedPlayCards([
      masked("0"),
      masked("1"),
      "/api/images/card/card-1",
      "/api/play/r/solo/sess/0/1/tok",
    ]);
    expect(urls).toEqual([masked("0"), masked("1")]);
    expect(urls.every((url) => url.includes("/api/play/m/"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/images/card/"))).toBe(false);
    expect(urls.some((url) => url.includes("/api/play/r/"))).toBe(false);
  });

  it("keeps N+1 and N+2 image requests alive and does not prefetch unmasked urls", () => {
    const created: Array<{ crossOrigin: string | null; src: string }> = [];
    const links: Array<{ rel: string; as: string; href: string; crossOrigin: string | null }> = [];
    const previousImage = globalThis.Image;
    const previousDocument = globalThis.document;
    class FakeImage {
      decoding = "";
      crossOrigin: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        created.push({ crossOrigin: this.crossOrigin, src: value });
      }
    }
    (globalThis as { Image?: typeof Image }).Image = FakeImage as unknown as typeof Image;
    (globalThis as { document?: Document }).document = {
      querySelector: () => null,
      head: { appendChild: () => {} },
      createElement: () => {
        const link = { rel: "", as: "", href: "", crossOrigin: null as string | null };
        links.push(link);
        return link;
      },
    } as unknown as Document;
    try {
      resetPrefetchForTests();
      const urls = prefetchMaskedPlayCards([
        masked("0"),
        masked("1"),
        masked("2"),
        "/api/images/card/nope",
      ]);
      expect(urls).toEqual([masked("0"), masked("1"), masked("2")]);
      expect(created.map((img) => img.src)).toEqual([masked("1"), masked("2"), masked("0")]);
      expect(created.every((img) => img.crossOrigin === "anonymous")).toBe(true);
      expect(retainedPrefetchCount()).toBe(3);
      expect(links.map((link) => link.href)).toEqual([masked("1"), masked("2")]);
      expect(links.every((link) => link.crossOrigin === "anonymous")).toBe(true);
    } finally {
      (globalThis as { Image?: typeof Image }).Image = previousImage;
      (globalThis as { document?: Document }).document = previousDocument;
      resetPrefetchForTests();
    }
  });
});

describe("prefetchRevealPlayCard", () => {
  it("prefetches only an ACK reveal URL", () => {
    expect(prefetchRevealPlayCard("/api/play/r/solo/sess/0/9/tok")).toBe("/api/play/r/solo/sess/0/9/tok");
    expect(prefetchRevealPlayCard("/api/images/card/card-1")).toBeNull();
    expect(prefetchRevealPlayCard(masked("0"))).toBeNull();
  });
});

describe("play surfaces prefetch remaining masked cards", () => {
  it("solo prefetches remaining masked URLs as soon as the session is known", () => {
    expect(gameSrc).toContain("prefetchMaskedPlayCards(remainingMaskedUrls)");
    expect(gameSrc).toContain("remainingPlayCardUrls");
    expect(gameSrc).toContain("prefetchRevealPlayCard(currentRevealUrl)");
    expect(gameSrc).not.toContain("/api/images/card/");
  });

  it("solo Next paints the next known card before /api/game/next ACK", () => {
    const handleNext = gameSrc.slice(
      gameSrc.indexOf("const handleNextQuestion"),
      gameSrc.indexOf("const handlePlayAgain"),
    );
    expect(handleNext).toContain("currentQuestionIndex: nextIndex");
    expect(handleNext).toContain("setIsRevealed(false)");
    expect(handleNext).toContain("nextQuestionMutation.mutate");
  });

  it("Daily 5 prefetches remaining masked URLs when the five are known", () => {
    expect(daily5Src).toContain("prefetchMaskedPlayCards(remaining)");
    expect(daily5Src).toContain("card.position >= currentPosition");
    expect(daily5Src).toContain("card.imageUrl");
    expect(daily5Src).toContain("prefetchRevealPlayCard(answerResult.revealUrl)");
    expect(daily5Src).not.toContain("card.cardId");
  });

  it("1v1 prefetches current + upcomingMaskedUrls and does not cache-bust first paint", () => {
    expect(matchSrc).toContain("upcomingMaskedUrls");
    expect(matchSrc).not.toContain("upcomingMaskedCardIds");
    expect(matchSrc).toContain("prefetchMaskedPlayCards");
    expect(matchSrc).toContain("imageRetryCount > 0");
    expect(matchSrc).not.toContain("t=${seedVersion}-${imageRetryCount}-${matchState.currentQuestionIndex}");
  });
});
