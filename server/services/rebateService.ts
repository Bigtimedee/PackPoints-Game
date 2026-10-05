import { db } from "../db";
import { canonicalEbayItem, matchesEpnIntent, parseEpnMoney } from "./epnVerification";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  attributedPurchases,
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

      // eBay reported a total below the price applied (offer, auction, partial order):
      // prorate credit and PackPTS spent from eBay's reported total, and refund the
      // PackPTS that are no longer needed. At or above the applied price: full credit.
      let usedReservationCents: number | undefined;
      if (verifiedSaleCents !== null && verifiedSaleCents < intent.priceCents) {
        const prorated = prorateRedemption(credit.creditCents, credit.packptsSpent, intent.priceCents, verifiedSaleCents);
        if (prorated.creditCents <= 0) {
          await recordRebateAudit(tx, {
            event: "EPN_POSTBACK_REJECTED",
            actor: "epn_postback",
            userId: intent.userId,
            purchaseIntentId: intent.id,
            details: { reason: "reported total too low for any credit", reportedTotalCents: verifiedSaleCents, appliedPriceCents: intent.priceCents },
          });
          return {
            success: true,
            granted: false,
            heldForReview: false,
            alreadyGranted: false,
            rebateBalanceCents: 0,
            creditCents: 0,
            packptsSpent: credit.packptsSpent,
            receiptUrl: receiptPath(intent.id),
            message: "The purchase total was too low for any cashback.",
            userId: intent.userId,
            listingTitle: intent.listingTitle,
            source: intent.source,
            skipEmail: true,
          };
        }
        if (prorated.refundPackpts > 0) {
          const refund = await walletService.earn(
            intent.userId,
            prorated.refundPackpts,
            "Partial refund: purchase price was lower than the price applied",
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
          packpts: prorated.refundPackpts,
          amountCents: prorated.creditCents,
          details: {
            reportedTotalCents: verifiedSaleCents,
            appliedPriceCents: intent.priceCents,
            creditBeforeCents: credit.creditCents,
            creditAfterCents: prorated.creditCents,
            packptsSpentBefore: credit.packptsSpent,
            packptsSpentAfter: prorated.keptPackpts,
          },
        });
        [credit] = await tx
          .update(redemptionCredit)
          .set({ creditCents: prorated.creditCents, packptsSpent: prorated.keptPackpts })
          .where(eq(redemptionCredit.id, credit.id))
          .returning();
        usedReservationCents = prorated.creditCents;
      }

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
    note?: string
  ): Promise<{ success: boolean; requestId?: string; message: string }> {
    if (amountCents <= 0) throw new Error("Amount must be positive");

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
        details: { payoutRequestId: request.id, method, rebateBalanceAfterCents: newBalance },
      });

      return {
        success: true,
        requestId: request.id,
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
  const salePriceCents = parseEpnMoney(query.sale_price);
  if (!salePriceCents || !query.item_id || !query.customid || !query.transaction_id) {
    throw new Error("EPN postback requires item, transaction and a valid sale price");
  }
  const clicks = await db.select().from(outboundClicks)
    .where(eq(outboundClicks.customId, query.customid)).limit(2);
  const click = clicks.length === 1 ? clicks[0] : null;
  if (!click?.userId || click.source !== "ebay" ||
      canonicalEbayItem(click.listingId) !== canonicalEbayItem(query.item_id)) {
    throw new Error("EPN postback has no matching authenticated outbound click");
  }
  const conversionDate = query.transaction_date ? new Date(query.transaction_date) : new Date();
  if (!Number.isFinite(conversionDate.getTime()) || (click.createdAt && conversionDate < click.createdAt)) {
    throw new Error("EPN conversion date is invalid or precedes click");
  }
  const commissionCents = query.commission ? parseEpnMoney(query.commission) : null;
  const [inserted] = await db.insert(attributedPurchases).values({
    customId: query.customid, outboundClickId: click.id, userId: click.userId,
    transactionId: query.transaction_id, itemId: query.item_id,
    salePriceCents, commissionCents, conversionDate, rawPayload: query,
  }).onConflictDoNothing().returning();
  const [existing] = inserted ? [inserted] : await db.select().from(attributedPurchases)
    .where(eq(attributedPurchases.transactionId, query.transaction_id)).limit(1);
  if (!existing || existing.customId !== query.customid || existing.userId !== click.userId ||
      existing.outboundClickId !== click.id || existing.salePriceCents !== salePriceCents ||
      !existing.itemId || canonicalEbayItem(existing.itemId) !== canonicalEbayItem(query.item_id)) {
    throw new Error("EPN transaction replay does not match original evidence");
  }
  const grants = await rebateService.grantFromEpnPostback({
    customId: query.customid, attributedPurchaseId: existing.id, userId: click.userId,
    listingId: click.listingId, outboundClickId: click.id, salePriceCents,
  });
  return { ok: true, grants };
  }
