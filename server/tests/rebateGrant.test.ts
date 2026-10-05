import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  wallets,
  ledgerEntries,
  profitPolicy,
  marginLedger,
  marginUsage,
  redemptionReservations,
  redemptionCredit,
  externalPurchaseIntent,
  outboundClicks,
  attributedPurchases,
  rebateLedger,
  rebatePayoutRequests,
  packptsSpendAllocation,
  packptsBucket,
} from "@shared/schema";
import { walletService } from "../services/walletService";
import { treasuryService } from "../services/treasuryService";
import { profitGuardrailService } from "../services/profitGuardrailService";
import { rebateService, processEpnPostback } from "../services/rebateService";

describe("marketplace cashback grant", () => {
  const suffix = randomUUID().slice(0, 8);
  let userId: string;
  const listingId = `itm-${suffix}`;

  async function cleanup() {
    const intents = await db
      .select({ id: externalPurchaseIntent.id })
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.userId, userId));
    const intentIds = intents.map((i) => i.id);
    if (intentIds.length) {
      await db.delete(rebateLedger).where(eq(rebateLedger.userId, userId));
      const credits = await db
        .select({ id: redemptionCredit.id })
        .from(redemptionCredit)
        .where(inArray(redemptionCredit.purchaseIntentId, intentIds));
      if (credits.length) {
        await db.delete(marginUsage).where(inArray(marginUsage.redemptionId, credits.map((c) => c.id)));
        await db.delete(redemptionReservations).where(inArray(redemptionReservations.purchaseIntentId, intentIds));
        await db.delete(redemptionCredit).where(inArray(redemptionCredit.id, credits.map((c) => c.id)));
      }
    }
    await db.delete(rebatePayoutRequests).where(eq(rebatePayoutRequests.userId, userId));
    await db.delete(rebateLedger).where(eq(rebateLedger.userId, userId));
    await db.delete(attributedPurchases).where(eq(attributedPurchases.userId, userId));
    await db.delete(outboundClicks).where(eq(outboundClicks.userId, userId));
    await db.delete(externalPurchaseIntent).where(eq(externalPurchaseIntent.userId, userId));
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      const buckets = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
      if (buckets.length) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, buckets.map((b) => b.id)));
      }
      const entries = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      if (entries.length) {
        await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.spendLedgerEntryId, entries.map((e) => e.id)));
      }
      await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  }

  beforeAll(async () => {
    userId = `rebate-user-${suffix}`;
    await db.insert(users).values({
      id: userId,
      username: `rebate_${suffix}`,
      email: `rebate_${suffix}@example.com`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });
    await walletService.getOrCreateWallet(userId);
    await walletService.earn(userId, 50_000, "test float", `rebate-earn-${suffix}`);

    await db.update(profitPolicy).set({ enabled: false }).where(eq(profitPolicy.enabled, true));
    await db.insert(profitPolicy).values({
      minMarginM: 0.25,
      affiliateRateA: 0.02,
      affiliateHaircutH: 0.7,
      processingFeeRateR: 0,
      fixedFeeFCents: 0,
      packptsValueVMicrousd: 2000,
      maxDiscountPct: 0.15,
      perUserDailyCreditCents: 10000,
      perUserWeeklyCreditCents: 50000,
      minRedemptionPackpts: 500,
      reserveFloorCents: 0,
      enabled: true,
    });
    await treasuryService.creditMarginPool(1_000_000, "MANUAL_ADJUSTMENT", `rebate-test-${suffix}`, "test reserve");
  });

  afterAll(async () => {
    await cleanup();
  });

  async function applyOnListing(source: "ebay" | "goldin", packpts: number, priceCents = 10_000) {
    const quote = await profitGuardrailService.createQuote(
      userId,
      source,
      listingId,
      `https://www.ebay.com/itm/${listingId}`,
      priceCents,
      "usd",
      "1987 Topps test card"
    );
    const applied = await profitGuardrailService.applyRedemption(userId, quote.purchaseIntentId, packpts);
    expect(applied.success).toBe(true);
    expect(applied.creditCents).toBeGreaterThan(0);
    return { quote, applied };
  }

  it("user claim never credits on its own, at any amount; admin review grants it", async () => {
    const { quote, applied } = await applyOnListing("goldin", 500);
    expect(applied.creditCents).toBeLessThan(2500);

    await expect(
      rebateService.confirmPurchase(userId, quote.purchaseIntentId, {})
    ).rejects.toThrow(/required/i);

    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const claimed = await rebateService.confirmPurchase(userId, quote.purchaseIntentId, {
      orderId: "GOLDIN-1",
      evidenceNote: "bought it",
    });
    expect(claimed.granted).toBe(false);
    expect(claimed.heldForReview).toBe(true);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before);

    // Repeating the claim still does not credit.
    const again = await rebateService.confirmPurchase(userId, quote.purchaseIntentId, {
      orderId: "GOLDIN-1",
    });
    expect(again.granted).toBe(false);
    expect(again.heldForReview).toBe(true);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before);

    const heldReceipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(heldReceipt?.intent.status).toBe("PURCHASE_CONFIRMED");
    expect(heldReceipt?.credit?.status).not.toBe("GRANTED");

    const granted = await rebateService.adminGrant(quote.purchaseIntentId);
    expect(granted.granted).toBe(true);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before + applied.creditCents);

    const idem = await rebateService.adminGrant(quote.purchaseIntentId);
    expect(idem.alreadyGranted).toBe(true);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before + applied.creditCents);

    const receipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(receipt?.intent.status).toBe("CREDIT_GRANTED");
    expect(receipt?.grantMethod).toBe("ADMIN_GRANT");
    expect(receipt?.honesty).toMatch(/Partner checkout unchanged/i);
  });

  it("EPN postback auto-grants when customid matches the apply", async () => {
    const listing = `epn-${suffix}`;
    const quote = await profitGuardrailService.createQuote(
      userId,
      "ebay",
      listing,
      `https://www.ebay.com/itm/${listing}`,
      8000,
      "usd",
      "EPN test listing"
    );
    const applied = await profitGuardrailService.applyRedemption(userId, quote.purchaseIntentId, 500);
    expect(applied.success).toBe(true);

    const customid = `packpts:u_${userId.slice(0, 12)}:i_${listing.slice(0, 16)}:t_${Date.now()}`;
    await db.insert(outboundClicks).values({
      source: "ebay",
      listingId: listing,
      destinationUrl: `https://www.ebay.com/itm/${listing}`,
      outboundUrl: `https://www.ebay.com/itm/${listing}?campid=1`,
      customId: customid,
      userId,
    });

    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    await expect(processEpnPostback({
      customid: "unknown-click", item_id: listing,
      transaction_id: `unknown-${suffix}`, sale_price: "80.00",
    })).rejects.toThrow(/matching authenticated outbound click/);
    await expect(processEpnPostback({
      customid, item_id: "wrong-item", transaction_id: `wrong-item-${suffix}`, sale_price: "80.00",
    })).rejects.toThrow(/matching authenticated outbound click/);
    await expect(processEpnPostback({
      customid, item_id: listing, transaction_id: `missing-price-${suffix}`,
    })).rejects.toThrow(/valid sale price/);
    const mismatch = await processEpnPostback({
      customid, item_id: listing, transaction_id: `price-mismatch-${suffix}`, sale_price: "79.99",
    });
    expect(mismatch.grants).toHaveLength(0);
    expect(await rebateService.grantFromEpnPostback({customId:customid, listingId:listing})).toEqual([]);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before);
    const result = await processEpnPostback({
      customid,
      item_id: listing,
      transaction_id: `txn-${suffix}-${Date.now()}`,
      sale_price: "80.00",
      commission: "1.60",
    });
    expect(result.ok).toBe(true);
    expect(result.grants.some((g) => g.granted)).toBe(true);

    const after = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(after).toBe(before + applied.creditCents);

    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.id, quote.purchaseIntentId));
    expect(intent.status).toBe("CREDIT_GRANTED");
    expect(intent.grantMethod).toBe("EPN_POSTBACK");
    const epnReceipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(epnReceipt?.grantMethod).toBe("EPN_POSTBACK");
    expect(epnReceipt?.plaque.grantMethodLabel).toBe("Affiliate confirm");

    const replay = await processEpnPostback({
      customid,
      item_id: listing,
      transaction_id: `txn-${suffix}-${Date.now()}-b`,
      sale_price: "80.00",
    });
    expect(replay.grants.every((g) => g.alreadyGranted || g.granted)).toBe(true);
    const afterReplay = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(afterReplay).toBe(after);
  });

  it("holds user-attested grants at $25+ for admin, then admin grant pays USD", async () => {
    const listing = `hold-${suffix}`;
    const quote = await profitGuardrailService.createQuote(
      userId,
      "ebay",
      listing,
      `https://www.ebay.com/itm/${listing}`,
      20_000,
      "usd",
      "High value card"
    );
    const applied = await profitGuardrailService.applyRedemption(userId, quote.purchaseIntentId, 15_000);
    expect(applied.success).toBe(true);
    expect(applied.creditCents).toBeGreaterThanOrEqual(2500);

    const held = await rebateService.confirmPurchase(userId, quote.purchaseIntentId, {
      orderId: "EBAY-HOLD",
      evidenceNote: "receipt attached as url",
      receiptUrl: "https://example.com/receipt",
    });
    expect(held.heldForReview).toBe(true);
    expect(held.granted).toBe(false);

    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.id, quote.purchaseIntentId));
    expect(intent.status).toBe("PURCHASE_CONFIRMED");
    expect(intent.evidenceOrderId).toBe("EBAY-HOLD");
    const heldReceipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(heldReceipt?.plaque.chip.label).toBe("PURCHASE_CONFIRMED");
    expect(heldReceipt?.plaque.helper).toBe("Credit pending review");
    expect(heldReceipt?.plaque.chip.label).not.toBe("PENDING");

    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const granted = await rebateService.adminGrant(quote.purchaseIntentId);
    expect(granted.granted).toBe(true);
    const after = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(after).toBe(before + applied.creditCents);
    const adminReceipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(adminReceipt?.grantMethod).toBe("ADMIN_GRANT");
    expect(adminReceipt?.plaque.grantMethodLabel).toBe("PackPTS review");
  });

  async function applyEbay(listing: string, priceCents: number, packpts: number) {
    const quote = await profitGuardrailService.createQuote(
      userId, "ebay", listing, `https://www.ebay.com/itm/${listing}`, priceCents, "usd", `Card ${listing}`
    );
    const applied = await profitGuardrailService.applyRedemption(userId, quote.purchaseIntentId, packpts);
    expect(applied.success).toBe(true);
    const customid = `packpts:u_${userId.slice(0, 12)}:i_${listing.slice(0, 16)}:t_${Date.now()}`;
    await db.insert(outboundClicks).values({
      source: "ebay", listingId: listing, destinationUrl: `https://www.ebay.com/itm/${listing}`,
      outboundUrl: `https://www.ebay.com/itm/${listing}?campid=1`, customId: customid, userId,
    });
    return { quote, applied, customid };
  }

  it("multi-card order: each listing matches its own postback and credits once", async () => {
    const a = await applyEbay(`multiA-${suffix}`, 8000, 500);
    const b = await applyEbay(`multiB-${suffix}`, 5000, 400);
    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const ra = await processEpnPostback({ customid: a.customid, item_id: `multiA-${suffix}`, transaction_id: `mA-${suffix}`, sale_price: "80.00" });
    const rb = await processEpnPostback({ customid: b.customid, item_id: `multiB-${suffix}`, transaction_id: `mB-${suffix}`, sale_price: "50.00" });
    expect(ra.grants).toHaveLength(1);
    expect(rb.grants).toHaveLength(1);
    const after = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(after).toBe(before + a.applied.creditCents + b.applied.creditCents);
  });

  it("quantity: a total of k x the listing price (k copies) matches; non-multiples do not", async () => {
    const { epnPriceMatches } = await import("../services/epnVerification");
    expect(epnPriceMatches(5000, 5000)).toBe(true);
    expect(epnPriceMatches(5000, 10000)).toBe(true);
    expect(epnPriceMatches(5000, 50000)).toBe(true);
    expect(epnPriceMatches(5000, 55000)).toBe(false); // 11 copies, over the limit
    expect(epnPriceMatches(5000, 7500)).toBe(false);
    expect(epnPriceMatches(5000, 4999)).toBe(false);
    const q = await applyEbay(`qty-${suffix}`, 6000, 300);
    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const r = await processEpnPostback({ customid: q.customid, item_id: `qty-${suffix}`, transaction_id: `q-${suffix}`, sale_price: "120.00" });
    expect(r.grants).toHaveLength(1);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before + q.applied.creditCents);
  });

  it("price change (offer/auction/partial): no auto credit, held for admin with the reported total", async () => {
    const q = await applyEbay(`chg-${suffix}`, 9000, 500);
    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const r = await processEpnPostback({ customid: q.customid, item_id: `chg-${suffix}`, transaction_id: `c-${suffix}`, sale_price: "75.00" });
    expect(r.grants).toHaveLength(0);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(before);
    const [intent] = await db.select().from(externalPurchaseIntent).where(eq(externalPurchaseIntent.id, q.quote.purchaseIntentId));
    expect(intent.status).toBe("PURCHASE_CONFIRMED");
    expect(intent.evidenceNote).toMatch(/\$75\.00.*\$90\.00/);
  });

  it("listReceipts includes CREATED intents as PENDING chip receipts", async () => {
    const listing = `created-${suffix}`;
    const quote = await profitGuardrailService.createQuote(
      userId,
      "ebay",
      listing,
      `https://www.ebay.com/itm/${listing}`,
      8_500,
      "usd",
      "CREATED list fixture"
    );
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.id, quote.purchaseIntentId));
    expect(intent.status).toBe("CREATED");

    const receipts = await rebateService.listReceipts(userId);
    const created = receipts.find((row) => row.intent.id === quote.purchaseIntentId);
    expect(created).toBeTruthy();
    expect(created?.intent.status).toBe("CREATED");
    expect(created?.plaque.chip.label).toBe("PENDING");
  });

  it("payout request debits rebate balance; deny returns it", async () => {
    const wallet = await walletService.getWallet(userId);
    expect(wallet?.rebateBalanceCents).toBeGreaterThan(0);
    const take = Math.min(100, wallet!.rebateBalanceCents);
    const req = await rebateService.requestPayout(userId, take, "paypal", "buyer@example.com");
    expect(req.success).toBe(true);
    const mid = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(mid).toBe(wallet!.rebateBalanceCents - take);

    await rebateService.adminDenyPayout(req.requestId!, "admin", "could not send");
    const restored = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(restored).toBe(wallet!.rebateBalanceCents);
  });
});
