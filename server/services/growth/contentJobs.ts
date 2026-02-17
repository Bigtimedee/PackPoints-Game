import { db } from "../../db";
import { growthContentPlans, growthContentItems, publishingQueue, dailyChallenges, dailyChallengeEntries } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { generateStructuredContent } from "./openaiAdapter";
import * as prompts from "./promptTemplates";

interface ContentPiece {
  title: string;
  body: string;
  hashtags: string[];
}

interface PlanOutput {
  theme: string;
  items: { type: string; platform: string; brief: string; postingMode: string }[];
}

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

registerJob("generate_daily_plan", async (ctx: JobContext) => {
  const date = getChicagoDate();

  const existing = await db.select().from(growthContentPlans).where(eq(growthContentPlans.date, date)).limit(1);
  if (existing.length > 0) {
    return { skipped: true, reason: "Plan already exists for today", planId: existing[0].id };
  }

  const recentPlans = await db.select({ theme: growthContentPlans.theme })
    .from(growthContentPlans)
    .orderBy(desc(growthContentPlans.date))
    .limit(5);
  const recentThemes = recentPlans.map(p => p.theme).filter(Boolean) as string[];

  const { parsed } = await generateStructuredContent<PlanOutput>({
    systemPrompt: prompts.SYSTEM_PROMPT,
    userPrompt: prompts.CONTENT_PLAN_PROMPT(date, recentThemes),
  });

  const [plan] = await db.insert(growthContentPlans).values({
    date,
    theme: parsed.theme,
    targetPlatforms: parsed.items.map(i => i.platform),
    status: "ACTIVE",
  }).returning();

  return { planId: plan.id, theme: parsed.theme, itemCount: parsed.items.length };
});

registerJob("generate_content_items", async (ctx: JobContext) => {
  const date = getChicagoDate();
  const [plan] = await db.select().from(growthContentPlans)
    .where(and(eq(growthContentPlans.date, date), eq(growthContentPlans.status, "ACTIVE")))
    .limit(1);

  if (!plan) return { skipped: true, reason: "No active plan for today" };

  const existingItems = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.planId, plan.id));
  if (existingItems.length > 0) {
    return { skipped: true, reason: "Content items already exist", count: existingItems.length };
  }

  const theme = plan.theme || "baseball card collecting";
  const platforms = (plan.targetPlatforms as string[]) || ["discord"];
  const generated: string[] = [];

  for (const platform of platforms) {
    let promptFn: ((t: string) => string) | null = null;
    let type = "";
    let postingMode = "MANUAL_QUEUE";

    switch (platform) {
      case "discord":
        promptFn = prompts.DISCORD_POST_PROMPT;
        type = "DISCORD_POST";
        postingMode = "AUTO";
        break;
      case "reddit":
        promptFn = prompts.REDDIT_POST_PROMPT;
        type = "REDDIT_POST";
        break;
      case "x":
        promptFn = prompts.X_THREAD_PROMPT;
        type = "X_THREAD";
        break;
      case "tiktok":
      case "instagram":
      case "youtube":
        promptFn = prompts.SHORT_VIDEO_SCRIPT_PROMPT;
        type = "SHORT_VIDEO_SCRIPT";
        break;
      default:
        continue;
    }

    try {
      const { parsed } = await generateStructuredContent<ContentPiece>({
        systemPrompt: prompts.SYSTEM_PROMPT,
        userPrompt: promptFn(theme),
      });

      const idempKey = `${ctx.idempotencyKey}_${platform}`;
      const [item] = await db.insert(growthContentItems).values({
        planId: plan.id,
        type,
        platform,
        title: parsed.title,
        body: parsed.body,
        metadata: { hashtags: parsed.hashtags, theme },
        postingMode,
        status: postingMode === "AUTO" ? "READY" : "QUEUED",
        idempotencyKey: idempKey,
      }).returning();

      if (postingMode === "MANUAL_QUEUE") {
        await db.insert(publishingQueue).values({
          contentItemId: item.id,
          platform,
          copyText: parsed.body,
          assets: { hashtags: parsed.hashtags, title: parsed.title },
          status: "READY",
        });
      }

      generated.push(`${platform}:${item.id}`);
    } catch (err: any) {
      console.error(`[ContentJobs] Failed to generate ${platform} content:`, err?.message);
    }
  }

  return { planId: plan.id, generated };
});

registerJob("generate_daily5_announcement", async (ctx: JobContext) => {
  const date = getChicagoDate();

  const [challenge] = await db.select().from(dailyChallenges)
    .where(eq(dailyChallenges.date, date))
    .limit(1);

  if (!challenge) return { skipped: true, reason: "No daily challenge for today" };

  const idempKey = `daily5_announce_${date}`;
  const existing = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.idempotencyKey, idempKey))
    .limit(1);
  if (existing.length > 0) return { skipped: true, reason: "Already announced" };

  const { parsed } = await generateStructuredContent<ContentPiece>({
    systemPrompt: prompts.SYSTEM_PROMPT,
    userPrompt: prompts.DAILY5_ANNOUNCEMENT_PROMPT(date, 5),
  });

  const [plan] = await db.select().from(growthContentPlans)
    .where(eq(growthContentPlans.date, date))
    .limit(1);

  const [item] = await db.insert(growthContentItems).values({
    planId: plan?.id || null,
    type: "DAILY5_ANNOUNCEMENT",
    platform: "discord",
    title: parsed.title,
    body: parsed.body,
    metadata: { hashtags: parsed.hashtags },
    postingMode: "AUTO",
    status: "READY",
    idempotencyKey: idempKey,
  }).returning();

  return { itemId: item.id };
});

registerJob("generate_daily5_recap", async (ctx: JobContext) => {
  const date = getChicagoDate();

  const idempKey = `daily5_recap_${date}`;
  const existing = await db.select().from(growthContentItems)
    .where(eq(growthContentItems.idempotencyKey, idempKey))
    .limit(1);
  if (existing.length > 0) return { skipped: true, reason: "Already generated recap" };

  const [challenge] = await db.select().from(dailyChallenges)
    .where(eq(dailyChallenges.date, date))
    .limit(1);
  if (!challenge) return { skipped: true, reason: "No challenge found" };

  const topEntries = await db.select({
    username: sql<string>`COALESCE(u.username, 'Anonymous')`,
    score: dailyChallengeEntries.score,
    correctCount: dailyChallengeEntries.correctCount,
  })
    .from(dailyChallengeEntries)
    .innerJoin(sql`users u`, sql`u.id = ${dailyChallengeEntries.userId}`)
    .where(eq(dailyChallengeEntries.dailyChallengeId, challenge.id))
    .orderBy(desc(dailyChallengeEntries.score))
    .limit(3);

  if (topEntries.length === 0) return { skipped: true, reason: "No entries to recap" };

  const topPlayers = topEntries.map(e => ({
    username: e.username,
    score: e.score,
    correct: e.correctCount,
  }));

  const { parsed } = await generateStructuredContent<ContentPiece>({
    systemPrompt: prompts.SYSTEM_PROMPT,
    userPrompt: prompts.DAILY5_RECAP_PROMPT(date, topPlayers),
  });

  const [plan] = await db.select().from(growthContentPlans)
    .where(eq(growthContentPlans.date, date))
    .limit(1);

  const platforms = ["discord", "x"];
  const items: string[] = [];
  for (const platform of platforms) {
    const [item] = await db.insert(growthContentItems).values({
      planId: plan?.id || null,
      type: "DAILY5_RECAP",
      platform,
      title: parsed.title,
      body: parsed.body,
      metadata: { hashtags: parsed.hashtags, topPlayers },
      postingMode: platform === "discord" ? "AUTO" : "MANUAL_QUEUE",
      status: platform === "discord" ? "READY" : "QUEUED",
      idempotencyKey: `${idempKey}_${platform}`,
    }).returning();

    if (platform !== "discord") {
      await db.insert(publishingQueue).values({
        contentItemId: item.id,
        platform,
        copyText: parsed.body,
        assets: { hashtags: parsed.hashtags, title: parsed.title },
        status: "READY",
      });
    }
    items.push(`${platform}:${item.id}`);
  }

  return { items };
});
