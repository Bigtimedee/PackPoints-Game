import { db } from "../../db";
import { growthFollowerDmLog } from "@shared/schema";
import { eq } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { getNewTwitterFollowers, sendTwitterWelcomeDM } from "./platformAdapters";

registerJob("send_follower_dms", async (_ctx: JobContext) => {
  console.log("[FollowerDMs] Starting send_follower_dms job");

  // 1. Load known follower IDs for platform "x"
  const existing = await db
    .select({ followerId: growthFollowerDmLog.followerId })
    .from(growthFollowerDmLog)
    .where(eq(growthFollowerDmLog.platform, "x"));

  const knownIds = new Set(existing.map((r) => r.followerId));
  console.log(`[FollowerDMs] Known follower IDs: ${knownIds.size}`);

  // 2. Fetch new followers (newest-first; stops paginating once a known ID is seen)
  const newFollowers = await getNewTwitterFollowers(knownIds);
  console.log(`[FollowerDMs] New followers found: ${newFollowers.length}`);

  if (newFollowers.length === 0) {
    return { platform: "x", newFollowers: 0, dmsSent: 0, failed: 0 };
  }

  let dmsSent = 0;
  let failed = 0;
  let rateLimited = false;

  // 3. DM each new follower
  for (const follower of newFollowers) {
    if (rateLimited) break;

    let dmStatus = "SENT";
    let errorMsg: string | undefined;

    try {
      const result = await sendTwitterWelcomeDM(follower.id, follower.username);

      if (!result.success) {
        const err = result.error ?? "Unknown error";

        // 429 = rate limit — stop the batch; don't log this follower so it retries next run
        if (err.includes("429") || err.toLowerCase().includes("rate limit")) {
          console.log(`[FollowerDMs] Rate limited after ${dmsSent} DMs. Stopping batch.`);
          rateLimited = true;
          break;
        }

        // 403 = DMs disabled by user — log as SKIPPED, never retry
        if (err.includes("403") || err.toLowerCase().includes("not authorized")) {
          dmStatus = "SKIPPED";
        } else {
          dmStatus = "FAILED";
        }

        errorMsg = err;
        failed++;
      } else {
        dmsSent++;
      }
    } catch (err: any) {
      dmStatus = "FAILED";
      errorMsg = err?.message || "Unknown error";
      failed++;
    }

    // 4. Insert log row; ON CONFLICT DO NOTHING for idempotency
    try {
      await db
        .insert(growthFollowerDmLog)
        .values({
          platform: "x",
          followerId: follower.id,
          followerUsername: follower.username,
          dmStatus,
          error: errorMsg ?? null,
        })
        .onConflictDoNothing();
    } catch (insertErr: any) {
      console.error(`[FollowerDMs] Failed to log DM for ${follower.username}: ${insertErr?.message}`);
    }
  }

  const summary = { platform: "x", newFollowers: newFollowers.length, dmsSent, failed };
  console.log(`[FollowerDMs] Done: ${JSON.stringify(summary)}`);
  return summary;
});
