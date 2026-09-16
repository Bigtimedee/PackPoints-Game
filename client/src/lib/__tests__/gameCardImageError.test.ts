import { describe, expect, it } from "vitest";
import {
  GAME_CARD_HONEST_IMAGE_ERROR_COPY,
  GAME_CARD_REPLACEMENT_PENDING_COPY,
  resolveGameCardImageErrorKind,
} from "../gameCardImageError";

describe("GameCard image-error overlay", () => {
  it("uses honest copy when there is no skip, replace, or onImageError path (Daily 5)", () => {
    expect(resolveGameCardImageErrorKind({})).toBe("honest");
    expect(resolveGameCardImageErrorKind({
      showSkipButton: false,
      showReplaceButton: false,
      onImageError: undefined,
    })).toBe("honest");
    expect(GAME_CARD_HONEST_IMAGE_ERROR_COPY).toBe("Card image didn’t load. You can still answer.");
    expect(GAME_CARD_HONEST_IMAGE_ERROR_COPY.toLowerCase()).not.toContain("replacement");
    expect(GAME_CARD_REPLACEMENT_PENDING_COPY).toContain("replacement");
  });

  it("only shows replacement-pending copy when a replace handler exists", () => {
    expect(resolveGameCardImageErrorKind({ onImageError: () => {} })).toBe("replace-pending");
    expect(resolveGameCardImageErrorKind({ showReplaceButton: true, onImageError: () => {} })).toBe("replace-button");
    expect(resolveGameCardImageErrorKind({ showSkipButton: true, onImageError: () => {} })).toBe("skip-button");
  });
});
