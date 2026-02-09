import { db } from "../../db";
import { wallets, ledgerEntries, packptsEvents } from "@shared/schema";
import { eq, sql, sum, desc } from "drizzle-orm";
import { walletService, type LedgerClassification, type WalletOperationResult } from "../walletService";

export type LedgerDirection = "credit" | "debit";
export type LedgerSource = "gameplay" | "purchase" | "admin" | "redemption" | "adjustment" | "streak";

export interface ApplyLedgerEntryParams {
  userId: string;
  direction: LedgerDirection;
  amountPackpts: number;
  source: LedgerSource;
  eventType: string;
  refType: string;
  refId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerBalance {
  balancePackpts: number;
  lifetimeEarnedPackpts: number;
  lifetimeSpentPackpts: number;
  lastUpdatedAt: Date | null;
}

export interface ReconciliationResult {
  userId: string;
  cachedBalance: number;
  computedBalance: number;
  match: boolean;
  fixed: boolean;
  computedLifetimeEarned: number;
  computedLifetimeSpent: number;
}

function buildClassification(params: ApplyLedgerEntryParams): LedgerClassification {
  return {
    source: params.source,
    eventType: params.eventType,
    refType: params.refType,
    refId: params.refId,
  };
}

async function logEvent(type: string, payload: Record<string, unknown>, status: "received" | "processed" | "failed", error?: string) {
  try {
    await db.insert(packptsEvents).values({
      type,
      payload,
      status,
      error: error || null,
    });
  } catch (e) {
    console.error(`[PackPTS Events] Failed to log event: ${type}`, e);
  }
}

export async function applyLedgerEntry(params: ApplyLedgerEntryParams): Promise<WalletOperationResult> {
  const {
    userId,
    direction,
    amountPackpts,
    source,
    eventType,
    refType,
    refId,
    idempotencyKey,
    metadata,
  } = params;

  if (amountPackpts <= 0) {
    await logEvent(eventType, { userId, amountPackpts, idempotencyKey }, "failed", "Amount must be positive");
    return { success: false, error: "Amount must be positive" };
  }

  const classification = buildClassification(params);

  const reason = `${source}:${eventType} (${refType}:${refId})`;

  console.log(
    `[PackPTS Ledger] ${direction.toUpperCase()} userId=${userId} amount=${amountPackpts} source=${source} eventType=${eventType} refType=${refType} refId=${refId} key=${idempotencyKey}`
  );

  let result: WalletOperationResult;

  try {
    if (direction === "credit") {
      if (source === "purchase") {
        result = await walletService.purchaseCredit(
          userId,
          amountPackpts,
          reason,
          idempotencyKey,
          metadata,
          classification
        );
      } else {
        result = await walletService.earn(
          userId,
          amountPackpts,
          reason,
          idempotencyKey,
          metadata,
          undefined,
          classification
        );
      }
    } else {
      result = await walletService.spend(
        userId,
        amountPackpts,
        reason,
        idempotencyKey,
        metadata,
        undefined,
        classification
      );
    }

    if (result.idempotent) {
      console.log(`[PackPTS Ledger] IDEMPOTENT (already processed) key=${idempotencyKey}`);
    }

    await logEvent(eventType, {
      userId,
      direction,
      amountPackpts,
      source,
      refType,
      refId,
      idempotencyKey,
      idempotent: result.idempotent || false,
      newBalance: result.wallet?.balance,
    }, result.success ? "processed" : "failed", result.error);

    return result;
  } catch (err: any) {
    console.error(`[PackPTS Ledger] ERROR key=${idempotencyKey}: ${err.message}`);
    await logEvent(eventType, { userId, direction, amountPackpts, idempotencyKey }, "failed", err.message);
    return { success: false, error: err.message };
  }
}

export async function getBalance(userId: string): Promise<LedgerBalance> {
  const wallet = await walletService.getWallet(userId);

  if (wallet) {
    return {
      balancePackpts: wallet.balance,
      lifetimeEarnedPackpts: wallet.lifetimeEarned,
      lifetimeSpentPackpts: wallet.lifetimeSpent,
      lastUpdatedAt: wallet.updatedAt,
    };
  }

  const [computed] = await db
    .select({
      totalCredits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.amount} > 0 THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
      totalDebits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.amount} < 0 THEN ABS(${ledgerEntries.amount}) ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
    .where(eq(wallets.userId, userId));

  const credits = Number(computed?.totalCredits || 0);
  const debits = Number(computed?.totalDebits || 0);

  return {
    balancePackpts: credits - debits,
    lifetimeEarnedPackpts: credits,
    lifetimeSpentPackpts: debits,
    lastUpdatedAt: null,
  };
}

export async function reconcileBalance(userId: string): Promise<ReconciliationResult> {
  const wallet = await walletService.getOrCreateWallet(userId);

  const [computed] = await db
    .select({
      totalCredits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.amount} > 0 THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
      totalDebits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.amount} < 0 THEN ABS(${ledgerEntries.amount}) ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.walletId, wallet.id));

  const computedCredits = Number(computed?.totalCredits || 0);
  const computedDebits = Number(computed?.totalDebits || 0);
  const computedBalance = computedCredits - computedDebits;

  const match = wallet.balance === computedBalance;

  if (!match) {
    console.warn(
      `[PackPTS Reconcile] MISMATCH userId=${userId} cached=${wallet.balance} computed=${computedBalance} earned_cached=${wallet.lifetimeEarned} earned_computed=${computedCredits} spent_cached=${wallet.lifetimeSpent} spent_computed=${computedDebits}`
    );

    await db
      .update(wallets)
      .set({
        balance: computedBalance,
        lifetimeEarned: computedCredits,
        lifetimeSpent: computedDebits,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id));

    await logEvent("reconciliation_fix", {
      userId,
      cachedBalance: wallet.balance,
      computedBalance,
      cachedLifetimeEarned: wallet.lifetimeEarned,
      computedLifetimeEarned: computedCredits,
      cachedLifetimeSpent: wallet.lifetimeSpent,
      computedLifetimeSpent: computedDebits,
    }, "processed");
  }

  return {
    userId,
    cachedBalance: wallet.balance,
    computedBalance,
    match,
    fixed: !match,
    computedLifetimeEarned: computedCredits,
    computedLifetimeSpent: computedDebits,
  };
}

export async function getLedgerHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0
) {
  const wallet = await walletService.getWallet(userId);
  if (!wallet) {
    return { entries: [], hasMore: false };
  }

  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.walletId, wallet.id))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = entries.length > limit;
  const trimmed = hasMore ? entries.slice(0, limit) : entries;

  return {
    entries: trimmed.map((e) => ({
      id: e.id,
      direction: e.amount > 0 ? "credit" : "debit",
      amountPackpts: Math.abs(e.amount),
      source: e.source || inferSource(e.entryType),
      eventType: e.eventType || e.entryType,
      refType: e.refType || null,
      refId: e.refId || null,
      reason: e.reason,
      balanceAfter: e.balanceAfter,
      createdAt: e.createdAt,
    })),
    hasMore,
    nextCursor: hasMore ? trimmed[trimmed.length - 1].id : undefined,
  };
}

function inferSource(entryType: string): string {
  switch (entryType) {
    case "EARN":
    case "STREAK_EARN":
      return "gameplay";
    case "PURCHASE_CREDIT":
      return "purchase";
    case "SPEND":
      return "redemption";
    case "ADJUST":
    case "REVERSAL":
      return "admin";
    default:
      return "unknown";
  }
}
