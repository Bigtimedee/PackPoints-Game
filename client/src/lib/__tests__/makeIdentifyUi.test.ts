import { describe, expect, it } from "vitest";
import {
  IDENTIFY_RETRY_COPY,
  MAKE_EMPTY_COPY,
  identifySlotChrome,
} from "../makeIdentifyUi";

describe("Design EMPTY_STATE copy", () => {
  it("locks /make empty chrome (not Surface A, not PackPoints)", () => {
    expect(MAKE_EMPTY_COPY.eyebrow).toBe("SNAP-TO-SET");
    expect(MAKE_EMPTY_COPY.headline).toBe("Photo the stack. Name it. Publish.");
    expect(MAKE_EMPTY_COPY.subline).toBe("Sample cards below — not your PC. Snap yours to start.");
    expect(MAKE_EMPTY_COPY.exampleBadge).toBe("EXAMPLE · NOT YOUR PC");
    expect(MAKE_EMPTY_COPY.primaryCta).toBe("Take photo");
    expect(MAKE_EMPTY_COPY.secondaryCta).toBe("Choose from library");
    expect(MAKE_EMPTY_COPY.softAuth).toBe("Sign in to photo your stack.");
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
  });
});
