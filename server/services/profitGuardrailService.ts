import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
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

    // Redemption credit is funded by affiliate revenue: h*A*P is the reliable
    // affiliate margin on the purchase, and the business retains fraction m of
    // that margin (docs: "70% of affiliate revenue funds redemptions, 25%
    // minimum margin"). The previous formula ((h*A - m) * P) subtracted m as a
    // fraction of PRICE from a revenue rate of ~1.4% of price — negative for
    // every possible listing, so Rmax was permanently 0 and no eBay redemption
    // could ever grant credit.
    const Cmax = (h * A * P * (1 - m) - f) / (1 + r);
    // Integer micro-USD math for the floor: raw Cmax carries IEEE-754 noise
    // (e.g. 1.0499999...) that would silently drop a PackPTS at the floor().
    const cmaxMicroUsd = Math.round(Cmax * 1_000_000);
    const Rmax = cmaxMicroUsd > 0 ? Math.floor(cmaxMicroUsd / policy.packptsValueVMicrousd) : 0;

    return {
      P,
      A,
      h,
      m,
      r,
      f,
      v,
      Cmax: Math.max(0, Math.round(Cmax * 100) / 100),
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
    const solvency = await treasuryService.getSolvencyStatus();

    // Compute margin-backed allowed cap (the SOLVENCY gate — never pay beyond it)
    const allowedCapCents = treasury.availableMarginPoolCents + txMargin.transactionMarginCents;
    const packptsValueCents = policy.packptsValueVMicrousd / 10000; // micro-USD to cents

    // MEANINGFUL-DISCOUNT ceiling: up to maxDiscountPct of the purchase price.
    // This is the headline generosity dial, decoupled from the ~1% affiliate
    // formula. It is only ACHIEVED when the reserve + per-user caps allow it.
    const maxDiscountPct = (policy as any).maxDiscountPct ?? 0.15;
    const meaningfulCreditCents = Math.floor(priceCents * maxDiscountPct);

    // Per-user velocity caps (rolling 24h / 7d, counts PENDING + GRANTED credit)
    const perUserDailyCents = (policy as any).perUserDailyCreditCents ?? 2500;
    const perUserWeeklyCents = (policy as any).perUserWeeklyCreditCents ?? 10000;
    const [dayUsed] = await db
      .select({ total: sql<number>`COALESCE(SUM(${redemptionCredit.creditCents}), 0)::int` })
      .from(redemptionCredit)
      .where(and(
        eq(redemptionCredit.userId, userId),
        sql`${redemptionCredit.status} IN ('PENDING','GRANTED')`,
        sql`${redemptionCredit.createdAt} > NOW() - INTERVAL '24 hours'`,
      ));
    const [weekUsed] = await db
      .select({ total: sql<number>`COALESCE(SUM(${redemptionCredit.creditCents}), 0)::int` })
      .from(redemptionCredit)
      .where(and(
        eq(redemptionCredit.userId, userId),
        sql`${redemptionCredit.status} IN ('PENDING','GRANTED')`,
        sql`${redemptionCredit.createdAt} > NOW() - INTERVAL '7 days'`,
      ));
    const dailyRemainingCents = Math.max(0, perUserDailyCents - Number(dayUsed?.total ?? 0));
    const weeklyRemainingCents = Math.max(0, perUserWeeklyCents - Number(weekUsed?.total ?? 0));

    // Reserve-floor kill switch: if funded reserve is below the floor, redemptions
    // are globally paused (solvency protection).
    const reserveHealthy = solvency.redemptionsHealthy;

    // Final credit = the MINIMUM of every ceiling. Meaningful up to maxDiscountPct,
    // but never more than the reserve, the per-user caps, or the affiliate formula
    // would each independently allow.
    const formulaCreditCents = Math.floor(calc.Rmax * packptsValueCents);
    const marginBackedCreditCentsMax = reserveHealthy
      ? Math.max(0, Math.min(
          meaningfulCreditCents,
          allowedCapCents,
          dailyRemainingCents,
          weeklyRemainingCents,
        ))
      : 0;
    let marginBackedRmax = Math.floor(marginBackedCreditCentsMax / packptsValueCents);

    // Enforce the minimum-redemption floor: sub-threshold offers show as ineligible
    const minRedemptionPackpts = (policy as any).minRedemptionPackpts ?? 500;
    if (marginBackedRmax < minRedemptionPackpts) {
      marginBackedRmax = 0;
    }

    const marginPoolAvailable = allowedCapCents > 0 && reserveHealthy;

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
    if (!reserveHealthy) {
      explanationText = "PackPTS redemption is temporarily paused while the rewards reserve is replenished.";
    } else if (!marginPoolAvailable) {
      explanationText = "PackPTS redemption temporarily unavailable for external purchases.";
    } else if (dailyRemainingCents <= 0 || weeklyRemainingCents <= 0) {
      explanationText = "You've reached your PackPTS redemption limit for now. Check back soon.";
    } else if (marginBackedRmax === 0) {
      explanationText = "This listing is not eligible for PackPTS credit right now.";
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

    // Clamp the request to the ceiling computed at quote time (intent.computedRmax
    // already folded in the meaningful-discount cap, the reserve, and the
    // per-user velocity caps). Prevents an apply from exceeding what the quote
    // authorized even if the client sends a larger number.
    if (requestedRedeemPackpts > intent.computedRmax) {
      requestedRedeemPackpts = intent.computedRmax;
    }
    if (requestedRedeemPackpts <= 0) {
      return {
        success: false,
        approvedRedeemPackpts: 0,
        creditCents: 0,
        redemptionCreditId: "",
        message: "No redemption available for this purchase",
      };
    }

    // Pre-check: frozen user — FAIL CLOSED. A risk-read failure must block the
    // redemption (money movement), not silently allow it.
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
      console.error("[Redemption] risk-state check failed — denying (fail-closed):", e);
      return {
        success: false,
        approvedRedeemPackpts: 0,
        creditCents: 0,
        redemptionCreditId: "",
        message: "Unable to verify account status; please try again shortly",
      };
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

    // All mutating steps wrapped in a single transaction so they commit or rollback together
    return await db.transaction(async (tx) => {
      // Idempotency check inside the transaction to close the race window where two
      // concurrent requests could both pass an outer check and double-charge the user.
      const [existingCredit] = await tx
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
        tx,
        { source: "redemption", eventType: "marketplace_redemption", refType: "purchase_intent", refId: String(purchaseIntentId) }
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
    return await db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(externalPurchaseIntent)
        .where(
          and(
            eq(externalPurchaseIntent.id, purchaseIntentId),
            eq(externalPurchaseIntent.userId, userId)
          )
        )
        .for("update");

      if (!intent) {
        throw new Error("Purchase intent not found");
      }

      if (intent.status !== "APPROVED") {
        throw new Error(`Cannot confirm purchase: intent status is ${intent.status}`);
      }

      const [credit] = await tx
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

      if (!credit) {
        throw new Error("Redemption credit not found for this purchase intent");
      }

      // High-value confirmations require admin review before the credit is
      // finalized (the confirm is a user self-attestation of purchase, so large
      // credits are held pending human verification of the evidence). Low-value
      // credits auto-grant. The wallet was already debited at apply time either
      // way; review only gates FINALIZATION and reservation consumption.
      const REVIEW_THRESHOLD_CENTS = 2500; // $25
      if (credit.creditCents >= REVIEW_THRESHOLD_CENTS) {
        await tx
          .update(externalPurchaseIntent)
          .set({ status: "PURCHASE_CONFIRMED", updatedAt: new Date() })
          .where(eq(externalPurchaseIntent.id, purchaseIntentId));
        return {
          success: true,
          message: "Purchase confirmed. Your credit is pending review and will be granted shortly.",
        };
      }

      await treasuryService.consumeReservation(purchaseIntentId, credit.id, tx);

      await tx
        .update(externalPurchaseIntent)
        .set({
          status: "CREDIT_GRANTED",
          updatedAt: new Date(),
        })
        .where(eq(externalPurchaseIntent.id, purchaseIntentId));

      await tx
        .update(redemptionCredit)
        .set({ status: "GRANTED" })
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

      return {
        success: true,
        message: "Purchase confirmed. Credit has been granted.",
      };
    });
  }

  /**
   * Admin finalizes a high-value redemption that was held at PURCHASE_CONFIRMED
   * pending review. Consumes the reservation and grants the credit.
   */
  async adminGrantConfirmed(purchaseIntentId: string): Promise<{ success: boolean; message: string }> {
    return await db.transaction(async (tx) => {
      const [intent] = await tx
        .select().from(externalPurchaseIntent)
        .where(eq(externalPurchaseIntent.id, purchaseIntentId)).for("update");
      if (!intent) throw new Error("Purchase intent not found");
      if (intent.status !== "PURCHASE_CONFIRMED") {
        throw new Error(`Cannot grant: intent status is ${intent.status}`);
      }
      const [credit] = await tx
        .select().from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));
      if (!credit) throw new Error("Redemption credit not found");

      await treasuryService.consumeReservation(purchaseIntentId, credit.id, tx);
      await tx.update(externalPurchaseIntent)
        .set({ status: "CREDIT_GRANTED", updatedAt: new Date() })
        .where(eq(externalPurchaseIntent.id, purchaseIntentId));
      await tx.update(redemptionCredit)
        .set({ status: "GRANTED" })
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));
      return { success: true, message: "Credit granted." };
    });
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
      maxDiscountPct: number;
      perUserDailyCreditCents: number;
      perUserWeeklyCreditCents: number;
      minRedemptionPackpts: number;
      reserveFloorCents: number;
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
      maxDiscountPct: 0.15,
      perUserDailyCreditCents: 2500,
      perUserWeeklyCreditCents: 10000,
      minRedemptionPackpts: 500,
      reserveFloorCents: 0,
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
    return await db.transaction(async (tx) => {
      const [credit] = await tx
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.id, redemptionCreditId))
        .for("update");

      if (!credit) {
        throw new Error("Redemption credit not found");
      }

      if (credit.status === "REVERSED") {
        return { success: false, message: "Redemption already reversed" };
      }

      const [intent] = await tx
        .select()
        .from(externalPurchaseIntent)
        .where(eq(externalPurchaseIntent.id, credit.purchaseIntentId))
        .for("update");

      if (intent && intent.status === "CREDIT_GRANTED") {
        return { success: false, message: "Cannot reverse: purchase already confirmed and credit granted" };
      }

      const idempotencyKey = `reversal:${redemptionCreditId}`;
      const earnResult = await walletService.earn(
        credit.userId,
        credit.packptsSpent,
        `Redemption reversal: ${reason}`,
        idempotencyKey,
        undefined,
        tx,
        { source: "admin", eventType: "redemption_reversal", refType: "redemption_credit", refId: String(redemptionCreditId) }
      );

      if (!earnResult.success) {
        console.error(`[Guardrail] Reversal refund failed for credit ${redemptionCreditId}: ${earnResult.error}`);
        throw new Error(`Reversal refund failed: ${earnResult.error}`);
      }

      await treasuryService.releaseReservation(credit.purchaseIntentId, tx);

      await tx
        .update(redemptionCredit)
        .set({ status: "REVERSED" })
        .where(eq(redemptionCredit.id, redemptionCreditId));

      await tx
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
    });
  }

  async cancelRedemption(
    userId: string,
    purchaseIntentId: string
  ): Promise<{ success: boolean; message: string }> {
    return await db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(externalPurchaseIntent)
        .where(
          and(
            eq(externalPurchaseIntent.id, purchaseIntentId),
            eq(externalPurchaseIntent.userId, userId)
          )
        )
        .for("update");

      if (!intent) {
        throw new Error("Purchase intent not found");
      }

      if (intent.status !== "APPROVED") {
        throw new Error(`Cannot cancel: intent status is ${intent.status}`);
      }

      const [credit] = await tx
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, purchaseIntentId));

      if (!credit) {
        throw new Error("Redemption credit not found");
      }

      const idempotencyKey = `cancel:${purchaseIntentId}`;
      const earnResult = await walletService.earn(
        userId,
        credit.packptsSpent,
        `Redemption canceled by user`,
        idempotencyKey,
        undefined,
        tx,
        { source: "redemption", eventType: "redemption_canceled", refType: "purchase_intent", refId: String(purchaseIntentId) }
      );

      if (!earnResult.success) {
        console.error(`[Guardrail] Cancel refund failed for intent ${purchaseIntentId}: ${earnResult.error}`);
        throw new Error(`Cancel refund failed: ${earnResult.error}`);
      }

      await treasuryService.releaseReservation(purchaseIntentId, tx);

      await tx
        .update(redemptionCredit)
        .set({ status: "REVERSED" })
        .where(eq(redemptionCredit.id, credit.id));

      await tx
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
    });
  }
}

export const profitGuardrailService = new ProfitGuardrailService();
