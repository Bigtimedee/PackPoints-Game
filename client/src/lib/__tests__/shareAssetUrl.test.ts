import { describe, it, expect } from "vitest";
import { isUsableImageUrl } from "../shareAssetUrl";

describe("isUsableImageUrl", () => {
  it("rejects empty or invalid src values so <img> is never mounted with a bad src", () => {
    expect(isUsableImageUrl(undefined)).toBe(false);
    expect(isUsableImageUrl(null)).toBe(false);
    expect(isUsableImageUrl("")).toBe(false);
    expect(isUsableImageUrl("   ")).toBe(false);
    expect(isUsableImageUrl("javascript:alert(1)")).toBe(false);
  });

  it("accepts same-origin generated score cards", () => {
    expect(isUsableImageUrl("/generated/share/2026-09-05/abc.png")).toBe(true);
    expect(isUsableImageUrl("https://packpts.com/generated/share/x.png")).toBe(true);
  });
});
