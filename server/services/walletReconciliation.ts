import { db } from "../db";
import { wallets, ledgerEntries } from "@shared/schema";
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
