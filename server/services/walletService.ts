import { db } from "../db";
import { wallets, ledgerEntries, packptsBucket, packptsSpendAllocation, userRiskState, type Wallet, type LedgerEntry, type LedgerEntryType, type BucketSourceType } from "@shared/schema";
import { eq, sql, and, asc, gt, isNull } from "drizzle-orm";
import { bucketService } from "./bucketService";

async function isUserFrozen(userId: string): Promise<{ frozen: boolean; reason?: string }> {
  try {
    const [state] = await db
      .select()
      .from(userRiskState)
      .where(eq(userRiskState.userId, userId))
      .limit(1);
    
    if (!state || state.status === "NORMAL") {
      return { frozen: false };
    }
    
    return { frozen: true, reason: state.reason || "Account frozen" };
  } catch (e) {
    // Fail closed: if we can't verify freeze status, deny the operation
    return { frozen: true, reason: "Unable to verify account status" };
  }
}

export interface LedgerClassification {
  source?: string;
  eventType?: string;
  refType?: string;
  refId?: string;
}

export interface WalletOperationResult {
  success: boolean;
  wallet?: Wallet;
  ledgerEntry?: LedgerEntry;
  error?: string;
  idempotent?: boolean;
}

export interface WalletWithHistory {
  wallet: Wallet;
  recentEntries: LedgerEntry[];
}

class WalletService {
  async getOrCreateWallet(userId: string): Promise<Wallet> {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      
      if (existing.length > 0) {
        return existing[0];
      }

      const [newWallet] = await tx.insert(wallets).values({
        userId,
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        status: "active",
      }).onConflictDoNothing().returning();

      if (newWallet) {
        return newWallet;
      }

      const [finalWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1);
      return finalWallet;
    });
  }

  async getWallet(userId: string): Promise<Wallet | null> {
    const result = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : null;
  }

  async getWalletWithHistory(userId: string, limit: number = 10): Promise<WalletWithHistory | null> {
    const wallet = await this.getOrCreateWallet(userId);
    
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, wallet.id))
      .orderBy(sql`${ledgerEntries.createdAt} DESC`)
      .limit(limit);

    return { wallet, recentEntries: entries };
  }

  async earn(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
    txOrDb?: any,
    classification?: LedgerClassification
  ): Promise<WalletOperationResult> {
    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    const frozenCheck = await isUserFrozen(userId);
    if (frozenCheck.frozen) {
      return { success: false, error: `Account frozen: ${frozenCheck.reason}` };
    }

    const executeEarn = async (tx: any): Promise<WalletOperationResult> => {
      const existingEntry = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      
      if (existingEntry.length > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) throw new Error(`Wallet not found for user ${userId} during idempotent replay`);
        return {
          success: true,
          wallet,
          ledgerEntry: existingEntry[0],
          idempotent: true
        };
      }

      let [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);

      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        wallet = newWallet;
      }
      
      if (wallet.status !== "active") {
        return { success: false, error: `Wallet is ${wallet.status}` };
      }

      const newBalance = wallet.balance + amount;
      const newLifetimeEarned = wallet.lifetimeEarned + amount;

      const insertedEntries = await tx
        .insert(ledgerEntries)
        .values({
          walletId: wallet.id,
          entryType: "EARN" as LedgerEntryType,
          amount: amount,
          balanceAfter: newBalance,
          reason,
          source: classification?.source || null,
          eventType: classification?.eventType || null,
          refType: classification?.refType || null,
          refId: classification?.refId || null,
          metadata: metadata || null,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (insertedEntries.length === 0) {
        const [existingLedger] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
        return { success: true, wallet: wallet, ledgerEntry: existingLedger, idempotent: true };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lifetimeEarned: newLifetimeEarned,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      await bucketService.createBucket(
        userId,
        amount,
        "EARNED",
        insertedEntries[0].id,
        metadata,
        undefined,
        tx
      );

      const updatedWallet = { ...wallet, balance: newBalance, lifetimeEarned: newLifetimeEarned };
      return { success: true, wallet: updatedWallet, ledgerEntry: insertedEntries[0] };
    };

    if (txOrDb) {
      return executeEarn(txOrDb);
    }
    return await db.transaction(async (tx) => executeEarn(tx));
  }

  async spend(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
    txOrDb?: any,
    classification?: LedgerClassification
  ): Promise<WalletOperationResult> {
    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    const frozenCheck = await isUserFrozen(userId);
    if (frozenCheck.frozen) {
      return { success: false, error: frozenCheck.reason || "Account frozen" };
    }

    const executeSpend = async (tx: any): Promise<WalletOperationResult> => {
      const existingEntry = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      
      if (existingEntry.length > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) throw new Error(`Wallet not found for user ${userId} during idempotent replay`);
        return {
          success: true,
          wallet,
          ledgerEntry: existingEntry[0],
          idempotent: true
        };
      }

      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      
      if (!wallet) {
        return { success: false, error: "Wallet not found" };
      }
      
      if (wallet.status !== "active") {
        return { success: false, error: `Wallet is ${wallet.status}` };
      }

      if (wallet.balance < amount) {
        return { success: false, error: "Insufficient balance" };
      }

      const newBalance = wallet.balance - amount;
      const newLifetimeSpent = wallet.lifetimeSpent + amount;

      const insertedEntries = await tx
        .insert(ledgerEntries)
        .values({
          walletId: wallet.id,
          entryType: "SPEND" as LedgerEntryType,
          amount: -amount,
          balanceAfter: newBalance,
          reason,
          source: classification?.source || null,
          eventType: classification?.eventType || null,
          refType: classification?.refType || null,
          refId: classification?.refId || null,
          metadata: metadata || null,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (insertedEntries.length === 0) {
        const [existingLedger] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
        return { success: true, wallet: wallet, ledgerEntry: existingLedger, idempotent: true };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lifetimeSpent: newLifetimeSpent,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      const allocationResult = await bucketService.allocateSpend(
        userId,
        amount,
        insertedEntries[0].id,
        tx
      );
      
      if (!allocationResult.success) {
        console.warn(`Bucket allocation warning for spend: ${allocationResult.error}`);
      }

      const updatedWallet = { ...wallet, balance: newBalance, lifetimeSpent: newLifetimeSpent };
      return { success: true, wallet: updatedWallet, ledgerEntry: insertedEntries[0] };
    };

    if (txOrDb) {
      return executeSpend(txOrDb);
    }
    return await db.transaction(async (tx) => executeSpend(tx));
  }

  async adjust(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
    classification?: LedgerClassification
  ): Promise<WalletOperationResult> {
    return await db.transaction(async (tx) => {
      const existingEntry = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      
      if (existingEntry.length > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) throw new Error(`Wallet not found for user ${userId} during idempotent replay`);
        return {
          success: true,
          wallet,
          ledgerEntry: existingEntry[0],
          idempotent: true
        };
      }

      let [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);

      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        wallet = newWallet;
      }
      
      const newBalance = wallet.balance + amount;
      
      if (newBalance < 0) {
        return { success: false, error: "Adjustment would result in negative balance" };
      }

      const lifetimeEarnedDelta = amount > 0 ? amount : 0;
      const lifetimeSpentDelta = amount < 0 ? Math.abs(amount) : 0;

      const insertedEntries = await tx
        .insert(ledgerEntries)
        .values({
          walletId: wallet.id,
          entryType: "ADJUST" as LedgerEntryType,
          amount: amount,
          balanceAfter: newBalance,
          reason,
          source: classification?.source || "admin",
          eventType: classification?.eventType || "admin_adjustment",
          refType: classification?.refType || "admin_action",
          refId: classification?.refId || null,
          metadata: metadata || null,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (insertedEntries.length === 0) {
        const [existingLedger] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
        return { success: true, wallet: wallet, ledgerEntry: existingLedger, idempotent: true };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lifetimeEarned: wallet.lifetimeEarned + lifetimeEarnedDelta,
          lifetimeSpent: wallet.lifetimeSpent + lifetimeSpentDelta,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      if (amount > 0) {
        await bucketService.createBucket(
          userId,
          amount,
          "ADJUSTMENT",
          insertedEntries[0].id,
          metadata,
          undefined,
          tx
        );
      } else if (amount < 0) {
        const allocationResult = await bucketService.allocateSpend(
          userId,
          Math.abs(amount),
          insertedEntries[0].id,
          tx
        );
        if (!allocationResult.success) {
          console.warn(`Bucket allocation warning for negative adjustment: ${allocationResult.error}`);
        }
      }

      const updatedWallet = { 
        ...wallet, 
        balance: newBalance,
        lifetimeEarned: wallet.lifetimeEarned + lifetimeEarnedDelta,
        lifetimeSpent: wallet.lifetimeSpent + lifetimeSpentDelta,
      };
      return { success: true, wallet: updatedWallet, ledgerEntry: insertedEntries[0] };
    });
  }

  async getLedgerHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<LedgerEntry[]> {
    const wallet = await this.getWallet(userId);
    if (!wallet) {
      return [];
    }

    return await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, wallet.id))
      .orderBy(sql`${ledgerEntries.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  async purchaseCredit(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
    classification?: LedgerClassification
  ): Promise<WalletOperationResult> {
    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    return await db.transaction(async (tx) => {
      const existingEntry = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      
      if (existingEntry.length > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) throw new Error(`Wallet not found for user ${userId} during idempotent replay`);
        return {
          success: true,
          wallet,
          ledgerEntry: existingEntry[0],
          idempotent: true
        };
      }

      let [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);

      if (!wallet) {
        const [newWallet] = await tx.insert(wallets).values({
          userId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          status: "active",
        }).returning();
        wallet = newWallet;
      }
      
      if (wallet.status !== "active") {
        return { success: false, error: `Wallet is ${wallet.status}` };
      }

      const newBalance = wallet.balance + amount;
      const newLifetimeEarned = wallet.lifetimeEarned + amount;

      const insertedEntries = await tx
        .insert(ledgerEntries)
        .values({
          walletId: wallet.id,
          entryType: "PURCHASE_CREDIT" as LedgerEntryType,
          amount: amount,
          balanceAfter: newBalance,
          reason,
          source: classification?.source || "purchase",
          eventType: classification?.eventType || "stripe_checkout_completed",
          refType: classification?.refType || "stripe_session",
          refId: classification?.refId || null,
          metadata: metadata || null,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (insertedEntries.length === 0) {
        const [existingLedger] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
        return { success: true, wallet: wallet, ledgerEntry: existingLedger, idempotent: true };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lifetimeEarned: newLifetimeEarned,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      await bucketService.createBucket(
        userId,
        amount,
        "PURCHASED",
        insertedEntries[0].id,
        metadata,
        undefined,
        tx
      );

      const updatedWallet = { ...wallet, balance: newBalance, lifetimeEarned: newLifetimeEarned };
      return { success: true, wallet: updatedWallet, ledgerEntry: insertedEntries[0] };
    });
  }

  async reversal(
    userId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    originalIdempotencyKey: string,
    metadata?: Record<string, unknown>
  ): Promise<WalletOperationResult> {
    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    return await db.transaction(async (tx) => {
      const existingReversal = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
        .for("update")
        .limit(1);
      
      if (existingReversal.length > 0) {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
        if (!wallet) throw new Error(`Wallet not found for user ${userId} during idempotent replay`);
        return {
          success: true,
          wallet,
          ledgerEntry: existingReversal[0],
          idempotent: true
        };
      }

      const originalEntry = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.idempotencyKey, originalIdempotencyKey))
        .limit(1);
      
      if (originalEntry.length === 0) {
        return { 
          success: false, 
          error: "Original transaction not found - nothing to reverse" 
        };
      }

      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      
      if (!wallet) {
        return { success: false, error: "Wallet not found" };
      }

      const newBalance = wallet.balance - amount;
      
      if (newBalance < 0) {
        return { success: false, error: "Reversal would result in negative balance" };
      }

      const insertedEntries = await tx
        .insert(ledgerEntries)
        .values({
          walletId: wallet.id,
          entryType: "REVERSAL" as LedgerEntryType,
          amount: -amount,
          balanceAfter: newBalance,
          reason,
          metadata: { 
            ...metadata, 
            originalIdempotencyKey,
            originalEntryId: originalEntry[0].id 
          },
          idempotencyKey,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (insertedEntries.length === 0) {
        const [existingLedger] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey)).limit(1);
        return { success: true, wallet: wallet, ledgerEntry: existingLedger, idempotent: true };
      }

      await tx
        .update(wallets)
        .set({
          balance: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      const allocationResult = await bucketService.allocateSpend(
        userId,
        amount,
        insertedEntries[0].id,
        tx
      );
      
      if (!allocationResult.success) {
        console.warn(`Bucket allocation warning for reversal: ${allocationResult.error}`);
      }

      const updatedWallet = { ...wallet, balance: newBalance };
      return { success: true, wallet: updatedWallet, ledgerEntry: insertedEntries[0] };
    });
  }

  async findLedgerEntryByIdempotencyKey(idempotencyKey: string): Promise<LedgerEntry | null> {
    const result = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
      .limit(1);
    return result.length > 0 ? result[0] : null;
  }
}

export const walletService = new WalletService();
