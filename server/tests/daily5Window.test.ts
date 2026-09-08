/**
 * Daily 5 CT window reconcile: rows created with UTC-midnight startsAt/endsAt
 * must be rewritten to America/Chicago midnights and activated during CT daytime.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../storage", () => ({ isKnownSilhouetteUrl: () => false }));
vi.mock("../services/packpts/ledgerService", () => ({ applyLedgerEntry: vi.fn() }));

import { getDailyStartEnd, packptsMidnightUtc } from "@shared/packptsDay";
import {
  daily5StatusForNow,
  reconcileDailyChallengeFields,
} from "../services/daily5Service";

describe("Daily 5 CT window reconcile", () => {
  const date = "2026-09-08";
  const utcMidnightStart = new Date("2026-09-09T00:00:00.000Z");
  const utcMidnightEnd = new Date("2026-09-10T00:00:00.000Z");
  // 2026-09-08 13:00 CDT — live prod was still SCHEDULED ("starts in 8h")
  const daytimeCt = new Date("2026-09-08T18:00:00.000Z");

  it("rewrites UTC midnights to CT and marks ACTIVE during Chicago daytime", () => {
    const patch = reconcileDailyChallengeFields(
      {
        date,
        startsAt: utcMidnightStart,
        endsAt: utcMidnightEnd,
        status: "SCHEDULED",
      },
      daytimeCt,
    );

    expect(patch).not.toBeNull();
    expect(patch!.startsAt.toISOString()).toBe(packptsMidnightUtc(date).toISOString());
    expect(patch!.endsAt.toISOString()).toBe(packptsMidnightUtc("2026-09-09").toISOString());
    expect(patch!.startsAt.toISOString()).toBe("2026-09-08T05:00:00.000Z");
    expect(patch!.endsAt.toISOString()).toBe("2026-09-09T05:00:00.000Z");
    expect(patch!.status).toBe("ACTIVE");
    expect(daily5StatusForNow(patch!.startsAt, patch!.endsAt, daytimeCt)).toBe("ACTIVE");
  });

  it("activates a CT-correct window left as SCHEDULED after start time", () => {
    const { startsAt, endsAt } = getDailyStartEnd(date);
    const patch = reconcileDailyChallengeFields(
      { date, startsAt, endsAt, status: "SCHEDULED" },
      daytimeCt,
    );
    expect(patch).not.toBeNull();
    expect(patch!.startsAt.getTime()).toBe(startsAt.getTime());
    expect(patch!.endsAt.getTime()).toBe(endsAt.getTime());
    expect(patch!.status).toBe("ACTIVE");
  });

  it("is a no-op when windows and status already match CT now", () => {
    const { startsAt, endsAt } = getDailyStartEnd(date);
    expect(
      reconcileDailyChallengeFields(
        { date, startsAt, endsAt, status: "ACTIVE" },
        daytimeCt,
      ),
    ).toBeNull();
  });
});
