/**
 * Pure checks for whether an APPROVED redemption already has rebate progress.
 * The post-purchase flow records an outbound click, then waits for an EPN
 * postback or user purchase evidence. Those intents must not be auto-canceled.
 */

export interface RebateIntentSignals {
  userId: string;
  listingId: string;
  listingUrl: string;
  outboundClickId: string | null;
  attributedPurchaseId: string | null;
  grantMethod: string | null;
  evidenceOrderId: string | null;
  evidenceNote: string | null;
  evidenceReceiptUrl: string | null;
  evidenceSubmittedAt: Date | string | null;
}

export interface OutboundClickSignal {
  id: string;
  userId: string | null;
  listingId: string;
}

export interface AttributedPurchaseSignal {
  userId: string | null;
  itemId: string | null;
  outboundClickId: string | null;
}

export function staleRedemptionCleanupMode(): "dry_run" | "live" {
  return process.env.STALE_REDEMPTION_CLEANUP_MODE === "live" ? "live" : "dry_run";
}

export function staleRedemptionMaxPerRun(): number {
  const parsed = Number.parseInt(process.env.STALE_REDEMPTION_MAX_PER_RUN ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

/** Same listing match the EPN grant path uses (exact, 16-char prefix, or URL). */
export function listingMatchesPostbackItem(listingId: string, listingUrl: string, itemId: string): boolean {
  if (listingId === itemId) return true;
  const prefix = itemId.substring(0, 16);
  if (prefix.length > 0 && listingId.startsWith(prefix)) return true;
  return itemId.length > 0 && listingUrl.includes(itemId);
}

export function approvedIntentHasRebateProgress(
  intent: RebateIntentSignals,
  clicks: OutboundClickSignal[],
  purchases: AttributedPurchaseSignal[],
): boolean {
  if (intent.outboundClickId || intent.attributedPurchaseId || intent.grantMethod) return true;
  if (intent.evidenceOrderId || intent.evidenceNote || intent.evidenceReceiptUrl || intent.evidenceSubmittedAt) {
    return true;
  }

  const clickIds = new Set<string>();
  for (const click of clicks) {
    if (click.userId === intent.userId && click.listingId === intent.listingId) {
      clickIds.add(click.id);
    }
  }
  if (clickIds.size > 0) return true;

  return purchases.some((purchase) => {
    if (purchase.userId !== intent.userId) return false;
    if (purchase.outboundClickId && clickIds.has(purchase.outboundClickId)) return true;
    if (!purchase.itemId) return false;
    return listingMatchesPostbackItem(intent.listingId, intent.listingUrl, purchase.itemId);
  });
}
