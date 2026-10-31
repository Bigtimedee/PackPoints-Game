import { describe, expect, it } from "vitest";
import { buildIgCaption } from "../services/igPublish";

describe("social captions never disclose the commission share", () => {
  for (const bad of [
    "Players get 70% of the eBay commission.",
    "70 % back to you.",
    "A 70/30 split.",
    "You keep 100 percent.",
    "Earn a share of the eBay commission.",
  ]) {
    it(`rejects: ${bad}`, () => expect(() => buildIgCaption(bad)).toThrow());
  }
  it("allows the approved headline", () => {
    expect(buildIgCaption("Name the player. Earn real cashback. Play free, link in bio.")).toContain("Earn real cashback.");
  });
});
