/**
 * Daily 5 fixed calendar: date -> set mapping, config override, and the
 * runtime resolver's held / too-few-cards fallback. Pure, no DB.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../storage", () => ({ isKnownSilhouetteUrl: () => false }));

import {
  DAILY5_CALENDAR_START,
  DAILY5_FALLBACK_SET_ID_DEFAULT,
  DAILY5_GREEN_SET_IDS_DEFAULT,
  DAILY5_RELEASED_EXPANSION_START,
  daily5CalendarConfig,
  daily5ConfigForDate,
  daily5GreenSetIds,
  daily5Weekday,
  daily5WeeklyTemplate,
  daysSinceCalendarStart,
  scheduledDaily5Set,
  WEEKDAYS,
} from "../services/daily5Calendar";
import { resolveDaily5SetForDate, type Daily5ResolverDeps } from "../services/daily5SetPick";
import { addPackptsDays } from "@shared/packptsDay";

const T89 = "352b33d1-c110-4e09-b641-8e3c02a94442";
const F87 = "91cfdf3f-a620-4e73-adc8-22b8df221716";
const F94 = "a09b2fe7-728e-431b-9df8-bbf2652aa3b2";
const B24 = "229f0379-aa56-40a8-abe3-1af217a397e8";
const EXTRA1 = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
const EXTRA2 = "74885a41-2043-4b7c-ab58-f9e16c05e2e3";
const T86 = "2b77043a-6583-4d79-b59d-d2ab20291a17"; // 1986 Topps
const D87 = "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4"; // 1987 Donruss
const FLEER89 = "855e8125-4169-5d0b-b04c-3513feae9637"; // 1989 Fleer
const FLEER86 = "891b39b8-0058-5e55-9837-6e4830c55d32"; // 1986 Fleer
const D89 = "d6997c20-0880-5119-80d2-9ce8c9b4727e"; // 1989 Donruss
const T90 = "97456b32-7b68-56fe-971a-1c821e2b09c4"; // 1990 Topps

const defaults = daily5CalendarConfig({});

describe("Daily 5 calendar mapping", () => {
  it("defaults to the three GREEN sets and 2024 Basketball as fallback", () => {
    expect(DAILY5_CALENDAR_START).toBe("2026-10-05");
    expect(daily5Weekday(DAILY5_CALENDAR_START)).toBe(0);
    expect(defaults.greenSetIds).toEqual([T89, F87, F94]);
    expect(defaults.fallbackSetId).toBe(B24);
    expect(DAILY5_FALLBACK_SET_ID_DEFAULT).toBe(B24);
    expect([...DAILY5_GREEN_SET_IDS_DEFAULT]).toEqual([T89, F87, F94]);
  });

  it("maps Mon Oct 5 .. Sun Oct 18 2026 to the agreed week", () => {
    const expected = [T89, B24, F87, B24, F94, T89, B24];
    for (let i = 0; i < 14; i++) {
      const date = addPackptsDays("2026-10-05", i);
      const s = scheduledDaily5Set(date, defaults)!;
      expect(s.weekday).toBe(WEEKDAYS[i % 7]);
      expect(s.setId).toBe(expected[i % 7]);
      expect(s.slot).toBe(expected[i % 7] === B24 ? "fallback" : "green");
    }
    expect(scheduledDaily5Set("2026-10-05", defaults)!.setId).toBe(T89);
  });

  it("is deterministic for any date and keeps legacy before the start", () => {
    expect(scheduledDaily5Set("2026-10-02", defaults)).toBeNull();
    expect(scheduledDaily5Set("2026-10-03", defaults)).toBeNull();
    expect(scheduledDaily5Set("2026-10-04", defaults)).toBeNull();
    expect(scheduledDaily5Set("2027-03-15", defaults)).toEqual(scheduledDaily5Set("2027-03-15", defaults));
    // DST change (Nov 1 2026) does not shift the weekday.
    expect(scheduledDaily5Set("2026-11-02", defaults)!.weekday).toBe("Mon");
    expect(scheduledDaily5Set("2026-11-02", defaults)!.setId).toBe(T89);
  });

  it("never puts a GREEN set on two days in a row for 1..9 sets", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    for (let n = 1; n <= 9; n++) {
      const config = { greenSetIds: ids.slice(0, n), fallbackSetId: B24 };
      const seen = new Set<string>();
      let prev: string | null = null;
      for (let d = 0; d < 7 * 12; d++) {
        const s = scheduledDaily5Set(addPackptsDays(DAILY5_CALENDAR_START, d), config)!;
        if (s.slot === "green") {
          expect(s.setId).not.toBe(prev);
          seen.add(s.setId);
        }
        prev = s.slot === "green" ? s.setId : null;
      }
      expect(seen.size).toBe(n);
    }
  });

  it("weekly templates match the documented shapes", () => {
    expect(daily5WeeklyTemplate(0)).toEqual([null, null, null, null, null, null, null]);
    expect(daily5WeeklyTemplate(1)).toEqual([0, null, null, null, null, 0, null]);
    expect(daily5WeeklyTemplate(3)).toEqual([0, null, 1, null, 2, 0, null]);
    expect(daily5WeeklyTemplate(5)).toEqual([0, 3, 1, 4, 2, 0, null]);
    expect(daily5WeeklyTemplate(6)).toEqual([0, 3, 1, 4, 2, 0, 5]);
    expect(daily5WeeklyTemplate(7)).toEqual([0, 3, 1, 4, 2, 6, 5]);
  });
});

describe("Daily 5 calendar config override", () => {
  it("reads DAILY5_GREEN_SET_IDS in order, trims, lowercases, drops junk and duplicates", () => {
    const env = { DAILY5_GREEN_SET_IDS: ` ${F94.toUpperCase()} ,nope,${T89},${F94},` };
    expect(daily5GreenSetIds(env)).toEqual([F94, T89]);
  });

  it("falls back to the code default when unset, blank, or all invalid", () => {
    expect(daily5GreenSetIds({})).toEqual([T89, F87, F94]);
    expect(daily5GreenSetIds({ DAILY5_GREEN_SET_IDS: "  " })).toEqual([T89, F87, F94]);
    expect(daily5GreenSetIds({ DAILY5_GREEN_SET_IDS: "x,y" })).toEqual([T89, F87, F94]);
  });

  it("adding sets by env only turns fallback days GREEN, existing GREEN days stay", () => {
    const env = { DAILY5_GREEN_SET_IDS: [T89, F87, F94, EXTRA1, EXTRA2].join(",") };
    const config = daily5CalendarConfig(env);
    const week = Array.from({ length: 7 }, (_, i) => scheduledDaily5Set(addPackptsDays("2026-10-05", i), config)!.setId);
    expect(week).toEqual([T89, EXTRA1, F87, EXTRA2, F94, T89, B24]);
  });

  it("never schedules the fallback id as a GREEN slot", () => {
    const env = { DAILY5_GREEN_SET_IDS: [T89, B24, F87, F94].join(",") };
    expect(daily5GreenSetIds(env)).toEqual([T89, F87, F94]);
  });

  it("places one released expansion on later open weekdays and leaves earlier days alone", () => {
    const fleer = FLEER86;
    expect(DAILY5_RELEASED_EXPANSION_START).toBe("2026-11-16");
    const beforeKey = "2026-11-10";
    expect(daily5Weekday(beforeKey)).toBe(1);
    const before = daily5ConfigForDate(beforeKey, defaults, [fleer]);
    expect(before).toBe(defaults);
    expect(scheduledDaily5Set(beforeKey, before)).toEqual(scheduledDaily5Set(beforeKey, defaults));
    expect(scheduledDaily5Set(beforeKey, before)!.setId).toBe(B24);
    expect(scheduledDaily5Set("2026-10-06", daily5ConfigForDate("2026-10-06", defaults, [fleer]))!.setId).toBe(B24);

    expect(daily5Weekday(DAILY5_RELEASED_EXPANSION_START)).toBe(0);
    const opened = daily5ConfigForDate(DAILY5_RELEASED_EXPANSION_START, defaults, [fleer]);
    expect(opened.greenSetIds).toEqual([T89, F87, F94]);
    expect(opened.rotationSetIds).toEqual([fleer]);
    expect(scheduledDaily5Set(DAILY5_RELEASED_EXPANSION_START, opened)!.setId).toBe(T89);
    expect(scheduledDaily5Set("2026-11-18", opened)!.setId).toBe(F87);
    expect(scheduledDaily5Set("2026-11-20", opened)!.setId).toBe(F94);
    expect(scheduledDaily5Set("2026-11-21", opened)!.setId).toBe(T89);
    expect(scheduledDaily5Set("2026-11-23", daily5ConfigForDate("2026-11-23", defaults, [fleer]))!.setId).toBe(T89);
    const tuesday = "2026-11-17";
    expect(daily5Weekday(tuesday)).toBe(1);
    expect(scheduledDaily5Set(tuesday, daily5ConfigForDate(tuesday, defaults, [fleer]))).toMatchObject({
      setId: fleer,
      slot: "green",
    });
    expect(scheduledDaily5Set("2026-11-19", opened)!.setId).toBe(fleer);
    expect(scheduledDaily5Set("2026-11-22", opened)!.setId).toBe(fleer);
  });

  it("leaves the calendar unchanged when the expansion rotation is empty", () => {
    const base4 = { greenSetIds: [T89, F87, T86, D87], fallbackSetId: B24 };
    for (const date of ["2026-11-09", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-19", "2026-11-29"]) {
      expect(daily5ConfigForDate(date, defaults, [])).toBe(defaults);
      expect(daily5ConfigForDate(date, base4, [])).toBe(base4);
      expect(daily5ConfigForDate(date, base4, ["nope", B24, T89])).toBe(base4);
      expect(scheduledDaily5Set(date, daily5ConfigForDate(date, defaults, []))).toEqual(scheduledDaily5Set(date, defaults));
      expect(scheduledDaily5Set(date, daily5ConfigForDate(date, base4, []))).toEqual(scheduledDaily5Set(date, base4));
    }
  });

  it("keeps a 4-set green week and rotates expansions through Thu and Sun", () => {
    // 1989 Topps, 1987 Topps (slot 1, 1987 Topps Football), 1986 Topps, 1987 Donruss.
    const base4 = { greenSetIds: [T89, F87, T86, D87], fallbackSetId: B24 };
    const expansions = [FLEER89, FLEER86, D89, T90];
    const anchored = new Set([0, 1, 2, 4, 5]);
    for (let i = 0; i < 21; i++) {
      const date = addPackptsDays("2026-11-09", i);
      const plain = scheduledDaily5Set(date, base4)!;
      const dated = daily5ConfigForDate(date, base4, expansions);
      const scheduled = scheduledDaily5Set(date, dated)!;
      expect(dated.greenSetIds).toEqual(base4.greenSetIds);
      const weekday = daily5Weekday(date);
      if (date < DAILY5_RELEASED_EXPANSION_START || anchored.has(weekday)) {
        expect(scheduled).toEqual(plain);
        continue;
      }
      expect(dated.rotationSetIds).toEqual(expansions);
      const week = Math.floor(daysSinceCalendarStart(date) / 7);
      const template = daily5WeeklyTemplate(base4.greenSetIds.length, week);
      const free = template.flatMap((slot, index) => (slot == null ? [index] : []));
      const k = free.indexOf(weekday);
      expect(free).toEqual([3, 6]);
      expect(scheduled).toMatchObject({
        setId: expansions[(k + free.length * week) % expansions.length],
        slot: "green",
      });
      expect(scheduled.setId).not.toBe(B24);
    }

    const pick = (date: string) => scheduledDaily5Set(date, daily5ConfigForDate(date, base4, expansions))!.setId;
    expect(pick("2026-11-12")).toBe(B24);
    expect(pick("2026-11-15")).toBe(B24);
    expect(pick("2026-11-16")).toBe(T89);
    expect(pick("2026-11-17")).toBe(D87);
    expect(pick("2026-11-18")).toBe(F87);
    expect(pick("2026-11-19")).toBe(FLEER89);
    expect(pick("2026-11-20")).toBe(T86);
    expect(pick("2026-11-21")).toBe(T89);
    expect(pick("2026-11-22")).toBe(FLEER86);
    expect(pick("2026-11-26")).toBe(D89);
    expect(pick("2026-11-29")).toBe(T90);
  });

  it("keeps the 3-default weekdays when four expansions would have made the list 7 long", () => {
    const expansions = [FLEER89, FLEER86, D89, T90];
    const opened = daily5ConfigForDate("2026-11-16", defaults, expansions);
    expect(opened.greenSetIds).toEqual([T89, F87, F94]);
    expect(opened.rotationSetIds).toEqual(expansions);
    const anchored = new Set([0, 2, 4, 5]);
    for (let i = 0; i < 14; i++) {
      const date = addPackptsDays("2026-11-16", i);
      const weekday = daily5Weekday(date);
      const scheduled = scheduledDaily5Set(date, daily5ConfigForDate(date, defaults, expansions))!;
      const plain = scheduledDaily5Set(date, defaults)!;
      if (anchored.has(weekday)) {
        expect(scheduled.setId).toBe(plain.setId);
      } else {
        const week = Math.floor(daysSinceCalendarStart(date) / 7);
        const free = daily5WeeklyTemplate(3, week).flatMap((slot, index) => (slot == null ? [index] : []));
        const k = free.indexOf(weekday);
        expect(scheduled.setId).toBe(expansions[(k + free.length * week) % expansions.length]);
      }
    }
  });

  it("DAILY5_FALLBACK_SET_ID overrides the fallback", () => {
    const config = daily5CalendarConfig({ DAILY5_FALLBACK_SET_ID: EXTRA1 });
    expect(config.fallbackSetId).toBe(EXTRA1);
    expect(scheduledDaily5Set("2026-10-06", config)!.setId).toBe(EXTRA1);
  });
});

function deps(over: Partial<Daily5ResolverDeps> & {
  held?: string[];
  counts?: Record<string, number>;
  inactive?: string[];
} = {}): Daily5ResolverDeps {
  const counts = over.counts ?? {};
  return {
    config: () => defaults,
    legacyPick: async () => ({ id: EXTRA1, setName: "1987 Topps" }),
    refreshHeld: async () => {},
    isHeld: (id) => (over.held ?? []).includes(id),
    describe: async (id) => ({ id, setName: `set ${id.slice(0, 8)}`, isActive: !(over.inactive ?? []).includes(id), isUserCreated: false }),
    dealableCount: async (id) => counts[id] ?? 100,
    ...over,
  };
}

describe("Daily 5 resolver", () => {
  it("uses the legacy pick before the calendar start (today and this weekend unchanged)", async () => {
    const legacyPick = vi.fn(async () => ({ id: EXTRA1, setName: "1987 Topps" }));
    for (const date of ["2026-10-02", "2026-10-03", "2026-10-04"]) {
      const choice = await resolveDaily5SetForDate(date, deps({ legacyPick }));
      expect(choice?.id).toBe(EXTRA1);
      expect(choice?.source).toBe("legacy");
    }
    expect(legacyPick).toHaveBeenCalledTimes(3);
  });

  it("deals the scheduled GREEN set on Mon Oct 5", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-05", deps());
    expect(choice).toMatchObject({ id: T89, source: "scheduled", slot: "green", skipped: [] });
  });

  it("deals the fallback on a fallback day", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-06", deps());
    expect(choice).toMatchObject({ id: B24, source: "fallback", slot: "fallback" });
  });

  it("does not deal a missing expansion set even when it is scheduled and dealable", async () => {
    const fleer = "891b39b8-0058-5e55-9837-6e4830c55d32";
    const choice = await resolveDaily5SetForDate("2026-10-05", deps({
      config: () => ({ greenSetIds: [fleer], fallbackSetId: B24 }),
    }));
    expect(choice?.id).toBe(B24);
    expect(choice?.skipped[0]).toEqual({ id: fleer, reason: "expansion_not_enrolled" });
  });

  it("skips a held scheduled set for the fallback", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-07", deps({ held: [F87] }));
    expect(choice).toMatchObject({ id: B24, source: "fallback", scheduledSetId: F87 });
    expect(choice?.skipped).toEqual([{ id: F87, reason: "held" }]);
  });

  it("skips a set that cannot deal 5 clean cards for the fallback", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-09", deps({ counts: { [F94]: 4 } }));
    expect(choice).toMatchObject({ id: B24, source: "fallback", scheduledSetId: F94 });
    expect(choice?.skipped).toEqual([{ id: F94, reason: "too_few_cards" }]);
  });

  it("skips an inactive scheduled set", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-05", deps({ inactive: [T89] }));
    expect(choice?.id).toBe(B24);
    expect(choice?.skipped).toEqual([{ id: T89, reason: "inactive" }]);
  });

  it("uses the legacy pick as a last resort when the fallback is also unusable", async () => {
    const choice = await resolveDaily5SetForDate("2026-10-05", deps({ held: [T89], counts: { [B24]: 2 } }));
    expect(choice).toMatchObject({ id: EXTRA1, source: "last_resort" });
    expect(choice?.skipped).toEqual([
      { id: T89, reason: "held" },
      { id: B24, reason: "too_few_cards" },
    ]);
  });

  it("returns null rather than an empty deal when nothing can deal 5", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const choice = await resolveDaily5SetForDate("2026-10-06", deps({ counts: { [B24]: 0, [EXTRA1]: 3 } }));
    expect(choice).toBeNull();
    spy.mockRestore();
  });
});
