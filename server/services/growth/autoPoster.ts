import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq, and, notInArray, inArray, or, isNull, lte } from "drizzle-orm";
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

/**
 * One-time backlog fix: promotes MANUAL_QUEUE items that are in READY status
 * to AUTO so the auto-poster can pick them up.  These were created incorrectly
 * by the cross-post job before the postingMode bug was fixed.  Safe to run
 * every cycle — it becomes a no-op once the backlog is drained.
 */
async function promoteManualQueueBacklog(): Promise<number> {
  try {
    // Only promote cross-posted items (instagram/facebook from TikTok) that
    // are stuck in MANUAL_QUEUE+READY and have never been posted.
    const stuckItems = await db
      .select({ id: growthContentItems.id, platform: growthContentItems.platform })
      .from(growthContentItems)
      .where(and(
        eq(growthContentItems.postingMode, "MANUAL_QUEUE"),
        eq(growthContentItems.status, "READY"),
        inArray(growthContentItems.platform, ["instagram", "facebook", "x", "discord", "reddit"])
      ))
      .limit(200);

    if (stuckItems.length === 0) return 0;

    const ids = stuckItems.map(i => i.id);
    await db.update(growthContentItems).set({
      postingMode: "AUTO",
      updatedAt: new Date(),
    }).where(inArray(growthContentItems.id, ids));

    console.log(`[AutoPoster] Backlog promotion: converted ${stuckItems.length} MANUAL_QUEUE → AUTO items (instagram/facebook)`);
    return stuckItems.length;
  } catch (err: any) {
    console.warn(`[AutoPoster] Backlog promotion failed: ${err?.message}`);
    return 0;
  }
}

registerJob("auto_post_ready_content", async (ctx: JobContext) => {
  if (isOpen()) {
    return { skipped: true, reason: "Circuit breaker open" };
  }

  // Always start with fresh credential validation so that newly-added or
  // recently-rotated credentials take effect immediately without waiting for
  // the 10-minute cache TTL to expire.
  clearCredentialCache();

  // Self-heal: reset any FAILED items that failed only because credentials
  // were not yet configured.  Runs every time so the queue recovers
  // automatically once credentials are added.
  const autoHealed = await resetCredentialFailedItems();

  // Backlog fix: promote any MANUAL_QUEUE instagram/facebook items that were
  // created before the crossPostJobs postingMode bug was fixed.
  const backlogPromoted = await promoteManualQueueBacklog();

  const now = new Date();
  const readyItems = await db.select().from(growthContentItems)
    .where(and(
      eq(growthContentItems.postingMode, "AUTO"),
      eq(growthContentItems.status, "READY"),
      notInArray(growthContentItems.platform, MANUAL_ONLY_PLATFORMS),
      or(isNull(growthContentItems.scheduledFor), lte(growthContentItems.scheduledFor, now))
    ))
    .limit(25);

  if (readyItems.length === 0) {
    // Count how many items are stuck in MANUAL_QUEUE+READY so the admin
    // can see there is work to do but the backlog promoter found none
    const stuckCount = await db.select({ id: growthContentItems.id })
      .from(growthContentItems)
      .where(and(
        eq(growthContentItems.status, "READY"),
        eq(growthContentItems.postingMode, "MANUAL_QUEUE"),
      ))
      .limit(1);
    return {
      posted: 0,
      failed: 0,
      skippedCredentials: 0,
      autoHealed,
      backlogPromoted,
      total: 0,
      errors: [],
      reason: stuckCount.length > 0
        ? "No AUTO+READY items — MANUAL_QUEUE items exist but were not promoted (check platform filter)"
        : "No READY items in queue",
    };
  }

  const platformsToPost = Array.from(new Set(readyItems.map(i => i.platform)));
  const credentialResults = new Map<string, { valid: boolean; error?: string }>();
  for (const p of platformsToPost) {
    const result = await checkPlatformCredentials(p);
    credentialResults.set(p, result);
    console.log(`[AutoPoster] Credential check ${p}: ${result.valid ? "VALID" : `INVALID — ${result.error}`}`);
  }

  let posted = 0;
  let failed = 0;
  let skippedCredentials = 0;
  const errors: { id: string; platform: string; type: string; error: string }[] = [];

  for (const item of readyItems) {
    const credCheck = credentialResults.get(item.platform);
    if (credCheck && !credCheck.valid) {
      skippedCredentials++;
      const reason = credCheck.error || "Credentials invalid";
      console.warn(`[AutoPoster] Skipping ${item.id} (${item.platform}/${item.type}) — ${reason}`);
      errors.push({ id: item.id, platform: item.platform, type: item.type || "", error: `CREDENTIAL_SKIP: ${reason}` });
      // Store the skip reason on the item so it is visible in the Content tab
      await db.update(growthContentItems).set({
        error: `Skipped: ${reason}`,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, item.id)).catch(() => {});
      continue;
    }

    const adapter = await getAdapterForPlatform(item.platform);
    if (!adapter) {
      console.warn(`[AutoPoster] No adapter for platform: ${item.platform}`);
      errors.push({ id: item.id, platform: item.platform, type: item.type || "", error: "No adapter registered for platform" });
      continue;
    }

    // Wrap each individual post in try/catch so one item throwing cannot
    // abort the remaining items in the batch.
    try {
      const result = await adapter(item.id);
      if (result.success) {
        posted++;
        recordSuccess();
        console.log(`[AutoPoster] Posted ${item.type} to ${item.platform} (${item.id}) → ${result.externalPostId}`);
      } else {
        failed++;
        recordFailure();
        clearCredentialCache(item.platform);
        await db.update(growthContentItems).set({
          status: "FAILED",
          error: result.error,
          updatedAt: new Date(),
        }).where(eq(growthContentItems.id, item.id));
        const errMsg = result.error || "Unknown error";
        console.error(`[AutoPoster] Failed ${item.platform}/${item.type} (${item.id}): ${errMsg}`);
        errors.push({ id: item.id, platform: item.platform, type: item.type || "", error: errMsg });
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
      errors.push({ id: item.id, platform: item.platform, type: item.type || "", error: errorMsg });
    }
  }

  const credentialStatus: Record<string, { valid: boolean; error?: string }> = {};
  credentialResults.forEach((v, k) => { credentialStatus[k] = v; });

  return { posted, failed, skippedCredentials, autoHealed, backlogPromoted, total: readyItems.length, errors, credentialStatus };
});
