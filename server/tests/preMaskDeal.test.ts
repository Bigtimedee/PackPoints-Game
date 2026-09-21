import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { cardIdsFromQuestions } from "../masking/preMaskDeal";

const maskingSrc = readFileSync(new URL("../masking/maskingService.ts", import.meta.url), "utf8");
const routeSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../services/daily5Service.ts", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../services/matchService.ts", import.meta.url), "utf8");

describe("cardIdsFromQuestions", () => {
  it("prefers playableCardId and skips blanks", () => {
    expect(cardIdsFromQuestions([
      { card: { id: "legacy", playableCardId: "pc-1" } },
      { card: { id: "legacy-2" } },
      { card: null },
      {},
    ])).toEqual(["pc-1", "legacy-2"]);
  });
});

describe("masked-image warm path", () => {
  it("peeks the versioned JPEG before DB/OCR", () => {
    expect(maskingSrc).toContain("export function peekWarmMaskedFilename");
    expect(maskingSrc).toContain("${cardId}_${CURRENT_MASK_VERSION}.jpg");
    expect(maskingSrc.indexOf("const warm = peekWarmMaskedFilename(cardId)")).toBeLessThan(
      maskingSrc.indexOf("const promise = generateMaskedImage(cardId)"),
    );
  });

  it("serves warm hits with cache headers and Server-Timing", () => {
    expect(routeSrc).toContain("peekWarmMaskedFilename");
    expect(routeSrc).toContain('X-Mask-Cache');
    expect(routeSrc).toContain("Server-Timing");
    expect(routeSrc).toContain("max-age=86400");
    expect(CURRENT_MASK_VERSION).toBe("v4.4");
  });

  it("kicks preMask on solo, Daily 5, and 1v1 deal start without awaiting", () => {
    expect(routeSrc).toContain('kickPreMask(cardIdsFromQuestions(session.questions), "solo-start")');
    expect(daily5Src).toContain('kickPreMask(selected.map((card) => card.id), "daily5-create")');
    expect(daily5Src).toContain('kickPreMask(maskedCards.map((card) => card.cardId), "daily5-start")');
    expect(matchSrc).toContain('kickPreMask(cardIdsFromQuestions(questions), "1v1-start")');
    expect(matchSrc).toContain('kickPreMask(cardIdsFromQuestions(questions), "1v1-random-start")');
  });
});
