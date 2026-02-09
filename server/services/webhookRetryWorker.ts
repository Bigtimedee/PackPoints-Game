import { db } from "../db";
import { purchaseEvents } from "@shared/schema";
import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { stripePurchaseService } from "./stripePurchaseService";

const MAX_RETRY_COUNT = 5;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export interface RetryResult {
  totalFound: number;
  retried: number;
  succeeded: number;
  failed: number;
  results: Array<{
    eventId: string;
    success: boolean;
    message?: string;
    error?: string;
  }>;
}

export async function retryFailedWebhookEvents(): Promise<RetryResult> {
  const now = new Date();

  const failedEvents = await db
    .select()
    .from(purchaseEvents)
    .where(
      and(
        eq(purchaseEvents.status, "failed"),
        lt(purchaseEvents.retryCount, MAX_RETRY_COUNT),
        or(
          isNull(purchaseEvents.lastRetryAt),
          sql`${purchaseEvents.lastRetryAt} < ${now} - (power(2, ${purchaseEvents.retryCount}) * interval '60 seconds')`
        )
      )
    );

  const result: RetryResult = {
    totalFound: failedEvents.length,
    retried: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  if (failedEvents.length === 0) {
    return result;
  }

  console.log(`[WebhookRetryWorker] Found ${failedEvents.length} failed events eligible for retry`);

  for (const event of failedEvents) {
    result.retried++;
    console.log(`[WebhookRetryWorker] Retrying event ${event.eventId} (attempt ${(event.retryCount || 0) + 1}/${MAX_RETRY_COUNT})`);

    try {
      const retryResult = await stripePurchaseService.retryEvent(event.eventId);

      if (retryResult.success) {
        result.succeeded++;
        console.log(`[WebhookRetryWorker] Event ${event.eventId} retry succeeded`);
      } else {
        result.failed++;
        console.log(`[WebhookRetryWorker] Event ${event.eventId} retry failed: ${retryResult.error}`);
      }

      result.results.push({
        eventId: event.eventId,
        success: retryResult.success,
        message: retryResult.message,
        error: retryResult.error,
      });
    } catch (err) {
      result.failed++;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`[WebhookRetryWorker] Event ${event.eventId} retry threw: ${errorMessage}`);
      result.results.push({
        eventId: event.eventId,
        success: false,
        error: errorMessage,
      });
    }
  }

  console.log(`[WebhookRetryWorker] Retry complete: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.retried} retried`);
  return result;
}

export function startWebhookRetryWorker(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  console.log(`[WebhookRetryWorker] Starting worker (interval: ${intervalMs / 1000}s)`);

  intervalHandle = setInterval(async () => {
    try {
      await retryFailedWebhookEvents();
    } catch (err) {
      console.error("[WebhookRetryWorker] Worker tick failed:", err instanceof Error ? err.message : err);
    }
  }, intervalMs);
}
