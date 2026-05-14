/**
 * wagerService.ts
 *
 * Validates wager amounts and escrows PackPTS for wager matches.
 * Uses ledgerService for balance operations.
 */
import { WAGER_MIN_PACKPTS, WAGER_MAX_PACKPTS } from "@shared/schema";
import { applyLedgerEntry, getBalance } from "./packpts/ledgerService";

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface EscrowResult {
  success: boolean;
  error?: string;
}

/**
 * Validate that a wager amount is within allowed bounds.
 */
export function validateWagerAmount(amount: number): ValidationResult {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { valid: false, error: "Wager amount must be a whole number" };
  }
  if (amount < WAGER_MIN_PACKPTS) {
    return { valid: false, error: `Minimum wager is ${WAGER_MIN_PACKPTS} PackPTS` };
  }
  if (amount > WAGER_MAX_PACKPTS) {
    return { valid: false, error: `Maximum wager is ${WAGER_MAX_PACKPTS} PackPTS` };
  }
  return { valid: true };
}

/**
 * Escrow a wager amount from a user's balance for a match.
 * Debits the user's wallet with a refType of "wager_escrow" so it can be
 * refunded or settled after the match concludes.
 */
export async function escrowWager(
  userId: string,
  matchId: string,
  amount: number,
  role: "host" | "guest",
): Promise<EscrowResult> {
  // Check balance first
  const balance = await getBalance(userId);
  if (balance.balancePackpts < amount) {
    return {
      success: false,
      error: `Insufficient balance. You have ${balance.balancePackpts} PackPTS but need ${amount}.`,
    };
  }

  const result = await applyLedgerEntry({
    userId,
    direction: "debit",
    amountPackpts: amount,
    source: "gameplay",
    eventType: "wager_escrow",
    refType: "wager_escrow",
    refId: `${matchId}:${role}`,
    idempotencyKey: `wager-escrow-${matchId}-${role}`,
    metadata: { matchId, role, amount },
  });

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to escrow wager" };
  }

  return { success: true };
}
