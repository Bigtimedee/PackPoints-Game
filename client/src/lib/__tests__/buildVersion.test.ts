import { describe, expect, it } from "vitest";
import {
  chunkReloadGuardId,
  decideStaleReload,
  hasReloadedForBuild,
  isActiveGameRoute,
  isChunkLoadErrorMessage,
  isGameSubmitRequest,
  isUpdatePending,
  pickBuildId,
  readBuildIdFromIndexHtml,
  rememberReloadedBuild,
  selectServedBuildId,
  shouldFetchBuildVersion,
  upsertBuildIdMeta,
  versionCheckUrl,
  type StaleReloadInput,
} from "@shared/buildVersion";

function input(overrides: Partial<StaleReloadInput> = {}): StaleReloadInput {
  return {
    trigger: "focus",
    embeddedBuildId: "aaa",
    serverBuildId: "bbb",
    updatePending: false,
    pathname: "/",
    targetPath: "/",
    submitting: false,
    daily5Playing: false,
    inProgressCard: false,
    reloadedBuildIds: null,
    ...overrides,
  };
}

describe("versionCheckUrl", () => {
  it("busts the cache key on every poll", () => {
    expect(versionCheckUrl(1_700_000_000_000)).toBe("/api/version?t=1700000000000");
  });
});

describe("pickBuildId", () => {
  it("prefers an explicit id, then Railway, then git, then a timestamp", () => {
    expect(pickBuildId({
      explicit: "from-build",
      railwaySha: "railway",
      gitSha: "gitsha",
      now: 5,
    })).toBe("from-build");
    expect(pickBuildId({ railwaySha: "railway", gitSha: "gitsha", now: 5 })).toBe("railway");
    expect(pickBuildId({ gitSha: "abc123", now: 5 })).toBe("abc123");
    expect(pickBuildId({ now: 5 })).toBe("t5");
  });
});

describe("served index build id", () => {
  it("round-trips the meta tag and prefers it over the runtime fallback", () => {
    const html = upsertBuildIdMeta("<html><head><title>PackPTS</title></head><body></body></html>", "deadbeef");
    expect(readBuildIdFromIndexHtml(html)).toBe("deadbeef");
    expect(selectServedBuildId(readBuildIdFromIndexHtml(html), "other")).toBe("deadbeef");
    expect(selectServedBuildId(null, "fallback")).toBe("fallback");
  });
});

describe("isUpdatePending", () => {
  it("is pending only when both ids are present and differ", () => {
    expect(isUpdatePending("aaa", "bbb")).toBe(true);
    expect(isUpdatePending("aaa", "aaa")).toBe(false);
    expect(isUpdatePending("aaa", null)).toBe(false);
    expect(isUpdatePending("", "bbb")).toBe(false);
  });
});

describe("shouldFetchBuildVersion", () => {
  it("throttles focus, visibility, online, and the interval to 60s and always allows navigation and safe points", () => {
    expect(shouldFetchBuildVersion({ reason: "focus", now: 1_000, lastFetchAt: null })).toBe(true);
    expect(shouldFetchBuildVersion({ reason: "focus", now: 30_000, lastFetchAt: 0 })).toBe(false);
    expect(shouldFetchBuildVersion({ reason: "visibility", now: 59_999, lastFetchAt: 0 })).toBe(false);
    expect(shouldFetchBuildVersion({ reason: "online", now: 59_999, lastFetchAt: 0 })).toBe(false);
    expect(shouldFetchBuildVersion({ reason: "interval", now: 59_999, lastFetchAt: 0 })).toBe(false);
    expect(shouldFetchBuildVersion({ reason: "visibility", now: 60_000, lastFetchAt: 0 })).toBe(true);
    expect(shouldFetchBuildVersion({ reason: "interval", now: 60_000, lastFetchAt: 0 })).toBe(true);
    expect(shouldFetchBuildVersion({ reason: "navigation", now: 1_000, lastFetchAt: 500 })).toBe(true);
    expect(shouldFetchBuildVersion({ reason: "safe-point", now: 1_000, lastFetchAt: 500 })).toBe(true);
  });
});

describe("isActiveGameRoute", () => {
  it("holds only while a card is in play, not for the whole game route", () => {
    expect(isActiveGameRoute({ pathname: "/game/solo", daily5Playing: false, inProgressCard: true })).toBe(true);
    expect(isActiveGameRoute({ pathname: "/game/solo", daily5Playing: false, inProgressCard: false })).toBe(false);
    expect(isActiveGameRoute({ pathname: "/game/ranked", daily5Playing: false, inProgressCard: true })).toBe(true);
    expect(isActiveGameRoute({ pathname: "/match/abc", daily5Playing: false, inProgressCard: true })).toBe(true);
    expect(isActiveGameRoute({ pathname: "/match/abc", daily5Playing: false, inProgressCard: false })).toBe(false);
    expect(isActiveGameRoute({ pathname: "/daily5", daily5Playing: true, inProgressCard: false })).toBe(true);
    expect(isActiveGameRoute({ pathname: "/daily", daily5Playing: false, inProgressCard: false })).toBe(false);
    expect(isActiveGameRoute({ pathname: "/", daily5Playing: false, inProgressCard: true })).toBe(true);
    expect(isActiveGameRoute({ pathname: "/leaderboard", daily5Playing: false, inProgressCard: false })).toBe(false);
  });
});

describe("decideStaleReload", () => {
  it("reloads on an interval away from a live question and holds while a card is in progress", () => {
    expect(decideStaleReload(input()).reload).toBe(true);
    expect(decideStaleReload(input({ trigger: "interval" })).reload).toBe(true);
    expect(decideStaleReload(input({ trigger: "online" })).reload).toBe(true);
    const live = decideStaleReload(input({
      trigger: "interval",
      pathname: "/game/solo",
      targetPath: "/game/solo",
      inProgressCard: true,
    }));
    expect(live.reload).toBe(false);
    expect(live.updatePending).toBe(true);
    expect(decideStaleReload(input({
      pathname: "/game/solo",
      targetPath: "/game/solo",
    })).reload).toBe(true);
    expect(decideStaleReload(input({
      pathname: "/match/1",
      targetPath: "/match/1",
      inProgressCard: true,
    })).reload).toBe(false);
    expect(decideStaleReload(input({
      pathname: "/daily5",
      targetPath: "/daily5",
      daily5Playing: true,
    })).reload).toBe(false);
    expect(decideStaleReload(input({ pathname: "/daily", targetPath: "/daily" })).reload).toBe(true);
  });

  it("reloads at Next Question or Game Complete without dropping an in-flight answer", () => {
    const next = decideStaleReload(input({
      trigger: "safe-point",
      pathname: "/game/solo",
      targetPath: "/game/solo",
      inProgressCard: true,
    }));
    expect(next.reload).toBe(true);
    expect(next.reloadBuildId).toBe("bbb");
    expect(decideStaleReload(input({
      trigger: "safe-point",
      pathname: "/game/solo",
      targetPath: "/game/solo",
      inProgressCard: true,
      submitting: true,
    })).reload).toBe(false);
  });

  it("reloads into the next route, including when leaving a game, and skips a no-op path change", () => {
    const leave = decideStaleReload(input({
      trigger: "navigation",
      pathname: "/game/solo",
      targetPath: "/leaderboard",
      inProgressCard: true,
    }));
    expect(leave.reload).toBe(true);
    expect(leave.reloadBuildId).toBe("bbb");

    const same = decideStaleReload(input({
      trigger: "navigation",
      pathname: "/game/solo",
      targetPath: "/game/solo?session=1",
    }));
    expect(same.reload).toBe(false);
    expect(same.updatePending).toBe(true);
  });

  it("never reloads during a submit", () => {
    expect(decideStaleReload(input({ submitting: true })).reload).toBe(false);
    expect(decideStaleReload(input({
      trigger: "navigation",
      pathname: "/",
      targetPath: "/store",
      submitting: true,
    })).reload).toBe(false);
    expect(decideStaleReload(input({ trigger: "chunk-error", submitting: true })).reload).toBe(false);
  });

  it("reloads once per server build id", () => {
    const first = decideStaleReload(input());
    expect(first.reload).toBe(true);
    const stored = first.nextReloadedBuildIds;
    expect(hasReloadedForBuild(stored, "bbb")).toBe(true);
    expect(decideStaleReload(input({ reloadedBuildIds: stored, updatePending: true })).reload).toBe(false);
    expect(decideStaleReload(input({
      reloadedBuildIds: stored,
      serverBuildId: "ccc",
    })).reload).toBe(true);
    expect(rememberReloadedBuild(stored, "ccc")).toBe("bbb,ccc");
  });

  it("reloads once for a chunk load failure tied to the embedded build", () => {
    const first = decideStaleReload(input({
      trigger: "chunk-error",
      serverBuildId: null,
      embeddedBuildId: "aaa",
    }));
    expect(first.reload).toBe(true);
    expect(first.reloadBuildId).toBe(chunkReloadGuardId("aaa"));
    expect(decideStaleReload(input({
      trigger: "chunk-error",
      serverBuildId: null,
      embeddedBuildId: "aaa",
      reloadedBuildIds: first.nextReloadedBuildIds,
    })).reload).toBe(false);
  });

  it("defers a chunk error during a question until the next safe point", () => {
    const deferred = decideStaleReload(input({
      trigger: "chunk-error",
      serverBuildId: null,
      embeddedBuildId: "aaa",
      inProgressCard: true,
    }));
    expect(deferred.reload).toBe(false);
    expect(deferred.chunkPending).toBe(true);
    const later = decideStaleReload(input({
      trigger: "safe-point",
      serverBuildId: null,
      embeddedBuildId: "aaa",
      inProgressCard: true,
      chunkPending: true,
    }));
    expect(later.reload).toBe(true);
    expect(later.reloadBuildId).toBe(chunkReloadGuardId("aaa"));
    expect(decideStaleReload(input({
      trigger: "safe-point",
      serverBuildId: null,
      embeddedBuildId: "aaa",
      chunkPending: true,
      reloadedBuildIds: later.nextReloadedBuildIds,
    })).reload).toBe(false);
  });

  it("does not reload when the server id is missing or already matches", () => {
    expect(decideStaleReload(input({ serverBuildId: null })).reload).toBe(false);
    expect(decideStaleReload(input({ serverBuildId: "aaa" })).updatePending).toBe(false);
    expect(decideStaleReload(input({ serverBuildId: "aaa" })).reload).toBe(false);
  });
});

describe("submit and chunk helpers", () => {
  it("recognizes answer submits and dynamic import failures", () => {
    expect(isGameSubmitRequest("POST", "/api/game/answer")).toBe(true);
    expect(isGameSubmitRequest("POST", "/api/daily5/answer")).toBe(true);
    expect(isGameSubmitRequest("POST", "/api/daily5/finish")).toBe(true);
    expect(isGameSubmitRequest("POST", "/api/matches/abc/answer")).toBe(true);
    expect(isGameSubmitRequest("GET", "/api/game/answer")).toBe(false);
    expect(isGameSubmitRequest("POST", "/api/store/checkout")).toBe(false);
    expect(isChunkLoadErrorMessage("Failed to fetch dynamically imported module: /assets/game-abc.js")).toBe(true);
    expect(isChunkLoadErrorMessage("Network down")).toBe(false);
  });
});
