/**
 * retentionCohorts.test.ts
 *
 * Fixture tests for admin D1/D7/D30:
 *   first event_log day (not signup), exact CT day-N return,
 *   staff + bot exclusion, pending windows.
 */
import { vi, describe, it, expect } from "vitest";

vi.mock("../db", () => ({ db: { execute: vi.fn() }, pool: {} }));

import { addPackptsDays, getPackptsDayKey, packptsMidnightUtc } from "@shared/packptsDay";
import {
  computeRetentionFromFixture,
  computeRetentionRate,
  fetchRetentionReport,
  isRetentionWindowMature,
  packptsIsoWeekStart,
} from "../services/retentionCohorts";
import { db } from "../db";

/** Monday 2026-06-01 is a CT Monday. */
const WEEK_A = "2026-06-01";
const WEEK_B = "2026-06-08";
const WEEK_C = "2026-06-15";

/** Instant inside a PackPTS day (noon CT). */
function atDay(dayKey: string, hourUtc = 17): Date {
  const start = packptsMidnightUtc(dayKey);
  return new Date(start.getTime() + hourUtc * 60 * 60 * 1000);
}

const USERS = [
  { id: "a", is_admin: false, is_bot: false },
  { id: "b", is_admin: false, is_bot: false },
  { id: "c", is_admin: false, is_bot: false },
  { id: "staff", is_admin: true, is_bot: false },
  { id: "bot", is_admin: false, is_bot: true },
];

describe("packptsIsoWeekStart / window maturity", () => {
  it("maps Sun/Mon/Sat onto the same Monday", () => {
    expect(packptsIsoWeekStart("2026-06-01")).toBe("2026-06-01");
    expect(packptsIsoWeekStart("2026-06-03")).toBe("2026-06-01");
    expect(packptsIsoWeekStart("2026-06-07")).toBe("2026-06-01");
    expect(packptsIsoWeekStart("2026-06-08")).toBe("2026-06-08");
  });

  it("holds D1 until the day after Sunday+1", () => {
    // Week ending Sun 2026-06-07; D1 last day = 2026-06-08
    expect(isRetentionWindowMature(WEEK_A, 1, "2026-06-08")).toBe(false);
    expect(isRetentionWindowMature(WEEK_A, 1, "2026-06-09")).toBe(true);
    expect(isRetentionWindowMature(WEEK_A, 7, "2026-06-14")).toBe(false);
    expect(isRetentionWindowMature(WEEK_A, 7, "2026-06-15")).toBe(true);
    expect(isRetentionWindowMature(WEEK_A, 30, "2026-07-07")).toBe(false);
    expect(isRetentionWindowMature(WEEK_A, 30, "2026-07-08")).toBe(true);
  });
});

describe("computeRetentionRate", () => {
  it("returns 0 when the cohort is empty", () => {
    expect(computeRetentionRate(3, 0)).toBe(0);
  });

  it("returns returned/size as a decimal", () => {
    expect(computeRetentionRate(1, 4)).toBe(0.25);
  });
});

describe("retention cohort fixture math", () => {
  it("cohorts on first event_log day, not an earlier unused signup", () => {
    // User a "signed up" conceptually on 2026-05-20 but first event is Mon 6/1.
    // Only the event clock is in the fixture — signup is intentionally absent.
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(WEEK_A) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
        { user_id: "b", created_at: atDay(WEEK_B) },
      ],
    });

    const weekA = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    const weekB = report.cohorts.find((c) => c.cohortWeek === WEEK_B);
    expect(weekA?.cohortSize).toBe(1);
    expect(weekA?.d1Returned).toBe(1);
    expect(weekA?.d1Rate).toBe(1);
    expect(weekB?.cohortSize).toBe(1);
    expect(weekB?.d1Returned).toBe(0);
    expect(weekB?.d1Rate).toBe(0);
  });

  it("counts D1 / D7 / D30 on the exact CT day, not nearby days", () => {
    const first = WEEK_A;
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(first) },
        { user_id: "a", created_at: atDay(addPackptsDays(first, 1)) }, // D1
        { user_id: "a", created_at: atDay(addPackptsDays(first, 6)) }, // not D7
        { user_id: "a", created_at: atDay(addPackptsDays(first, 8)) }, // not D7
        { user_id: "a", created_at: atDay(addPackptsDays(first, 30)) }, // D30
        { user_id: "b", created_at: atDay(first) },
        { user_id: "b", created_at: atDay(addPackptsDays(first, 7)) }, // D7 only
      ],
    });

    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    expect(row?.cohortSize).toBe(2);
    expect(row?.d1Returned).toBe(1);
    expect(row?.d7Returned).toBe(1);
    expect(row?.d30Returned).toBe(1);
    expect(row?.d1Rate).toBe(0.5);
    expect(row?.d7Rate).toBe(0.5);
    expect(row?.d30Rate).toBe(0.5);
  });

  it("does not treat first-active day itself as D1", () => {
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(WEEK_A, 14) },
        { user_id: "a", created_at: atDay(WEEK_A, 22) },
      ],
    });
    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    expect(row?.cohortSize).toBe(1);
    expect(row?.d1Returned).toBe(0);
    expect(row?.d1Rate).toBe(0);
  });

  it("excludes staff and bots from cohort size and returns", () => {
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "staff", created_at: atDay(WEEK_A) },
        { user_id: "staff", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
        { user_id: "bot", created_at: atDay(WEEK_A) },
        { user_id: "bot", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
        { user_id: "a", created_at: atDay(WEEK_A) },
      ],
    });
    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    expect(row?.cohortSize).toBe(1);
    expect(row?.d1Returned).toBe(0);
  });

  it("drops anonymous event_log rows and unknown user ids", () => {
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: null, created_at: atDay(WEEK_A) },
        { user_id: "ghost", created_at: atDay(WEEK_A) },
        { user_id: "ghost", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
      ],
    });
    expect(report.cohorts.find((c) => c.cohortWeek === WEEK_A)).toBeUndefined();
  });

  it("marks incomplete D1/D7/D30 as null, not 0", () => {
    // Today is Wednesday of WEEK_C — current week D1 is still pending
    // (Sunday + 1 has not finished).
    const now = atDay(addPackptsDays(WEEK_C, 2));
    expect(getPackptsDayKey(now)).toBe("2026-06-17");

    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(WEEK_C) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_C, 1)) },
      ],
      weekCount: 4,
    });

    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_C);
    expect(row?.cohortSize).toBe(1);
    expect(row?.d1Returned).toBe(1);
    expect(row?.d1Rate).toBeNull();
    expect(row?.d7Rate).toBeNull();
    expect(row?.d30Rate).toBeNull();
    expect(report.headlines.d1).toBeNull();
  });

  it("headlines pick the newest mature window, not the current pending week", () => {
    const now = atDay("2026-06-17"); // Wed of WEEK_C
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(WEEK_A) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
        { user_id: "b", created_at: atDay(WEEK_A) },
        { user_id: "c", created_at: atDay(WEEK_C) },
        { user_id: "c", created_at: atDay(addPackptsDays(WEEK_C, 1)) },
      ],
      weekCount: 4,
    });

    expect(report.headlines.d1).toEqual({
      cohortWeek: WEEK_A,
      cohortSize: 2,
      returned: 1,
      rate: 0.5,
    });
    // D7 for WEEK_A is mature by 2026-06-17; nobody returned on day 7 → 0%, not pending.
    expect(report.headlines.d7).toEqual({
      cohortWeek: WEEK_A,
      cohortSize: 2,
      returned: 0,
      rate: 0,
    });
    expect(report.headlines.d30).toBeNull();
  });

  it("dedupes multiple events on the same CT day", () => {
    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: atDay(WEEK_A, 14) },
        { user_id: "a", created_at: atDay(WEEK_A, 20) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1), 14) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1), 20) },
      ],
    });
    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    expect(row?.cohortSize).toBe(1);
    expect(row?.d1Returned).toBe(1);
  });

  it("maps live event_log rows through the same fixture math", async () => {
    // SQL already drops staff/bots; this proves the row → fixture mapping.
    vi.mocked(db.execute).mockResolvedValueOnce({
      rows: [
        { user_id: "a", created_at: atDay(WEEK_A) },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
        { user_id: "b", created_at: atDay(WEEK_A) },
      ],
    } as never);

    const report = await fetchRetentionReport(atDay("2026-07-15"));
    const row = report.cohorts.find((c) => c.cohortWeek === WEEK_A);
    expect(row?.cohortSize).toBe(2);
    expect(row?.d1Returned).toBe(1);
    expect(row?.d1Rate).toBe(0.5);
  });

  it("uses CT day keys across a UTC-date boundary (late-evening CT)", () => {
    // 2026-06-01 23:30 CT = 2026-06-02 04:30 UTC — still first-active Mon CT.
    const lateMonday = packptsMidnightUtc(WEEK_A);
    lateMonday.setTime(lateMonday.getTime() + 23.5 * 60 * 60 * 1000);
    expect(getPackptsDayKey(lateMonday)).toBe(WEEK_A);

    const now = atDay("2026-07-15");
    const report = computeRetentionFromFixture({
      now,
      users: USERS,
      events: [
        { user_id: "a", created_at: lateMonday },
        { user_id: "a", created_at: atDay(addPackptsDays(WEEK_A, 1)) },
      ],
    });
    expect(report.cohorts.find((c) => c.cohortWeek === WEEK_A)?.d1Returned).toBe(1);
  });
});
