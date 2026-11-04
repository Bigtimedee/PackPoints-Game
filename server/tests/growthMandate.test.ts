import { describe, expect, it } from "vitest";
import { buildTrackedUrl, isApprovedPackptsAsset } from "../services/growthAgent/create";
import { calculateQdauPerThousand, selectWinningCreatives } from "../services/growthAgent/learn";
import { rankSignals } from "../services/growthAgent/listen";

describe("Growth Agent mandate helpers", () => {
  it("builds creative-level attribution URLs", () => {
    const url = new URL(
      buildTrackedUrl({
        siteUrl: "https://packpts.com/",
        destinationPath: "/daily5",
        platform: "TIKTOK",
        creativeId: "creative-123",
      }),
    );

    expect(url.origin).toBe("https://packpts.com");
    expect(url.pathname).toBe("/daily5");
    expect(url.searchParams.get("utm_source")).toBe("tiktok");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("growth_agent");
    expect(url.searchParams.get("utm_content")).toBe("creative-123");
  });

  it("allows only PackPTS-owned or PackPTS-generated asset paths", () => {
    expect(isApprovedPackptsAsset("/generated/share/2026-10-02/a.png")).toBe(true);
    expect(isApprovedPackptsAsset("/generated/videos/2026-10-02/a.mp4")).toBe(true);
    expect(isApprovedPackptsAsset("/daily5-masked-1080.png")).toBe(true);
    expect(isApprovedPackptsAsset("https://random.example/image.png")).toBe(false);
    expect(isApprovedPackptsAsset(null)).toBe(false);
  });

  it("calculates qualified DAUs per thousand impressions", () => {
    expect(calculateQdauPerThousand(25, 10_000)).toBe(2.5);
    expect(calculateQdauPerThousand(0, 10_000)).toBe(0);
    expect(calculateQdauPerThousand(10, 0)).toBe(0);
  });

  it("ranks signals by score", () => {
    const ranked = rankSignals(
      [{ score: 20, id: "low" }, { score: 90, id: "high" }, { score: 50, id: "mid" }],
      2,
    );
    expect(ranked.map((item) => item.id)).toEqual(["high", "mid"]);
  });

  it("selects winning creatives by qualified DAU efficiency", () => {
    const winners = selectWinningCreatives(
      [
        {
          creativeId: "a",
          platform: "X",
          contentType: "CHALLENGE",
          impressions: 500,
          clicks: 10,
          signups: 5,
          gameStarts: 5,
          activations: 4,
          d1Retained: 2,
          d7Retained: 1,
          qdauPerThousand: 8,
        },
        {
          creativeId: "b",
          platform: "TIKTOK",
          contentType: "CHALLENGE",
          impressions: 500,
          clicks: 20,
          signups: 10,
          gameStarts: 8,
          activations: 8,
          d1Retained: 5,
          d7Retained: 2,
          qdauPerThousand: 16,
        },
      ],
      1,
      100,
    );

    expect(winners[0]?.creativeId).toBe("b");
  });
});
