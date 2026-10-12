import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { qaBlockedPath } from "@shared/qaTestAccount";
import { upToBackLabel } from "../../client/src/lib/pointsCopy";

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
});
