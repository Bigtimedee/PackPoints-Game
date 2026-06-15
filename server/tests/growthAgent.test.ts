/**
 * growthAgent.test.ts
 *
 * Integration tests for the Growth Agent service.
 * Tests schema validation, idempotency (deduplication), and job run tracking.
 *
 * NOTE: These tests require a live DB connection and will insert/delete real rows.
 * The OpenAI calls are mocked to avoid external API usage and cost.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  growthContentPlans,
  growthContentItems,
  growthJobRuns,
  publishingQueue,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { runDailyGrowthJob } from "../services/growthAgent";

// ──────────────────────────────────────────────────────────────
// Mock OpenAI so tests never hit the real API
// ──────────────────────────────────────────────────────────────

const FAKE_PLAN_RESPONSE = {
  themes: ["score highlights", "streak milestones"],
  goals: "Drive downloads via viral score clips.",
  summary: "Today we focus on big scores and streaks.",
};

const FAKE_ITEM_RESPONSE = {
  caption: "Test caption for unit test",
  hashtags: ["#PackPTS", "#BaseballCards"],
  hook: "Test hook",
  script: "Test script [scene 1]",
  overlayText: "Test overlay",
  cta: "Download now",
  assetRefs: [{ label: "Score card", description: "Screenshot of top score" }],
  metadata: {},
};

vi.mock("openai", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: "" } }],
  });

  return {
    default: vi.fn().mockImplementation(function() {
      return {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      };
    }),
    __mockCreate: mockCreate,
  };
});

// Return plan JSON for the first call, item JSON for subsequent calls
async function setupOpenAIMock() {
  const openaiModule = await import("openai");
  const mockCreate = (openaiModule as any).__mockCreate as ReturnType<typeof vi.fn>;
  mockCreate
    .mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(FAKE_PLAN_RESPONSE) } }],
    })
    .mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(FAKE_ITEM_RESPONSE) } }],
    });
}

// ──────────────────────────────────────────────────────────────
// Cleanup helper
// ──────────────────────────────────────────────────────────────

async function cleanupDate(date: string) {
  // Find all plans for this date
  const plans = await db
    .select({ id: growthContentPlans.id })
    .from(growthContentPlans)
    .where(eq(growthContentPlans.date, date));

  for (const plan of plans) {
    const items = await db
      .select({ id: growthContentItems.id })
      .from(growthContentItems)
      .where(eq(growthContentItems.planId, plan.id));

    for (const item of items) {
      await db.delete(publishingQueue).where(eq(publishingQueue.contentItemId, item.id));
    }
    await db.delete(growthContentItems).where(eq(growthContentItems.planId, plan.id));
  }
  await db.delete(growthContentPlans).where(eq(growthContentPlans.date, date));
  await db.delete(growthJobRuns).where(eq(growthJobRuns.targetDate, date));
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("runDailyGrowthJob", () => {
  const testDate = `2099-01-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`;

  beforeEach(async () => {
    await cleanupDate(testDate);
    await setupOpenAIMock();
  });

  afterEach(async () => {
    await cleanupDate(testDate);
  });

  it("creates a COMPLETE plan and content items on first run", async () => {
    const result = await runDailyGrowthJob(testDate);

    expect(result.status).toBe("COMPLETE");
    expect(result.planId).toBeTruthy();
    expect(result.itemsGenerated).toBeGreaterThan(0);

    // Plan row exists and is COMPLETE
    const [plan] = await db
      .select()
      .from(growthContentPlans)
      .where(eq(growthContentPlans.id, result.planId));

    expect(plan).toBeDefined();
    expect(plan.status).toBe("COMPLETE");
    expect(plan.date).toBe(testDate);
    expect(Array.isArray(plan.themes)).toBe(true);
    expect((plan.themes as string[]).length).toBeGreaterThan(0);

    // Content items exist
    const items = await db
      .select()
      .from(growthContentItems)
      .where(eq(growthContentItems.planId, result.planId));

    expect(items.length).toBe(result.itemsGenerated);

    // All DRAFT items should be in the publishing queue
    const draftItems = items.filter((i) => i.status === "DRAFT");
    for (const item of draftItems) {
      const [queueRow] = await db
        .select()
        .from(publishingQueue)
        .where(eq(publishingQueue.contentItemId, item.id));
      expect(queueRow).toBeDefined();
      expect(queueRow.status).toBe("PENDING");
    }

    // Job run is COMPLETE
    const [jobRun] = await db
      .select()
      .from(growthJobRuns)
      .where(eq(growthJobRuns.id, result.jobRunId));

    expect(jobRun).toBeDefined();
    expect(jobRun.status).toBe("COMPLETE");
    expect(jobRun.itemsGenerated).toBe(result.itemsGenerated);
  });

  it("is idempotent — second call returns existing plan without recreating items", async () => {
    // First run
    const first = await runDailyGrowthJob(testDate);
    expect(first.status).toBe("COMPLETE");

    // Reset mock for second call (should not be called for AI)
    await setupOpenAIMock();

    // Second run
    const second = await runDailyGrowthJob(testDate);
    expect(second.status).toBe("COMPLETE");
    expect(second.planId).toBe(first.planId);
    expect(second.itemsGenerated).toBe(first.itemsGenerated);

    // Only one plan exists for this date
    const plans = await db
      .select()
      .from(growthContentPlans)
      .where(and(eq(growthContentPlans.date, testDate), eq(growthContentPlans.status, "COMPLETE")));

    expect(plans.length).toBe(1);
  });

  it("records a FAILED job run when plan generation throws", async () => {
    const openaiModule = await import("openai");
    const mockCreate = (openaiModule as any).__mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockReset();
    mockCreate.mockRejectedValueOnce(new Error("AI service unavailable"));

    const result = await runDailyGrowthJob(testDate);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("AI service unavailable");

    // Job run should be FAILED
    const [jobRun] = await db
      .select()
      .from(growthJobRuns)
      .where(eq(growthJobRuns.id, result.jobRunId));

    expect(jobRun?.status).toBe("FAILED");
    expect(jobRun?.errorMessage).toContain("AI service unavailable");
  });

  it("stores all expected fields on content items", async () => {
    const result = await runDailyGrowthJob(testDate);
    expect(result.status).toBe("COMPLETE");

    const items = await db
      .select()
      .from(growthContentItems)
      .where(eq(growthContentItems.planId, result.planId));

    for (const item of items) {
      if (item.status === "DRAFT") {
        expect(item.platform).toMatch(/^(TIKTOK|INSTAGRAM|X|REDDIT)$/);
        expect(item.contentType).toMatch(
          /^(SCORE_HIGHLIGHT|STREAK_MILESTONE|CHALLENGE_RECAP|GENERAL)$/,
        );
        expect(typeof item.caption).toBe("string");
        expect(Array.isArray(item.hashtags)).toBe(true);
      }
    }
  });
});
