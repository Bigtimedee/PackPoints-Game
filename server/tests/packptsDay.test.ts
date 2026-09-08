import { describe, expect, it } from "vitest";
import {
  addPackptsDays,
  getPackptsDayKey,
  isPackptsDayKey,
  msUntilPackptsMidnight,
  PACKPTS_DAY_TZ,
  packptsMidnightUtc,
} from "@shared/packptsDay";

describe("PackPTS product day (America/Chicago)", () => {
  it("locks the product timezone to Chicago", () => {
    expect(PACKPTS_DAY_TZ).toBe("America/Chicago");
  });

  it("formats YYYY-MM-DD in CT, not UTC, around the CST/UTC boundary", () => {
    // 2026-01-15 05:30 UTC = 2026-01-14 23:30 CST
    const lateCst = new Date("2026-01-15T05:30:00.000Z");
    expect(getPackptsDayKey(lateCst)).toBe("2026-01-14");
    expect(lateCst.toISOString().slice(0, 10)).toBe("2026-01-15");

    // 2026-01-15 06:30 UTC = 2026-01-15 00:30 CST
    expect(getPackptsDayKey(new Date("2026-01-15T06:30:00.000Z"))).toBe("2026-01-15");
  });

  it("does not use America/New_York for the day key", () => {
    // 2026-01-15 05:30 UTC = Jan 15 00:30 EST, but still Jan 14 in Chicago
    const at = new Date("2026-01-15T05:30:00.000Z");
    const ny = at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const ct = getPackptsDayKey(at);
    expect(ny).toBe("2026-01-15");
    expect(ct).toBe("2026-01-14");
  });

  it("computes CT midnight instants that match the day key", () => {
    const start = packptsMidnightUtc("2026-01-15");
    expect(getPackptsDayKey(start)).toBe("2026-01-15");
    expect(getPackptsDayKey(new Date(start.getTime() - 1))).toBe("2026-01-14");
    expect(addPackptsDays("2026-01-15", 1)).toBe("2026-01-16");
    expect(isPackptsDayKey("2026-09-08")).toBe(true);
    expect(isPackptsDayKey("09-08-2026")).toBe(false);
  });

  it("counts down to the next CT midnight", () => {
    const justAfter = new Date(packptsMidnightUtc("2026-07-04").getTime() + 60_000);
    const ms = msUntilPackptsMidnight(justAfter);
    expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
