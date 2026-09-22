import { describe, expect, it } from "vitest";
import {
  IDENTIFY_RETRY_COPY,
  MAKE_EMPTY_COPY,
  QA_IDENTIFY_FAIL_ENTRY_ID,
  QA_IDENTIFY_FAIL_STORAGE_KEY,
  consumeQaIdentifyFailStorage,
  draftBoardTitle,
  draftSlotTitle,
  identifySlotChrome,
  makeQaIdentifyFailEntry,
  searchWantsQaIdentifyFail,
  staffWantsQaIdentifyFail,
  storageWantsQaIdentifyFail,
} from "../makeIdentifyUi";

describe("Design EMPTY_STATE copy", () => {
  it("locks /make empty chrome (not Surface A, not PackPoints)", () => {
    expect(MAKE_EMPTY_COPY.eyebrow).toBe("SNAP-TO-SET");
    expect(MAKE_EMPTY_COPY.headline).toBe("Snap a card. Find its set.");
    expect(MAKE_EMPTY_COPY.subline).toBe("Match to a set already in PackPTS — then play it.");
    expect(MAKE_EMPTY_COPY.exampleBadge).toBe("EXAMPLE · CATALOG DEMO");
    expect(MAKE_EMPTY_COPY.primaryCta).toBe("Take photo");
    expect(MAKE_EMPTY_COPY.secondaryCta).toBe("Choose from library");
    expect(MAKE_EMPTY_COPY.softAuth).toBe("Sign in to snap a card.");
    expect(Object.values(MAKE_EMPTY_COPY).join(" ")).not.toMatch(/Name it\. Publish/);
    const blob = Object.values(MAKE_EMPTY_COPY).join(" ");
    expect(blob).not.toMatch(/PackPoints/);
    expect(blob).not.toMatch(/Maker Rate/i);
  });
});

describe("Design IDENTIFY_RETRY chrome", () => {
  it("labels queued / identifying / failed without alarm red flags", () => {
    expect(identifySlotChrome("queued")).toMatchObject({
      label: IDENTIFY_RETRY_COPY.queued,
      showTryAgain: false,
      showSkip: false,
      success: false,
    });
    expect(identifySlotChrome("loading")).toMatchObject({
      label: IDENTIFY_RETRY_COPY.identifying,
      showTryAgain: false,
      success: false,
    });
    expect(identifySlotChrome("ok")).toMatchObject({
      label: null,
      success: true,
      showTryAgain: false,
      failBorder: false,
    });
    expect(identifySlotChrome("error")).toMatchObject({
      label: IDENTIFY_RETRY_COPY.failed,
      showTryAgain: true,
      showSkip: true,
      failBorder: true,
      success: false,
    });
    expect(IDENTIFY_RETRY_COPY.tryAgain).toBe("Try again");
    expect(IDENTIFY_RETRY_COPY.skip).toBe("Skip");
    expect(IDENTIFY_RETRY_COPY.failed).toBe("Couldn't identify");
    expect(IDENTIFY_RETRY_COPY.headline).toBe("Identifying…");
    expect(IDENTIFY_RETRY_COPY.subline).toBe("Matching to sets already in PackPTS.");
    expect(IDENTIFY_RETRY_COPY.rateLimit).toBe("You've hit today's identify pace — try again in a bit.");
    expect(IDENTIFY_RETRY_COPY.decode).toBe("Couldn't read that photo — try exporting as JPEG");
    expect(draftBoardTitle(4)).toBe("Identifying · 4");
    expect(draftBoardTitle(4).toLowerCase()).not.toContain("draft");
    expect(draftSlotTitle("ok", { year: 1992, brand: "Topps" }, 0)).toBe("1992 Topps");
    expect(draftSlotTitle("error", undefined, 2)).toBe("Photo 03");
  });
});

describe("Staff QA identify-fail seed", () => {
  it("reads qaIdentifyFail=1 and qa=identify-fail from the query string", () => {
    expect(searchWantsQaIdentifyFail("?qaIdentifyFail=1")).toBe(true);
    expect(searchWantsQaIdentifyFail("qaIdentifyFail=1")).toBe(true);
    expect(searchWantsQaIdentifyFail("?qa=identify-fail")).toBe(true);
    expect(searchWantsQaIdentifyFail("?qaIdentifyFail=0")).toBe(false);
    expect(searchWantsQaIdentifyFail("?qa=empty")).toBe(false);
    expect(searchWantsQaIdentifyFail("")).toBe(false);
  });

  it("ignores URL and storage unless the viewer is admin", () => {
    const store: Record<string, string> = { [QA_IDENTIFY_FAIL_STORAGE_KEY]: "1" };
    expect(
      staffWantsQaIdentifyFail({
        isAdmin: false,
        search: "?qaIdentifyFail=1",
        readStorage: (k) => store[k],
      }),
    ).toBe(false);
    expect(
      staffWantsQaIdentifyFail({
        isAdmin: undefined,
        search: "?qa=identify-fail",
        readStorage: (k) => store[k],
      }),
    ).toBe(false);
    expect(
      staffWantsQaIdentifyFail({
        isAdmin: true,
        search: "?qaIdentifyFail=1",
      }),
    ).toBe(true);
    expect(
      staffWantsQaIdentifyFail({
        isAdmin: true,
        search: "",
        readStorage: (k) => store[k],
      }),
    ).toBe(true);
    expect(storageWantsQaIdentifyFail((k) => store[k])).toBe(true);
  });

  it("builds one Failed slot labeled Couldn't identify and consumes one-shot storage", () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "preview.jpg", {
      type: "image/jpeg",
    });
    const entry = makeQaIdentifyFailEntry(file);
    expect(entry).toMatchObject({
      id: QA_IDENTIFY_FAIL_ENTRY_ID,
      status: "error",
      error: IDENTIFY_RETRY_COPY.failed,
    });
    expect(identifySlotChrome(entry.status)).toMatchObject({
      label: "Couldn't identify",
      showTryAgain: true,
      showSkip: true,
      failBorder: true,
    });
    const leftover: Record<string, string | undefined> = { [QA_IDENTIFY_FAIL_STORAGE_KEY]: "1" };
    consumeQaIdentifyFailStorage((key) => {
      delete leftover[key];
    });
    expect(leftover[QA_IDENTIFY_FAIL_STORAGE_KEY]).toBeUndefined();
  });
});
