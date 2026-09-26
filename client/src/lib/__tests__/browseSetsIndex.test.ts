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
import { BrowseSetsShelf, type BrowseSet } from "../../pages/browse-sets";

function shelfSet(overrides: Partial<BrowseSet> & Pick<BrowseSet, "id" | "setName" | "cardCount">): BrowseSet {
  return {
    makerNote: null,
    makerUsername: "Maker",
    isUserCreated: false,
    createdAt: "2026-07-18T17:38:58.000Z",
    coverCardUrls: ["https://packpts.com/cards/one.jpg"],
    ...overrides,
  };
}

function renderShelf(sets: BrowseSet[], isLoading = false): string {
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
        createElement(BrowseSetsShelf, { sets, isLoading }),
      ),
    ),
  );
}

describe("browse sets index", () => {
  const sets = [
    shelfSet({ id: "set-1987", setName: "1987 Topps", cardCount: 19 }),
    shelfSet({ id: "set-fleer", setName: "1989 Fleer Basketball", cardCount: 168, makerUsername: null }),
  ];

  it("renders one card per integrated set, an honest count, and Play this set", () => {
    const html = renderShelf(sets);
    expect(html).toContain("2 sets");
    expect(html).toContain("1987 Topps");
    expect(html).toContain("1989 Fleer Basketball");
    expect(html).toContain("19 cards");
    expect(html).toContain("168 cards");
    expect(html).toContain('data-testid="card-set-set-1987"');
    expect(html).toContain('data-testid="card-set-set-fleer"');
    expect(html).toContain('data-testid="button-play-set-set-1987"');
    expect(html).toContain('data-testid="button-play-set-set-fleer"');
    expect(html.match(/Play this set/g)?.length).toBe(2);
    expect(html).not.toContain("The shelf is empty.");
    expect(html).not.toContain("by Maker");
    expect(html).not.toContain("AUTHORED");
    expect(html).not.toContain("PackPoints");
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(html).toContain("Integrated sets only. Play what&#x27;s here, or open Daily 5.");
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

  it("shows the empty shelf only when there are zero sets", () => {
    const html = renderShelf([]);
    expect(html).toContain("0 sets");
    expect(html).toContain("The shelf is empty.");
    expect(html).toContain("Play Daily 5 while PackPTS adds more sets.");
    expect(html).not.toContain("card-set-");
    expect(html).not.toContain("Play this set");
    expect(html).not.toMatch(/[\u2013\u2014]/);
    expect(html).not.toContain("PackPoints");
  });
});
