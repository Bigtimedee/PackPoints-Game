import { db } from "../../db";
import { growthContentPlans, growthContentItems, growthJobRuns, publishingQueue, dailyChallenges, dailyChallengeEntries } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { generateStructuredContent } from "./openaiAdapter";
import * as prompts from "./promptTemplates";
import {
  ContentPieceSchema, PlanOutputSchema, type ContentPiece, type PlanOutput,
  validateWithSchema, getSchemaForPlatform, getSchemaJsonHint,
} from "./schemas";
import { validateCompliance } from "./complianceValidator";
import { getRecentHooks, getRecentPlayerNames, getRecentThemes, buildDiversityConstraints } from "./diversityTracker";
import { buildContentContext, contextToPromptSection } from "./contextBuilder";
import { selectCardsForFormat } from "./cardSelector";

const VISUAL_PLATFORMS = new Set(["instagram", "x", "facebook", "tiktok"]);
const PACKPTS_LOGO_URL = "https://packpts.com/logo-social.jpg";

async function ensureImageForVisualPlatform(
  platform: string,
  date: string,
  formatSeed: string,
  existingMetadata: Record<string, any>,
): Promise<Record<string, any>> {
  if (!VISUAL_PLATFORMS.has(platform)) return existingMetadata;
  if (existingMetadata.imageUrl || existingMetadata.video_asset) return existingMetadata;

  try {
    const cards = await selectCardsForFormat(formatSeed, date);
    if (cards.length > 0) {
      const card = cards[0];
      console.log(`[ContentJobs] Attached card image for ${platform}: ${card.player} (${card.set} ${card.year})`);
      return {
        ...existingMetadata,
        imageUrl: card.imageUrl,
        attachedCard: { cardId: card.id, player: card.player, set: card.set, year: card.year },
      };
    }
  } catch (err: any) {
    console.warn(`[ContentJobs] Card selection failed for ${platform}: ${err?.message}`);
  }

  console.warn(`[ContentJobs] Using PackPTS logo fallback for ${platform} — no eligible cards found`);
  return { ...existingMetadata, imageUrl: PACKPTS_LOGO_URL };
}

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

async function checkDailyPlanStatus(date: string): Promise<{ hasPlan: boolean; planFailed: boolean; failError?: string }> {
  const [plan] = await db.select().from(growthContentPlans)
    .where(and(eq(growthContentPlans.date, date), eq(growthContentPlans.status, "ACTIVE")))
    .limit(1);

  if (plan) return { hasPlan: true, planFailed: false };

  const [failedRun] = await db.select().from(growthJobRuns)
    .where(
      and(
        eq(growthJobRuns.jobName, "generate_daily_plan"),
        eq(growthJobRuns.status, "FAILED"),
        sql`${growthJobRuns.startedAt} >= ${date}::date`,
        sql`${growthJobRuns.startedAt} < (${date}::date + interval '1 day')`
      )
    )
    .orderBy(desc(growthJobRuns.startedAt))
    .limit(1);

  if (failedRun) {
    return { hasPlan: false, planFailed: true, failError: failedRun.error || "Unknown error" };
  }

  return { hasPlan: false, planFailed: false };
}

registerJob("generate_daily_plan", async (ctx: JobContext) => {
  const date = getChicagoDate();

  const existing = await db.select().from(growthContentPlans).where(eq(growthContentPlans.date, date)).limit(1);
  if (existing.length > 0) {
    return { skipped: true, reason: "Plan already exists for today", planId: existing[0].id };
  }

  const [recentThemesList, recentHooksList, recentPlayersList, contentCtx] = await Promise.all([
    getRecentThemes(),
    getRecentHooks(),
    getRecentPlayerNames(),
    buildContentContext(),
  ]);
  const diversityHint = buildDiversityConstraints(recentHooksList, recentPlayersList, recentThemesList);
  const contextHint = contextToPromptSection(contentCtx);

  const { parsed: rawParsed } = await generateStructuredContent<PlanOutput>({
    systemPrompt: prompts.SYSTEM_PROMPT + diversityHint + contextHint,
    userPrompt: prompts.CONTENT_PLAN_PROMPT(date, recentThemesList),
  });

  const parsed = validateWithSchema(PlanOutputSchema, rawParsed, "DailyPlan");

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

  const planStatus = await checkDailyPlanStatus(date);

  if (!planStatus.hasPlan) {
    if (planStatus.planFailed) {
      return {
        skipped: true,
        reason: `Cannot generate content: today's daily plan failed (${planStatus.failError}). Fix the issue and retry 'generate_daily_plan' first.`,
        dependencyFailed: true,
      };
    }
    return {
      skipped: true,
      reason: "No active plan for today. Run 'generate_daily_plan' first.",
      dependencyMissing: true,
    };
  }

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

  const [hooksList, playersList, itemCtx] = await Promise.all([
    getRecentHooks(),
    getRecentPlayerNames(),
    buildContentContext(),
  ]);
  const diversityHint = buildDiversityConstraints(hooksList, playersList, []);
  const contextHint = contextToPromptSection(itemCtx);

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
        postingMode = "AUTO";
        break;
      case "x":
        promptFn = prompts.X_THREAD_PROMPT;
        type = "X_THREAD";
        postingMode = "AUTO";
        break;
      case "instagram":
        promptFn = prompts.INSTAGRAM_POST_PROMPT;
        type = "INSTAGRAM_POST";
        postingMode = "AUTO";
        break;
      case "tiktok":
        continue;
      case "youtube":
        promptFn = prompts.SHORT_VIDEO_SCRIPT_PROMPT;
        type = "SHORT_VIDEO_SCRIPT";
        break;
      default:
        continue;
    }

    if (!promptFn) continue;

    try {
      const schema = getSchemaForPlatform(platform);

      // For visual platforms: select the card FIRST so content is written about that specific card
      let preSelectedCard: { id: string; player: string; set: string; year: number; imageUrl: string } | null = null;
      if (VISUAL_PLATFORMS.has(platform)) {
        try {
          const cards = await selectCardsForFormat(`content_${platform}`, date);
          if (cards.length > 0) preSelectedCard = cards[0];
        } catch (err: any) {
          console.warn(`[ContentJobs] Pre-selection failed for ${platform}: ${err?.message}`);
        }
      }

      // Inject card identity into the system prompt so the AI writes about THIS specific card
      const cardHint = preSelectedCard
        ? `\n\nFEATURED CARD FOR THIS POST: ${preSelectedCard.player} — ${preSelectedCard.year} ${preSelectedCard.set}\nYour post MUST be specifically about this player and card. All content references must match this exact card. Do not reference other players, other sports, or cards from different sets or eras.`
        : "";

      const { parsed: rawParsed } = await generateStructuredContent<ContentPiece>({
        systemPrompt: prompts.SYSTEM_PROMPT + diversityHint + contextHint + cardHint,
        userPrompt: promptFn(theme),
        jsonSchema: getSchemaJsonHint(platform),
      });
      let parsed = validateWithSchema(schema, rawParsed, `ContentItem:${platform}`) as ContentPiece;

      const compliance = await validateCompliance(parsed, platform);
      if (compliance.rewritten) {
        parsed = { ...parsed, ...compliance.rewritten };
      }

      const idempKey = `${ctx.idempotencyKey}_${platform}`;
      let itemMetadata: Record<string, any> = { hashtags: parsed.hashtags, theme, complianceIssues: compliance.issues.length > 0 ? compliance.issues : undefined };

      if (preSelectedCard) {
        // Attach the pre-selected card — content was already written about this card
        itemMetadata.imageUrl = preSelectedCard.imageUrl;
        itemMetadata.attachedCard = { cardId: preSelectedCard.id, player: preSelectedCard.player, set: preSelectedCard.set, year: preSelectedCard.year };
        console.log(`[ContentJobs] Card-matched post for ${platform}: ${preSelectedCard.player} (${preSelectedCard.set} ${preSelectedCard.year})`);
      } else {
        itemMetadata = await ensureImageForVisualPlatform(platform, date, `content_${platform}`, itemMetadata);
      }

      const [item] = await db.insert(growthContentItems).values({
        planId: plan.id,
        type,
        platform,
        title: parsed.title,
        body: parsed.body,
        metadata: itemMetadata,
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

  // Select the featured card before generating content so text matches the image
  let announceFeaturedCard: { id: string; player: string; set: string; year: number; imageUrl: string } | null = null;
  try {
    const cards = await selectCardsForFormat(`daily5_announce_instagram`, date);
    if (cards.length > 0) announceFeaturedCard = cards[0];
  } catch {}

  const announceCardHint = announceFeaturedCard
    ? `\n\nFEATURED CARD FOR THIS ANNOUNCEMENT: ${announceFeaturedCard.player} — ${announceFeaturedCard.year} ${announceFeaturedCard.set}\nReference this specific player and card in the announcement. All content must match this card exactly.`
    : "";

  const { parsed: rawParsed } = await generateStructuredContent<ContentPiece>({
    systemPrompt: prompts.SYSTEM_PROMPT + announceCardHint,
    userPrompt: prompts.DAILY5_ANNOUNCEMENT_PROMPT(date, 5),
  });
  const parsed = validateWithSchema(ContentPieceSchema, rawParsed, "Daily5Announcement");

  const [plan] = await db.select().from(growthContentPlans)
    .where(eq(growthContentPlans.date, date))
    .limit(1);

  const postPlatforms = ["discord", "x", "instagram"];
  const items: string[] = [];
  for (const platform of postPlatforms) {
    const postingMode = "AUTO";
    let announceMeta: Record<string, any> = { hashtags: parsed.hashtags };
    if (announceFeaturedCard && VISUAL_PLATFORMS.has(platform)) {
      announceMeta.imageUrl = announceFeaturedCard.imageUrl;
      announceMeta.attachedCard = { cardId: announceFeaturedCard.id, player: announceFeaturedCard.player, set: announceFeaturedCard.set, year: announceFeaturedCard.year };
    } else {
      announceMeta = await ensureImageForVisualPlatform(platform, date, `daily5_announce_${platform}`, announceMeta);
    }

    const [item] = await db.insert(growthContentItems).values({
      planId: plan?.id || null,
      type: "DAILY5_ANNOUNCEMENT",
      platform,
      title: parsed.title,
      body: parsed.body,
      metadata: announceMeta,
      postingMode,
      status: "READY",
      idempotencyKey: `${idempKey}_${platform}`,
    }).returning();

    items.push(`${platform}:${item.id}`);
  }

  return { items };
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

  // Select the featured card before generating the recap so text matches the image
  let recapFeaturedCard: { id: string; player: string; set: string; year: number; imageUrl: string } | null = null;
  try {
    const cards = await selectCardsForFormat(`daily5_recap_instagram`, date);
    if (cards.length > 0) recapFeaturedCard = cards[0];
  } catch {}

  const recapCardHint = recapFeaturedCard
    ? `\n\nFEATURED CARD FOR THIS RECAP: ${recapFeaturedCard.player} — ${recapFeaturedCard.year} ${recapFeaturedCard.set}\nReference this specific player and card when describing today's challenge. All content must match this card exactly.`
    : "";

  const { parsed: rawParsed } = await generateStructuredContent<ContentPiece>({
    systemPrompt: prompts.SYSTEM_PROMPT + recapCardHint,
    userPrompt: prompts.DAILY5_RECAP_PROMPT(date, topPlayers),
  });
  const parsed = validateWithSchema(ContentPieceSchema, rawParsed, "Daily5Recap");

  const [plan] = await db.select().from(growthContentPlans)
    .where(eq(growthContentPlans.date, date))
    .limit(1);

  const postPlatforms = ["discord", "x", "instagram"];
  const items: string[] = [];
  for (const platform of postPlatforms) {
    const postingMode = "AUTO";
    let recapMeta: Record<string, any> = { hashtags: parsed.hashtags, topPlayers };
    if (recapFeaturedCard && VISUAL_PLATFORMS.has(platform)) {
      recapMeta.imageUrl = recapFeaturedCard.imageUrl;
      recapMeta.attachedCard = { cardId: recapFeaturedCard.id, player: recapFeaturedCard.player, set: recapFeaturedCard.set, year: recapFeaturedCard.year };
    } else {
      recapMeta = await ensureImageForVisualPlatform(platform, date, `daily5_recap_${platform}`, recapMeta);
    }

    const [item] = await db.insert(growthContentItems).values({
      planId: plan?.id || null,
      type: "DAILY5_RECAP",
      platform,
      title: parsed.title,
      body: parsed.body,
      metadata: recapMeta,
      postingMode,
      status: "READY",
      idempotencyKey: `${idempKey}_${platform}`,
    }).returning();

    items.push(`${platform}:${item.id}`);
  }

  return { items };
});
