import { db } from "../../db";
import { growthContentItems } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";

const PACKPTS_LOGO_URL = "https://packpts.com/logo-social.jpg";

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function extractImageUrl(metadata: Record<string, any> | null, contentItemId: string): string {
  if (!metadata) return PACKPTS_LOGO_URL;

  if (metadata.imageUrl) return metadata.imageUrl;

  const assetRefs = metadata.asset_refs as { type?: string; url?: string }[] | undefined;
  if (assetRefs && assetRefs.length > 0) {
    const cardImage = assetRefs.find(a => a.type === "card_image" && a.url);
    if (cardImage?.url) return cardImage.url;
    const anyAsset = assetRefs.find(a => a.url);
    if (anyAsset?.url) return anyAsset.url;
  }

  const cards = metadata.cards as { imageUrl?: string }[] | undefined;
  if (cards && cards.length > 0) {
    const cardWithImg = cards.find(c => c.imageUrl);
    if (cardWithImg?.imageUrl) return cardWithImg.imageUrl;
  }

  const videoAsset = metadata.video_asset as { thumbnail?: string } | undefined;
  if (videoAsset?.thumbnail) return videoAsset.thumbnail;

  return PACKPTS_LOGO_URL;
}

registerJob("crosspost_to_ig_fb", async (ctx: JobContext) => {
  const date = getChicagoDate();

  const tiktokItems = await db.select().from(growthContentItems)
    .where(and(
      eq(growthContentItems.platform, "tiktok"),
      eq(growthContentItems.status, "READY"),
      // Timezone-aware date filter: compare in Chicago time so items created at
      // 11 PM Chicago (= midnight UTC next day) are not missed.
      sql`DATE(${growthContentItems.createdAt} AT TIME ZONE 'America/Chicago') = ${date}`
    ))
    .limit(20);

  if (tiktokItems.length === 0) {
    return { created: 0, reason: "No TikTok items to cross-post" };
  }

  let igCreated = 0;
  let fbCreated = 0;
  const errors: string[] = [];

  for (const item of tiktokItems) {
    const metadata = item.metadata as Record<string, any> | null;
    const resolvedImageUrl = extractImageUrl(metadata, item.id);

    const igIdempKey = `crosspost_ig_${item.idempotencyKey || item.id}`;
    try {
      const [existing] = await db.select({ id: growthContentItems.id })
        .from(growthContentItems)
        .where(eq(growthContentItems.idempotencyKey, igIdempKey))
        .limit(1);

      if (!existing) {
        const [igItem] = await db.insert(growthContentItems).values({
          planId: item.planId,
          type: item.type,
          platform: "instagram",
          title: item.title,
          body: item.body,
          metadata: {
            ...metadata,
            imageUrl: resolvedImageUrl,
            crossPostedFrom: item.id,
            originalPlatform: "tiktok",
          },
          postingMode: "AUTO",
          status: "READY",
          scheduledFor: null,
          idempotencyKey: igIdempKey,
        }).returning();

        igCreated++;
        console.log(`[CrossPost] Created Instagram copy (auto): ${igItem.id} from TikTok ${item.id}`);
      }
    } catch (err: any) {
      errors.push(`ig_${item.id}: ${err?.message}`);
    }

    const fbIdempKey = `crosspost_fb_${item.idempotencyKey || item.id}`;
    try {
      const [existing] = await db.select({ id: growthContentItems.id })
        .from(growthContentItems)
        .where(eq(growthContentItems.idempotencyKey, fbIdempKey))
        .limit(1);

      if (!existing) {
        const [fbItem] = await db.insert(growthContentItems).values({
          planId: item.planId,
          type: item.type,
          platform: "facebook",
          title: item.title,
          body: item.body,
          metadata: {
            ...metadata,
            imageUrl: resolvedImageUrl,
            crossPostedFrom: item.id,
            originalPlatform: "tiktok",
          },
          postingMode: "AUTO",
          status: "READY",
          scheduledFor: null,
          idempotencyKey: fbIdempKey,
        }).returning();

        fbCreated++;
        console.log(`[CrossPost] Created Facebook copy (auto): ${fbItem.id} from TikTok ${item.id}`);
      }
    } catch (err: any) {
      errors.push(`fb_${item.id}: ${err?.message}`);
    }
  }

  return {
    date,
    tiktokSourceCount: tiktokItems.length,
    igCreated,
    fbCreated,
    errors: errors.length > 0 ? errors : undefined,
  };
});
