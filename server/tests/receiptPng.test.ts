import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildReceiptPlaqueView, containsBannedReceiptCopy, RECEIPT_COLORS } from "@shared/receiptContract";
import { buildReceiptPngSvg, RECEIPT_PNG_MIN_BYTES, RECEIPT_PNG_SIZE, renderReceiptPng } from "../contentFactory/generateReceiptPng";
import { assertDejaVuReceiptFonts, DEJAVU_FILES } from "../contentFactory/fonts";

const granted = buildReceiptPlaqueView({
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

describe("receipt PNG — SOCIAL_PNG_QA", () => {
  it("raises unless DejaVu absolute paths exist", () => {
    const fonts = assertDejaVuReceiptFonts();
    expect(fonts.regularPath).toMatch(/DejaVuSans\.ttf$/);
    expect(fonts.boldPath).toMatch(/DejaVuSans-Bold\.ttf$/);
    expect(fonts.regularPath.startsWith("/") || fonts.regularPath.includes("assets/fonts")).toBe(true);
    expect(DEJAVU_FILES.monoBold).toBe("DejaVuSansMono-Bold.ttf");
  });

  it("outlines type with no <text> / sans-serif and no banned copy", () => {
    const svg = buildReceiptPngSvg(granted);
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).not.toContain("sans-serif");
    expect(svg).toContain(RECEIPT_COLORS.canvas);
    expect(svg).toContain("PACKPTS RECEIPT");
    expect(svg).toContain("CREDIT_GRANTED");
    expect(svg).toContain("Partner price");
    expect(svg).toContain("M292 196");
    expect(containsBannedReceiptCopy(svg)).toEqual([]);
  });

  it("rasters a 1080 PNG over 50KB", async () => {
    const png = await renderReceiptPng(granted);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(RECEIPT_PNG_SIZE);
    expect(meta.height).toBe(RECEIPT_PNG_SIZE);
    expect(png.byteLength).toBeGreaterThan(RECEIPT_PNG_MIN_BYTES);
  });
});
