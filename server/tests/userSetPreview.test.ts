import { describe, expect, it } from "vitest";
import {
  createdAtToIso,
  extractCardYear,
  sanitizeCoverCardUrls,
  toPublicPreviewCard,
  usablePublicImageUrl,
} from "../routes/userSetPreview";

describe("toPublicPreviewCard", () => {
  it("strips player, description, and raw photo URLs from the public payload", () => {
    const setId = "74885a41-2043-4b7c-ab58-f9e16c05e2e3";
    const masked = `/api/sets/${setId}/covers/0`;
    const preview = toPublicPreviewCard({
      imageUrl: masked,
      set: "1987 Topps",
      description: "1987 Topps Mike Trout",
      player: "Mike Trout",
    });
    expect(preview).toEqual({
      imageUrl: masked,
      year: 1987,
    });
    expect(toPublicPreviewCard({
      imageUrl: "https://cdn.bubble.io/d112/crop_image",
      set: "1987 Topps",
      player: "Joe Montana",
    }).imageUrl).toBeNull();
    expect(JSON.stringify(preview)).not.toMatch(/Trout|Mike|Montana/i);
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

describe("createdAtToIso", () => {
  it("normalizes raw pg timestamps to the same ISO as drizzle Date JSON", () => {
    expect(createdAtToIso("2026-09-08 17:38:58.989524")).toBe("2026-09-08T17:38:58.989Z");
    expect(createdAtToIso("2026-09-08T17:38:58.989Z")).toBe("2026-09-08T17:38:58.989Z");
    expect(createdAtToIso(new Date("2026-09-08T17:38:58.989Z"))).toBe("2026-09-08T17:38:58.989Z");
    expect(createdAtToIso(null)).toBeNull();
    expect(createdAtToIso("not-a-date")).toBeNull();
  });
});

describe("sanitizeCoverCardUrls", () => {
  it("accepts a JSON array from SQL and drops unusable slots", () => {
    const masked = "/api/sets/74885a41-2043-4b7c-ab58-f9e16c05e2e3/covers/1";
    expect(
      sanitizeCoverCardUrls(
        JSON.stringify([
          "https://cdn.bubble.io/d112/crop_image",
          "",
          "/assets/maker-set-1080.png",
          "/generated/share/x.png",
          masked,
          "/api/images/card/579e675f-b5c1-4cd1-89c2-d052005ab2f8",
        ]),
      ),
    ).toEqual([masked]);
  });
});
