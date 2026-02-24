import { db } from "../../db";
import { growthContentItems, publishingQueue } from "@shared/schema";
import { eq, and, sql, not, like } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function isIgAutopostEnabled(): boolean {
  return process.env.GROWTH_IG_AUTOPOST === "true";
}

function isFbAutopostEnabled(): boolean {
  return process.env.GROWTH_FB_AUTOPOST === "true";
}

registerJob("crosspost_to_ig_fb", async (ctx: JobContext) => {
  const igEnabled = isIgAutopostEnabled();
  const fbEnabled = isFbAutopostEnabled();

  if (!igEnabled && !fbEnabled) {
    return { skipped: true, reason: "Both IG and FB auto-posting disabled" };
  }

  const date = getChicagoDate();

  const tiktokItems = await db.select().from(growthContentItems)
    .where(and(
      eq(growthContentItems.platform, "tiktok"),
      eq(growthContentItems.status, "READY"),
      sql`DATE(${growthContentItems.createdAt}) = ${date}`
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

    if (igEnabled) {
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
              crossPostedFrom: item.id,
              originalPlatform: "tiktok",
            },
            postingMode: "AUTO",
            status: "READY",
            scheduledFor: item.scheduledFor,
            idempotencyKey: igIdempKey,
          }).returning();

          await db.insert(publishingQueue).values({
            contentItemId: igItem.id,
            platform: "instagram",
            copyText: metadata?.caption || item.body || "",
            assets: {
              ...(metadata || {}),
              crossPostedFrom: item.id,
            },
            status: "READY",
          });

          igCreated++;
          console.log(`[CrossPost] Created Instagram copy: ${igItem.id} from TikTok ${item.id}`);
        }
      } catch (err: any) {
        errors.push(`ig_${item.id}: ${err?.message}`);
      }
    }

    if (fbEnabled) {
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
              crossPostedFrom: item.id,
              originalPlatform: "tiktok",
            },
            postingMode: "AUTO",
            status: "READY",
            scheduledFor: item.scheduledFor,
            idempotencyKey: fbIdempKey,
          }).returning();

          await db.insert(publishingQueue).values({
            contentItemId: fbItem.id,
            platform: "facebook",
            copyText: metadata?.caption || item.body || "",
            assets: {
              ...(metadata || {}),
              crossPostedFrom: item.id,
            },
            status: "READY",
          });

          fbCreated++;
          console.log(`[CrossPost] Created Facebook copy: ${fbItem.id} from TikTok ${item.id}`);
        }
      } catch (err: any) {
        errors.push(`fb_${item.id}: ${err?.message}`);
      }
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
