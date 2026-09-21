/**
 * Guest registration gate: thresholds, escrow claim, and the honest
 * registered-user count. No database — the server calls these functions.
 */
import { describe, it, expect } from "vitest";
import {
  ANON_CONVERSION_SQL,
  ANON_GATE_CODE,
  ANON_GATE_COPY,
  anonGateDeniedBody,
  anonStartAllowed,
  applyCompletedGame,
  noteAnonStart,
  creditIfNew,
  emptyAnonSnapshot,
  evaluateAnonGate,
  planEscrowClaim,
  summarizeAnonConversion,
  toPublicAnonGate,
} from "@shared/anonGate";
import {
  isHonestRegisteredUser,
  REGISTERED_USERS_NON_STAFF_SQL,
  summarizeUserCounts,
} from "../services/userCounts";

const TODAY = "2026-09-21";
const YESTERDAY = "2026-09-20";

function played(
  surface: "daily5" | "sets" | "solo",
  points: number,
  row = emptyAnonSnapshot(),
  today = TODAY,
) {
  return applyCompletedGame(row, {
    surface,
    points,
    correct: 3,
    answers: surface === "daily5" ? 5 : 10,
    today,
  });
}

describe("anon gate thresholds", () => {
  it("lets a new guest start", () => {
    const gate = evaluateAnonGate({ gamesCompleted: 0, lastPlayDay: null, today: TODAY });
    expect(gate.phase).toBe("open");
    expect(gate.canStart).toBe(true);
    expect(gate.prompt).toBe("none");
  });

  it("soft-prompts after one Daily 5 and still allows the next start", () => {
    const row = played("daily5", 40);
    expect(row.daily5Completed).toBe(1);
    expect(row.gamesCompleted).toBe(1);
    expect(row.escrowPoints).toBe(40);
    const gate = evaluateAnonGate({
      gamesCompleted: row.gamesCompleted,
      lastPlayDay: row.lastPlayDay,
      today: TODAY,
    });
    expect(gate.phase).toBe("soft");
    expect(gate.canStart).toBe(true);
    expect(gate.reason).toBe("after_first_game");
  });

  it("soft-prompts after one /sets play the same way", () => {
    const row = played("sets", 80);
    expect(row.setsPlaysCompleted).toBe(1);
    expect(row.daily5Completed).toBe(0);
    const gate = evaluateAnonGate({
      gamesCompleted: row.gamesCompleted,
      lastPlayDay: row.lastPlayDay,
      today: TODAY,
    });
    expect(gate).toMatchObject({ phase: "soft", canStart: true });
  });

  it("hard-stops a new start after two completed rounds", () => {
    const row = played("sets", 25, played("daily5", 40));
    expect(row.gamesCompleted).toBe(2);
    expect(row.escrowPoints).toBe(65);
    const gate = evaluateAnonGate({
      gamesCompleted: row.gamesCompleted,
      lastPlayDay: row.lastPlayDay,
      today: TODAY,
    });
    expect(gate.phase).toBe("hard");
    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe("game_cap");
  });

  it("hard-stops a next-day return even after a single guest round", () => {
    const gate = evaluateAnonGate({
      gamesCompleted: 1,
      lastPlayDay: YESTERDAY,
      today: TODAY,
    });
    expect(gate.phase).toBe("hard");
    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe("next_day");
  });

  it("does not treat a visitor who never started a round as a next-day block", () => {
    const gate = evaluateAnonGate({ gamesCompleted: 0, gamesStarted: 0, lastPlayDay: null, today: TODAY });
    expect(gate.canStart).toBe(true);
  });

  it("hard-stops a next-day return after a start that was never finished", () => {
    const row = noteAnonStart(emptyAnonSnapshot(), YESTERDAY);
    const gate = evaluateAnonGate({ ...row, today: TODAY });
    expect(row.gamesCompleted).toBe(0);
    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe("next_day");
  });

  it("stops a third start even when earlier rounds were abandoned", () => {
    let row = emptyAnonSnapshot();
    expect(evaluateAnonGate({ ...row, today: TODAY }).canStart).toBe(true);
    row = noteAnonStart(row, TODAY);
    expect(evaluateAnonGate({ ...row, today: TODAY }).canStart).toBe(true);
    expect(evaluateAnonGate({ ...row, today: TODAY }).prompt).toBe("none");
    row = noteAnonStart(row, TODAY);
    const gate = evaluateAnonGate({ ...row, today: TODAY });
    expect(row.gamesCompleted).toBe(0);
    expect(gate.canStart).toBe(false);
    expect(gate.reason).toBe("game_cap");
  });

  it("allows Daily 5 resume after the hard gate, and still blocks a new solo start", () => {
    const hard = evaluateAnonGate({ gamesCompleted: 2, lastPlayDay: TODAY, today: TODAY });
    expect(anonStartAllowed(hard, true)).toBe(true);
    expect(anonStartAllowed(hard, false)).toBe(false);
  });

  it("counts a solo round toward the same cap as Daily 5 and /sets", () => {
    const row = played("solo", 10);
    expect(row.soloPlaysCompleted).toBe(1);
    expect(evaluateAnonGate({
      gamesCompleted: row.gamesCompleted,
      lastPlayDay: row.lastPlayDay,
      today: TODAY,
    }).phase).toBe("soft");
  });
});

describe("escrow claim", () => {
  it("plans a one-time wallet credit for unclaimed points", () => {
    const row = played("sets", 80);
    const plan = planEscrowClaim(row);
    expect(plan.alreadyClaimed).toBe(false);
    expect(plan.creditPoints).toBe(80);
    expect(plan.games).toBe(1);
    expect(plan.answers).toBe(10);
  });

  it("does not credit a second claim", () => {
    const row = { ...played("daily5", 50), claimedAt: "2026-09-21T18:00:00.000Z" };
    const plan = planEscrowClaim(row);
    expect(plan.alreadyClaimed).toBe(true);
    expect(plan.creditPoints).toBe(0);
    expect(plan.games).toBe(0);
  });

  it("does not keep accruing after the row is claimed", () => {
    const claimed = { ...played("sets", 15), claimedAt: new Date("2026-09-21T18:00:00.000Z") };
    const again = applyCompletedGame(claimed, {
      surface: "sets",
      points: 100,
      correct: 1,
      answers: 5,
      today: TODAY,
    });
    expect(again.escrowPoints).toBe(15);
    expect(again.gamesCompleted).toBe(1);
  });

  it("credits a round once when the same completion is retried", () => {
    const first = creditIfNew(emptyAnonSnapshot(), {
      surface: "daily5",
      points: 30,
      correct: 2,
      answers: 5,
      today: TODAY,
    }, false);
    expect(first.applied).toBe(true);
    expect(first.row.escrowPoints).toBe(30);
    const retry = creditIfNew(first.row, {
      surface: "daily5",
      points: 30,
      correct: 2,
      answers: 5,
      today: TODAY,
    }, true);
    expect(retry.applied).toBe(false);
    expect(retry.row.escrowPoints).toBe(30);
    expect(retry.row.gamesCompleted).toBe(1);
  });

  it("refuses the next start with the hard-wall code", () => {
    const gate = toPublicAnonGate({ gamesCompleted: 2, lastPlayDay: TODAY, escrowPoints: 12 }, TODAY);
    const body = anonGateDeniedBody(gate);
    expect(body.code).toBe(ANON_GATE_CODE);
    expect(body.error).toBe(ANON_GATE_COPY.hardTitle);
    expect(body.canStart).toBe(false);
    expect(body.escrowPoints).toBe(12);
  });
});

describe("registeredUsersNonStaff ignores anon", () => {
  it("drops an anonymous row even when it is not staff and not a bot", () => {
    expect(isHonestRegisteredUser({ isAdmin: false, isBot: false, isAnonymous: true })).toBe(false);
    expect(isHonestRegisteredUser({ isAdmin: false, isBot: false })).toBe(true);
  });

  it("does not add guest identities to the citable registered count", () => {
    const summary = summarizeUserCounts([
      { isAdmin: false, isBot: false },
      { isAdmin: false, isBot: false, isAnonymous: true },
      { isAdmin: true, isBot: false },
      { isAdmin: false, isBot: true },
    ]);
    expect(summary.registeredUsersNonStaff).toBe(1);
    expect(summary.allUserRows).toBe(4);
  });

  it("keeps the registered-user SQL on users and the conversion SQL on anon_players", () => {
    expect(REGISTERED_USERS_NON_STAFF_SQL).toMatch(/FROM users/);
    expect(REGISTERED_USERS_NON_STAFF_SQL).not.toMatch(/FROM anon_players/i);
    expect(REGISTERED_USERS_NON_STAFF_SQL).toContain("is_admin");
    expect(REGISTERED_USERS_NON_STAFF_SQL).toContain("is_bot");
    expect(ANON_CONVERSION_SQL).toMatch(/FROM anon_players/);
    expect(ANON_CONVERSION_SQL).not.toMatch(/FROM users/);
  });

  it("reports anon→register conversion separately from registered users", () => {
    const conversion = summarizeAnonConversion([
      { gamesCompleted: 2, claimedAt: "2026-09-21T00:00:00.000Z" },
      { gamesCompleted: 1, claimedAt: null },
      { gamesCompleted: 0, claimedAt: null },
      { gamesCompleted: 0, claimedAt: "2026-09-21T00:00:00.000Z" },
    ]);
    expect(conversion.anonIdentities).toBe(4);
    expect(conversion.anonPlayed).toBe(2);
    expect(conversion.claimedPlayed).toBe(1);
    expect(conversion.unclaimedPlayed).toBe(1);
    expect(conversion.conversionRate).toBe(0.5);
    expect(conversion.anonIdentities).not.toBe(conversion.claimedPlayed);
  });
});

describe("gate copy", () => {
  it("names the soft one-more-round prompt and the hard wall", () => {
    expect(ANON_GATE_COPY.softBody).toContain("one more round");
    expect(ANON_GATE_COPY.softSecondary).toBe("Play one more round");
    expect(ANON_GATE_COPY.hardTitle).toBe("Register to keep playing");
    expect(ANON_GATE_COPY.nextDayBody.toLowerCase()).toContain("new day");
  });
});
