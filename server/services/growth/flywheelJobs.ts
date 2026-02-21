import { db } from "../../db";
import { contentAssets, publishingQueue, users } from "@shared/schema";
import { eq, desc, sql, gte, and } from "drizzle-orm";

export async function pickTopContentForPublishing(): Promise<{
  picked: number;
  queued: number;
  details: string[];
}> {
  const details: string[] = [];
  let queued = 0;

  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentAssets = await db.select({
      id: contentAssets.id,
      assetType: contentAssets.assetType,
      userId: contentAssets.userId,
      sourceEventId: contentAssets.sourceEventId,
      metadata: contentAssets.metadata,
      imagePath: contentAssets.imagePath,
      createdAt: contentAssets.createdAt,
    })
      .from(contentAssets)
      .where(gte(contentAssets.createdAt, oneDayAgo))
      .orderBy(desc(contentAssets.createdAt))
      .limit(20);

    if (recentAssets.length === 0) {
      return { picked: 0, queued: 0, details: ["No recent content assets found"] };
    }

    const streakBadges = recentAssets.filter(a => a.assetType === "STREAK_BADGE");
    const scoreCards = recentAssets.filter(a =>
      a.assetType === "SCORE_CARD" || a.assetType === "DAILY5_RANK_CARD"
    );

    const topPicks = [
      ...streakBadges.slice(0, 2),
      ...scoreCards.slice(0, 1),
    ].slice(0, 3);

    for (const asset of topPicks) {
      try {
        const meta = asset.metadata as any;
        const username = meta?.username || "Player";
        const score = meta?.score || 0;

        let copyText = "";
        if (asset.assetType === "STREAK_BADGE") {
          const streakDays = meta?.streakDays || 0;
          const label = meta?.milestoneLabel || "streak";
          copyText = `${username} just hit a ${streakDays}-day streak on PackPTS! ${label}\n\nCan you match their dedication?\n\n#PackPTS #BaseballCards #Streak`;
        } else {
          copyText = `${username} scored ${score} points on PackPTS!\n\nThink you can do better? Play now!\n\n#PackPTS #BaseballCards #Trivia`;
        }

        const existingQueue = await db.select({ id: publishingQueue.id })
          .from(publishingQueue)
          .where(
            and(
              eq(publishingQueue.platform, "TWITTER"),
              sql`${publishingQueue.assets}->>'contentAssetId' = ${asset.id}`,
            )
          )
          .limit(1);

        if (existingQueue.length > 0) {
          details.push(`Skip ${asset.id}: already queued`);
          continue;
        }

        await db.insert(publishingQueue).values({
          platform: "TWITTER",
          copyText,
          assets: {
            contentAssetId: asset.id,
            assetType: asset.assetType,
            imagePath: asset.imagePath,
            username,
            source: "flywheel_auto",
          },
          status: "READY",
        });

        queued++;
        details.push(`Queued ${asset.assetType} from ${username} (${asset.id})`);
      } catch (err: any) {
        details.push(`Error queueing ${asset.id}: ${err?.message}`);
      }
    }

    return { picked: topPicks.length, queued, details };
  } catch (err: any) {
    console.error("[FlywheelJobs] Error:", err?.message);
    return { picked: 0, queued: 0, details: [`Error: ${err?.message}`] };
  }
}
