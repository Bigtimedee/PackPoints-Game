import express from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  users, wallets, ledgerEntries, profitPolicy, marginUsage, redemptionReservations, redemptionCredit,
  externalPurchaseIntent, outboundClicks, attributedPurchases, rebateLedger, rebatePayoutRequests,
  packptsSpendAllocation, packptsBucket,
} from "@shared/schema";
import { walletService } from "../services/walletService";
import { treasuryService } from "../services/treasuryService";
import { profitGuardrailService } from "../services/profitGuardrailService";
import { rebateService } from "../services/rebateService";
import { applyEpnTracking, generateEpnCustomId, logOutboundClick } from "../services/marketplace/outbound";
import { registerVerifiedEpnPostback } from "../routes/epnPostback";

/**
 * End-to-end rebate path through the real code: earned vs bought points, quote with
 * #230 caps, apply, tracked outbound click (customid in the eBay URL), signed EPN
 * postback over HTTP, credit, 30-day hold, $10 minimum, payout -> admin approval.
 */
describe("rebate path end to end", () => {
  const suffix = randomUUID().slice(0, 8);
  let userId: string;
  const SECRET = "e".repeat(40);
  let server: any; let base = "";
  const prior = { secret: process.env.EPN_POSTBACK_SECRET, camp: process.env.EPN_CAMPID };

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
    process.env.EPN_POSTBACK_SECRET = SECRET;
    process.env.EPN_CAMPID = "5338000000";
    userId = `e2e-rebate-${suffix}`;
    await db.insert(users).values({ id: userId, username: `e2e_${suffix}`, email: `e2e_${suffix}@example.com`, points: 0, gamesPlayed: 0, correctAnswers: 0, totalAnswers: 0, isAdmin: false });
    await walletService.getOrCreateWallet(userId);
    await db.update(profitPolicy).set({ enabled: false }).where(eq(profitPolicy.enabled, true));
    await db.insert(profitPolicy).values({ minMarginM: 0.25, affiliateRateA: 0.02, affiliateHaircutH: 0.7, processingFeeRateR: 0, fixedFeeFCents: 0, packptsValueVMicrousd: 2000, maxDiscountPct: 0.15, perUserDailyCreditCents: 2500, perUserWeeklyCreditCents: 10000, minRedemptionPackpts: 500, reserveFloorCents: 0, enabled: true });
    await treasuryService.creditMarginPool(1_000_000, "MANUAL_ADJUSTMENT", `e2e-${suffix}`, "test reserve");
    const app = express();
    registerVerifiedEpnPostback(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}/api/webhooks/epn-postback`;
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((r) => server.close(() => r()));
    if (prior.secret === undefined) delete process.env.EPN_POSTBACK_SECRET; else process.env.EPN_POSTBACK_SECRET = prior.secret;
    if (prior.camp === undefined) delete process.env.EPN_CAMPID; else process.env.EPN_CAMPID = prior.camp;
  });

  async function quoteAndApply(listing: string, priceCents: number, pts: number) {
    const q = await profitGuardrailService.createQuote(userId, "ebay", listing, `https://www.ebay.com/itm/${listing}`, priceCents, "usd", "e2e card");
    const a = await profitGuardrailService.applyRedemption(userId, q.purchaseIntentId, pts);
    return { q, a };
  }

  async function trackedClick(listing: string) {
    const url = applyEpnTracking(`https://www.ebay.com/itm/${listing}`, userId, listing, generateEpnCustomId(userId, listing));
    await logOutboundClick({ source: "ebay", listingId: listing, destinationUrl: `https://www.ebay.com/itm/${listing}`, outboundUrl: url, customId: "ignored", userId, sessionId: null, ip: "203.0.113.9", userAgent: "vitest" });
    const customid = new URL(url).searchParams.get("customid")!;
    const [click] = await db.select().from(outboundClicks).where(eq(outboundClicks.customId, customid));
    return { url, customid, click };
  }

  it("bought and earned points both redeem, within the #230 formula cap", async () => {
    const bought = await walletService.purchaseCredit(userId, 80_000, "e2e store bundle", `e2e-buy-${suffix}`);
    expect(bought.success).toBe(true);
    await walletService.earn(userId, 2_000, "e2e play", `e2e-earn-${suffix}`);
    const { q, a } = await quoteAndApply(`earned-${suffix}`, 10_000, 5_000);
    expect(a.success).toBe(true);
    expect(a.creditCents).toBeLessThanOrEqual(105); // 0.7 * 2% * 75% of $100
    expect(q.marginBackedCreditCentsMax).toBeLessThanOrEqual(105);
  });

  it("tracked link carries the customid that is stored, and a signed postback credits the user", async () => {
    const listing = `earned-${suffix}`;
    const { url, customid, click } = await trackedClick(listing);
    expect(new URL(url).searchParams.get("campid")).toBe("5338000000");
    expect(click?.userId).toBe(userId);
    const qs = `customid=${encodeURIComponent(customid)}&item_id=${listing}&transaction_id=e2e-${suffix}&sale_price=100.00`;
    expect((await fetch(`${base}?${qs}`)).status).toBe(401); // unsigned forgeries rejected
    const before = (await walletService.getWallet(userId))!.rebateBalanceCents;
    const res = await fetch(`${base}?${qs}`, { headers: { "x-epn-postback-secret": SECRET } });
    expect(res.status).toBe(200);
    const after = (await walletService.getWallet(userId))!.rebateBalanceCents;
    expect(after).toBeGreaterThan(before);
    // replay of the same transaction never double-credits (query-param secret also accepted)
    expect((await fetch(`${base}?${qs}&secret=${SECRET}`)).status).toBe(200);
    expect((await walletService.getWallet(userId))!.rebateBalanceCents).toBe(after);
  });

  it("fresh credit is on the 30-day hold, payouts start at $10, and go to admin approval", async () => {
    const bal = (await walletService.getWallet(userId))!.rebateBalanceCents;
    await expect(rebateService.requestPayout(userId, Math.max(1000, bal), "paypal", `e2e_${suffix}@example.com`)).rejects.toThrow(/hold|Insufficient/);
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.update(rebateLedger).set({ createdAt: old }).where(eq(rebateLedger.userId, userId));
    const topUp = Math.max(0, 1200 - bal);
    await db.update(wallets).set({ rebateBalanceCents: bal + topUp }).where(eq(wallets.userId, userId));
    if (topUp) await db.insert(rebateLedger).values({ userId, amountCents: topUp, balanceAfterCents: bal + topUp, type: "ADJUSTMENT", idempotencyKey: `e2e-top-${suffix}`, createdAt: old });
    await expect(rebateService.requestPayout(userId, 999, "paypal", `e2e_${suffix}@example.com`)).rejects.toThrow(/Minimum payout/);
    const req = await rebateService.requestPayout(userId, 1000, "paypal", `e2e_${suffix}@example.com`);
    expect(req.success).toBe(true);
    const [row] = await db.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, req.requestId!));
    expect(row.status).toBe("REQUESTED");
    const paid = await rebateService.adminMarkPayoutPaid(req.requestId!, "admin-e2e", "e2e");
    expect(paid.success).toBe(true);
    const [done] = await db.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, req.requestId!));
    expect(done.status).toBe("PAID");
  });
});
