import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { getAdapterForPlatform, validateTwitterCredentials, validateInstagramCredentials, validateFacebookCredentials, clearCredentialCache } from "./platformAdapters";
import { isOpen, recordFailure, recordSuccess } from "./circuitBreaker";

async function checkPlatformCredentials(platform: string): Promise<{ valid: boolean; error?: string }> {
  switch (platform) {
    case "x": {
      const r = await validateTwitterCredentials();
      return { valid: r.valid, error: r.error };
    }
    case "instagram": {
      const r = await validateInstagramCredentials();
      return { valid: r.valid, error: r.error };
    }
    case "facebook": {
      const r = await validateFacebookCredentials();
      return { valid: r.valid, error: r.error };
    }
    default:
      return { valid: true };
  }
}

registerJob("auto_post_ready_content", async (ctx: JobContext) => {
  if (isOpen()) {
    return { skipped: true, reason: "Circuit breaker open" };
  }

  const readyItems = await db.select().from(growthContentItems)
    .where(and(
      eq(growthContentItems.postingMode, "AUTO"),
      eq(growthContentItems.status, "READY")
    ))
    .limit(10);

  if (readyItems.length === 0) {
    return { posted: 0, reason: "No ready items" };
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
  }

  return { posted, failed, skippedCredentials, total: readyItems.length };
});
