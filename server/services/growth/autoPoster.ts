import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { getAdapterForPlatform, validateTwitterCredentials, clearCredentialCache } from "./platformAdapters";
import { isOpen, recordFailure, recordSuccess } from "./circuitBreaker";

const MANUAL_ONLY_PLATFORMS: string[] = [];

/**
 * Substrings that identify a FAILED item whose error was a missing-credential
 * configuration issue rather than a real posting failure.  Items with these
 * errors are safe to auto-reset to READY so they will be retried once
 * credentials are eventually configured.
 */
const CREDENTIAL_ERROR_MARKERS = [
  "not configured",
  "not set",
  "credentials not found",
];

async function checkPlatformCredentials(platform: string): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (platform) {
      case "x": {
        const r = await validateTwitterCredentials();
        return { valid: r.valid, error: r.error };
      }
      case "instagram": {
        const r = await import("./platformAdapters").then(m => m.validateInstagramCredentials());
        return { valid: r.valid, error: r.error };
      }
      case "facebook": {
        const r = await import("./platformAdapters").then(m => m.validateFacebookCredentials());
        return { valid: r.valid, error: r.error };
      }
      case "discord": {
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        return webhookUrl
          ? { valid: true }
          : { valid: false, error: "DISCORD_WEBHOOK_URL not configured — set env var to enable Discord posting" };
      }
      case "reddit": {
        const hasRedditCreds = process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET &&
          process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD;
        return hasRedditCreds
          ? { valid: true }
          : { valid: false, error: "Reddit credentials not configured — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD" };
      }
      default:
        return { valid: true };
    }
  } catch (err: any) {
    // If the credential check itself throws (network error, etc.), skip this
    // platform rather than crashing the entire posting run.
    const error = err?.message || "Credential check failed";
    console.warn(`[AutoPoster] Credential check threw for ${platform}: ${error} — skipping platform this run`);
    return { valid: false, error: `Credential check error: ${error}` };
  }
}

/**
 * Scans all FAILED content items and resets those whose error was caused by
 * missing credentials back to READY.  This self-heals the queue: as soon as
 * credentials are added to the environment, previously-failed items will be
 * picked up on the next auto-post run without any manual intervention.
 */
async function resetCredentialFailedItems(): Promise<number> {
  try {
    const failedItems = await db
      .select({ id: growthContentItems.id, error: growthContentItems.error, platform: growthContentItems.platform })
      .from(growthContentItems)
      .where(eq(growthContentItems.status, "FAILED"))
      .limit(100);

    const toReset = failedItems.filter(item => {
      const err = (item.error || "").toLowerCase();
      return CREDENTIAL_ERROR_MARKERS.some(m => err.includes(m));
    });

    if (toReset.length === 0) return 0;

    for (const item of toReset) {
      await db.update(growthContentItems).set({
        status: "READY",
        error: null,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, item.id));
      clearCredentialCache(item.platform || undefined);
      console.log(`[AutoPoster] Auto-healed: reset ${item.platform} item ${item.id} FAILED → READY (was a credential-config error)`);
    }

    return toReset.length;
  } catch (err: any) {
    console.warn(`[AutoPoster] Credential auto-heal scan failed: ${err?.message}`);
    return 0;
  }
}

registerJob("auto_post_ready_content", async (ctx: JobContext) => {
  if (isOpen()) {
    return { skipped: true, reason: "Circuit breaker open" };
  }

  // Self-heal: reset any FAILED items that failed only because credentials
  // were not yet configured.  Runs every time so the queue recovers
  // automatically once credentials are added.
  const autoHealed = await resetCredentialFailedItems();

  const readyItems = await db.select().from(growthContentItems)
    .where(and(
      eq(growthContentItems.postingMode, "AUTO"),
      eq(growthContentItems.status, "READY"),
      notInArray(growthContentItems.platform, MANUAL_ONLY_PLATFORMS)
    ))
    .limit(10);

  if (readyItems.length === 0) {
    return { posted: 0, autoHealed, reason: "No ready items" };
  }

  const platformsToPost = Array.from(new Set(readyItems.map(i => i.platform)));
  const credentialResults = new Map<string, { valid: boolean; error?: string }>();
  for (const p of platformsToPost) {
    credentialResults.set(p, await checkPlatformCredentials(p));
  }

  let posted = 0;
  let failed = 0;
  let skippedCredentials = 0;

  for (const item of readyItems) {
    const credCheck = credentialResults.get(item.platform);
    if (credCheck && !credCheck.valid) {
      skippedCredentials++;
      console.warn(`[AutoPoster] Skipping ${item.id} — ${item.platform} credentials invalid: ${credCheck.error}. Item stays READY for retry after credentials are fixed.`);
      continue;
    }

    const adapter = await getAdapterForPlatform(item.platform);
    if (!adapter) {
      console.warn(`[AutoPoster] No adapter for platform: ${item.platform}`);
      continue;
    }

    // Wrap each individual post in try/catch so one item throwing cannot
    // abort the remaining items in the batch.
    try {
      const result = await adapter(item.id);
      if (result.success) {
        posted++;
        recordSuccess();
        console.log(`[AutoPoster] Posted ${item.type} to ${item.platform} (${item.id})`);
      } else {
        failed++;
        recordFailure();
        clearCredentialCache(item.platform);
        await db.update(growthContentItems).set({
          status: "FAILED",
          error: result.error,
          updatedAt: new Date(),
        }).where(eq(growthContentItems.id, item.id));
        console.error(`[AutoPoster] Failed to post ${item.id}: ${result.error}`);
      }
    } catch (err: any) {
      failed++;
      recordFailure();
      clearCredentialCache(item.platform);
      const errorMsg = err?.message || "Unexpected adapter error";
      await db.update(growthContentItems).set({
        status: "FAILED",
        error: errorMsg,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, item.id));
      console.error(`[AutoPoster] Unexpected error posting ${item.id} to ${item.platform}:`, errorMsg);
    }
  }

  return { posted, failed, skippedCredentials, autoHealed, total: readyItems.length };
});
