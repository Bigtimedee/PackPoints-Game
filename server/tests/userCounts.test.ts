/**
 * userCounts.test.ts
 *
 * Fixture tests for honest registered-user math (staff + bot exclusion).
 * No live DB — do not invent production numbers here.
 */
import { describe, it, expect } from "vitest";
import {
  isHonestRegisteredUser,
  NEW_SIGNUPS_NON_STAFF_SQL,
  REGISTERED_USERS_NON_STAFF_SQL,
  summarizeUserCounts,
  USER_COUNT_DEFINITION,
} from "../services/userCounts";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("isHonestRegisteredUser", () => {
  it("keeps non-staff non-bot rows", () => {
    expect(isHonestRegisteredUser({ isAdmin: false, isBot: false })).toBe(true);
  });

  it("drops staff and bots", () => {
    expect(isHonestRegisteredUser({ isAdmin: true, isBot: false })).toBe(false);
    expect(isHonestRegisteredUser({ isAdmin: false, isBot: true })).toBe(false);
    expect(isHonestRegisteredUser({ isAdmin: true, isBot: true })).toBe(false);
  });
});

describe("summarizeUserCounts — staff + bot exclusion", () => {
  it("excludes staff and bots from the citable registered count", () => {
    const summary = summarizeUserCounts(
      [
        { isAdmin: false, isBot: false, createdAt: daysAgo(30) },
        { isAdmin: false, isBot: false, createdAt: daysAgo(2) },
        { isAdmin: true, isBot: false, createdAt: daysAgo(1) },
        { isAdmin: false, isBot: true, createdAt: daysAgo(1) },
      ],
      NOW,
    );

    expect(summary.registeredUsersNonStaff).toBe(2);
    expect(summary.staffUsers).toBe(1);
    expect(summary.botUsers).toBe(1);
    expect(summary.allUserRows).toBe(4);
    expect(summary.newSignupsNonStaff).toBe(1);
    expect(summary.newSignupsAllRows).toBe(3);
  });

  it("does not count a staff signup in the 7d honest window", () => {
    const summary = summarizeUserCounts(
      [{ isAdmin: true, isBot: false, createdAt: daysAgo(1) }],
      NOW,
    );
    expect(summary.registeredUsersNonStaff).toBe(0);
    expect(summary.newSignupsNonStaff).toBe(0);
    expect(summary.newSignupsAllRows).toBe(1);
  });
});

describe("documented SQL", () => {
  it("filters is_admin and is_bot on the registered-user query", () => {
    expect(REGISTERED_USERS_NON_STAFF_SQL).toContain("is_admin");
    expect(REGISTERED_USERS_NON_STAFF_SQL).toContain("is_bot");
    expect(NEW_SIGNUPS_NON_STAFF_SQL).toContain("is_admin");
    expect(NEW_SIGNUPS_NON_STAFF_SQL).toContain("is_bot");
  });

  it("tells Marketing to cite registeredUsersNonStaff only", () => {
    expect(USER_COUNT_DEFINITION.cite).toContain("registeredUsersNonStaff");
    expect(USER_COUNT_DEFINITION.doNotCite).toContain("all-rows users COUNT(*)");
  });
});
