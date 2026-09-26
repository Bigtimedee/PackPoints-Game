/**
 * /sets index renders the integrated shelf. Empty only when the list is empty.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { TheStack } from "../../components/SetCover";
import { CHROME_BASKETBALL_2024_SET_ID } from "@shared/setDisplayOverride";
import { BrowseSetsShelf, type BrowseSet } from "../../pages/browse-sets";

function shelfSet(overrides: Partial<BrowseSet> & Pick<BrowseSet, "id" | "setName" | "cardCount">): BrowseSet {
  return {
    makerNote: null,
    makerUsername: "Maker",
    isUserCreated: false,
    brand: "Topps",
    createdAt: "2026-07-18T17:38:58.000Z",
    coverCardUrls: [
      "/api/sets/74885a41-2043-4b7c-ab58-f9e16c05e2e3/covers/0",
      "/api/sets/74885a41-2043-4b7c-ab58-f9e16c05e2e3/covers/1",
    ],
    ...overrides,
  };
}

function renderShelf(sets: BrowseSet[], isLoading = false, coversDisabled = false): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        Router,
        { ssrPath: "/sets", ssrSearch: "" },
        createElement(BrowseSetsShelf, { sets, isLoading, coversDisabled }),
      ),
    ),
  );
}

describe("browse sets index", () => {
  const sets = [
    shelfSet({ id: "set-1987", setName: "1987 Topps", cardCount: 19 }),
    shelfSet({ id: "set-fleer", setName: "1989 Fleer Basketball", brand: "Fleer", cardCount: 168, makerUsername: null }),
    shelfSet({ id: "set-2024", setName: "2024 Basketball", brand: "Topps", cardCount: 733 }),
    shelfSet({ id: "set-plain", setName: "Open Hoops", brand: null, cardCount: 12 }),
  ];

  it("renders one card per integrated set, an honest count, and Play this set", () => {
    const html = renderShelf(sets);
    expect(html).toContain("4 sets");
    expect(html).toContain("1987 Topps");
    expect(html).toContain("1989 Fleer Basketball");
    expect(html).toContain("2024 Topps Basketball");
    expect(html).not.toMatch(/>2024 Basketball</);
    expect(html).not.toContain("2025 Topps");
    expect(html).toContain("Open Hoops");
    expect(html).toContain("19 cards");
    expect(html).toContain("168 cards");
    expect(html).toContain('data-testid="card-set-set-1987"');
    expect(html).toContain('data-testid="card-set-set-fleer"');
    expect(html).toContain('data-testid="button-play-set-set-1987"');
    expect(html).toContain('data-testid="button-play-set-set-fleer"');
    expect(html.match(/Play this set/g)?.length).toBe(4);
    expect(html).not.toContain("The shelf is empty.");
    expect(html).not.toContain("by Maker");
    expect(html).not.toContain("AUTHORED");
    expect(html).not.toContain("PackPoints");
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(html).not.toContain("A short shelf");
    expect(html).not.toContain("banner-short-shelf");
    expect(html).not.toContain("Integrated sets only");
    expect(html).not.toContain("2,840");
    expect(html).not.toContain("2840");
  });

  it("paints fanned thumbs as a solid plaque with a gold seam and no label text", () => {
    const html = renderShelf(sets);
    expect(html).toContain('data-plaque-chrome="bar"');
    expect(html).toContain('data-testid="plaque-seam"');
    expect(html).not.toContain("WHO IS THIS PLAYER?");
    expect(html).not.toContain("CERT SEALED");
  });

  it("hides an empty cover list with no cream card, gray box, or card count", () => {
    const html = renderShelf([
      shelfSet({
        id: "set-empty-cover",
        setName: "1990 Hoops",
        brand: null,
        year: 1990,
        cardCount: 8,
        makerUsername: null,
        coverCardUrls: [],
      }),
    ]);
    expect(html).toContain('data-testid="cover-slot-hidden"');
    expect(html).toContain("1990 Hoops");
    expect(html).toContain(">1990<");
    expect(html).toContain("Play this set");
    expect(html).not.toContain("cover-masked-stack");
    expect(html).not.toContain("8 cards");
    expect(html).not.toContain("#F3E6C8");
    expect(html).not.toContain("#121821");
    expect(html).not.toContain("coming soon");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("fans three covers evenly and renders the chrome basketball override", () => {
    const setId = "74885a41-2043-4b7c-ab58-f9e16c05e2e3";
    const urls = [0, 1, 2].map((slot) => `/api/sets/${setId}/covers/${slot}`);
    const fanned = renderShelf([
      shelfSet({
        id: setId,
        setName: "1987 Topps Football",
        year: 1987,
        cardCount: 82,
        makerUsername: null,
        coverCardUrls: urls,
      }),
    ]);
    expect(fanned).toContain('data-cover-count="3"');
    expect(fanned).toContain("left:36%");
    expect(fanned).toContain("left:50%");
    expect(fanned).toContain("left:64%");
    expect(fanned.match(/<img\b/g)?.length).toBe(3);
    expect(fanned).not.toContain("#F3E6C8");
    expect(fanned).not.toContain("#121821");

    const override = renderShelf([
      shelfSet({
        id: CHROME_BASKETBALL_2024_SET_ID,
        setName: "2024 Basketball",
        brand: "Topps",
        year: 2025,
        cardCount: 733,
        makerUsername: null,
        coverCardUrls: [],
      }),
    ], false, true);
    expect(override).toContain("2024-25 Topps Chrome Basketball");
    expect(override).toContain(">2024-25<");
    expect(override).not.toContain(">2025<");
    expect(override).not.toContain("2024 Topps Basketball");
    expect(override).not.toMatch(/[\u2013\u2014]/);
  });

  it("renders only the masked cover URL", () => {
    const masked = "/api/sets/74885a41-2043-4b7c-ab58-f9e16c05e2e3/covers/0";
    const raw = "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/JOE_MONTANA/resize";
    const html = renderShelf([
      shelfSet({
        id: "74885a41-2043-4b7c-ab58-f9e16c05e2e3",
        setName: "1987 Topps Football",
        cardCount: 82,
        makerUsername: null,
        coverCardUrls: [raw, masked, "/api/images/card/579e675f-b5c1-4cd1-89c2-d052005ab2f8"],
      }),
    ]);
    expect(html).toContain(`src="${masked}"`);
    expect(html).not.toContain("bubble.io");
    expect(html).not.toContain("JOE_MONTANA");
    expect(html).not.toContain("/api/images/card");
    expect(html).not.toMatch(/[\u2013\u2014]/);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stack = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TheStack, {
          cards: [
            { imageUrl: raw, year: 1987 },
            { imageUrl: masked, year: 1987 },
          ],
        }),
      ),
    );
    expect(stack).toContain(`src="${masked}"`);
    expect(stack).not.toContain("bubble.io");
    expect(stack).not.toContain("/api/images/card");
  });

  it("keeps unmasked card routes off the public set pages", () => {
    const pages = [
      readFileSync(new URL("../../pages/browse-sets.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../pages/set-page.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../components/SetCover.tsx", import.meta.url), "utf8"),
    ];
    for (const src of pages) {
      expect(src).not.toContain("/api/images/card");
      expect(src).not.toContain("bubble.io");
    }
  });

  it("keeps the cover height and shows name, year, and Play when covers are disabled", () => {
    const html = renderShelf([
      shelfSet({
        id: "set-hidden-cover",
        setName: "1989 Fleer Basketball",
        brand: "Fleer",
        year: 1989,
        cardCount: 168,
        makerUsername: null,
        shareImageUrl: "/generated/share/1989-fleer.png",
      }),
      shelfSet({
        id: "set-long-name",
        setName: "1987 Topps Baseball Traded Update",
        brand: "Topps",
        year: 1987,
        cardCount: 132,
        makerUsername: null,
      }),
    ], false, true);
    expect(html).toContain("1989 Fleer Basketball");
    expect(html).toContain("1987 Topps Baseball Traded Update");
    expect(html).toContain('data-testid="text-set-year"');
    expect(html).toContain(">1989<");
    expect(html).toContain(">1987<");
    expect(html).toContain("Play this set");
    expect(html).toContain('data-testid="button-play-set-set-hidden-cover"');
    expect(html).toContain('data-testid="cover-slot-hidden"');
    expect(html).toContain("height:168px");
    expect(html).not.toContain("168 cards");
    expect(html).not.toContain("132 cards");
    expect(html).not.toContain("cards");
    expect(html).not.toContain("cover-masked-stack");
    expect(html).not.toContain("cover-surface-a");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/covers/");
    expect(html).not.toContain("1989-fleer.png");
    expect(html).not.toContain("#121821");
    expect(html).not.toContain("#F3E6C8");
    expect(html).not.toContain("coming soon");
    expect(html).not.toContain("Cover");
    expect(html).not.toMatch(/[\u2013\u2014]/);

    const slot = html.match(/<div[^>]*data-testid="cover-slot-hidden"[^>]*>/)?.[0] ?? "";
    expect(slot).toMatch(/height:168px/);
    expect(slot).not.toContain("background");
  });

  it("shows the empty shelf only when there are zero sets", () => {
    const html = renderShelf([]);
    expect(html).toContain("0 sets");
    expect(html).toContain("The shelf is empty.");
    expect(html).toContain("Play Daily 5 while PackPTS adds more sets.");
    expect(html).not.toContain("card-set-");
    expect(html).not.toContain("Play this set");
    expect(html).not.toContain("A short shelf");
    expect(html).not.toContain("banner-short-shelf");
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(html).not.toContain("PackPoints");
  });
});
