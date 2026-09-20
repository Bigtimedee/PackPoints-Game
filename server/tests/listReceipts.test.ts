import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { RECEIPT_LIST_STATUSES, receiptChip } from "@shared/receiptContract";

const rebateSrc = readFileSync(new URL("../services/rebateService.ts", import.meta.url), "utf8");

describe("listReceipts status filter", () => {
  it("includes CREATED so PENDING chip receipts appear on /redemptions", () => {
    const listFn = rebateSrc.slice(
      rebateSrc.indexOf("async listReceipts"),
      rebateSrc.indexOf("async persistEvidence"),
    );
    expect(listFn).toContain("RECEIPT_LIST_STATUSES");
    expect(RECEIPT_LIST_STATUSES).toContain("CREATED");
    expect(receiptChip("CREATED").label).toBe("PENDING");
  });
});
