/**
 * Set detail with no valid covers matches the index hidden state.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { CHROME_BASKETBALL_2024_SET_ID } from "@shared/setDisplayOverride";
import { SetDetailView } from "../../pages/set-page";

function renderDetail(set: Record<string, unknown>): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        Router,
        { ssrPath: "/sets/x", ssrSearch: "" },
        createElement(SetDetailView, { set: set as never }),
      ),
    ),
  );
}

const base = {
  id: "74885a41-2043-4b7c-ab58-f9e16c05e2e3",
  setName: "1987 Topps Football",
  brand: "Topps",
  year: 1987,
  makerNote: null,
  isUserCreated: false,
  createdByUserId: null,
  coCreatorUserId: null,
  makerUsername: null,
  coCreatorUsername: null,
  cardCount: 82,
  createdAt: "2026-07-18T17:38:58.000Z",
  previewCards: [],
};

describe("set detail hidden state", () => {
  it("shows the name, year, and Play with no placeholders when there are no covers", () => {
    const html = renderDetail(base);
    expect(html).toContain('data-testid="set-detail-hidden"');
    expect(html).toContain("1987 Topps Football");
    expect(html).toContain(">1987<");
    expect(html).toContain(">Play<");
    expect(html).not.toContain("cover-masked-stack");
    expect(html).not.toContain("text-card-count");
    expect(html).not.toContain("THE STACK");
    expect(html).not.toContain("coming soon");
    expect(html).not.toContain("#F3E6C8");
    expect(html).not.toContain("#121821");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("82 Cards");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it("fans valid cover URLs instead of the hidden state", () => {
    const urls = [0, 1, 2].map((slot) => `/api/sets/${base.id}/covers/${slot}`);
    const html = renderDetail({
      ...base,
      previewCards: urls.map((imageUrl) => ({ imageUrl, year: 1987 })),
    });
    expect(html).toContain('data-testid="set-detail-covers"');
    expect(html).toContain('data-cover-count="3"');
    expect(html).toContain("left:36%");
    expect(html).toContain("left:64%");
    expect(html).toContain("82 Cards");
    expect(html).toContain("THE STACK");
    expect(html).not.toContain("set-detail-hidden");
    expect(html).not.toContain("#F3E6C8");
  });

  it("renders the chrome basketball display title and year label", () => {
    const html = renderDetail({
      ...base,
      id: CHROME_BASKETBALL_2024_SET_ID,
      setName: "2024 Basketball",
      brand: "Topps",
      year: 2025,
      cardCount: 733,
    });
    expect(html).toContain("2024-25 Topps Chrome Basketball");
    expect(html).toContain(">2024-25<");
    expect(html).not.toContain(">2025<");
    expect(html).not.toContain(">2024 Basketball<");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
