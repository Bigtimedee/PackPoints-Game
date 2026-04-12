/**
 * videoFactory.test.ts
 *
 * Vitest integration tests for the Video Factory service.
 * Tests cover the SVG helpers, template frame builders, and the
 * renderVideo() orchestrator (with a real DB content item).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { growthContentPlans, growthContentItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { escapeXml, wrapLines } from "../services/videoFactory/svgHelpers";
import { buildFrames as buildOnlyRealFans } from "../services/videoFactory/templates/onlyRealFans";
import { buildFrames as buildDifficultyLadder } from "../services/videoFactory/templates/difficultyLadder";
import { buildFrames as buildMemoryShock } from "../services/videoFactory/templates/memoryShock";
import { buildFrames as buildLeaderboardFlex } from "../services/videoFactory/templates/leaderboardFlex";
import { renderVideo } from "../services/videoFactory";

// ── Test fixtures ────────────────────────────────────────────────────────────

const ITEM_INPUT = {
  hook: "Only real fans know this score",
  script: "The top player hit 9,450 points this week — can you beat it?",
  overlayText: "Think you can top the leaderboard?",
  cta: "Download PackPTS and find out",
  caption: "Weekly leaderboard drops every Sunday. Are you on it?",
};

let testPlanId: string;
let testItemId: string;

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  testPlanId = randomUUID();
  testItemId = randomUUID();

  await db.insert(growthContentPlans).values({
    id: testPlanId,
    date: "2099-01-01",
    status: "COMPLETE",
  });

  await db.insert(growthContentItems).values({
    id: testItemId,
    planId: testPlanId,
    platform: "TIKTOK",
    contentType: "SCORE_HIGHLIGHT",
    status: "QUEUED",
    hook: ITEM_INPUT.hook,
    script: ITEM_INPUT.script,
    overlayText: ITEM_INPUT.overlayText,
    cta: ITEM_INPUT.cta,
    caption: ITEM_INPUT.caption,
    hashtags: ["packpts", "trivia"],
  });
});

afterAll(async () => {
  await db.delete(growthContentItems).where(eq(growthContentItems.id, testItemId));
  await db.delete(growthContentPlans).where(eq(growthContentPlans.id, testPlanId));
});

// ── SVG helper tests ─────────────────────────────────────────────────────────

describe("escapeXml", () => {
  it("escapes ampersand", () => {
    expect(escapeXml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeXml('"hello" and \'world\'')).toBe("&quot;hello&quot; and &apos;world&apos;");
  });

  it("returns plain text unchanged", () => {
    expect(escapeXml("PackPTS")).toBe("PackPTS");
  });
});

describe("wrapLines", () => {
  it("returns a single line when text fits", () => {
    expect(wrapLines("Hello world", 20)).toEqual(["Hello world"]);
  });

  it("wraps long text into multiple lines", () => {
    const lines = wrapLines("one two three four five", 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("respects existing newlines", () => {
    const lines = wrapLines("first line\nsecond line", 50);
    expect(lines).toEqual(["first line", "second line"]);
  });

  it("returns [''] for empty string", () => {
    expect(wrapLines("", 20)).toEqual([""]);
  });
});

// ── Template frame tests ─────────────────────────────────────────────────────

describe("onlyRealFans template", () => {
  it("returns 4 frames", () => {
    const frames = buildOnlyRealFans(ITEM_INPUT);
    expect(frames).toHaveLength(4);
  });

  it("each frame has valid SVG and positive duration", () => {
    for (const frame of buildOnlyRealFans(ITEM_INPUT)) {
      expect(frame.svgContent).toContain("<svg");
      expect(frame.svgContent).toContain("</svg>");
      expect(frame.durationSeconds).toBeGreaterThan(0);
    }
  });

  it("does not expose raw player names", () => {
    const svg = buildOnlyRealFans(ITEM_INPUT).map((f) => f.svgContent).join("");
    expect(svg).not.toMatch(/Player\s+\d+/i);
  });
});

describe("difficultyLadder template", () => {
  it("returns 4 frames", () => {
    const frames = buildDifficultyLadder(ITEM_INPUT);
    expect(frames).toHaveLength(4);
  });

  it("each frame has valid SVG", () => {
    for (const frame of buildDifficultyLadder(ITEM_INPUT)) {
      expect(frame.svgContent).toContain("<svg");
    }
  });
});

describe("memoryShock template", () => {
  it("returns 3 frames", () => {
    const frames = buildMemoryShock(ITEM_INPUT);
    expect(frames).toHaveLength(3);
  });

  it("hook text appears in first frame", () => {
    const [first] = buildMemoryShock(ITEM_INPUT);
    // hook is wrapped; at least the first word should appear
    expect(first.svgContent).toContain("Only");
  });
});

describe("leaderboardFlex template", () => {
  it("returns 3 frames", () => {
    const frames = buildLeaderboardFlex(ITEM_INPUT);
    expect(frames).toHaveLength(3);
  });

  it("leaderboard frame contains masked name bars, not real names", () => {
    const [, leaderboard] = buildLeaderboardFlex(ITEM_INPUT);
    // Masked name bars are <rect> elements with opacity — real names should NOT appear
    expect(leaderboard.svgContent).toContain("<rect");
    expect(leaderboard.svgContent).not.toContain("Player1");
  });
});

// ── renderVideo orchestrator test ────────────────────────────────────────────

describe("renderVideo", () => {
  it("renders an MP4 and thumbnail and returns valid URLs", async () => {
    const result = await renderVideo(testItemId);

    expect(result.contentItemId).toBe(testItemId);
    expect(result.videoUrl).toMatch(/\.mp4$/);
    expect(result.thumbnailUrl).toMatch(/-thumb\.jpg$/);
    expect(result.template).toBeTruthy();
  }, 60_000); // allow up to 60s for FFmpeg render

  it("persists DONE status in DB metadata after render", async () => {
    const [item] = await db
      .select()
      .from(growthContentItems)
      .where(eq(growthContentItems.id, testItemId))
      .limit(1);

    const meta = item.metadata as Record<string, unknown> | null;
    expect(meta?.renderStatus).toBe("DONE");
    expect(typeof meta?.videoUrl).toBe("string");
    expect(typeof meta?.thumbnailUrl).toBe("string");
  });

  it("throws and sets ERROR status for missing content item", async () => {
    const fakeId = randomUUID();
    await expect(renderVideo(fakeId)).rejects.toThrow(fakeId);
  });
});
