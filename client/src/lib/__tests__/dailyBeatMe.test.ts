import { afterEach, describe, expect, it } from "vitest";
import {
  buildDailyBeatMePath,
  buildDailyBeatMeUrl,
  formatBeatMeBanner,
  formatBeatMeCompare,
  formatBeatMeShareCaption,
  mapBeatMeApiResult,
  parseBeatMeToken,
  persistBeatMeChallenge,
  readPersistedBeatMeChallenge,
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

const TOKEN = "v1.abc.def";

describe("Daily 5 Beat-me URL contract", () => {
  it("builds the durable /daily challenge URL", () => {
    const path = buildDailyBeatMePath(TOKEN);
    expect(path.startsWith("/daily?")).toBe(true);
    const params = new URLSearchParams(path.slice("/daily?".length));
    expect(params.get("utm_source")).toBe("share");
    expect(params.get("utm_medium")).toBe("beatme");
    expect(params.get("utm_campaign")).toBe("daily5");
    expect(params.get("challenge")).toBe(TOKEN);
    expect(buildDailyBeatMeUrl(TOKEN)).toBe(`https://packpts.com${path}`);
  });

  it("reads the challenge token and ignores leftover query-score params", () => {
    expect(
      parseBeatMeToken(`?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge=${TOKEN}&s=9`),
    ).toBe(TOKEN);
    expect(parseBeatMeToken("?s=3&n=dave")).toBeUndefined();
  });

  it("uses Design Sync copy — active, stale, and quiet compare", () => {
    expect(
      formatBeatMeBanner({ status: "active", token: TOKEN, correctCount: 3, displayName: "dave" }),
    ).toBe("Beat dave — they went 3/5 today");
    expect(
      formatBeatMeBanner({ status: "stale", token: TOKEN, correctCount: 3, displayName: "dave" }),
    ).toBe("Challenge expired — play today's five.");
    expect(formatBeatMeShareCaption(3)).toBe("I went 3/5 on today's Daily 5.");
    expect(formatBeatMeCompare(4, 3)).toBe("You went 4/5. They went 3/5.");
    expect(formatBeatMeCompare(2, 5)).toBe("They went 5/5. You went 2/5.");
    expect(formatBeatMeCompare(3, 3)).toBe("You both went 3/5.");
  });

  it("persists a resolved token so /daily5 still shows context", () => {
    installMemoryStorage();
    const mapped = mapBeatMeApiResult(TOKEN, {
      status: "active",
      correctCount: 1,
      displayName: "Pat",
      puzzleDay: "2026-09-08",
      today: "2026-09-08",
    });
    expect(mapped?.status).toBe("active");
    expect(readPersistedBeatMeChallenge()?.token).toBe(TOKEN);
    persistBeatMeChallenge({
      status: "stale",
      token: TOKEN,
      correctCount: 4,
      puzzleDay: "2026-09-07",
      today: "2026-09-08",
    });
    expect(readPersistedBeatMeChallenge()?.status).toBe("stale");
  });
});
