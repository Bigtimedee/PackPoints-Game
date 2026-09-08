import { afterEach, describe, expect, it } from "vitest";
import {
  buildDailyBeatMePath,
  buildDailyBeatMeUrl,
  formatBeatMeBanner,
  formatBeatMeShareCaption,
  parseBeatMeCorrectCount,
  parseDailyBeatMeParams,
  persistBeatMeChallenge,
  readPersistedBeatMeChallenge,
  resolveBeatMeChallenge,
  sanitizeBeatMeName,
} from "../dailyBeatMe";

const memory = new Map<string, string>();

afterEach(() => {
  memory.clear();
});

function installMemoryStorage() {
  const store: Storage = {
    get length() {
      return memory.size;
    },
    clear() {
      memory.clear();
    },
    getItem(key) {
      return memory.has(key) ? memory.get(key)! : null;
    },
    key(index) {
      return [...memory.keys()][index] ?? null;
    },
    removeItem(key) {
      memory.delete(key);
    },
    setItem(key, value) {
      memory.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: store,
  });
}

describe("Daily 5 Beat-me URL contract", () => {
  it("builds a stable /daily deep link from a real X/5 session score", () => {
    expect(buildDailyBeatMePath({ correctCount: 3, displayName: "dave" })).toBe(
      "/daily?s=3&n=dave",
    );
    expect(buildDailyBeatMeUrl({ correctCount: 0, displayName: "Ada" })).toBe(
      "https://packpts.com/daily?s=0&n=Ada",
    );
  });

  it("omits name when missing and refuses fake / out-of-range scores", () => {
    expect(buildDailyBeatMePath({ correctCount: 4 })).toBe("/daily?s=4");
    expect(buildDailyBeatMePath({ correctCount: 6 })).toBe("/daily");
    expect(buildDailyBeatMePath({ correctCount: -1 })).toBe("/daily");
    expect(buildDailyBeatMePath({ correctCount: 3.5 })).toBe("/daily");
    expect(buildDailyBeatMePath({ correctCount: "4/5" })).toBe("/daily");
    expect(parseBeatMeCorrectCount("5")).toBe(5);
    expect(parseBeatMeCorrectCount("99")).toBeUndefined();
  });

  it("parses challenge context and ignores unrelated params (ref, date)", () => {
    expect(parseDailyBeatMeParams("?s=3&n=dave&ref=abc123")).toEqual({
      correctCount: 3,
      displayName: "dave",
    });
    expect(parseDailyBeatMeParams("s=2&n=Pat&d=2020-01-01")).toEqual({
      correctCount: 2,
      displayName: "Pat",
    });
    expect(parseDailyBeatMeParams("?ref=only")).toBeNull();
    expect(parseDailyBeatMeParams("?s=9&n=dave")).toBeNull();
  });

  it("sanitizes display names to the username charset", () => {
    expect(sanitizeBeatMeName(" dave_1 ")).toBe("dave_1");
    expect(sanitizeBeatMeName("<script>")).toBe("script");
    expect(sanitizeBeatMeName("!!!")).toBeUndefined();
    expect(sanitizeBeatMeName("a".repeat(40))).toHaveLength(20);
  });

  it("uses quiet recipient / sender copy — no fake streaks", () => {
    expect(formatBeatMeBanner({ correctCount: 3, displayName: "dave" })).toBe(
      "dave went 3/5 — Beat them",
    );
    expect(formatBeatMeBanner({ correctCount: 5 })).toBe("A player went 5/5 — Beat them");
    expect(formatBeatMeShareCaption({ correctCount: 3 })).toBe(
      "I went 3/5 on today's Daily 5.",
    );
  });

  it("persists URL challenge so auth / /daily5 still shows context", () => {
    installMemoryStorage();
    expect(resolveBeatMeChallenge("?s=1&n=Pat")).toEqual({
      correctCount: 1,
      displayName: "Pat",
    });
    expect(readPersistedBeatMeChallenge()).toEqual({
      correctCount: 1,
      displayName: "Pat",
    });
    expect(resolveBeatMeChallenge("")).toEqual({
      correctCount: 1,
      displayName: "Pat",
    });
    persistBeatMeChallenge({ correctCount: 4, displayName: "jo" });
    expect(readPersistedBeatMeChallenge()?.correctCount).toBe(4);
  });
});
