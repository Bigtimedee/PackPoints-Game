/**
 * Narrow /sets pages keep the chat button off every tappable control.
 * The button stays on screen. Clearance is padding plus a shorter scrollport.
 */
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { BrowseSetsShelf, type BrowseSet } from "../../pages/browse-sets";
import {
  SETS_CHAT_BUTTON_BLOCK,
  SETS_CHAT_BUTTON_BOTTOM,
  SETS_PAGE_CHAT_PADDING,
  SETS_PAGE_CLEARANCE_CLASS,
  SETS_POLISH,
  SETS_SCROLLPORT_CLASS,
  SETS_SCROLLPORT_MARGIN,
  SETS_SHELL_CLASS,
  isPublicSetsPath,
  setsMainClassName,
  setsShellClassName,
} from "../setsPolish";

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("public sets chat clearance", () => {
  it("matches the floating button size and the narrow offset", () => {
    const fab = read("../../components/FeedbackWidget.tsx");
    expect(fab).toContain("bottom-20");
    expect(fab).toContain("h-12");
    expect(fab).toContain("w-12");
    expect(SETS_CHAT_BUTTON_BLOCK).toBe("3rem");
    expect(SETS_CHAT_BUTTON_BOTTOM).toBe("5rem");
    expect(SETS_PAGE_CHAT_PADDING).toBe("calc(3rem + env(safe-area-inset-bottom, 0px))");
    expect(SETS_SCROLLPORT_MARGIN).toBe(
      "calc(5rem + 3rem + env(safe-area-inset-bottom, 0px))",
    );
  });

  it("applies only to /sets and /sets/:id", () => {
    expect(isPublicSetsPath("/sets")).toBe(true);
    expect(isPublicSetsPath("/sets/")).toBe(true);
    expect(isPublicSetsPath("/sets?limit=50")).toBe(true);
    expect(isPublicSetsPath("/sets/74885a41-2043-4b7c-ab58-f9e16c05e2e3")).toBe(true);
    expect(isPublicSetsPath("/sets/1987-topps-74885a41")).toBe(true);
    expect(isPublicSetsPath("/sets/74885a41/covers/0")).toBe(false);
    expect(isPublicSetsPath("/game/solo")).toBe(false);
    expect(isPublicSetsPath("/make")).toBe(false);
    expect(isPublicSetsPath("/")).toBe(false);

    expect(setsShellClassName("/sets")).toBe(SETS_SHELL_CLASS);
    expect(setsShellClassName("/game/solo")).toBe("");
    expect(setsMainClassName("/sets/abc")).toContain(SETS_SCROLLPORT_CLASS);
    expect(setsMainClassName("/sets/abc")).toContain("pb-20");
    expect(setsMainClassName("/daily")).not.toContain(SETS_SCROLLPORT_CLASS);
    expect(setsMainClassName("/match/abc")).not.toContain(SETS_SCROLLPORT_CLASS);
  });

  it("reserves button height plus the home indicator at 320 to 430px", () => {
    const css = read("../../index.css");
    const narrow = css.slice(css.indexOf("@media (max-width: 430px)"));
    expect(narrow.startsWith("@media (max-width: 430px)")).toBe(true);
    expect(narrow).toContain(`.${SETS_SHELL_CLASS}`);
    expect(narrow).toContain(SETS_POLISH.canvas);
    expect(narrow).toContain(`main.${SETS_SCROLLPORT_CLASS}`);
    expect(narrow).toContain(`margin-bottom: ${SETS_SCROLLPORT_MARGIN}`);
    expect(narrow).toContain("padding-bottom: 0");
    expect(narrow).toContain(`.${SETS_PAGE_CLEARANCE_CLASS}`);
    expect(narrow).toContain(`padding-bottom: ${SETS_PAGE_CHAT_PADDING}`);
    expect(narrow).not.toContain("overflow:");
    expect(narrow).not.toMatch(/[\u2013\u2014]/);

    const browse = read("../../pages/browse-sets.tsx");
    const detail = read("../../pages/set-page.tsx");
    const app = read("../../App.tsx");
    expect(browse).toContain("SETS_PAGE_CLEARANCE_CLASS");
    expect(detail.match(/SETS_PAGE_CLEARANCE_CLASS/g)?.length).toBe(4);
    expect(app).toContain("setsMainClassName");
    expect(app).toContain("setsShellClassName");
  });

  it("puts the clearance class on the shelf container", () => {
    const set: BrowseSet = {
      id: "set-1987",
      setName: "1987 Topps",
      brand: "Topps",
      makerNote: null,
      makerUsername: null,
      isUserCreated: false,
      cardCount: 19,
      createdAt: null,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Router,
          { ssrPath: "/sets", ssrSearch: "" },
          createElement(BrowseSetsShelf, { sets: [set], isLoading: false }),
        ),
      ),
    );
    expect(html).toContain(`class="${SETS_PAGE_CLEARANCE_CLASS} min-h-full pb-20 md:pb-10"`);
    expect(html).toContain("Play this set");
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
