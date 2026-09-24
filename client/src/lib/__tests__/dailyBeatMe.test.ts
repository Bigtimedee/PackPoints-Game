import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  BEAT_ME_COPY,
  buildDailyBeatMePath,
  buildDailyBeatMeUrl,
  dismissBeatMeBanner,
  formatBeatMeBanner,
  formatBeatMeCompare,
  formatBeatMeShareCaption,
  isBeatMeBannerDismissed,
  isBeatMeShareUrl,
  mapBeatMeApiResult,
  parseBeatMeToken,
  persistBeatMeChallenge,
  readPersistedBeatMeChallenge,
} from "../dailyBeatMe";

const gameSrc = readFileSync(new URL("../../pages/game.tsx", import.meta.url), "utf8");
const daily5Src = readFileSync(new URL("../../pages/daily5.tsx", import.meta.url), "utf8");

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
    expect(isBeatMeShareUrl(`https://packpts.com${path}`)).toBe(true);
    expect(isBeatMeShareUrl("https://packpts.com/daily")).toBe(false);
    expect(isBeatMeShareUrl("https://packpts.com/daily?s=3&n=dave")).toBe(false);
  });

  it("reads the challenge token and ignores leftover query-score params", () => {
    expect(
      parseBeatMeToken(`?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge=${TOKEN}&s=9`),
    ).toBe(TOKEN);
    expect(parseBeatMeToken("?s=3&n=dave")).toBeUndefined();
  });

  it("uses Design SoR copy — active, stale, anonymous, and quiet compare", () => {
    expect(
      formatBeatMeBanner({ status: "active", token: TOKEN, correctCount: 4, displayName: "Alex" }),
    ).toBe("Beat Alex — they went 4/5 today");
    expect(
      formatBeatMeBanner({ status: "active", token: TOKEN, correctCount: 4 }),
    ).toBe("Beat a collector — they went 4/5 today");
    const stale = formatBeatMeBanner({
      status: "stale",
      token: TOKEN,
      correctCount: 4,
      displayName: "Alex",
    });
    expect(stale).toBe("Challenge expired — play today's five.");
    expect(stale).not.toMatch(/4\/5/);
    expect(stale).not.toContain("Alex");
    expect(formatBeatMeShareCaption(3)).toBe("I went 3/5. Beat me. Play today's Daily 5.");
    expect(formatBeatMeCompare(5, 4)).toBe("You went 5/5. They went 4/5.");
    expect(formatBeatMeCompare(2, 4)).toBe("They led — 4/5 to your 2/5.");
    expect(formatBeatMeCompare(3, 3)).toBe("Tied at 3/5.");
    expect(BEAT_ME_COPY.primary).toBe("Beat me.");
    expect(BEAT_ME_COPY.helper).toBe("Challenge a friend to today's five.");
    expect(BEAT_ME_COPY.browseSets).toBe("Browse sets");
    expect(BEAT_ME_COPY.browseHref).toBe("/sets");
  });

  it("drops invalid tokens and keeps stale without treating the score as a client input", () => {
    expect(mapBeatMeApiResult(TOKEN, { status: "invalid", correctCount: 5 })).toBeNull();
    expect(mapBeatMeApiResult(TOKEN, {})).toBeNull();
    const stale = mapBeatMeApiResult(TOKEN, {
      status: "stale",
      correctCount: 4,
      displayName: "Alex",
      puzzleDay: "2026-09-22",
      today: "2026-09-23",
    });
    expect(stale?.status).toBe("stale");
    expect(formatBeatMeBanner(stale!)).not.toMatch(/4\/5/);
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
    dismissBeatMeBanner(TOKEN);
    expect(isBeatMeBannerDismissed(TOKEN)).toBe(true);
    expect(readPersistedBeatMeChallenge()?.correctCount).toBe(4);
  });
});

describe("Beat-me surfaces ban PackPoints-flavored challenge copy", () => {
  it("kills the points-on-PackPTS residue in solo challenge text", () => {
    expect(gameSrc).not.toMatch(/points on PackPTS/);
    expect(gameSrc).not.toMatch(/PackPoints/);
    expect(gameSrc).not.toMatch(/Think you can beat me/);
    expect(gameSrc).toMatch(/on PackPTS/);
  });

  it("locks Daily 5 Beat me chrome to the signed URL and quiet compare", () => {
    expect(daily5Src).toContain('apiRequest("POST", "/api/daily5/beat-me")');
    expect(daily5Src).toContain('fetch(`/api/daily5/beat-me?challenge=');
    expect(daily5Src).toContain('data-testid="button-d5-beat-me"');
    expect(daily5Src).toContain("BEAT_ME_COPY.primary");
    expect(daily5Src).toContain("BEAT_ME_COPY.browseHref");
    expect(daily5Src).toContain('beatMe?.status === "active"');
    expect(daily5Src).toContain("formatBeatMeCompare");
    expect(daily5Src).not.toContain('shareUrl={beatMeUrl ?? "https://packpts.com/daily"}');
    expect(daily5Src).not.toMatch(/https:\/\/packpts\.com\/daily(?!\?)/);
    expect(daily5Src).not.toMatch(/PackPoints/);
    expect(daily5Src).not.toMatch(/points on PackPTS/);
    expect(daily5Src).not.toMatch(/Maker Rate/);
    expect(daily5Src).not.toMatch(/href="\/make"/);
    expect(daily5Src).not.toMatch(/YOU WIN/i);
    const bannerStart = daily5Src.indexOf("function BeatMeBanner");
    const bannerEnd = daily5Src.indexOf("async function pngFileFromUrl");
    const banner = daily5Src.slice(bannerStart, bannerEnd);
    expect(banner).toContain("formatBeatMeBanner");
    expect(banner).not.toContain("correctCount");
  });
});
