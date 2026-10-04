import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "../db";
import { rebateLedger, rebatePayoutAccounts, rebatePayoutRequests, users, wallets, userRiskState } from "@shared/schema";
import { BANK_FEE_RESERVE_CENTS, MIN_PAYOUT_CENTS, payoutConfiguration, stripeGlobalPayoutsProvider as provider, validatePayment } from "./stripeGlobalPayoutsProvider";

export const PAYOUT_HOLD_DAYS = 30;
export const LARGE_PAYOUT_CENTS = 10000;
export class CashbackPayoutService {
  async onboarding(userId: string) {
    const { sandbox, financialAccount } = payoutConfiguration();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.email) throw new Error("Verified account email required");
    const [stored] = await db.select().from(rebatePayoutAccounts).where(and(eq(rebatePayoutAccounts.userId, userId), eq(rebatePayoutAccounts.sandbox, sandbox)));
    if (stored && stored.financialAccountId !== financialAccount) throw new Error("Recipient financial account mismatch; re-onboarding required");
    let recipient = stored?.stripeRecipientId;
    if (!recipient) {
      const account = await provider.createRecipient(userId, user.email);
      await db.insert(rebatePayoutAccounts).values({ userId, stripeRecipientId: account.id, sandbox, financialAccountId: financialAccount }).onConflictDoNothing();
      const [saved] = await db.select().from(rebatePayoutAccounts).where(and(eq(rebatePayoutAccounts.userId, userId), eq(rebatePayoutAccounts.sandbox, sandbox)));
      recipient = saved.stripeRecipientId;
    }
    const link = await provider.onboarding(recipient);
    if (!link.url?.startsWith("https://")) throw new Error("Stripe onboarding link unavailable");
    return { url: link.url, sandbox };
  }
  async account(userId: string) {
    const { sandbox, financialAccount } = payoutConfiguration();
    const [account] = await db.select().from(rebatePayoutAccounts).where(and(eq(rebatePayoutAccounts.userId, userId), eq(rebatePayoutAccounts.sandbox, sandbox)));
    if (!account) return { ready: false, enabled: true, sandbox, minimumCents: MIN_PAYOUT_CENTS };
    if (account.financialAccountId !== financialAccount) throw new Error("Recipient financial account mismatch; re-onboarding required");
    const destination = await provider.destination(account.stripeRecipientId);
    return { ready: true, enabled: true, sandbox, minimumCents: MIN_PAYOUT_CENTS, destination: destination.masked };
  }
  async request(userId: string, amountCents: number, requestKey: string) {
    const { sandbox, financialAccount } = payoutConfiguration();
    if (!Number.isSafeInteger(amountCents) || amountCents < MIN_PAYOUT_CENTS) throw new Error("Minimum withdrawal is $25");
    const [account] = await db.select().from(rebatePayoutAccounts).where(and(eq(rebatePayoutAccounts.userId, userId), eq(rebatePayoutAccounts.sandbox, sandbox)));
    if (!account) throw new Error("Set up your bank account with Stripe first");
    if (account.financialAccountId !== financialAccount) throw new Error("Recipient financial account mismatch; re-onboarding required");
    const destination = await provider.destination(account.stripeRecipientId);
    return db.transaction(async tx => {
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update");
      if (!wallet) throw new Error("Wallet not found");
      const [previous] = await tx.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.requestKey, requestKey));
      if (previous) {
        if (previous.userId !== userId || previous.amountCents !== amountCents || previous.sandbox !== sandbox || previous.financialAccountId !== financialAccount) throw new Error("Withdrawal retry does not match original request");
        return { success: true, requestId: previous.id, message: "Withdrawal already requested" };
      }
      const [risk] = await tx.select().from(userRiskState).where(eq(userRiskState.userId, userId)).for("update");
      if (risk?.status === "FROZEN") throw new Error("Cashback account is frozen; contact support");
      // Conservative hold: any new positive credit holds withdrawals for 30 days.
      // This avoids treating recent, reversible self-attested grants as settled cash.
      const [recent] = await tx.select({ id: rebateLedger.id }).from(rebateLedger)
        .where(and(eq(rebateLedger.userId, userId), sql`${rebateLedger.amountCents} > 0`, sql`${rebateLedger.payoutRequestId} IS NULL`,
          sql`${rebateLedger.createdAt} > NOW() - INTERVAL '30 days'`)).limit(1);
      if (recent) throw new Error("Cashback is in the 30-day purchase review hold");
      if (wallet.rebateBalanceCents < amountCents) throw new Error("Insufficient cashback balance");
      // Reserve amount now, but do not claim it was paid or write a PAYOUT until Stripe posts.
      await tx.update(wallets).set({ rebateBalanceCents: wallet.rebateBalanceCents - amountCents, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
      const [request] = await tx.insert(rebatePayoutRequests).values({ userId, amountCents, requestKey,
        method: "stripe_bank", destination: destination.masked, stripeRecipientId: account.stripeRecipientId,
        stripePayoutMethodId: destination.id, financialAccountId: financialAccount, sandbox, status: "REQUESTED" }).returning();
      await tx.insert(rebateLedger).values({ userId, amountCents: -amountCents,
        balanceAfterCents: wallet.rebateBalanceCents - amountCents, type: "ADJUSTMENT", payoutRequestId: request.id,
        idempotencyKey: `cashback-hold:${request.id}`, note: "Withdrawal hold, not a completed payment" });
      // In this draft ALL payouts require review, which includes first and large payouts.
      return { success: true, requestId: request.id, message: sandbox ? "Test withdrawal reserved for admin review. No real money will move." : "Withdrawal reserved for admin review. No money sent yet." };
    });
  }
  async approve(id: string, adminUserId: string) {
    const { financialAccount, sandbox } = payoutConfiguration();
    const [initial] = await db.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, id));
    if (!initial || initial.method !== "stripe_bank" || initial.sandbox !== sandbox || initial.financialAccountId !== financialAccount) throw new Error("Withdrawal mode or financial account does not match");
    if (initial.stripePaymentId) return this.refresh(id);
    if (initial.status !== "REQUESTED" && initial.status !== "PROCESSING") throw new Error("Withdrawal cannot be approved in this state");
    const bank = await provider.destination(initial.stripeRecipientId!);
    if (bank.id !== initial.stripePayoutMethodId || bank.masked !== initial.destination) throw new Error("Bank destination changed; deny and create a new request");
    const request = await db.transaction(async tx => {
      // Global lock serializes funding reservations across users and app instances.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(78190322)`);
      const [r] = await tx.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, id)).for("update");
      if (!r || r.sandbox !== sandbox || r.financialAccountId !== financialAccount) throw new Error("Withdrawal mode or financial account does not match");
      if (r.status !== "REQUESTED" && r.status !== "PROCESSING") throw new Error("Withdrawal state changed");
      if (r.stripePaymentId) throw new Error("Payment already created; refresh status");
      const [risk] = await tx.select().from(userRiskState).where(eq(userRiskState.userId, r.userId));
      if (risk?.status === "FROZEN") throw new Error("Cashback account frozen");
      if (r.submitStartedAt && Date.now() - r.submitStartedAt.getTime() > 20 * 60 * 60 * 1000)
        throw new Error("Ambiguous old submission: manual provider reconciliation required; do not retry");
      // Fetch cash inside the shared funding lock, not before it.
      const available = await provider.available();
      const [{ held }] = await tx.select({ held: sql<number>`COALESCE(SUM(${rebatePayoutRequests.amountCents} + ${BANK_FEE_RESERVE_CENTS}), 0)::int` })
        .from(rebatePayoutRequests).where(and(eq(rebatePayoutRequests.status, "PROCESSING"), eq(rebatePayoutRequests.sandbox, sandbox), eq(rebatePayoutRequests.financialAccountId, financialAccount), sql`${rebatePayoutRequests.id} <> ${id}`));
      if (available < Number(held) + r.amountCents + BANK_FEE_RESERVE_CENTS) throw new Error("Insufficient funded Stripe balance including fees");
      await tx.update(rebatePayoutRequests).set({ status: "PROCESSING", reviewedBy: adminUserId, reviewedAt: new Date(),
        submitStartedAt: r.submitStartedAt ?? new Date(), updatedAt: new Date() }).where(eq(rebatePayoutRequests.id, id));
      return r;
    });
    // Stable provider key makes retries/concurrent approval harmless. Network errors retain the hold.
    const payment = await provider.send(id, request.amountCents, request.stripeRecipientId!, request.stripePayoutMethodId!);
    validatePayment(payment, { amountCents: request.amountCents, recipient: request.stripeRecipientId!, method: request.stripePayoutMethodId!, financialAccount });
    await this.applyProviderState(id, payment);
    return { success: true, message: "Payout submitted to Stripe; bank receipt is not yet confirmed" };
  }
  async refresh(id: string, userId?: string) {
    const { sandbox, financialAccount } = payoutConfiguration();
    const [request] = await db.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, id));
    if (!request || (userId && request.userId !== userId)) throw new Error("Withdrawal not found");
    if (request.sandbox !== sandbox || request.financialAccountId !== financialAccount || request.method !== "stripe_bank") throw new Error("Withdrawal mode or financial account does not match");
    if (request.stripePaymentId) await this.applyProviderState(id, await provider.retrieve(request.stripePaymentId));
    return { success: true, message: "Stripe status refreshed" };
  }
  async applyProviderState(id: string, payment: any) {
    const { financialAccount, sandbox } = payoutConfiguration();
    await db.transaction(async tx => {
      const [r] = await tx.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, id)).for("update");
      if (!r || r.sandbox !== sandbox || r.financialAccountId !== financialAccount || r.method !== "stripe_bank" || !["PROCESSING", "SENT", "FAILED", "RETURNED"].includes(r.status)) throw new Error("Invalid payout reconciliation state");
      validatePayment(payment, { amountCents: r.amountCents, recipient: r.stripeRecipientId!, method: r.stripePayoutMethodId!, financialAccount });
      if (r.stripePaymentId && r.stripePaymentId !== payment.id) throw new Error("Provider payment ID mismatch");
      if ((r.status === "FAILED" || r.status === "RETURNED") || (r.status === "SENT" && payment.status === "processing")) return;
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, r.userId)).for("update");
      let status: "PROCESSING" | "SENT" | "FAILED" | "RETURNED" = "PROCESSING";
      if (payment.status === "posted") {
        status = "SENT";
        if (!r.postedAt) {
          // Release the accounting hold and append the actual payout. Net wallet change is zero.
          await tx.insert(rebateLedger).values([{ userId: r.userId, amountCents: r.amountCents,
            balanceAfterCents: wallet.rebateBalanceCents + r.amountCents, type: "ADJUSTMENT", payoutRequestId: id,
            idempotencyKey: `cashback-release:${id}`, note: "Withdrawal hold replaced by provider-confirmed payout" },
          { userId: r.userId, amountCents: -r.amountCents, balanceAfterCents: wallet.rebateBalanceCents,
            type: "PAYOUT", payoutRequestId: id, idempotencyKey: `cashback-paid:${id}`, note: `Stripe sent ${payment.id}; bank arrival not guaranteed` }]);
        }
      } else if (["failed", "canceled", "returned"].includes(payment.status)) {
        status = payment.status === "returned" ? "RETURNED" : "FAILED";
        await tx.update(wallets).set({ rebateBalanceCents: wallet.rebateBalanceCents + r.amountCents, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
        await tx.insert(rebateLedger).values({ userId: r.userId, amountCents: r.amountCents,
          balanceAfterCents: wallet.rebateBalanceCents + r.amountCents, type: "PAYOUT_REFUND", payoutRequestId: id,
          idempotencyKey: `cashback-refund:${id}`, note: `Stripe ${payment.status}; cashback restored` });
      }
      const receipt = typeof payment.receipt_url === "string" && payment.receipt_url.startsWith("https://payments.stripe.com/") ? payment.receipt_url : null;
      await tx.update(rebatePayoutRequests).set({ status, stripePaymentId: payment.id, stripeStatus: payment.status,
        providerReceiptUrl: receipt, postedAt: status === "SENT" ? r.postedAt ?? new Date() : r.postedAt,
        receiptEmailStatus: sandbox ? "SANDBOX_SUPPRESSED" : "IN_APP_RECEIPT", updatedAt: new Date() }).where(eq(rebatePayoutRequests.id, id));
    });
  }
  async deny(id: string, adminUserId: string, reason: string) {
    const { sandbox, financialAccount } = payoutConfiguration();
    return db.transaction(async tx => {
      const [r] = await tx.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id, id)).for("update");
      if (!r || r.sandbox !== sandbox || r.financialAccountId !== financialAccount || r.method !== "stripe_bank" || r.status !== "REQUESTED" || r.submitStartedAt || r.stripePaymentId) throw new Error("Only unsubmitted requests can be denied");
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, r.userId)).for("update");
      await tx.update(wallets).set({ rebateBalanceCents: wallet.rebateBalanceCents + r.amountCents, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
      await tx.insert(rebateLedger).values({ userId: r.userId, amountCents: r.amountCents,
        balanceAfterCents: wallet.rebateBalanceCents + r.amountCents, type: "PAYOUT_REFUND", payoutRequestId: id,
        idempotencyKey: `cashback-refund:${id}`, note: `Withdrawal denied: ${reason}` });
      await tx.update(rebatePayoutRequests).set({ status: "DENIED", adminNote: reason, reviewedBy: adminUserId,
        reviewedAt: new Date(), updatedAt: new Date() }).where(eq(rebatePayoutRequests.id, id));
      return { success: true, message: "Unsubmitted withdrawal denied and cashback restored" };
    });
  }
}
export const cashbackPayoutService = new CashbackPayoutService();

/** Reconcile only known payments in the configured mode/account. Never submit from this loop. */
export function startCashbackPayoutReconciler() {
  try { payoutConfiguration(); } catch { return; }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { sandbox, financialAccount } = payoutConfiguration();
      const pending = await db.select().from(rebatePayoutRequests).where(and(eq(rebatePayoutRequests.sandbox, sandbox), eq(rebatePayoutRequests.financialAccountId, financialAccount), eq(rebatePayoutRequests.method, "stripe_bank"),
        sql`${rebatePayoutRequests.stripePaymentId} IS NOT NULL`,
        sql`${rebatePayoutRequests.status} IN ('PROCESSING','SENT')`,
        sql`${rebatePayoutRequests.updatedAt} > NOW() - INTERVAL '60 days'`)).orderBy(asc(rebatePayoutRequests.updatedAt)).limit(100);
      for (const r of pending) {
        try { await cashbackPayoutService.refresh(r.id); } catch { console.error("[Cashback] payout reconciliation pending", r.id); }
      }
    } catch { console.error("[Cashback] reconciliation unavailable"); } finally { running = false; }
  }, 60000);
  timer.unref();
  return timer;
}
