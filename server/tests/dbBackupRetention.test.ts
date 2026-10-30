import { describe, it, expect } from "vitest";
import { selectDailyToPrune, DAILY_KEEP } from "../services/dbBackupService";

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString();

describe("daily DB backup retention", () => {
  it("keeps 7 daily dumps", () => expect(DAILY_KEEP).toBe(7));

  it("prunes only daily dumps beyond the newest 7", () => {
    const daily = Array.from({ length: 30 }, (_, i) => ({ name: `daily-${i}.dump`, mtime: day(i) }));
    const prepush = Array.from({ length: 14 }, (_, i) => ({ name: `pre-push-${i}.dump`, mtime: day(i) }));
    const victims = selectDailyToPrune([...daily, ...prepush]);
    expect(victims).toHaveLength(23);
    expect(victims.every((n) => n.startsWith("daily-"))).toBe(true);
    for (let i = 23; i < 30; i++) expect(victims).not.toContain(`daily-${i}.dump`);
  });

  it("no-op at or under 7", () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({ name: `daily-${i}.dump`, mtime: day(i) }));
    expect(selectDailyToPrune(daily)).toEqual([]);
  });

  it("never deletes the most recent backup even with keep=0", () => {
    const b = [{ name: "daily-a.dump", mtime: day(2) }, { name: "daily-b.dump", mtime: day(1) }];
    expect(selectDailyToPrune(b, 0)).toEqual(["daily-b.dump"]);
  });
});
