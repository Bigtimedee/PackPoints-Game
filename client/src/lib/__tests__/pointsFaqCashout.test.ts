import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { addingAnswer, cashOutAnswer } from "../pointsCopy";

const base = { expiry: null, payoutMinimum: { cents: 1000, display: "$10" }, holdDays: 30 };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : /\.(tsx?|json)$/.test(f) ? [p] : [];
  });
}

describe("points FAQ", () => {
  it("cash-out answer shows only when rebates are live, with live values", () => {
    expect(cashOutAnswer({ rebateLive: false, ...base })).toBeNull();
    expect(cashOutAnswer({ rebateLive: true, ...base })).toBe("Once you have $10 in rebates that are at least 30 days old.");
    expect(cashOutAnswer({ rebateLive: true, ...base, payoutMinimum: { cents: 2500, display: "$25" }, holdDays: 14 })).toBe("Once you have $25 in rebates that are at least 14 days old.");
    expect(cashOutAnswer({ rebateLive: true, expiry: null })).toBeNull();
  });
  it("adding answer is soft, has no $ when not live, never says bought points don't count", () => {
    for (const live of [true, false]) {
      const a = addingAnswer(live, null);
      expect(a.toLowerCase()).not.toContain("bigger rebate");
      expect(a).not.toMatch(/[\u2013\u2014]/);
      expect(a.toLowerCase()).not.toMatch(/don't count|do not count|play only/);
      if (!live) expect(a).not.toContain("$");
    }
  });
  it("no client copy says 'bigger rebate'", () => {
    const root = new URL("../..", import.meta.url).pathname;
    for (const f of walk(root)) expect(readFileSync(f, "utf8").toLowerCase(), f).not.toContain("bigger rebate");
  });
});
