import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { cardIdsFromQuestions } from "../masking/preMaskDeal";

const maskingSrc = readFileSync(new URL("../masking/maskingService.ts", import.meta.url), "utf8");
const routeSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
const maskedSendSrc = readFileSync(new URL("../services/playImageSend.ts", import.meta.url), "utf8");
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
      maskingSrc.indexOf("generateMaskedImage(cardId"),
    );
  });

  it("serves warm hits with cache headers and Server-Timing", () => {
    expect(maskedSendSrc).toContain("peekWarmMaskedFilename");
    expect(maskedSendSrc).toContain('X-Mask-Cache');
    expect(maskedSendSrc).toContain("Server-Timing");
    expect(maskedSendSrc).toContain("max-age=86400");
    expect(maskedSendSrc).toContain('res.removeHeader("X-Card-Id")');
    expect(CURRENT_MASK_VERSION).toBe("v4.6");
  });

  it("kicks preMask on solo, Daily 5, and 1v1 deal start without awaiting", () => {
    expect(routeSrc).toContain('kickPreMask(cardIdsFromQuestions(session.questions), "solo-start")');
    expect(daily5Src).toContain('kickPreMask(selected.map((card) => card.id), "daily5-create")');
    expect(daily5Src).toContain('kickPreMask(cards.map((card) => card.cardId), "daily5-start")');
    expect(matchSrc).toContain('kickPreMask(cardIdsFromQuestions(questions), "1v1-start")');
    expect(matchSrc).toContain('kickPreMask(cardIdsFromQuestions(questions), "1v1-random-start")');
  });
});
