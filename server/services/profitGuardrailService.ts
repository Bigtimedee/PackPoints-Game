import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import {
  profitPolicy,
  externalPurchaseIntent,
  redemptionCredit,
  wallets,
  ledgerEntries,
  userRiskState,
  type ProfitPolicy,
  type ExternalPurchaseIntent,
  type RedemptionCredit,
} from "@shared/schema";
import { walletService } from "./walletService";
import { treasuryService } from "./treasuryService";

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
  marginBackedRmax: number;
  marginBackedCreditCentsMax: number;
  marginPoolAvailable: boolean;
  policySummary: {
    minMargin: number;
    packptsValueUsd: number;
  };
  treasurySnapshot: {
    availableMarginPoolCents: number;
    transactionMarginCents: number;
    allowedCapCents: number;
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

    // Compute formula-based Rmax
    const calc = this.computeRmax(priceCents, policy);

    // Get treasury status and transaction margin
    const treasury = await treasuryService.getTreasuryStatus();
    const txMargin = await treasuryService.computeTransactionMargin(source, priceCents);
    
    // Compute margin-backed allowed cap
    const allowedCapCents = treasury.availableMarginPoolCents + txMargin.transactionMarginCents;
    const packptsValueCents = policy.packptsValueVMicrousd / 10000; // micro-USD to cents
    
    // Margin-backed Rmax is the minimum of formula Rmax and what the margin pool can support
    const formulaCreditCents = Math.floor(calc.Rmax * packptsValueCents);
    const marginBackedCreditCentsMax = Math.min(formulaCreditCents, allowedCapCents);
    const marginBackedRmax = Math.floor(marginBackedCreditCentsMax / packptsValueCents);
    
    const marginPoolAvailable = allowedCapCents > 0;

    const [intent] = await db
      .insert(externalPurchaseIntent)
      .values({
        userId,
        source,
        listingId,
        listingUrl,
        priceCents,
        currency,
        computedRmax: marginBackedRmax, // Store margin-backed limit
        calcSnapshot: {
          ...calc,
          marginPoolCents: treasury.availableMarginPoolCents,
          txMarginCents: txMargin.transactionMarginCents,
          allowedCapCents,
        },
        status: "CREATED",
      })
      .returning();

    let explanationText: string;
    if (!marginPoolAvailable) {
      explanationText = "PackPTS redemption temporarily unavailable for external purchases.";
    } else if (marginBackedRmax === 0) {
      explanationText = "This listing is not eligible for PackPTS credit due to margin requirements.";
    } else {
      const creditDollars = (marginBackedRmax * (policy.packptsValueVMicrousd / 1_000_000)).toFixed(2);
      explanationText = `You can apply up to ${marginBackedRmax.toLocaleString()} PackPTS for $${creditDollars} credit on this purchase.`;
    }

    return {
      rMax: calc.Rmax, // Formula-based max (for reference)
      creditCentsMax: formulaCreditCents,
      marginBackedRmax, // Margin-pool backed max (actual limit)
      marginBackedCreditCentsMax,
      marginPoolAvailable,
      policySummary: {
        minMargin: policy.minMarginM,
        packptsValueUsd: policy.packptsValueVMicrousd / 1_000_000,
      },
      treasurySnapshot: {
        availableMarginPoolCents: treasury.availableMarginPoolCents,
        transactionMarginCents: txMargin.transactionMarginCents,
        allowedCapCents,
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

    // Pre-check: frozen user
    try {
      const [riskState] = await db
        .select()
        .from(userRiskState)
        .where(eq(userRiskState.userId, userId))
        .limit(1);

      if (riskState && riskState.status !== "NORMAL") {
        return {
          success: false,
          approvedRedeemPackpts: 0,
          creditCents: 0,
          redemptionCreditId: "",
          message: "Your account is currently restricted from redemptions",
        };
      }
    } catch (e) {
      // If risk check fails, allow to continue (fail-open for reads)
    }

    // Pre-check: wallet status
    const wallet = await walletService.getWallet(userId);
    if (!wallet) {
      return {
        success: false,
        approvedRedeemPackpts: 0,
        creditCents: 0,
        redemptionCreditId: "",
        message: "Wallet not found",
      };
    }
    if (wallet.status !== "active") {
      return {
        success: false,
        approvedRedeemPackpts: 0,
        creditCents: 0,
        redemptionCreditId: "",
        message: `Your wallet is ${wallet.status}`,
      };
    }

    const userBalance = wallet.balance;

    const policy = await this.getActivePolicy();
    if (!policy) {
      throw new Error("No active profit policy configured");
    }

    const allowed = await treasuryService.computeAllowedRedemption(
      userId,
      intent.source as "ebay" | "goldin",
      intent.priceCents,
      requestedRedeemPackpts,
      userBalance
    );

    if (allowed.rejected) {
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
        message: allowed.reason === "INSUFFICIENT_MARGIN_BACKING"
          ? "PackPTS redemption temporarily unavailable - insufficient margin backing"
          : userBalance === 0
            ? "Insufficient PackPTS balance"
            : "No redemption allowed for this purchase",
      };
    }

    const approvedRedeemPackpts = allowed.approvedPackpts;
    const creditCents = allowed.approvedCreditCents;

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
        message: "No redemption allowed for this purchase",
      };
    }

    // Idempotency check before entering transaction
    const [existingCredit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

    if (existingCredit) {
      return {
        success: true,
        approvedRedeemPackpts: existingCredit.packptsSpent,
        creditCents: existingCredit.creditCents,
        redemptionCreditId: existingCredit.id,
        message: `Already reserved ${existingCredit.packptsSpent.toLocaleString()} PackPTS for $${(existingCredit.creditCents / 100).toFixed(2)} credit`,
      };
    }

    // All mutating steps wrapped in a single transaction so they commit or rollback together
    return await db.transaction(async (tx) => {
      // Step 1: Create margin reservation
      await treasuryService.createReservation(purchaseIntentId, creditCents, tx);

      // Step 2: Spend user PackPTS (using the same tx)
      const idempotencyKey = `redeem:${purchaseIntentId}`;
      const spendResult = await walletService.spend(
        userId,
        approvedRedeemPackpts,
        `Marketplace redemption: ${intent.source} listing ${intent.listingId}`,
        idempotencyKey,
        undefined,
        tx
      );

      if (!spendResult.success || !spendResult.ledgerEntry) {
        throw new Error(spendResult.error || "Failed to spend PackPTS");
      }

      // Step 3: Create redemption credit record
      const [credit] = await tx
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

      if (!credit) {
        const [existingAfterConflict] = await tx
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

      // Step 4: Update purchase intent status
      await tx
        .update(externalPurchaseIntent)
        .set({
          status: "APPROVED",
          requestedRedeemPackpts,
          approvedRedeemPackpts,
          updatedAt: new Date(),
        })
        .where(eq(externalPurchaseIntent.id, purchaseIntentId));

      const clampedMessage = allowed.clamped
        ? ` (clamped from ${requestedRedeemPackpts.toLocaleString()} due to margin limits)`
        : "";

      return {
        success: true,
        approvedRedeemPackpts,
        creditCents,
        redemptionCreditId: credit.id,
        message: `Reserved ${approvedRedeemPackpts.toLocaleString()} PackPTS for $${(creditCents / 100).toFixed(2)} credit${clampedMessage}`,
      };
    });
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

    // Get the redemption credit to consume the reservation
    const [credit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

    if (!credit) {
      throw new Error("Redemption credit not found for this purchase intent");
    }

    // Consume the reservation and record margin usage
    await treasuryService.consumeReservation(purchaseIntentId, credit.id);

    // Update intent status
    await db
      .update(externalPurchaseIntent)
      .set({
        status: "CREDIT_GRANTED",
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));

    // Grant the credit
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

    // Release the margin reservation (if still active)
    await treasuryService.releaseReservation(credit.purchaseIntentId);

    // Refund the PackPTS to the user
    const idempotencyKey = `reversal:${redemptionCreditId}`;
    const earnResult = await walletService.earn(
      credit.userId,
      credit.packptsSpent,
      `Redemption reversal: ${reason}`,
      idempotencyKey
    );

    if (!earnResult.success) {
      console.error(`[Guardrail] Reversal refund failed for credit ${redemptionCreditId}: ${earnResult.error}`);
      throw new Error(`Reversal refund failed: ${earnResult.error}`);
    }

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

  async cancelRedemption(
    userId: string,
    purchaseIntentId: string
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
      throw new Error(`Cannot cancel: intent status is ${intent.status}`);
    }

    // Get the redemption credit
    const [credit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

    if (!credit) {
      throw new Error("Redemption credit not found");
    }

    // Release the margin reservation
    await treasuryService.releaseReservation(purchaseIntentId);

    // Refund PackPTS
    const idempotencyKey = `cancel:${purchaseIntentId}`;
    const earnResult = await walletService.earn(
      userId,
      credit.packptsSpent,
      `Redemption canceled by user`,
      idempotencyKey
    );

    if (!earnResult.success) {
      console.error(`[Guardrail] Cancel refund failed for intent ${purchaseIntentId}: ${earnResult.error}`);
      throw new Error(`Cancel refund failed: ${earnResult.error}`);
    }

    // Update statuses
    await db
      .update(redemptionCredit)
      .set({ status: "REVERSED" })
      .where(eq(redemptionCredit.id, credit.id));

    await db
      .update(externalPurchaseIntent)
      .set({
        status: "CANCELED",
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));

    return {
      success: true,
      message: `Canceled redemption and refunded ${credit.packptsSpent} PackPTS`,
    };
  }
}

export const profitGuardrailService = new ProfitGuardrailService();
