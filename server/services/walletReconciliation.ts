import { db } from "../db";
import { wallets, ledgerEntries, pointsAwards } from "@shared/schema";
import { eq, sql, sum } from "drizzle-orm";

export interface WalletMismatch {
  userId: string;
  walletId: string;
  cachedBalance: number;
  computedBalance: number;
  drift: number;
}

export interface ReconciliationResult {
  totalWallets: number;
  matchCount: number;
  mismatchCount: number;
  mismatches: WalletMismatch[];
  reconciledAt: string;
}

export async function reconcileAllWallets(): Promise<ReconciliationResult> {
  const allWallets = await db.select().from(wallets);

  const ledgerSums = await db
    .select({
      walletId: ledgerEntries.walletId,
      computedBalance: sum(ledgerEntries.amount).mapWith(Number),
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.walletId);

  const sumMap = new Map<string, number>();
  for (const row of ledgerSums) {
    sumMap.set(row.walletId, row.computedBalance ?? 0);
  }

  const mismatches: WalletMismatch[] = [];

  for (const wallet of allWallets) {
    const computedBalance = sumMap.get(wallet.id) ?? 0;
    if (computedBalance !== wallet.balance) {
      const mismatch: WalletMismatch = {
        userId: wallet.userId,
        walletId: wallet.id,
        cachedBalance: wallet.balance,
        computedBalance,
        drift: computedBalance - wallet.balance,
      };
      mismatches.push(mismatch);
      console.warn(
        `[WalletReconciliation] MISMATCH wallet=${wallet.id} user=${wallet.userId} cached=${wallet.balance} computed=${computedBalance} drift=${mismatch.drift}`
      );
    }
  }

  const result: ReconciliationResult = {
    totalWallets: allWallets.length,
    matchCount: allWallets.length - mismatches.length,
    mismatchCount: mismatches.length,
    mismatches,
    reconciledAt: new Date().toISOString(),
  };

  if (mismatches.length === 0) {
    console.log(
      `[WalletReconciliation] All ${allWallets.length} wallets reconciled successfully.`
    );
  } else {
    console.warn(
      `[WalletReconciliation] ${mismatches.length}/${allWallets.length} wallets have balance mismatches.`
    );
  }

  return result;
}

export interface CrossSystemMismatch {
  userId: string;
  pointsAwardsTotal: number;
  walletLifetimeEarned: number;
  walletBalance: number;
  drift: number;
}

export interface CrossSystemReconciliationResult {
  usersChecked: number;
  matchCount: number;
  mismatchCount: number;
  mismatches: CrossSystemMismatch[];
  reconciledAt: string;
}

export async function reconcileCrossSystem(): Promise<CrossSystemReconciliationResult> {
  const awardSums = await db
    .select({
      userId: pointsAwards.userId,
      totalAwarded: sql<number>`COALESCE(SUM(${pointsAwards.finalPts}), 0)`.mapWith(Number),
    })
    .from(pointsAwards)
    .groupBy(pointsAwards.userId);

  const mismatches: CrossSystemMismatch[] = [];

  for (const awardRow of awardSums) {
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, awardRow.userId))
      .limit(1);

    const walletEarned = wallet?.lifetimeEarned ?? 0;
    const walletBalance = wallet?.balance ?? 0;

    if (awardRow.totalAwarded !== walletEarned) {
      const drift = awardRow.totalAwarded - walletEarned;
      const mismatch: CrossSystemMismatch = {
        userId: awardRow.userId,
        pointsAwardsTotal: awardRow.totalAwarded,
        walletLifetimeEarned: walletEarned,
        walletBalance,
        drift,
      };
      mismatches.push(mismatch);
      const direction = drift > 0 ? "UNDER-CREDITED" : "OVER-CREDITED";
      console.warn(
        `[CrossSystemReconciliation] ${direction} user=${awardRow.userId} awards=${awardRow.totalAwarded} walletEarned=${walletEarned} drift=${drift}`
      );
    }
  }

  const result: CrossSystemReconciliationResult = {
    usersChecked: awardSums.length,
    matchCount: awardSums.length - mismatches.length,
    mismatchCount: mismatches.length,
    mismatches,
    reconciledAt: new Date().toISOString(),
  };

  if (mismatches.length === 0) {
    console.log(`[CrossSystemReconciliation] All ${awardSums.length} users reconciled — no drift.`);
  } else {
    console.warn(`[CrossSystemReconciliation] ${mismatches.length}/${awardSums.length} users have points_awards vs wallet drift.`);
  }

  return result;
}

let reconciliationInterval: ReturnType<typeof setInterval> | null = null;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function startReconciliationWorker(intervalMs: number = SIX_HOURS_MS): void {
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
  }

  console.log(
    `[WalletReconciliation] Starting reconciliation worker (interval=${intervalMs}ms)`
  );

  reconciliationInterval = setInterval(async () => {
    try {
      await reconcileAllWallets();
    } catch (error) {
      console.error("[WalletReconciliation] Worker error:", error);
    }
  }, intervalMs);
}
