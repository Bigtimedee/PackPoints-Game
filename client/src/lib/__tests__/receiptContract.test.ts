import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  RECEIPT_BANNED_PHRASES,
  RECEIPT_COLORS,
  RECEIPT_COPY,
  buildReceiptPlaqueView,
  containsBannedReceiptCopy,
  formatHeroAmount,
  formatWalletHeader,
  grantMethodLabel,
  receiptChip,
} from "@shared/receiptContract";

const pageSrc = readFileSync(new URL("../../pages/redemptions.tsx", import.meta.url), "utf8");
const plaqueSrc = readFileSync(new URL("../../components/receipt-plaque.tsx", import.meta.url), "utf8");

describe("receipt chip map — Design enum lock", () => {
  it("maps intent.status to exact chips and never invents UNDER_REVIEW", () => {
    expect(receiptChip("CREATED")).toEqual({
      label: "PENDING",
      color: RECEIPT_COLORS.muted,
      helper: RECEIPT_COPY.awaitingPurchase,
    });
    expect(receiptChip("APPROVED")).toEqual({
      label: "APPROVED",
      color: RECEIPT_COLORS.blue,
      helper: RECEIPT_COPY.confirmToUnlock,
    });
    expect(receiptChip("PURCHASE_CONFIRMED")).toEqual({
      label: "PURCHASE_CONFIRMED",
      color: RECEIPT_COLORS.gold,
      helper: RECEIPT_COPY.creditPendingReview,
    });
    expect(receiptChip("CREDIT_GRANTED")).toEqual({
      label: "CREDIT_GRANTED",
      color: RECEIPT_COLORS.green,
      helper: RECEIPT_COPY.usdGranted,
    });
    expect(receiptChip("DENIED").label).toBe("DENIED");
    expect(receiptChip("CANCELED").label).toBe("CANCELED");
    expect(receiptChip("UNDER_REVIEW").label).toBe("PENDING");
  });

  it("keeps ≥$25 review on PURCHASE_CONFIRMED, not PENDING", () => {
    const chip = receiptChip("PURCHASE_CONFIRMED");
    expect(chip.label).toBe("PURCHASE_CONFIRMED");
    expect(chip.helper).toBe("Credit pending review");
    expect(chip.label).not.toBe("PENDING");
  });

  it("labels grant methods quietly", () => {
    expect(grantMethodLabel("EPN_POSTBACK")).toBe("Affiliate confirm");
    expect(grantMethodLabel("USER_CONFIRM")).toBe("You confirmed");
    expect(grantMethodLabel("ADMIN_GRANT")).toBe("PackPTS review");
    expect(formatWalletHeader(4825)).toBe("Wallet $48.25");
    expect(formatHeroAmount(1250, "CREDIT_GRANTED")).toBe("+$12.50");
    expect(formatHeroAmount(4500, "PURCHASE_CONFIRMED")).toBe("$45.00");
  });
});

describe("redemptions page copy — #96 + receipt contract", () => {
  const surfaces = pageSrc + "\n" + plaqueSrc;

  it("uses Design labels and PackPTS spelling", () => {
    expect(surfaces).toContain("PACKPTS RECEIPT");
    expect(surfaces).toContain("Partner price");
    expect(surfaces).toContain("Post-purchase rebate");
    expect(surfaces).toContain("Partner checkout unchanged");
    expect(surfaces).toContain("Credit pending review");
    expect(surfaces).toContain("USD credit granted to PackPTS wallet");
    expect(surfaces).toContain("/packpts-mark.svg");
    expect(surfaces).toContain("PackPTS receipt");
    expect(surfaces).not.toMatch(/PackPoints/);
    expect(surfaces).not.toMatch(/three-square|packpts-logo\.png/);
  });

  it("rejects banned checkout-discount / gift-card / UNDER_REVIEW chip strings", () => {
    expect(containsBannedReceiptCopy(surfaces)).toEqual([]);
    for (const phrase of RECEIPT_BANNED_PHRASES) {
      expect(surfaces.includes(phrase)).toBe(false);
    }
    expect(pageSrc).not.toMatch(/UNDER_REVIEW/);
    expect(plaqueSrc).not.toMatch(/UNDER_REVIEW/);
  });

  it("keeps the APPROVED claim form and ≥$25 pending-review helper", () => {
    expect(pageSrc).toContain('intent.status === "APPROVED"');
    expect(pageSrc).toContain("button-claim-rebate");
    expect(pageSrc).toMatch(/PURCHASE_CONFIRMED/);
    expect(pageSrc).toMatch(/Credit pending review/);
    expect(surfaces).toContain("text-wallet-header");
  });
});

describe("buildReceiptPlaqueView", () => {
  it("builds CREDIT_GRANTED proof with quiet grant meta", () => {
    const view = buildReceiptPlaqueView({
      intentId: "7f3a9c2e-1111-2222-3333-444444444444",
      source: "goldin",
      listingId: "GLD-88421",
      listingTitle: "1952 Topps Mickey Mantle PSA 4",
      listingUrl: "https://goldin.co/item/1",
      priceCents: 125000,
      packptsSpent: 2500,
      creditCents: 1250,
      status: "CREDIT_GRANTED",
      grantMethod: "USER_CONFIRM",
      grantedAt: "2026-09-18T12:00:00.000Z",
      createdAt: "2026-09-18T12:00:00.000Z",
      evidenceOrderId: "GLD-88421",
      evidenceNote: null,
      evidenceReceiptUrl: null,
      deniedReason: null,
      rebateBalanceCents: 4825,
    });
    expect(view.chip.label).toBe("CREDIT_GRANTED");
    expect(view.heroAmount).toBe("+$12.50");
    expect(view.partnerPrice).toBe("$1,250.00");
    expect(view.walletHeader).toBe("Wallet $48.25");
    expect(view.grantMethodLabel).toBe("You confirmed");
    expect(view.partner).toBe("Goldin");
    expect(containsBannedReceiptCopy(JSON.stringify(view))).toEqual([]);
  });
});
