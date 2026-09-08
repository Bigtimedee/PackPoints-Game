import { describe, expect, it } from "vitest";
import {
  buildBeatMePath,
  parseBeatMeCorrectCount,
  resolveBeatMeToken,
  signBeatMeToken,
  verifyBeatMeToken,
} from "../lib/daily5BeatMeToken";

describe("Daily 5 Beat-me token", () => {
  const puzzleDay = "2026-09-08";

  it("signs a real 0–5 session score onto a CT puzzle_day", () => {
    const token = signBeatMeToken({
      correctCount: 3,
      puzzleDay,
      displayName: "dave",
      userId: "user-1",
    });
    expect(token.startsWith("v1.")).toBe(true);
    expect(verifyBeatMeToken(token)).toEqual({
      v: 1,
      s: 3,
      d: puzzleDay,
      n: "dave",
      u: "user-1",
    });
  });

  it("refuses fake / out-of-range scores and non-CT day keys", () => {
    expect(parseBeatMeCorrectCount(6)).toBeUndefined();
    expect(() => signBeatMeToken({ correctCount: 6, puzzleDay })).toThrow();
    expect(() => signBeatMeToken({ correctCount: 3, puzzleDay: "09/08/2026" })).toThrow();
  });

  it("treats a mismatched puzzle_day as stale against today's CT key", () => {
    const token = signBeatMeToken({ correctCount: 4, puzzleDay: "2026-09-07", displayName: "Pat" });
    expect(resolveBeatMeToken(token, "2026-09-08")).toEqual({
      status: "stale",
      puzzleDay: "2026-09-07",
      today: "2026-09-08",
      correctCount: 4,
      displayName: "Pat",
    });
    expect(resolveBeatMeToken(token, "2026-09-07").status).toBe("active");
  });

  it("rejects tampered tokens", () => {
    const token = signBeatMeToken({ correctCount: 2, puzzleDay });
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    payload.s = 5;
    const tampered = `v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
    expect(verifyBeatMeToken(tampered)).toBeNull();
    expect(resolveBeatMeToken("not-a-token").status).toBe("invalid");
  });

  it("builds the durable /daily challenge URL with Beat-me UTM", () => {
    const token = signBeatMeToken({ correctCount: 1, puzzleDay });
    const path = buildBeatMePath(token);
    expect(path.startsWith("/daily?")).toBe(true);
    const params = new URLSearchParams(path.slice("/daily?".length));
    expect(params.get("utm_source")).toBe("share");
    expect(params.get("utm_medium")).toBe("beatme");
    expect(params.get("utm_campaign")).toBe("daily5");
    expect(params.get("challenge")).toBe(token);
  });
});
