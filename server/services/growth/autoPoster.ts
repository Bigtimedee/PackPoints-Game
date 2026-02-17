import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { getAdapterForPlatform } from "./platformAdapters";
import { isOpen, recordFailure, recordSuccess } from "./circuitBreaker";

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

  let posted = 0;
  let failed = 0;

  for (const item of readyItems) {
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
      await db.update(growthContentItems).set({
        status: "FAILED",
        error: result.error,
        updatedAt: new Date(),
      }).where(eq(growthContentItems.id, item.id));
      console.error(`[AutoPoster] Failed to post ${item.id}: ${result.error}`);
    }
  }

  return { posted, failed, total: readyItems.length };
});
