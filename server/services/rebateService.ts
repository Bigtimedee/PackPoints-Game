import { db } from "../db";
import { classifyEpnStatus, canonicalEbayItem, matchesEpnIntent, parseEpnMoney, resolveEpnLine, epnItemList, normalizeEpnCustomId } from "./epnVerification";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  attributedPurchases,
  marginLedger,
  externalPurchaseIntent,
  outboundClicks,
  rebateLedger,
  rebatePayoutRequests,
  redemptionCredit,
  users,
  wallets,
  type ExternalPurchaseIntent,
  type RedemptionCredit,
} from "@shared/schema";
import { treasuryService } from "./treasuryService";
import { walletService } from "./walletService";
import { recordRebateAudit } from "./rebateAuditService";
import {
  PAYOUT_MIN_CENTS,
  PAYOUT_HOLD_DAYS,
  computeWithdrawableCents,
  commissionGrant,
  normalizePayoutDestination,
  payoutReviewFlags,
} from "./guardrailPolicy";
import { sendRebateReceiptEmail } from "./emailService";
import { buildReceiptPlaqueView, RECEIPT_LIST_STATUSES, type ReceiptPlaqueView } from "@shared/receiptContract";

// Only a verified eBay affiliate postback credits cashback. Older rows may carry
// USER_CONFIRM or ADMIN_GRANT in grant_method; no new rows are written with them.
export type RebateGrantMethod = "EPN_POSTBACK";

export interface RebateGrantResult {
  success: boolean;
  granted: boolean;
  heldForReview: boolean;
  alreadyGranted: boolean;
  rebateBalanceCents: number;
  creditCents: number;
  packptsSpent: number;
  receiptUrl: string;
  message: string;
}

export interface PurchaseEvidence {
  orderId?: string;
  evidenceNote?: string;
  receiptUrl?: string;
  evidence?: string;
}

export interface RedemptionReceipt {
  intent: ExternalPurchaseIntent;
  credit: RedemptionCredit | null;
  rebateBalanceCents: number;
  grantMethod: string | null;
  plaque: ReceiptPlaqueView;
  honesty: string;
}

const SITE_URL = () => process.env.SITE_URL || "https://packpts.com";

const HONESTY =
  "Post-purchase rebate. Partner checkout unchanged.";

function assembleReceipt(
  intent: ExternalPurchaseIntent,
  credit: RedemptionCredit | null,
  rebateBalanceCents: number,
): RedemptionReceipt {
  const grantMethod = intent.grantMethod || credit?.grantMethod || null;
  return {
    intent,
    credit,
    rebateBalanceCents,
    grantMethod,
    plaque: buildReceiptPlaqueView({
      intentId: intent.id,
      source: intent.source,
      listingId: intent.listingId,
      listingTitle: intent.listingTitle ?? null,
      listingUrl: intent.listingUrl,
      priceCents: intent.priceCents,
      packptsSpent: credit?.packptsSpent ?? intent.approvedRedeemPackpts ?? 0,
      creditCents: credit?.creditCents ?? 0,
      status: intent.status,
      grantMethod,
      grantedAt: intent.grantedAt ?? credit?.grantedAt ?? null,
      createdAt: intent.createdAt ?? null,
      evidenceOrderId: intent.evidenceOrderId ?? null,
      evidenceNote: intent.evidenceNote ?? null,
      evidenceReceiptUrl: intent.evidenceReceiptUrl ?? null,
      deniedReason: intent.deniedReason ?? null,
      rebateBalanceCents,
    }),
    honesty: HONESTY,
  };
}

function receiptPath(intentId: string): string {
  return `${SITE_URL()}/redemptions/${intentId}`;
}

class RebateService {
  async getRebateBalance(userId: string): Promise<number> {
    const [wallet] = await db
      .select({ rebateBalanceCents: wallets.rebateBalanceCents })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    return wallet?.rebateBalanceCents ?? 0;
  }

  async getReceipt(userId: string, intentId: string): Promise<RedemptionReceipt | null> {
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(and(eq(externalPurchaseIntent.id, intentId), eq(externalPurchaseIntent.userId, userId)));
    if (!intent) return null;

    const [credit] = await db
      .select()
      .from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, intentId));

    return assembleReceipt(intent, credit || null, await this.getRebateBalance(userId));
  }

  async listReceipts(userId: string): Promise<RedemptionReceipt[]> {
    const intents = await db
      .select()
      .from(externalPurchaseIntent)
      .where(
        and(
          eq(externalPurchaseIntent.userId, userId),
          or(
            ...RECEIPT_LIST_STATUSES.map((status) =>
              eq(externalPurchaseIntent.status, status),
            ),
          )
        )
      )
      .orderBy(desc(externalPurchaseIntent.createdAt))
      .limit(50);

    const credits = intents.length
      ? await db
          .select()
          .from(redemptionCredit)
          .where(
            sql`${redemptionCredit.purchaseIntentId} IN (${sql.join(
              intents.map((i) => sql`${i.id}`),
              sql`, `
            )})`
          )
      : [];
    const creditByIntent = new Map(credits.map((c) => [c.purchaseIntentId, c]));
    const rebateBalanceCents = await this.getRebateBalance(userId);

    return intents.map((intent) =>
      assembleReceipt(intent, creditByIntent.get(intent.id) || null, rebateBalanceCents),
    );
  }

  async persistEvidence(
    userId: string,
    purchaseIntentId: string,
    evidence: PurchaseEvidence
  ): Promise<void> {
    const orderId = evidence.orderId?.trim() || null;
    const note = evidence.evidenceNote?.trim() || evidence.evidence?.trim() || null;
    const receiptUrl = evidence.receiptUrl?.trim() || null;

    await db
      .update(externalPurchaseIntent)
      .set({
        evidenceOrderId: orderId,
        evidenceNote: note,
        evidenceReceiptUrl: receiptUrl || null,
        evidenceSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(externalPurchaseIntent.id, purchaseIntentId),
          eq(externalPurchaseIntent.userId, userId)
        )
      );
  }

  /**
   * Record a purchase the user says they made. This never credits: a claim is not
   * verified against eBay or Goldin. Cashback is credited only when eBay's affiliate
   * report confirms the purchase (grantFromEpnPostback). The claim is kept as
   * evidence and written to the audit log.
   */
  async confirmPurchase(
    userId: string,
    purchaseIntentId: string,
    evidence: PurchaseEvidence = {}
  ): Promise<RebateGrantResult> {
    const hasEvidence = Boolean(
      evidence.orderId?.trim() || evidence.evidenceNote?.trim() || evidence.evidence?.trim() || evidence.receiptUrl?.trim()
    );
    if (!hasEvidence) {
      throw new Error("Order id, receipt URL, or a short note is required to record a purchase");
    }
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(and(eq(externalPurchaseIntent.id, purchaseIntentId), eq(externalPurchaseIntent.userId, userId)));
    if (!intent) throw new Error("Purchase intent not found");
    const [credit] = await db.select().from(redemptionCredit).where(eq(redemptionCredit.purchaseIntentId, intent.id));
    const wallet = await walletService.getWallet(userId);
    if (intent.status === "CREDIT_GRANTED") {
      return {
        success: true,
        granted: true,
        heldForReview: false,
        alreadyGranted: true,
        rebateBalanceCents: wallet?.rebateBalanceCents ?? 0,
        creditCents: credit?.creditCents ?? 0,
        packptsSpent: credit?.packptsSpent ?? intent.approvedRedeemPackpts,
        receiptUrl: receiptPath(intent.id),
        message: "Cashback already granted.",
      };
    }
    if (intent.status !== "APPROVED" && intent.status !== "PURCHASE_CONFIRMED") {
      throw new Error(`Cannot record a purchase: intent status is ${intent.status}`);
    }
    await this.persistEvidence(userId, purchaseIntentId, evidence);
    await recordRebateAudit(db, {
      event: "CLAIM_RECORDED",
      actor: `user:${userId}`,
      userId,
      purchaseIntentId,
      details: {
        source: intent.source,
        orderId: evidence.orderId?.trim() || null,
        hasReceiptUrl: Boolean(evidence.receiptUrl?.trim()),
        creditedByClaim: false,
      },
    });
    return {
      success: true,
      granted: false,
      heldForReview: false,
      alreadyGranted: false,
      rebateBalanceCents: wallet?.rebateBalanceCents ?? 0,
      creditCents: credit?.creditCents ?? 0,
      packptsSpent: credit?.packptsSpent ?? intent.approvedRedeemPackpts,
      receiptUrl: receiptPath(intent.id),
      message:
        intent.source === "ebay"
          ? "Recorded. Cashback is added automatically when eBay confirms your purchase."
          : "Recorded. Goldin purchases cannot be confirmed automatically, so no cashback is added.",
    };
  }

  async adminDeny(
    purchaseIntentId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    const { profitGuardrailService } = await import("./profitGuardrailService");
    const [intent] = await db
      .select()
      .from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));
    if (!intent) throw new Error("Purchase intent not found");
    if (intent.status === "CREDIT_GRANTED") {
      throw new Error("Cannot deny: cashback already granted");
    }
    if (intent.status !== "APPROVED" && intent.status !== "PURCHASE_CONFIRMED") {
      throw new Error(`Cannot deny: intent status is ${intent.status}`);
    }

    const result = await profitGuardrailService.cancelRedemption(intent.userId, purchaseIntentId);
    await db
      .update(externalPurchaseIntent)
      .set({
        status: "DENIED",
        deniedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(externalPurchaseIntent.id, purchaseIntentId));
    await recordRebateAudit(db, {
      event: "INTENT_DENIED",
      actor: "admin",
      userId: intent.userId,
      purchaseIntentId,
      packpts: intent.approvedRedeemPackpts,
      details: { reason },
    });
    return { success: result.success, message: `Denied and refunded PackPTS. ${reason}` };
  }

  /** Grant only one unambiguous intent belonging to the authenticated tracked click. */
  async grantFromEpnPostback(input: {
    customId: string;
    attributedPurchaseId?: string;
    userId?: string | null;
    listingId?: string | null;
    outboundClickId?: string | null;
    salePriceCents?: number | null;
  }): Promise<RebateGrantResult[]> {
    if (!input.userId || !input.outboundClickId || !input.attributedPurchaseId || !input.salePriceCents) return [];
    const [click] = await db.select().from(outboundClicks).where(eq(outboundClicks.id, input.outboundClickId));
    if (!click || click.customId !== input.customId || click.userId !== input.userId) return [];
    const [consumed] = await db.select().from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.attributedPurchaseId, input.attributedPurchaseId)).limit(1);
    if (consumed) return [];
    const intents = await db.select().from(externalPurchaseIntent).where(and(
      eq(externalPurchaseIntent.userId, input.userId),
      or(eq(externalPurchaseIntent.status, "APPROVED"), eq(externalPurchaseIntent.status, "PURCHASE_CONFIRMED")),
    ));
    const matches = intents.filter(intent => matchesEpnIntent(intent, click, input.salePriceCents!));
    if (matches.length === 0) {
      await recordRebateAudit(db, {
        event: "EPN_POSTBACK_NO_MATCH",
        actor: "epn_postback",
        userId: input.userId,
        details: {
          attributedPurchaseId: input.attributedPurchaseId,
          outboundClickId: input.outboundClickId,
          reportedTotalCents: input.salePriceCents,
          openIntents: intents.length,
        },
      });
      return [];
    }
    if (matches.length !== 1) {
      await recordRebateAudit(db, {
        event: "EPN_POSTBACK_REJECTED",
        actor: "epn_postback",
        userId: input.userId,
        details: { attributedPurchaseId: input.attributedPurchaseId, reason: "more than one open apply matches", matches: matches.length },
      });
      return []; // Never fan one conversion out across multiple applies.
    }
    return [await this.grantForIntent({
      purchaseIntentId: matches[0].id,
      expectedUserId: input.userId,
      method: "EPN_POSTBACK",
      attributedPurchaseId: input.attributedPurchaseId,
      outboundClickId: click.id,
    })];
  }

  async grantForIntent(opts: {
    purchaseIntentId: string;
    expectedUserId?: string;
    method: RebateGrantMethod;
    attributedPurchaseId?: string;
    outboundClickId?: string;
  }): Promise<RebateGrantResult> {
    const result = await db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(externalPurchaseIntent)
        .where(eq(externalPurchaseIntent.id, opts.purchaseIntentId))
        .for("update");

      if (!intent) throw new Error("Purchase intent not found");
      if (opts.expectedUserId && intent.userId !== opts.expectedUserId) {
        throw new Error("Purchase intent not found");
      }

      // Revalidate evidence inside the locked grant transaction, including direct callers.
      let verifiedSaleCents: number | null = null;
      let verifiedCommissionCents: number | null = null;
      if (opts.method !== "EPN_POSTBACK") throw new Error("Only a verified eBay purchase can grant cashback");
      {
        if (!opts.outboundClickId || !opts.attributedPurchaseId || !opts.expectedUserId) {
          throw new Error("EPN grant requires tracked purchase evidence");
        }
        const [click] = await tx.select().from(outboundClicks).where(eq(outboundClicks.id, opts.outboundClickId));
        const [purchase] = await tx.select().from(attributedPurchases).where(eq(attributedPurchases.id, opts.attributedPurchaseId));
        // Serialize grants on the purchase so one transaction cannot fund two intents.
        const [lockedPurchase] = await tx.select().from(attributedPurchases)
          .where(eq(attributedPurchases.id, opts.attributedPurchaseId)).for("update");
        const [used] = await tx.select().from(externalPurchaseIntent)
          .where(eq(externalPurchaseIntent.attributedPurchaseId, opts.attributedPurchaseId)).limit(1);
        if (used && used.id !== intent.id) throw new Error("EPN transaction already credited");
        if (!lockedPurchase || !click || !purchase || purchase.userId !== intent.userId || purchase.outboundClickId !== click.id ||
            purchase.customId !== click.customId || !purchase.itemId || !purchase.salePriceCents ||
            canonicalEbayItem(purchase.itemId) !== canonicalEbayItem(click.listingId) ||
            !matchesEpnIntent(intent, click, purchase.salePriceCents)) {
          throw new Error("EPN purchase evidence does not match intent");
        }
        verifiedSaleCents = purchase.salePriceCents;
        verifiedCommissionCents = purchase.commissionCents ?? null;
      }

      if (intent.status === "CREDIT_GRANTED") {
        const [credit] = await tx
          .select()
          .from(redemptionCredit)
          .where(eq(redemptionCredit.purchaseIntentId, intent.id));
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, intent.userId));
        return {
          success: true,
          granted: true,
          heldForReview: false,
          alreadyGranted: true,
          rebateBalanceCents: wallet?.rebateBalanceCents ?? 0,
          creditCents: credit?.creditCents ?? 0,
          packptsSpent: credit?.packptsSpent ?? intent.approvedRedeemPackpts,
          receiptUrl: receiptPath(intent.id),
          message: "Cashback already granted.",
          userId: intent.userId,
          listingTitle: intent.listingTitle,
          source: intent.source,
          skipEmail: true,
        };
      }

      if (intent.status !== "APPROVED" && intent.status !== "PURCHASE_CONFIRMED") {
        throw new Error(`Cannot grant: intent status is ${intent.status}`);
      }

      let [credit] = await tx
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, intent.id))
        .for("update");
      if (!credit) throw new Error("Redemption credit not found for this purchase intent");
      if (credit.status === "REVERSED") {
        throw new Error("Cannot grant a reversed redemption");
      }

      // Rebate = 100% of the confirmed EPN commission (Dave, Oct 12 2026), capped
      // at the credit applied. No commission on the postback means nothing to pay
      // yet: leave the apply open so a later postback carrying it can grant.
      let usedReservationCents: number | undefined;
      if (!verifiedCommissionCents || verifiedCommissionCents <= 0) {
        await recordRebateAudit(tx, {
          event: "EPN_POSTBACK_REJECTED",
          actor: "epn_postback",
          userId: intent.userId,
          purchaseIntentId: intent.id,
          details: { reason: "postback has no commission yet", reportedTotalCents: verifiedSaleCents },
        });
        return {
          success: true, granted: false, heldForReview: false, alreadyGranted: false,
          rebateBalanceCents: 0, creditCents: 0, packptsSpent: credit.packptsSpent,
          receiptUrl: receiptPath(intent.id),
          message: "Waiting for eBay to confirm the commission on this sale.",
          userId: intent.userId, listingTitle: intent.listingTitle, source: intent.source, skipEmail: true,
        };
      }
      const centsPerPoint = credit.packptsSpent > 0 ? credit.creditCents / credit.packptsSpent : 0.2;
      const final = commissionGrant(credit.creditCents, credit.packptsSpent, verifiedCommissionCents, centsPerPoint);
      if (final.creditCents < credit.creditCents) {
        if (final.refundPackpts > 0) {
          const refund = await walletService.earn(
            intent.userId,
            final.refundPackpts,
            "Points returned: eBay's confirmed commission was below the rebate applied",
            `partial-refund:${intent.id}`,
            undefined,
            tx,
            { source: "redemption", eventType: "redemption_partial_refund", refType: "purchase_intent", refId: String(intent.id) },
          );
          if (!refund.success) throw new Error(`Partial refund failed: ${refund.error}`);
        }
        await recordRebateAudit(tx, {
          event: "PARTIAL_REFUND",
          actor: "epn_postback",
          userId: intent.userId,
          purchaseIntentId: intent.id,
          packpts: final.refundPackpts,
          amountCents: final.creditCents,
          details: {
            reason: "credit set to confirmed commission",
            commissionCents: verifiedCommissionCents,
            reportedTotalCents: verifiedSaleCents,
            creditBeforeCents: credit.creditCents,
            creditAfterCents: final.creditCents,
          },
        });
        [credit] = await tx
          .update(redemptionCredit)
          .set({ creditCents: final.creditCents, packptsSpent: final.keptPackpts })
          .where(eq(redemptionCredit.id, credit.id))
          .returning();
        usedReservationCents = final.creditCents;
      }
      // Book the confirmed commission into the pool so the rebate it funds is net zero.
      await tx.insert(marginLedger).values({
        sourceType: "AFFILIATE_PAYOUT",
        amountCents: verifiedCommissionCents,
        referenceId: opts.attributedPurchaseId ?? null,
        note: `EPN commission ${intent.source} ${intent.listingId}`,
      });

      await treasuryService.consumeReservation(intent.id, credit.id, tx, usedReservationCents);

      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, intent.userId))
        .for("update");
      if (!wallet) throw new Error("Wallet not found");

      const newBalance = (wallet.rebateBalanceCents ?? 0) + credit.creditCents;
      await tx
        .update(wallets)
        .set({ rebateBalanceCents: newBalance, updatedAt: new Date() })
        .where(eq(wallets.id, wallet.id));

      const [ledger] = await tx
        .insert(rebateLedger)
        .values({
          userId: intent.userId,
          amountCents: credit.creditCents,
          balanceAfterCents: newBalance,
          type: "GRANT",
          purchaseIntentId: intent.id,
          idempotencyKey: `rebate-grant:${intent.id}`,
          note: `Marketplace cashback (${opts.method}) ${intent.source} ${intent.listingId}`,
        })
        .onConflictDoNothing()
        .returning();

      await recordRebateAudit(tx, {
        event: "CREDIT_GRANTED",
        actor: "epn_postback",
        userId: intent.userId,
        purchaseIntentId: intent.id,
        amountCents: credit.creditCents,
        packpts: credit.packptsSpent,
        details: {
          method: opts.method,
          source: intent.source,
          listingId: intent.listingId,
          attributedPurchaseId: opts.attributedPurchaseId ?? null,
          outboundClickId: opts.outboundClickId ?? null,
          reportedTotalCents: verifiedSaleCents,
          appliedPriceCents: intent.priceCents,
          rebateBalanceAfterCents: newBalance,
          rebateLedgerId: ledger?.id ?? null,
        },
      });

      const grantedAt = new Date();
      await tx
        .update(redemptionCredit)
        .set({
          status: "GRANTED",
          grantMethod: opts.method,
          grantedAt,
          rebateLedgerId: ledger?.id ?? null,
        })
        .where(eq(redemptionCredit.id, credit.id));

      await tx
        .update(externalPurchaseIntent)
        .set({
          status: "CREDIT_GRANTED",
          grantMethod: opts.method,
          grantedAt,
          attributedPurchaseId: opts.attributedPurchaseId ?? intent.attributedPurchaseId,
          outboundClickId: opts.outboundClickId ?? intent.outboundClickId,
          updatedAt: grantedAt,
        })
        .where(eq(externalPurchaseIntent.id, intent.id));

      return {
        success: true,
        granted: true,
        heldForReview: false,
        alreadyGranted: false,
        rebateBalanceCents: newBalance,
        creditCents: credit.creditCents,
        packptsSpent: credit.packptsSpent,
        receiptUrl: receiptPath(intent.id),
        message: `Granted $${(credit.creditCents / 100).toFixed(2)} PackPTS cashback.`,
        userId: intent.userId,
        listingTitle: intent.listingTitle,
        source: intent.source,
        skipEmail: false,
      };
    });

    if (result.granted && !result.alreadyGranted && !result.skipEmail) {
      void this.emailReceipt(result.userId, {
        listingTitle: result.listingTitle,
        source: result.source,
        packptsSpent: result.packptsSpent,
        creditCents: result.creditCents,
        receiptUrl: result.receiptUrl,
        method: opts.method,
      });
    }

    const { userId: _u, listingTitle: _t, source: _s, skipEmail: _e, ...publicResult } = result;
    return publicResult;
  }

  private async emailReceipt(
    userId: string,
    details: {
      listingTitle: string | null;
      source: string;
      packptsSpent: number;
      creditCents: number;
      receiptUrl: string;
      method: string;
    }
  ): Promise<void> {
    try {
      const [user] = await db
        .select({ email: users.email, username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user?.email) return;
      await sendRebateReceiptEmail(user.email, user.username || "collector", details);
    } catch (err: any) {
      console.error("[Rebate] receipt email failed:", err?.message);
    }
  }

  async requestPayout(
    userId: string,
    amountCents: number,
    method: string,
    destination: string,
    note?: string,
    ctx: { ipHash?: string | null; deviceFingerprint?: string | null } = {}
  ): Promise<{ success: boolean; requestId?: string; message: string; reviewFlags?: string[] }> {
    if (amountCents <= 0) throw new Error("Amount must be positive");
    if (amountCents < PAYOUT_MIN_CENTS) {
      throw new Error(`Minimum payout is $${(PAYOUT_MIN_CENTS / 100).toFixed(2)}`);
    }
    const destinationNormalized = normalizePayoutDestination(destination);
    const ipHash = ctx.ipHash || null;
    const deviceFingerprint = ctx.deviceFingerprint || null;

    return db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update");
      if (!wallet) throw new Error("Wallet not found");
      if ((wallet.rebateBalanceCents ?? 0) < amountCents) {
        throw new Error("Insufficient cashback balance");
      }

      // Hold (PAYOUT_HOLD_DAYS, 60) from purchase; a sale EPN reports as locked
      // releases at PAYOUT_LOCKED_MIN_HOLD_DAYS (45), never earlier.
      const recent = await tx
        .select({
          amountCents: rebateLedger.amountCents,
          type: rebateLedger.type,
          createdAt: rebateLedger.createdAt,
          locked: sql<boolean>`COALESCE((SELECT (ap.raw_payload->>'epnLockedAt') IS NOT NULL FROM ${externalPurchaseIntent} epi JOIN ${attributedPurchases} ap ON ap.id = epi.attributed_purchase_id WHERE epi.id = ${rebateLedger.purchaseIntentId} LIMIT 1), false)`,
        })
        .from(rebateLedger)
        .where(and(
          eq(rebateLedger.userId, userId),
          sql`${rebateLedger.amountCents} > 0`,
          sql`${rebateLedger.createdAt} > NOW() - make_interval(days => ${PAYOUT_HOLD_DAYS})`,
        ));
      const { withdrawableCents, heldCents } = computeWithdrawableCents(wallet.rebateBalanceCents ?? 0, recent);
      if (amountCents > withdrawableCents) {
        throw new Error(
          `Only $${(withdrawableCents / 100).toFixed(2)} is available to withdraw; $${(heldCents / 100).toFixed(2)} is still on hold`
        );
      }

      // Multi-account signals: other users sharing device, IP or payout destination.
      const [deviceRow] = deviceFingerprint
        ? await tx.select({ n: sql<number>`count(*)::int` }).from(users)
            .where(and(eq(users.deviceFingerprint, deviceFingerprint), sql`${users.id} <> ${userId}`))
        : [{ n: 0 }];
      const [devicePayoutRow] = deviceFingerprint
        ? await tx.select({ n: sql<number>`count(DISTINCT ${rebatePayoutRequests.userId})::int` }).from(rebatePayoutRequests)
            .where(and(eq(rebatePayoutRequests.deviceFingerprint, deviceFingerprint), sql`${rebatePayoutRequests.userId} <> ${userId}`))
        : [{ n: 0 }];
      const [ipRow] = ipHash
        ? await tx.select({ n: sql<number>`count(DISTINCT ${rebatePayoutRequests.userId})::int` }).from(rebatePayoutRequests)
            .where(and(eq(rebatePayoutRequests.ipHash, ipHash), sql`${rebatePayoutRequests.userId} <> ${userId}`))
        : [{ n: 0 }];
      const [destRow] = await tx.select({ n: sql<number>`count(DISTINCT ${rebatePayoutRequests.userId})::int` }).from(rebatePayoutRequests)
        .where(and(
          sql`(${rebatePayoutRequests.destinationNormalized} = ${destinationNormalized} OR lower(trim(${rebatePayoutRequests.destination})) = ${destinationNormalized})`,
          sql`${rebatePayoutRequests.userId} <> ${userId}`,
        ));
      const reviewFlags = payoutReviewFlags({
        device: Number(deviceRow?.n ?? 0) + Number(devicePayoutRow?.n ?? 0),
        ip: Number(ipRow?.n ?? 0),
        destination: Number(destRow?.n ?? 0),
      });

      const newBalance = wallet.rebateBalanceCents - amountCents;
      await tx
        .update(wallets)
        .set({ rebateBalanceCents: newBalance, updatedAt: new Date() })
        .where(eq(wallets.id, wallet.id));

      const [request] = await tx
        .insert(rebatePayoutRequests)
        .values({
          userId,
          amountCents,
          method,
          destination,
          note: note || null,
          status: "REQUESTED",
          ipHash,
          deviceFingerprint,
          destinationNormalized,
          reviewFlags,
        })
        .returning();

      await tx.insert(rebateLedger).values({
        userId,
        amountCents: -amountCents,
        balanceAfterCents: newBalance,
        type: "PAYOUT",
        payoutRequestId: request.id,
        idempotencyKey: `rebate-payout:${request.id}`,
        note: `Payout requested via ${method}`,
      });
      await recordRebateAudit(tx, {
        event: "PAYOUT_REQUESTED",
        actor: `user:${userId}`,
        userId,
        amountCents,
        details: { payoutRequestId: request.id, method, rebateBalanceAfterCents: newBalance, reviewFlags },
      });

      return {
        success: true,
        requestId: request.id,
        reviewFlags,
        message: `Payout of $${(amountCents / 100).toFixed(2)} requested. We'll send it via ${method} and email when it's marked paid.`,
      };
    });
  }

  async adminMarkPayoutPaid(
    requestId: string,
    adminUserId: string,
    adminNote?: string
  ): Promise<{ success: boolean; message: string }> {
    const [request] = await db
      .select()
      .from(rebatePayoutRequests)
      .where(eq(rebatePayoutRequests.id, requestId));
    if (!request) throw new Error("Payout request not found");
    if (request.status !== "REQUESTED") {
      throw new Error(`Cannot mark paid: status is ${request.status}`);
    }
    await db
      .update(rebatePayoutRequests)
      .set({
        status: "PAID",
        adminNote: adminNote || null,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rebatePayoutRequests.id, requestId));
    await recordRebateAudit(db, {
      event: "PAYOUT_PAID",
      actor: `admin:${adminUserId}`,
      userId: request.userId,
      amountCents: request.amountCents,
      details: { payoutRequestId: requestId, method: request.method, note: adminNote || null },
    });
    return { success: true, message: "Payout marked paid." };
  }

  async adminDenyPayout(
    requestId: string,
    adminUserId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    return db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(rebatePayoutRequests)
        .where(eq(rebatePayoutRequests.id, requestId))
        .for("update");
      if (!request) throw new Error("Payout request not found");
      if (request.status !== "REQUESTED") {
        throw new Error(`Cannot deny: status is ${request.status}`);
      }

      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, request.userId))
        .for("update");
      if (!wallet) throw new Error("Wallet not found");

      const newBalance = (wallet.rebateBalanceCents ?? 0) + request.amountCents;
      await tx
        .update(wallets)
        .set({ rebateBalanceCents: newBalance, updatedAt: new Date() })
        .where(eq(wallets.id, wallet.id));

      await tx.insert(rebateLedger).values({
        userId: request.userId,
        amountCents: request.amountCents,
        balanceAfterCents: newBalance,
        type: "PAYOUT_REFUND",
        payoutRequestId: request.id,
        idempotencyKey: `rebate-payout-refund:${request.id}`,
        note: `Payout denied: ${reason}`,
      });
      await recordRebateAudit(tx, {
        event: "PAYOUT_DENIED",
        actor: `admin:${adminUserId}`,
        userId: request.userId,
        amountCents: request.amountCents,
        details: { payoutRequestId: request.id, reason, rebateBalanceAfterCents: newBalance },
      });

      await tx
        .update(rebatePayoutRequests)
        .set({
          status: "DENIED",
          adminNote: reason,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(rebatePayoutRequests.id, requestId));

      return { success: true, message: "Payout denied and cashback returned to the user." };
    });
  }

  async listAdminIntents(status?: string): Promise<
    Array<ExternalPurchaseIntent & { credit: RedemptionCredit | null; username: string | null }>
  > {
    const rows = status
      ? await db
          .select()
          .from(externalPurchaseIntent)
          .where(eq(externalPurchaseIntent.status, status as any))
          .orderBy(desc(externalPurchaseIntent.updatedAt))
          .limit(100)
      : await db
          .select()
          .from(externalPurchaseIntent)
          .where(
            or(
              eq(externalPurchaseIntent.status, "APPROVED"),
              eq(externalPurchaseIntent.status, "PURCHASE_CONFIRMED"),
              eq(externalPurchaseIntent.status, "CREDIT_GRANTED")
            )
          )
          .orderBy(desc(externalPurchaseIntent.updatedAt))
          .limit(100);

    const credits = rows.length
      ? await db
          .select()
          .from(redemptionCredit)
          .where(
            sql`${redemptionCredit.purchaseIntentId} IN (${sql.join(
              rows.map((i) => sql`${i.id}`),
              sql`, `
            )})`
          )
      : [];
    const creditByIntent = new Map(credits.map((c) => [c.purchaseIntentId, c]));

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const userRows = userIds.length
      ? await db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const nameById = new Map(userRows.map((u) => [u.id, u.username]));

    return rows.map((intent) => ({
      ...intent,
      credit: creditByIntent.get(intent.id) || null,
      username: nameById.get(intent.userId) || null,
    }));
  }

  async listPayoutRequests(status?: string) {
    if (status) {
      return db
        .select()
        .from(rebatePayoutRequests)
        .where(eq(rebatePayoutRequests.status, status as any))
        .orderBy(desc(rebatePayoutRequests.createdAt))
        .limit(100);
    }
    return db
      .select()
      .from(rebatePayoutRequests)
      .orderBy(desc(rebatePayoutRequests.createdAt))
      .limit(100);
  }

  async listUserPayouts(userId: string) {
    return db
      .select()
      .from(rebatePayoutRequests)
      .where(eq(rebatePayoutRequests.userId, userId))
      .orderBy(desc(rebatePayoutRequests.createdAt))
      .limit(20);
  }
}

export const rebateService = new RebateService();

/** Pure proration used when the real price is below the applied price. Rounds in the house's favor on credit. */
export function prorateRedemption(
  creditCents: number,
  packptsSpent: number,
  appliedPriceCents: number,
  actualPriceCents: number,
): { creditCents: number; keptPackpts: number; refundPackpts: number } {
  if (actualPriceCents >= appliedPriceCents) {
    return { creditCents, keptPackpts: packptsSpent, refundPackpts: 0 };
  }
  const credit = Math.floor((creditCents * actualPriceCents) / appliedPriceCents);
  const kept = Math.min(packptsSpent, Math.ceil((packptsSpent * actualPriceCents) / appliedPriceCents));
  return { creditCents: credit, keptPackpts: kept, refundPackpts: packptsSpent - kept };
}

/**
 * Persist an EPN conversion and grant matching marketplace cashback.
 * Extracted so tests can drive the postback without HTTP.
 */
export async function processEpnPostback(query: {
  customid: string;
  item_id?: string;
  transaction_id: string;
  sale_price?: string;
  commission?: string;
  transaction_date?: string;
}): Promise<{ ok: true; grants: RebateGrantResult[] }> {
  if (!query.item_id || !query.customid || !query.transaction_id || !query.sale_price) {
    throw new Error("EPN postback requires item, transaction and a valid sale price");
  }
  let clicks = await db.select().from(outboundClicks)
    .where(eq(outboundClicks.customId, query.customid)).limit(2);
  if (clicks.length === 0) {
    // EPN may strip characters like "|" from the customid it echoes back.
    const norm = normalizeEpnCustomId(query.customid);
    clicks = await db.select().from(outboundClicks)
      .where(sql`regexp_replace(${outboundClicks.customId}, '[^A-Za-z0-9:_-]', '', 'g') = ${norm}`).limit(2);
  }
  const click = clicks.length === 1 ? clicks[0] : null;
  if (!click?.userId || click.source !== "ebay") {
    throw new Error("EPN postback has no matching authenticated outbound click");
  }
  const line = resolveEpnLine(click.listingId, query.item_id, query.sale_price);
  if (!line) {
    if (epnItemList(query.item_id).includes(canonicalEbayItem(click.listingId))) {
      throw new Error("EPN postback requires item, transaction and a valid sale price");
    }
    throw new Error("EPN postback has no matching authenticated outbound click");
  }
  const salePriceCents = line.salePriceCents;
  const matchedItemId = line.itemId;
  const conversionDate = query.transaction_date ? new Date(query.transaction_date) : new Date();
  // EPN often sends a date-only or local-time transaction_date; allow a day of
  // slack before the click rather than rejecting same-day purchases.
  if (!Number.isFinite(conversionDate.getTime()) ||
      (click.createdAt && conversionDate.getTime() < click.createdAt.getTime() - 86_400_000)) {
    throw new Error("EPN conversion date is invalid or precedes click");
  }
  const commissionCents = query.commission ? parseEpnMoney(query.commission) : null;
  const [inserted] = await db.insert(attributedPurchases).values({
    customId: click.customId!, outboundClickId: click.id, userId: click.userId,
    transactionId: query.transaction_id, itemId: matchedItemId,
    salePriceCents, commissionCents, conversionDate, rawPayload: query,
  }).onConflictDoNothing().returning();
  let [existing] = inserted ? [inserted] : await db.select().from(attributedPurchases)
    .where(eq(attributedPurchases.transactionId, query.transaction_id)).limit(1);
  // A first postback may arrive before the commission; a later one carries it.
  if (existing && !inserted && !existing.commissionCents && commissionCents) {
    [existing] = await db.update(attributedPurchases).set({ commissionCents })
      .where(eq(attributedPurchases.id, existing.id)).returning();
  }
  if (!existing || existing.customId !== click.customId || existing.userId !== click.userId ||
      existing.outboundClickId !== click.id || existing.salePriceCents !== salePriceCents ||
      !existing.itemId || canonicalEbayItem(existing.itemId) !== matchedItemId) {
    throw new Error("EPN transaction replay does not match original evidence");
  }
  const grants = await rebateService.grantFromEpnPostback({
    customId: click.customId!, attributedPurchaseId: existing.id, userId: click.userId,
    listingId: click.listingId, outboundClickId: click.id, salePriceCents,
  });
  return { ok: true, grants };
  }

/**
 * Status postback (or report import) for a sale we already recorded.
 * locked: mark the sale so its rebate may release at 45 days.
 * reversal: claw back the held rebate from the wallet. Credits are held 60 days
 * so a reversal normally lands before payout; if the balance no longer covers
 * it, the shortfall is audited for admin follow-up.
 */
export { classifyEpnStatus };
export async function processEpnStatus(query: { transaction_id: string; status: string }): Promise<{ ok: true; action: string }> {
  const kind = classifyEpnStatus(query.status);
  if (!kind) return { ok: true, action: "ignored" };
  const [purchase] = await db.select().from(attributedPurchases)
    .where(eq(attributedPurchases.transactionId, query.transaction_id)).limit(1);
  if (!purchase) throw new Error("Unknown EPN transaction");
  const now = new Date().toISOString();
  const raw = (purchase.rawPayload && typeof purchase.rawPayload === "object") ? purchase.rawPayload as Record<string, unknown> : {};
  if (kind === "locked") {
    if (raw.epnLockedAt || raw.epnReversedAt) return { ok: true, action: "noop" };
    await db.update(attributedPurchases).set({ rawPayload: { ...raw, epnLockedAt: now } })
      .where(eq(attributedPurchases.id, purchase.id));
    await recordRebateAudit(db, { event: "EPN_SALE_LOCKED", actor: "epn_postback", userId: purchase.userId, details: { attributedPurchaseId: purchase.id } });
    return { ok: true, action: "locked" };
  }
  if (raw.epnReversedAt) return { ok: true, action: "noop" };
  return db.transaction(async (tx) => {
    await tx.update(attributedPurchases).set({ rawPayload: { ...raw, epnReversedAt: now } })
      .where(eq(attributedPurchases.id, purchase.id));
    const [intent] = await tx.select().from(externalPurchaseIntent)
      .where(eq(externalPurchaseIntent.attributedPurchaseId, purchase.id)).limit(1);
    if (!intent) return { ok: true as const, action: "reversed_no_grant" };
    const [credit] = await tx.select().from(redemptionCredit)
      .where(eq(redemptionCredit.purchaseIntentId, intent.id)).for("update");
    if (!credit || credit.status !== "GRANTED") return { ok: true as const, action: "reversed_no_grant" };
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, intent.userId)).for("update");
    const balance = wallet?.rebateBalanceCents ?? 0;
    const take = Math.max(0, Math.min(balance, credit.creditCents));
    if (wallet && take > 0) {
      const newBalance = balance - take;
      await tx.update(wallets).set({ rebateBalanceCents: newBalance, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
      await tx.insert(rebateLedger).values({
        userId: intent.userId, amountCents: -take, balanceAfterCents: newBalance, type: "ADJUSTMENT",
        purchaseIntentId: intent.id, idempotencyKey: `rebate-clawback:${intent.id}`,
        note: `EPN reversal (${query.status}) ${intent.source} ${intent.listingId}`,
      }).onConflictDoNothing();
    }
    await tx.update(redemptionCredit).set({ status: "REVERSED" }).where(eq(redemptionCredit.id, credit.id));
    await recordRebateAudit(tx, {
      event: "CREDIT_REVERSED", actor: "epn_postback", userId: intent.userId, purchaseIntentId: intent.id,
      amountCents: take, details: { status: query.status, creditCents: credit.creditCents, attributedPurchaseId: purchase.id },
    });
    if (take < credit.creditCents) {
      await recordRebateAudit(tx, {
        event: "EPN_REVERSAL_UNRECOVERED", actor: "epn_postback", userId: intent.userId, purchaseIntentId: intent.id,
        amountCents: credit.creditCents - take, details: { attributedPurchaseId: purchase.id },
      });
    }
    return { ok: true as const, action: take > 0 ? "clawed_back" : "reversed_unrecovered" };
  });
}

