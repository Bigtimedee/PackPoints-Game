import { describe, expect, it } from "vitest";
import {
  extractCardYear,
  sanitizeCoverCardUrls,
  toPublicPreviewCard,
  usablePublicImageUrl,
} from "../routes/userSetPreview";

describe("toPublicPreviewCard", () => {
  it("strips player and description from the public payload", () => {
    const preview = toPublicPreviewCard({
      imageUrl: "https://packpts.com/api/card-photos/abc",
      set: "1987 Topps",
      description: "1987 Topps — Mike Trout",
      player: "Mike Trout",
    });
    expect(preview).toEqual({
      imageUrl: "https://packpts.com/api/card-photos/abc",
      year: 1987,
    });
    expect(JSON.stringify(preview)).not.toMatch(/Trout|Mike/i);
  });

  it("drops stock fan and junk URLs", () => {
    expect(usablePublicImageUrl("/assets/maker-set-1080.png")).toBeNull();
    expect(usablePublicImageUrl("javascript:alert(1)")).toBeNull();
    expect(toPublicPreviewCard({ imageUrl: "/assets/maker-set-1080.png", set: "1991 Fleer" })).toEqual({
      imageUrl: null,
      year: 1991,
    });
  });

  it("does not invent a year when none is present", () => {
    expect(extractCardYear("Topps", "Binder pull")).toBeNull();
    expect(toPublicPreviewCard({ imageUrl: null, set: "PC stack" })).toEqual({
      imageUrl: null,
      year: null,
    });
  });
});

describe("sanitizeCoverCardUrls", () => {
  it("accepts a JSON array from SQL and drops unusable slots", () => {
    expect(
      sanitizeCoverCardUrls(
        JSON.stringify([
          "https://packpts.com/api/card-photos/a",
          "",
          "/assets/maker-set-1080.png",
          "/generated/share/x.png",
        ]),
      ),
    ).toEqual([
      "https://packpts.com/api/card-photos/a",
      "/generated/share/x.png",
    ]);
  });
});
