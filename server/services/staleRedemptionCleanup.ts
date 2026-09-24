import { db } from "../db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { attributedPurchases, externalPurchaseIntent, outboundClicks } from "@shared/schema";
import { profitGuardrailService } from "./profitGuardrailService";
import {
  approvedIntentHasRebateProgress,
  staleRedemptionCleanupMode,
  staleRedemptionMaxPerRun,
  type AttributedPurchaseSignal,
  type OutboundClickSignal,
} from "./staleRedemptionGuard";

const STALE_APPROVED_HOURS = 72;
const STALE_CREATED_HOURS = 24;

export interface CleanupResult {
  approvedCanceled: number;
  createdExpired: number;
  skippedProtected: number;
  remaining: number;
  errors: string[];
}

function ageHours(from: Date | null | undefined, now: Date): number {
  if (!from) return 0;
  const at = from instanceof Date ? from : new Date(from);
  return Math.round((now.getTime() - at.getTime()) / 3600000);
}

export async function runStaleRedemptionCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    approvedCanceled: 0,
    createdExpired: 0,
    skippedProtected: 0,
    remaining: 0,
    errors: [],
  };

  const now = new Date();
  const mode = staleRedemptionCleanupMode();

  const staleApproved = await db
    .select()
    .from(externalPurchaseIntent)
    .where(
      and(
        eq(externalPurchaseIntent.status, "APPROVED"),
        sql`${externalPurchaseIntent.listingId} NOT LIKE 'qa-receipt-%'`,
        lte(
          externalPurchaseIntent.updatedAt,
          new Date(now.getTime() - STALE_APPROVED_HOURS * 60 * 60 * 1000)
        )
      )
    );

  const staleCreated = await db
    .select({
      id: externalPurchaseIntent.id,
      createdAt: externalPurchaseIntent.createdAt,
    })
    .from(externalPurchaseIntent)
    .where(
      and(
        eq(externalPurchaseIntent.status, "CREATED"),
        sql`${externalPurchaseIntent.listingId} NOT LIKE 'qa-receipt-%'`,
        lte(
          externalPurchaseIntent.createdAt,
          new Date(now.getTime() - STALE_CREATED_HOURS * 60 * 60 * 1000)
        )
      )
    );

  const userIds = [...new Set(staleApproved.map((intent) => intent.userId))];
  const listingIds = [...new Set(staleApproved.map((intent) => intent.listingId))];

  let clicks: OutboundClickSignal[] = [];
  let purchases: AttributedPurchaseSignal[] = [];
  if (userIds.length > 0) {
    const clickRows = listingIds.length === 0
      ? []
      : await db
          .select({
            id: outboundClicks.id,
            userId: outboundClicks.userId,
            listingId: outboundClicks.listingId,
          })
          .from(outboundClicks)
          .where(and(
            inArray(outboundClicks.userId, userIds),
            inArray(outboundClicks.listingId, listingIds),
          ));
    clicks = clickRows;

    purchases = await db
      .select({
        userId: attributedPurchases.userId,
        itemId: attributedPurchases.itemId,
        outboundClickId: attributedPurchases.outboundClickId,
      })
      .from(attributedPurchases)
      .where(inArray(attributedPurchases.userId, userIds));
  }

  const approvedCandidates = staleApproved.map((intent) => ({
    intent,
    ageHours: ageHours(intent.updatedAt, now),
    protected: approvedIntentHasRebateProgress(intent, clicks, purchases),
  }));

  if (mode === "dry_run") {
    console.log(
      `[StaleCleanup] DRY RUN: approved=${approvedCandidates.length} created=${staleCreated.length}`
    );
    for (const candidate of approvedCandidates) {
      console.log(
        `[StaleCleanup] DRY RUN approved id=${candidate.intent.id} ageHours=${candidate.ageHours} protected=${candidate.protected}`
      );
    }
    for (const intent of staleCreated) {
      console.log(
        `[StaleCleanup] DRY RUN created id=${intent.id} ageHours=${ageHours(intent.createdAt, now)}`
      );
    }
    console.log(
      `[StaleCleanup] DRY RUN totals: approved=${approvedCandidates.length} created=${staleCreated.length} protected=${approvedCandidates.filter((c) => c.protected).length}`
    );
    return result;
  }

  const cap = staleRedemptionMaxPerRun();
  const actionable = approvedCandidates.filter((candidate) => !candidate.protected);
  result.skippedProtected = approvedCandidates.length - actionable.length;
  const approvedToCancel = actionable.slice(0, cap);
  const createdToCancel = staleCreated.slice(0, Math.max(0, cap - approvedToCancel.length));
  result.remaining = (actionable.length - approvedToCancel.length) + (staleCreated.length - createdToCancel.length);

  for (const candidate of approvedCandidates) {
    if (candidate.protected) {
      console.log(
        `[StaleCleanup] Skipped APPROVED intent ${candidate.intent.id}: outbound click, partner postback, or purchase evidence (age: ${candidate.ageHours}h)`
      );
    }
  }

  for (const candidate of approvedToCancel) {
    const intent = candidate.intent;
    try {
      await profitGuardrailService.cancelRedemption(intent.userId, intent.id);
      result.approvedCanceled++;
      console.log(
        `[StaleCleanup] Auto-canceled stale APPROVED intent ${intent.id} for user ${intent.userId} (age: ${candidate.ageHours}h)`
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

  if (createdToCancel.length > 0) {
    const canceled = await db
      .update(externalPurchaseIntent)
      .set({
        status: "CANCELED",
        updatedAt: new Date(),
      })
      .where(and(
        inArray(externalPurchaseIntent.id, createdToCancel.map((intent) => intent.id)),
        eq(externalPurchaseIntent.status, "CREATED"),
      ))
      .returning({ id: externalPurchaseIntent.id });
    result.createdExpired = canceled.length;
    console.log(`[StaleCleanup] Expired ${canceled.length} orphaned CREATED intents`);
  }

  console.log(
    `[StaleCleanup] totals: approvedCanceled=${result.approvedCanceled} createdExpired=${result.createdExpired} skippedProtected=${result.skippedProtected} remaining=${result.remaining} errors=${result.errors.length}`
  );

  return result;
}
