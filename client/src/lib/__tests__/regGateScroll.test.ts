/**
 * P0 2026-10-03: the guest hard wall on /game/solo could not be reached on
 * iPhone. /game/* clipped main (overflow-hidden), the wall sat under the
 * setup selects, the static legal footer added 53px of window scroll and slid
 * over the card, and the chat launcher sat on top of the plaque.
 * Layout is checked by Playwright at 375x667, 390x664 and 390x844; these lock
 * the code paths.
 */
import { readFileSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { feedbackLauncherAllowed, fullscreenMainClassName } from "../appShellLayout";
import { acquireGuestWallChrome, guestWallActiveCount } from "../guestWallChrome";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("app shell scroll per route", () => {
  it("lets /game/* scroll and keeps /match/* clipped", () => {
    expect(fullscreenMainClassName("/game/solo")).toBe("flex-1 min-h-0 overflow-y-auto overscroll-contain");
    expect(fullscreenMainClassName("/game/solo")).not.toContain("overflow-hidden");
    expect(fullscreenMainClassName("/match/abc")).toBe("flex-1 overflow-hidden");
    expect(fullscreenMainClassName("/match")).toBe("flex-1 overflow-hidden");
    expect(fullscreenMainClassName("/daily5")).toBeNull();
    expect(fullscreenMainClassName("/sets/abc")).toBeNull();
  });

  it("keeps active play from scrolling the page", () => {
    const game = read("../../pages/game.tsx");
    expect(game).toContain('data-testid="game-active-viewport" className="h-full flex flex-col overflow-hidden"');
  });

  it("hides the chat launcher on play routes", () => {
    expect(feedbackLauncherAllowed("/game/solo")).toBe(false);
    expect(feedbackLauncherAllowed("/match/abc")).toBe(false);
    expect(feedbackLauncherAllowed("/review/x")).toBe(false);
    expect(feedbackLauncherAllowed("/daily5")).toBe(true);
    expect(feedbackLauncherAllowed("/")).toBe(true);
    expect(read("../../App.tsx")).toContain("feedbackLauncherAllowed(location)");
  });
});

describe("guest hard wall chrome", () => {
  afterEach(() => {
    expect(guestWallActiveCount()).toBe(0);
  });

  it("is counted, so the flag clears only after the last wall unmounts", () => {
    const releaseA = acquireGuestWallChrome();
    const releaseB = acquireGuestWallChrome();
    expect(guestWallActiveCount()).toBe(2);
    releaseA();
    releaseA();
    expect(guestWallActiveCount()).toBe(1);
    releaseB();
    expect(guestWallActiveCount()).toBe(0);
  });

  it("hides the launcher under a hard wall and takes the static footer out of layout", () => {
    const css = read("../../index.css");
    expect(css).toMatch(/body\[data-reg-gate="hard"\] \[data-testid="button-feedback-launcher"\] \{\s*display: none !important;/);
    expect(css).toMatch(/body\.app-mounted #static-legal-footer \{[^}]*position: absolute !important;[^}]*height: 1px !important;/);
    expect(css).not.toMatch(/#static-legal-footer \{[^}]*position: fixed/);
    expect(read("../../main.tsx")).toContain('document.body.classList.add("app-mounted")');
    expect(read("../../../index.html")).toContain('id="static-legal-footer"');
    expect(read("../../components/FeedbackWidget.tsx")).toContain('data-testid="button-feedback-launcher"');
    expect(read("../../components/guest-hard-wall.tsx")).toContain("useGuestWallChrome(true)");
    expect(read("../../components/signup-modal.tsx")).toContain('useGuestWallChrome(open && variant === "hard")');
  });
});

describe("hard wall placement", () => {
  it("replaces the solo setup form with a block screen and blocks Game Complete with the hard modal", () => {
    const game = read("../../pages/game.tsx");
    expect(game).toContain('data-testid="screen-solo-guest-block"');
    expect(game).toContain("pb-[calc(1.5rem+env(safe-area-inset-bottom))]");
    expect(game).not.toContain("AnonGatePlaque");
    expect(game).toMatch(/anonGate\.phase === "hard"\) \{[\s\S]{0,200}setGateOpenOn\("plaque"\);\s*setShowSignupModal\(true\);/);
  });

  it("gives the gate dialog its own scroll and safe-area padding", () => {
    const modal = read("../../components/signup-modal.tsx");
    expect(modal).toContain("max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain");
    expect(modal).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(modal).not.toContain("max-h-[90vh]");
    // Both steps keep a 16px side margin at 375 and 390 (Design QA 2026-10-03).
    expect(modal.match(/w-\[calc\(100%-2rem\)\]/g)?.length).toBe(2);
  });

  it("uses the shared wall on Daily 5 and blocks Daily 5 results with the hard modal", () => {
    const d5 = read("../../pages/daily5.tsx");
    expect(d5).not.toContain("AnonGatePlaque");
    expect(d5).toContain("<GuestHardWall");
    expect(d5).toContain("resultsHardGate");
  });
});
