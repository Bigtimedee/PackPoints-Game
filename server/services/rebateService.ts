import { db } from "../db";
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
import { sendRebateReceiptEmail } from "./emailService";

export const REVIEW_THRESHOLD_CENTS = 2500; // $25 user-attested confirms need admin

export type RebateGrantMethod = "EPN_POSTBACK" | "USER_CONFIRM" | "ADMIN_GRANT";

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
  honesty: string;
}

const SITE_URL = () => process.env.SITE_URL || "https://packpts.com";

const HONESTY =
  "eBay and Goldin checkout stay full price. PackPTS pays this cashback after a confirmed purchase.";

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

    return {
      intent,
      credit: credit || null,
      rebateBalanceCents: await this.getRebateBalance(userId),
      honesty: HONESTY,
    };
  }

  async listReceipts(userId: string): Promise<RedemptionReceipt[]> {
    const intents = await db
      .select()
      .from(externalPurchaseIntent)
      .where(
        and(
          eq(externalPurchaseIntent.userId, userId),
          or(
            eq(externalPurchaseIntent.status, "APPROVED"),
            eq(externalPurchaseIntent.status, "PURCHASE_CONFIRMED"),
            eq(externalPurchaseIntent.status, "CREDIT_GRANTED"),
            eq(externalPurchaseIntent.status, "CANCELED"),
            eq(externalPurchaseIntent.status, "DENIED")
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

    return intents.map((intent) => ({
      intent,
      credit: creditByIntent.get(intent.id) || null,
      rebateBalanceCents,
      honesty: HONESTY,
    }));
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
   * Confirm a purchase the user attests they completed on eBay/Goldin.
   * Persists evidence. Auto-grants under $25; holds high-value for admin.
   */
  async confirmPurchase(
    userId: string,
    purchaseIntentId: string,
    evidence: PurchaseEvidence = {}
  ): Promise<RebateGrantResult> {
    await this.persistEvidence(userId, purchaseIntentId, evidence);
    const hasEvidence = Boolean(
      evidence.orderId?.trim() || evidence.evidenceNote?.trim() || evidence.evidence?.trim() || evidence.receiptUrl?.trim()
    );
    if (!hasEvidence) {
      throw new Error("Order id, receipt URL, or a short note is required to claim cashback");
    }
    return this.grantForIntent({
      purchaseIntentId,
      expectedUserId: userId,
      method: "USER_CONFIRM",
      skipReview: false,
    });
  }

  async adminGrant(purchaseIntentId: string): Promise<RebateGrantResult> {
    return this.grantForIntent({
      purchaseIntentId,
      method: "ADMIN_GRANT",
      skipReview: true,
    });
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
    return { success: result.success, message: `Denied and refunded PackPTS. ${reason}` };
  }

  /**
   * After an EPN conversion postback, grant matching APPROVED/held intents.
   * EPN is partner-verified — skip the $25 user-attestation hold.
   */
  async grantFromEpnPostback(input: {
    customId: string;
    attributedPurchaseId?: string;
    userId?: string | null;
    listingId?: string | null;
    outboundClickId?: string | null;
  }): Promise<RebateGrantResult[]> {
    const results: RebateGrantResult[] = [];
    const userId = input.userId || null;
    const listingId = input.listingId || null;

    const conditions = [];
    if (userId) conditions.push(eq(externalPurchaseIntent.userId, userId));
    if (listingId) {
      conditions.push(
        or(
          eq(externalPurchaseIntent.listingId, listingId),
          sql`${externalPurchaseIntent.listingId} LIKE ${listingId.substring(0, 16) + "%"}`,
          sql`${externalPurchaseIntent.listingUrl} LIKE ${"%" + listingId + "%"}`
        )
      );
    }

    if (conditions.length === 0) return results;

    const intents = await db
      .select()
      .from(externalPurchaseIntent)
      .where(
        and(
          or(
            eq(externalPurchaseIntent.status, "APPROVED"),
            eq(externalPurchaseIntent.status, "PURCHASE_CONFIRMED")
          ),
          ...conditions
        )
      );

    for (const intent of intents) {
      try {
        const granted = await this.grantForIntent({
          purchaseIntentId: intent.id,
          expectedUserId: intent.userId,
          method: "EPN_POSTBACK",
          skipReview: true,
          attributedPurchaseId: input.attributedPurchaseId,
          outboundClickId: input.outboundClickId ?? undefined,
        });
        results.push(granted);
      } catch (err: any) {
        console.error(`[Rebate] EPN grant failed for intent ${intent.id}:`, err?.message);
      }
    }
    return results;
  }

  async grantForIntent(opts: {
    purchaseIntentId: string;
    expectedUserId?: string;
    method: RebateGrantMethod;
    skipReview: boolean;
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

      const [credit] = await tx
        .select()
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, intent.id))
        .for("update");
      if (!credit) throw new Error("Redemption credit not found for this purchase intent");
      if (credit.status === "REVERSED") {
        throw new Error("Cannot grant a reversed redemption");
      }

      if (!opts.skipReview && credit.creditCents >= REVIEW_THRESHOLD_CENTS) {
        await tx
          .update(externalPurchaseIntent)
          .set({
            status: "PURCHASE_CONFIRMED",
            outboundClickId: opts.outboundClickId ?? intent.outboundClickId,
            attributedPurchaseId: opts.attributedPurchaseId ?? intent.attributedPurchaseId,
            updatedAt: new Date(),
          })
          .where(eq(externalPurchaseIntent.id, intent.id));
        return {
          success: true,
          granted: false,
          heldForReview: true,
          alreadyGranted: false,
          rebateBalanceCents: 0,
          creditCents: credit.creditCents,
          packptsSpent: credit.packptsSpent,
          receiptUrl: receiptPath(intent.id),
          message:
            "Purchase recorded. Cashback of $25 or more is held for review and will be granted shortly.",
          userId: intent.userId,
          listingTitle: intent.listingTitle,
          source: intent.source,
          skipEmail: false,
        };
      }

      await treasuryService.consumeReservation(intent.id, credit.id, tx);

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
  const [click] = await db
    .select()
    .from(outboundClicks)
    .where(eq(outboundClicks.customId, query.customid))
    .limit(1);

  const salePriceCents = query.sale_price ? Math.round(parseFloat(query.sale_price) * 100) : null;
  const commissionCents = query.commission ? Math.round(parseFloat(query.commission) * 100) : null;
  const conversionDate = query.transaction_date ? new Date(query.transaction_date) : new Date();

  const [inserted] = await db
    .insert(attributedPurchases)
    .values({
      customId: query.customid,
      outboundClickId: click?.id || null,
      userId: click?.userId || null,
      transactionId: query.transaction_id,
      itemId: query.item_id || null,
      salePriceCents,
      commissionCents,
      conversionDate,
      rawPayload: query,
    })
    .onConflictDoNothing()
    .returning();

  const [existing] = inserted
    ? [inserted]
    : await db
        .select()
        .from(attributedPurchases)
        .where(eq(attributedPurchases.transactionId, query.transaction_id))
        .limit(1);

  const grants = await rebateService.grantFromEpnPostback({
    customId: query.customid,
    attributedPurchaseId: existing?.id,
    userId: click?.userId || existing?.userId || null,
    listingId: click?.listingId || query.item_id || null,
    outboundClickId: click?.id || null,
  });

  return { ok: true, grants };
}
