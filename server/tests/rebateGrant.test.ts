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

  it("user confirm grants USD cashback and is idempotent", async () => {
    const { quote, applied } = await applyOnListing("goldin", 500);

    await expect(
      rebateService.confirmPurchase(userId, quote.purchaseIntentId, {})
    ).rejects.toThrow(/required/i);

    const granted = await rebateService.confirmPurchase(userId, quote.purchaseIntentId, {
      orderId: "GOLDIN-1",
      evidenceNote: "bought it",
    });
    expect(granted.granted).toBe(true);
    expect(granted.creditCents).toBe(applied.creditCents);

    const wallet = await walletService.getWallet(userId);
    expect(wallet?.rebateBalanceCents).toBe(applied.creditCents);

    const again = await rebateService.confirmPurchase(userId, quote.purchaseIntentId, {
      orderId: "GOLDIN-1",
    });
    expect(again.alreadyGranted).toBe(true);
    const wallet2 = await walletService.getWallet(userId);
    expect(wallet2?.rebateBalanceCents).toBe(applied.creditCents);

    const receipt = await rebateService.getReceipt(userId, quote.purchaseIntentId);
    expect(receipt?.intent.status).toBe("CREDIT_GRANTED");
    expect(receipt?.credit?.status).toBe("GRANTED");
    expect(receipt?.honesty).toMatch(/full price/i);
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

    const replay = await processEpnPostback({
      customid,
      item_id: listing,
      transaction_id: `txn-${suffix}-${Date.now()}-b`,
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

    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const granted = await rebateService.adminGrant(quote.purchaseIntentId);
    expect(granted.granted).toBe(true);
    const after = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(after).toBe(before + applied.creditCents);
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
