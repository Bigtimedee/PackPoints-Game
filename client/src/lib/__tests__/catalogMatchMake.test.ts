import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CATALOG_MATCH_COPY, MAKE_EMPTY_COPY } from "../makeIdentifyUi";

const makeSrc = readFileSync(new URL("../../pages/make.tsx", import.meta.url), "utf8");
const resultSrc = readFileSync(new URL("../../components/MakeMatchResult.tsx", import.meta.url), "utf8");
const appSrc = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

const BANNED = [
  "Photo the stack. Name it. Publish.",
  "Publish set",
  "I MADE THIS SET",
  "Make your own",
  "Create a set",
  "Publish it yourself",
  "Create card",
  "PackPoints",
  "Maker Rate",
  "mixtape",
  "Name Your Set",
  "/api/sets/create",
  "Make it together",
];

describe("/make catalog-match surface", () => {
  it("ships the entry copy and file-input honesty", () => {
    expect(MAKE_EMPTY_COPY.headline).toBe("Snap a card. Find its set.");
    expect(MAKE_EMPTY_COPY.subline).toBe("Match to a set already in PackPTS, then play it.");
    expect(MAKE_EMPTY_COPY.exampleBadge).toBe("EXAMPLE · CATALOG DEMO");
    expect(MAKE_EMPTY_COPY.softAuth).toBe("Sign in to snap a card.");
    expect(makeSrc).toContain('capture="environment"');
    expect(makeSrc).toContain("multiple");
    const library = makeSrc.slice(makeSrc.indexOf("Library:"));
    expect(library).toContain("multiple");
    expect(library.slice(0, 280)).not.toContain("capture=");
    expect(makeSrc).toContain('data-testid="make-camera-input"');
    const camera = makeSrc.slice(makeSrc.indexOf('data-testid="make-camera-input"') - 180, makeSrc.indexOf('data-testid="make-camera-input"'));
    expect(camera).toContain('capture="environment"');
    expect(camera).not.toContain("multiple");
  });

  it("wires found, ambiguous, and quiet no-match without a publish escape", () => {
    const blob = `${makeSrc}\n${resultSrc}`;
    for (const phrase of BANNED) {
      expect(blob.toLowerCase().includes(phrase.toLowerCase()), phrase).toBe(false);
    }
    expect(CATALOG_MATCH_COPY.foundHeadline).toBe("Match found");
    expect(CATALOG_MATCH_COPY.play).toBe("Play this set");
    expect(CATALOG_MATCH_COPY.honesty).toBe("Matches what’s already in PackPTS.");
    expect(CATALOG_MATCH_COPY.ambiguousHeadline).toBe("A few possible sets");
    expect(CATALOG_MATCH_COPY.ambiguousSub).toBe("Pick the one that matches your card.");
    expect(CATALOG_MATCH_COPY.noneHeadline).toBe("No set match yet");
    expect(CATALOG_MATCH_COPY.noneSub).toBe("That card isn’t in a playable PackPTS set right now.");
    expect(CATALOG_MATCH_COPY.browse).toBe("Browse sets");
    expect(CATALOG_MATCH_COPY.tryAnother).toBe("Try another photo");
    expect(resultSrc).toContain("CATALOG_MATCH_COPY.foundHeadline");
    expect(resultSrc).toContain("CATALOG_MATCH_COPY.noneHeadline");
    expect(resultSrc).toContain("CATALOG_MATCH_COPY.play");
    expect(resultSrc).toContain("button-browse-sets");
    expect(resultSrc).toContain("button-try-another-photo");
    expect(resultSrc).not.toContain("Publish");
    expect(resultSrc).toContain("catalogMatchPlayPath");
    expect(makeSrc).toContain('"/sets"');
    expect(makeSrc).toContain('"/api/make/identify"');
    expect(makeSrc).not.toContain('"/api/sets/identify-card"');
  });

  it("does not redirect non-staff away from /make", () => {
    const route = appSrc.slice(appSrc.indexOf("function MakeRoute"), appSrc.indexOf("function Router"));
    expect(route).not.toContain("setLocation");
    expect(route).not.toContain("/sets");
    expect(route).toContain("<Make />");
  });
});
