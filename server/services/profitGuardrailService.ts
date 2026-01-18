import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import {
  profitPolicy,
  externalPurchaseIntent,
  redemptionCredit,
  wallets,
  ledgerEntries,
  type ProfitPolicy,
  type ExternalPurchaseIntent,
  type RedemptionCredit,
} from "@shared/schema";
import { walletService } from "./walletService";

export interface CalcSnapshot {
  P: number;
  A: number;
  h: number;
  m: number;
  r: number;
  f: number;
  v: number;
  Cmax: number;
  Rmax: number;
}

export interface QuoteResult {
  rMax: number;
  creditCentsMax: number;
  policySummary: {
    minMargin: number;
    packptsValueUsd: number;
  };
  explanationText: string;
  purchaseIntentId: string;
}

export interface ApplyResult {
  success: boolean;
  approvedRedeemPackpts: number;
  creditCents: number;
  redemptionCreditId: string;
  message: string;
}

class ProfitGuardrailService {
  async getActivePolicy(): Promise<ProfitPolicy | null> {
    const policies = await db
      .select()
      .from(profitPolicy)
      .where(eq(profitPolicy.enabled, true))
      .orderBy(desc(profitPolicy.effectiveFrom))
      .limit(1);

    return policies[0] || null;
  }

  async getPolicyForDisplay(): Promise<{
    minMargin: number;
    packptsValueUsd: number;
    affiliateRate: number;
    enabled: boolean;
  } | null> {
    const policy = await this.getActivePolicy();
    if (!policy) return null;

    return {
      minMargin: policy.minMarginM,
      packptsValueUsd: policy.packptsValueVMicrousd / 1_000_000,
      affiliateRate: policy.affiliateRateA,
      enabled: policy.enabled,
    };
  }

  computeRmax(priceCents: number, policy: ProfitPolicy): CalcSnapshot {
    const P = priceCents / 100;
    const A = policy.affiliateRateA;
    const h = policy.affiliateHaircutH;
    const m = policy.minMarginM;
    const r = policy.processingFeeRateR;
    const f = policy.fixedFeeFCents / 100;
    const v = policy.packptsValueVMicrousd / 1_000_000;

    const Cmax = ((h * A - m) * P - f) / (1 + r);
    const Rmax = Cmax > 0 ? Math.floor(Cmax / v) : 0;

    return {
      P,
      A,
      h,
      m,
      r,
      f,
      v,
      Cmax: Math.max(0, Cmax),
      Rmax,
    };
  }

  async createQuote(
    userId: string,
    source: "ebay" | "goldin",
    listingId: string,
    listingUrl: string,
    priceCents: number,
    currency: string = "usd"
  ): Promise<QuoteResult> {
    const policy = await this.getActivePolicy();
    if (!policy) {
      throw new Error("No active profit policy configured");
    }

    const calc = this.computeRmax(priceCents, policy);

    const [intent] = await db
      .insert(externalPurchaseIntent)
      .values({
        userId,
        source,
        listingId,
        listingUrl,
        priceCents,
        currency,
        computedRmax: calc.Rmax,
        calcSnapshot: calc,
        status: "CREATED",
      })
      .returning();

    let explanationText: string;
    if (calc.Rmax === 0) {
      explanationText =
        "This listing is not eligible for PackPTS credit due to margin requirements.";
    } else {
      const creditDollars = (calc.Rmax * calc.v).toFixed(2);
      explanationText = `You can apply up to ${calc.Rmax.toLocaleString()} PackPTS for $${creditDollars} credit on this purchase.`;
    }

    return {
      rMax: calc.Rmax,
      creditCentsMax: Math.floor(calc.Rmax * calc.v * 100),
      policySummary: {
        minMargin: policy.minMarginM,
        packptsValueUsd: calc.v,
      },
      explanationText,
      purchaseIntentId: intent.id,
    };
  }

  async applyRedemption(
    userId: string,
    purchaseIntentId: string,
    requestedRedeemPackpts: number
  ): Promise<ApplyResult> {
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(
        and(
          eq(externalPurchaseIntent.id, purchaseIntentId),
          eq(externalPurchaseIntent.userId, userId)
        )
      );

    if (!intent) {
      throw new Error("Purchase intent not found");
    }

    if (intent.status !== "CREATED") {
      throw new Error(`Cannot apply redemption: intent status is ${intent.status}`);
    }

    const policy = await this.getActivePolicy();
    if (!policy) {
      throw new Error("No active profit policy configured");
    }

    const freshCalc = this.computeRmax(intent.priceCents, policy);

    const wallet = await walletService.getWallet(userId);
    const userBalance = wallet?.balance ?? 0;

    const approvedRedeemPackpts = Math.min(
      requestedRedeemPackpts,
      freshCalc.Rmax,
      userBalance
    );

    if (approvedRedeemPackpts <= 0) {
      await db
        .update(externalPurchaseIntent)
        .set({
          status: "DENIED",
          requestedRedeemPackpts,
          approvedRedeemPackpts: 0,
          updatedAt: new Date(),
        })
        .where(eq(externalPurchaseIntent.id, purchaseIntentId));

      return {
        success: false,
        approvedRedeemPackpts: 0,
        creditCents: 0,
        redemptionCreditId: "",
        message:
          approvedRedeemPackpts === 0 && userBalance === 0
            ? "Insufficient PackPTS balance"
            : "No redemption allowed for this purchase",
      };
    }

    const creditCents = Math.floor(
      approvedRedeemPackpts * (policy.packptsValueVMicrousd / 1_000_000) * 100
    );

    // Check if a redemption credit already exists for this intent (idempotency check)
    const [existingCredit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

    if (existingCredit) {
      // Return the existing result for idempotency
      return {
        success: true,
        approvedRedeemPackpts: existingCredit.packptsSpent,
        creditCents: existingCredit.creditCents,
        redemptionCreditId: existingCredit.id,
        message: `Already reserved ${existingCredit.packptsSpent.toLocaleString()} PackPTS for $${(existingCredit.creditCents / 100).toFixed(2)} credit`,
      };
    }

    const idempotencyKey = `redeem:${purchaseIntentId}`;
    const spendResult = await walletService.spend(
      userId,
      approvedRedeemPackpts,
      `Marketplace redemption: ${intent.source} listing ${intent.listingId}`,
      idempotencyKey
    );

    if (!spendResult.success || !spendResult.ledgerEntry) {
      throw new Error(spendResult.error || "Failed to spend PackPTS");
    }

    // Use onConflictDoNothing to handle race conditions with the unique constraint
    const [credit] = await db
      .insert(redemptionCredit)
      .values({
        purchaseIntentId,
        userId,
        packptsSpent: approvedRedeemPackpts,
        creditCents,
        status: "PENDING",
        ledgerSpendEntryId: spendResult.ledgerEntry.id,
      })
      .onConflictDoNothing()
      .returning();

    // If no credit was created due to conflict, fetch the existing one
    if (!credit) {
      const [existingAfterConflict] = await db
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));
      
      if (existingAfterConflict) {
        return {
          success: true,
          approvedRedeemPackpts: existingAfterConflict.packptsSpent,
          creditCents: existingAfterConflict.creditCents,
          redemptionCreditId: existingAfterConflict.id,
          message: `Already reserved ${existingAfterConflict.packptsSpent.toLocaleString()} PackPTS`,
        };
      }
      throw new Error("Failed to create redemption credit");
    }

    await db
      .update(externalPurchaseIntent)
      .set({
        status: "APPROVED",
        requestedRedeemPackpts,
        approvedRedeemPackpts,
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));

    return {
      success: true,
      approvedRedeemPackpts,
      creditCents,
      redemptionCreditId: credit.id,
      message: `Reserved ${approvedRedeemPackpts.toLocaleString()} PackPTS for $${(creditCents / 100).toFixed(2)} credit`,
    };
  }

  async confirmPurchase(
    userId: string,
    purchaseIntentId: string,
    evidence?: string
  ): Promise<{ success: boolean; message: string }> {
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(
        and(
          eq(externalPurchaseIntent.id, purchaseIntentId),
          eq(externalPurchaseIntent.userId, userId)
        )
      );

    if (!intent) {
      throw new Error("Purchase intent not found");
    }

    if (intent.status !== "APPROVED") {
      throw new Error(`Cannot confirm purchase: intent status is ${intent.status}`);
    }

    await db
      .update(externalPurchaseIntent)
      .set({
        status: "PURCHASE_CONFIRMED",
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));

    await db
      .update(redemptionCredit)
      .set({ status: "GRANTED" })
      .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

    return {
      success: true,
      message: "Purchase confirmed. Credit has been granted.",
    };
  }

  async getPurchaseIntent(
    intentId: string
  ): Promise<ExternalPurchaseIntent | null> {
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.id, intentId));

    return intent || null;
  }

  async getUserPurchaseIntents(
    userId: string,
    status?: string
  ): Promise<ExternalPurchaseIntent[]> {
    if (status) {
      return db
        .select()
        .from(externalPurchaseIntent)
        .where(
          and(
            eq(externalPurchaseIntent.userId, userId),
            eq(externalPurchaseIntent.status, status as any)
          )
        )
        .orderBy(desc(externalPurchaseIntent.createdAt));
    }

    return db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.userId, userId))
      .orderBy(desc(externalPurchaseIntent.createdAt));
  }

  async updatePolicy(
    policyData: Partial<{
      minMarginM: number;
      affiliateRateA: number;
      affiliateHaircutH: number;
      processingFeeRateR: number;
      fixedFeeFCents: number;
      packptsValueVMicrousd: number;
    }>
  ): Promise<ProfitPolicy> {
    await db
      .update(profitPolicy)
      .set({ enabled: false })
      .where(eq(profitPolicy.enabled, true));

    const defaults = {
      minMarginM: 0.25,
      affiliateRateA: 0.02,
      affiliateHaircutH: 0.70,
      processingFeeRateR: 0.00,
      fixedFeeFCents: 0,
      packptsValueVMicrousd: 2000,
    };

    const [newPolicy] = await db
      .insert(profitPolicy)
      .values({
        ...defaults,
        ...policyData,
        effectiveFrom: new Date(),
        enabled: true,
      })
      .returning();

    return newPolicy;
  }

  async getRedemptionQueue(
    status?: "PENDING" | "GRANTED" | "REVERSED"
  ): Promise<RedemptionCredit[]> {
    if (status) {
      return db
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.status, status))
        .orderBy(desc(redemptionCredit.createdAt));
    }

    return db
      .select()
      .from(redemptionCredit)
      .orderBy(desc(redemptionCredit.createdAt));
  }

  async reverseRedemption(
    redemptionCreditId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    const [credit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.id, redemptionCreditId));

    if (!credit) {
      throw new Error("Redemption credit not found");
    }

    if (credit.status === "REVERSED") {
      return { success: false, message: "Redemption already reversed" };
    }

    const idempotencyKey = `reversal:${redemptionCreditId}`;
    await walletService.earn(
      credit.userId,
      credit.packptsSpent,
      `Redemption reversal: ${reason}`,
      idempotencyKey
    );

    await db
      .update(redemptionCredit)
      .set({ status: "REVERSED" })
      .where(eq(redemptionCredit.id, redemptionCreditId));

    await db
      .update(externalPurchaseIntent)
      .set({
        status: "CANCELED",
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, credit.purchaseIntentId));

    return {
      success: true,
      message: `Reversed ${credit.packptsSpent} PackPTS`,
    };
  }
}

export const profitGuardrailService = new ProfitGuardrailService();
