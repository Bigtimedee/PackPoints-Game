import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  creatorApplications,
  jobQueue,
  partnerInquiries,
  promotions,
  userAttribution,
  userFeedback,
} from "@shared/schema";
import {
  approvedIntentHasRebateProgress,
  staleRedemptionCleanupMode,
  staleRedemptionMaxPerRun,
} from "../services/staleRedemptionGuard";

const REQUIRED_TABLES = [
  ["job_queue", jobQueue],
  ["promotions", promotions],
  ["user_attribution", userAttribution],
  ["creator_applications", creatorApplications],
  ["partner_inquiries", partnerInquiries],
  ["user_feedback", userFeedback],
] as const;

describe("raw-SQL tables in the Drizzle schema", () => {
  it("exports the tables drizzle-kit push must keep", () => {
    for (const [name, table] of REQUIRED_TABLES) {
      expect(getTableConfig(table).name).toBe(name);
    }
  });

  it("uses the snake_case columns the raw SQL call sites insert and select", () => {
    const columns = (table: (typeof REQUIRED_TABLES)[number][1]) =>
      getTableConfig(table).columns.map((column) => column.name);

    expect(columns(jobQueue)).toEqual([
      "id",
      "job_type",
      "status",
      "payload",
      "attempts",
      "max_attempts",
      "last_error",
      "scheduled_at",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at",
    ]);
    expect(columns(userAttribution)).toEqual(expect.arrayContaining([
      "user_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "referrer",
    ]));
    expect(columns(promotions)).toEqual(expect.arrayContaining([
      "name",
      "start_at",
      "end_at",
      "points_multiplier",
      "active",
      "created_by",
    ]));
    expect(columns(creatorApplications)).toEqual(expect.arrayContaining([
      "social_handle",
      "follower_count",
      "content_description",
      "why_packpts",
      "reviewed_by",
    ]));
    expect(columns(partnerInquiries)).toEqual(expect.arrayContaining([
      "shop_name",
      "contact_name",
      "contact_email",
      "monthly_volume",
    ]));
    expect(columns(userFeedback)).toEqual(expect.arrayContaining([
      "user_id",
      "category",
      "page_url",
      "admin_notes",
    ]));
  });

  it("gives user_attribution a unique user_id so signup ON CONFLICT (user_id) works", () => {
    const config = getTableConfig(userAttribution);
    const uniqueUserId = config.indexes.some((idx) =>
      idx.config.unique && idx.config.columns.some((column) => "name" in column && column.name === "user_id")
    );
    expect(uniqueUserId).toBe(true);
    const userId = config.columns.find((column) => column.name === "user_id");
    expect(userId?.getSQLType()).toContain("varchar");
  });
});

describe("stale redemption catch-up guard", () => {
  const intent = {
    userId: "user-1",
    listingId: "listing-abcdef1234567890",
    listingUrl: "https://www.ebay.com/itm/listing-abcdef1234567890",
    outboundClickId: null,
    attributedPurchaseId: null,
    grantMethod: null,
    evidenceOrderId: null,
    evidenceNote: null,
    evidenceReceiptUrl: null,
    evidenceSubmittedAt: null,
  };

  it("defaults to dry_run and a cap of 50", () => {
    const previousMode = process.env.STALE_REDEMPTION_CLEANUP_MODE;
    const previousCap = process.env.STALE_REDEMPTION_MAX_PER_RUN;
    delete process.env.STALE_REDEMPTION_CLEANUP_MODE;
    delete process.env.STALE_REDEMPTION_MAX_PER_RUN;
    expect(staleRedemptionCleanupMode()).toBe("dry_run");
    expect(staleRedemptionMaxPerRun()).toBe(50);
    process.env.STALE_REDEMPTION_CLEANUP_MODE = "live";
    process.env.STALE_REDEMPTION_MAX_PER_RUN = "10";
    expect(staleRedemptionCleanupMode()).toBe("live");
    expect(staleRedemptionMaxPerRun()).toBe(10);
    if (previousMode === undefined) delete process.env.STALE_REDEMPTION_CLEANUP_MODE;
    else process.env.STALE_REDEMPTION_CLEANUP_MODE = previousMode;
    if (previousCap === undefined) delete process.env.STALE_REDEMPTION_MAX_PER_RUN;
    else process.env.STALE_REDEMPTION_MAX_PER_RUN = previousCap;
  });

  it("skips APPROVED intents that already have a click, postback, or evidence", () => {
    expect(approvedIntentHasRebateProgress(intent, [], [])).toBe(false);
    expect(approvedIntentHasRebateProgress(intent, [
      { id: "click-1", userId: "user-1", listingId: intent.listingId },
    ], [])).toBe(true);
    expect(approvedIntentHasRebateProgress(intent, [], [
      { userId: "user-1", itemId: "listing-abcdef", outboundClickId: null },
    ])).toBe(true);
    expect(approvedIntentHasRebateProgress({
      ...intent,
      evidenceOrderId: "order-9",
    }, [], [])).toBe(true);
    expect(approvedIntentHasRebateProgress(intent, [
      { id: "click-2", userId: "someone-else", listingId: intent.listingId },
    ], [
      { userId: "user-1", itemId: "different-item", outboundClickId: null },
    ])).toBe(false);
  });
});
