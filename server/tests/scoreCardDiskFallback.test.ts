/**
 * P0 2026-10-30: Game Complete showed "Score card didn't load" and Retry
 * toasted "Could not generate the score card" when the share PNG write to the
 * volume failed. Disk is now a cache: generation succeeds without it and
 * /generated/share/<date>/<assetId>.png renders on demand from content_assets.
 */
import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("../db", () => ({ db: {} }));

import { writeSharePngBytes, renderScoreCardPng } from "../contentFactory/generateScoreCard";
import { renderStoredShareImage } from "../contentFactory/index";

const ID = "0b9c6a8e-1f2d-4c3b-9a7e-5d6f7a8b9c0d";

function asset(assetType: string, metadata: Record<string, unknown>) {
  return { id: ID, assetType, userId: "u1", sourceEventId: "x", metadata, imagePath: null, videoPath: null, createdAt: new Date() } as any;
}

describe("score card survives a refused disk write", () => {
  for (const code of ["ENOSPC", "EACCES", "EROFS"]) {
    it(`returns the share URL when the write fails with ${code}`, async () => {
      const png = await renderScoreCardPng({ username: "x", score: 30, correctCount: 3, totalQuestions: 5, mode: "daily5", date: "2026-10-30" });
      const out = await writeSharePngBytes(png, "2026-10-30", `${ID}.png`, async () => {
        throw Object.assign(new Error(code), { code });
      });
      expect(out.cached).toBe(false);
      expect(out.imageUrl).toBe(`/generated/share/2026-10-30/${ID}.png`);
    });
  }
});

describe("on-demand share image render", () => {
  it("renders a 1080x1350 PNG for a Daily 5 card and a solo card", async () => {
    for (const [type, mode, total] of [["DAILY5_RANK_CARD", "daily5", 5], ["SCORE_CARD", "solo", 10]] as const) {
      const png = await renderStoredShareImage(`${ID}.png`, async () =>
        asset(type, { score: 40, correctCount: 4, totalQuestions: total, mode, date: "2026-10-30" }));
      expect(png).not.toBeNull();
      const meta = await sharp(png!).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([1080, 1350]);
    }
  });

  it("refuses non score-card assets, unknown ids and path tricks", async () => {
    expect(await renderStoredShareImage(`${ID}.png`, async () => asset("MAKER_SHARE_CARD", {}))).toBeNull();
    expect(await renderStoredShareImage(`${ID}.png`, async () => null)).toBeNull();
    const load = vi.fn();
    expect(await renderStoredShareImage("../../etc/passwd", load)).toBeNull();
    expect(await renderStoredShareImage("play-sets.png", load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
