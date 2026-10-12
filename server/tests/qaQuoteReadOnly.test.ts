import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { qaBlockedPath } from "@shared/qaTestAccount";
import { upToBackLabel } from "../../client/src/lib/pointsCopy";
import { previewCreditFromQuote } from "../services/guardrailPolicy";

const ROOT = path.resolve(__dirname, "../..");

describe("QA account: quote yes, apply no", () => {
  it("lets the QA account call quote-batch", () => {
    expect(qaBlockedPath("POST", "/api/marketplace/redemption/quote-batch")).toBe(false);
  });
  it("still blocks apply, single quote, redeem and payouts", () => {
    for (const p of [
      "/api/marketplace/redemption/apply",
      "/api/marketplace/redemption/quote",
      "/api/marketplace/redemption/quote-batch/extra",
      "/api/redeem",
      "/api/rebate/payout-request",
    ]) expect(qaBlockedPath("POST", p)).toBe(true);
  });
  it("quote-batch runs read-only for the QA account (no intent, no audit row)", () => {
    const routes = readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    expect(routes).toMatch(/\{ readOnly: isQaTestUser\(userId\) \}/);
    const svc = readFileSync(path.join(ROOT, "server/services/profitGuardrailService.ts"), "utf8");
    expect(svc).toMatch(/opts\.readOnly \? \[\{ id: "" \}/);
    expect(svc).toMatch(/if \(!opts\.readOnly\) await recordRebateAudit/);
  });
});

describe("Up to $X back badge", () => {
  it("is hidden at 0, null, undefined or negative", () => {
    for (const v of [0, null, undefined, -5, NaN]) expect(upToBackLabel(v as any)).toBeNull();
  });
  it("shows the capped credit", () => {
    expect(upToBackLabel(105)).toBe("Up to $1.05 back");
  });
  it("is hidden under 25 cents and shown at 25", () => {
    expect(upToBackLabel(24)).toBeNull();
    expect(upToBackLabel(25)).toBe("Up to $0.25 back");
  });
});

describe("one figure for badge and Apply", () => {
  it("$53.99 card: badge equals the full capped credit, not a 50% reserve", () => {
    // 280 pts margin-backed cap at 0.2 cents/pt = 56 cents. The old card showed 140 pts (50%).
    expect(previewCreditFromQuote(280, 5000, 0.2)).toEqual({ pts: 280, creditCents: 56 });
  });
  it("clamps to the wallet balance, as applyRedemption does", () => {
    expect(previewCreditFromQuote(280, 100, 0.2)).toEqual({ pts: 100, creditCents: 20 });
    expect(upToBackLabel(previewCreditFromQuote(280, 100, 0.2).creditCents)).toBeNull();
  });
  it("zero for bad inputs", () => {
    expect(previewCreditFromQuote(280, 5000, 0).creditCents).toBe(0);
    expect(previewCreditFromQuote(-3, 5000, 0.2)).toEqual({ pts: 0, creditCents: 0 });
  });
  it("cards drop the 50% reserve line and the dialog uses the margin-backed cap", () => {
    const m = readFileSync(path.join(ROOT, "client/src/pages/marketplace.tsx"), "utf8");
    expect(m).not.toMatch(/PackPTS reserve:/);
    expect(m).not.toMatch(/quote\?\.rMax/);
    expect(readFileSync(path.join(ROOT, "server/routes.ts"), "utf8")).not.toMatch(/Default 50%/);
  });
  it("feedback bubble is hidden on /points and /marketplace", () => {
    const w = readFileSync(path.join(ROOT, "client/src/components/FeedbackWidget.tsx"), "utf8");
    expect(w).toMatch(/location === "\/points" \|\| location\.startsWith\("\/marketplace"\)/);
  });
});
