/**
 * /sets index renders the integrated shelf. Empty only when the list is empty.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
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
