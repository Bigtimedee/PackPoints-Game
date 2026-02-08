import { db } from "../db";
import { eq, and, lte, sql } from "drizzle-orm";
import { externalPurchaseIntent } from "@shared/schema";
import { profitGuardrailService } from "./profitGuardrailService";

const STALE_APPROVED_HOURS = 72;
const STALE_CREATED_HOURS = 24;

export interface CleanupResult {
  approvedCanceled: number;
  createdExpired: number;
  errors: string[];
}

export async function runStaleRedemptionCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    approvedCanceled: 0,
    createdExpired: 0,
    errors: [],
  };

  const now = new Date();

  const staleApproved = await db
    .select()
    .from(externalPurchaseIntent)
    .where(
      and(
        eq(externalPurchaseIntent.status, "APPROVED"),
        lte(
          externalPurchaseIntent.updatedAt,
          new Date(now.getTime() - STALE_APPROVED_HOURS * 60 * 60 * 1000)
        )
      )
    );

  for (const intent of staleApproved) {
    try {
      await profitGuardrailService.cancelRedemption(intent.userId, intent.id);
      result.approvedCanceled++;
      console.log(
        `[StaleCleanup] Auto-canceled stale APPROVED intent ${intent.id} for user ${intent.userId} (age: ${Math.round((now.getTime() - (intent.updatedAt?.getTime() || now.getTime())) / 3600000)}h)`
      );
    } catch (err: any) {
      if (err.message?.includes("Cannot cancel:") || err.message?.includes("not found")) {
        console.log(`[StaleCleanup] Skipped intent ${intent.id}: ${err.message}`);
      } else {
        const msg = `Failed to cancel stale intent ${intent.id}: ${err.message}`;
        console.error(`[StaleCleanup] ${msg}`);
        result.errors.push(msg);
      }
    }
  }

  const staleCreated = await db
    .update(externalPurchaseIntent)
    .set({
      status: "CANCELED",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalPurchaseIntent.status, "CREATED"),
        lte(
          externalPurchaseIntent.createdAt,
          new Date(now.getTime() - STALE_CREATED_HOURS * 60 * 60 * 1000)
        )
      )
    )
    .returning({ id: externalPurchaseIntent.id });

  result.createdExpired = staleCreated.length;

  if (staleCreated.length > 0) {
    console.log(
      `[StaleCleanup] Expired ${staleCreated.length} orphaned CREATED intents`
    );
  }

  if (result.approvedCanceled > 0 || result.createdExpired > 0) {
    console.log(
      `[StaleCleanup] Job complete: ${result.approvedCanceled} approved canceled, ${result.createdExpired} created expired, ${result.errors.length} errors`
    );
  }

  return result;
}
