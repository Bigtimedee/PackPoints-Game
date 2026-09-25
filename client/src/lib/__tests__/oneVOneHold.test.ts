import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { shouldHoldOneVOne } from "../oneVOneHold";

const lobbySrc = readFileSync(new URL("../../pages/lobby.tsx", import.meta.url), "utf8");
const matchSrc = readFileSync(new URL("../../pages/match.tsx", import.meta.url), "utf8");
const queueSrc = readFileSync(new URL("../../pages/queue.tsx", import.meta.url), "utf8");

describe("1v1 lobby hold", () => {
  it("holds a waiting lobby and a pre-active match the same as an active one", () => {
    expect(shouldHoldOneVOne({ surface: "lobby", lobbyOpen: false })).toBe(false);
    expect(shouldHoldOneVOne({
      surface: "lobby",
      lobbyOpen: true,
      lobbyStatus: "waiting",
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "match",
      matchStatus: "LOBBY",
      matchEnded: false,
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "match",
      matchStatus: "INITIALIZING",
      matchEnded: false,
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "match",
      matchStatus: null,
      matchEnded: false,
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "match",
      matchStatus: "ACTIVE",
      matchEnded: false,
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "queue",
      queuePhase: "searching",
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "queue",
      queuePhase: "matched",
    })).toBe(true);
    expect(shouldHoldOneVOne({
      surface: "queue",
      queuePhase: "idle",
    })).toBe(false);
    expect(lobbySrc).toContain("shouldHoldOneVOne");
    expect(matchSrc).toContain("shouldHoldOneVOne");
    expect(queueSrc).toContain("shouldHoldOneVOne");
  });
});
