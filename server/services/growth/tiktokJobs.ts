import { db } from "../../db";
import { growthContentPlans, growthContentItems, publishingQueue, dailyChallenges, dailyChallengeEntries } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { generateStructuredContent } from "./openaiAdapter";
import * as prompts from "./promptTemplates";
import { TikTokPackageSchema, validateTikTokPackage, TIKTOK_PACKAGE_JSON_HINT } from "./schemas";
import { isTikTokEnabled } from "./tiktokConfig";

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function getScheduledTime(date: string, hour: number, minute: number): Date {
  const et = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`);
  return et;
}

async function saveTikTokItem(
  planId: string | null,
  type: string,
  pkg: any,
  idempKey: string,
  scheduledFor: Date,
): Promise<string | null> {
  const existing = await db.select({ id: growthContentItems.id })
    .from(growthContentItems)
    .where(eq(growthContentItems.idempotencyKey, idempKey))
    .limit(1);

  if (existing.length > 0) {
    return null;
  }

  const [item] = await db.insert(growthContentItems).values({
    planId,
    type,
    platform: "tiktok",
    title: pkg.hook,
    body: pkg.script,
    metadata: pkg,
    postingMode: "MANUAL_QUEUE",
    status: "READY",
    scheduledFor,
    idempotencyKey: idempKey,
  }).returning();

  await db.insert(publishingQueue).values({
    contentItemId: item.id,
    platform: "tiktok",
    copyText: pkg.caption,
    assets: {
      hook: pkg.hook,
      script: pkg.script,
      on_screen_text: pkg.on_screen_text,
      caption: pkg.caption,
      hashtags: pkg.hashtags,
      cta: pkg.cta,
      thumbnail_text: pkg.thumbnail_text,
      format_notes: pkg.format_notes,
      audio_notes: pkg.audio_notes,
      asset_refs: pkg.asset_refs,
      legal_safe: pkg.legal_safe,
    },
    status: "READY",
  });

  return item.id;
}

registerJob("generate_tiktok_packages", async (ctx: JobContext) => {
  if (!isTikTokEnabled()) {
    return { skipped: true, reason: "TikTok is disabled (set GROWTH_TIKTOK_ENABLED=true)" };
  }

  const date = getChicagoDate();

  const [plan] = await db.select().from(growthContentPlans)
    .where(and(eq(growthContentPlans.date, date), eq(growthContentPlans.status, "ACTIVE")))
    .limit(1);

  const theme = plan?.theme || "baseball card collecting";
  const planId = plan?.id || null;
  const generated: string[] = [];
  const errors: string[] = [];

  try {
    const idempKey = `tiktok_daily5_announce_${date}`;
    const { parsed: rawParsed } = await generateStructuredContent({
      systemPrompt: prompts.SYSTEM_PROMPT,
      userPrompt: prompts.TIKTOK_DAILY5_ANNOUNCEMENT_PROMPT(date, 5),
      jsonSchema: TIKTOK_PACKAGE_JSON_HINT,
    });

    const rawData = rawParsed as Record<string, any>;
    if (!rawData.dedupe_key) rawData.dedupe_key = `${date}:TIKTOK_DAILY5_ANNOUNCEMENT`;
    const pkg = validateTikTokPackage(rawData, "TikTokDaily5Announcement");
    const itemId = await saveTikTokItem(planId, "TIKTOK_DAILY5_ANNOUNCEMENT", pkg, idempKey, getScheduledTime(date, 20, 0));
    if (itemId) generated.push(`TIKTOK_DAILY5_ANNOUNCEMENT:${itemId}`);
    else generated.push("TIKTOK_DAILY5_ANNOUNCEMENT:deduped");
  } catch (err: any) {
    console.error("[TikTokJobs] Failed to generate Daily 5 announcement:", err?.message);
    errors.push(`daily5_announcement: ${err?.message}`);
  }

  try {
    const idempKey = `tiktok_trivia_${date}`;
    const { parsed: rawParsed } = await generateStructuredContent({
      systemPrompt: prompts.SYSTEM_PROMPT,
      userPrompt: prompts.TIKTOK_TRIVIA_CHALLENGE_PROMPT(date, theme),
      jsonSchema: TIKTOK_PACKAGE_JSON_HINT,
    });

    const rawData = rawParsed as Record<string, any>;
    if (!rawData.dedupe_key) rawData.dedupe_key = `${date}:TIKTOK_TRIVIA_CHALLENGE`;
    const pkg = validateTikTokPackage(rawData, "TikTokTriviaChallenge");
    const itemId = await saveTikTokItem(planId, "TIKTOK_TRIVIA_CHALLENGE", pkg, idempKey, getScheduledTime(date, 10, 0));
    if (itemId) generated.push(`TIKTOK_TRIVIA_CHALLENGE:${itemId}`);
    else generated.push("TIKTOK_TRIVIA_CHALLENGE:deduped");
  } catch (err: any) {
    console.error("[TikTokJobs] Failed to generate trivia challenge:", err?.message);
    errors.push(`trivia_challenge: ${err?.message}`);
  }

  try {
    const [challenge] = await db.select().from(dailyChallenges)
      .where(eq(dailyChallenges.date, date))
      .limit(1);

    if (challenge) {
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

      if (topEntries.length > 0) {
        const topPlayers = topEntries.map(e => ({
          username: e.username,
          score: e.score,
          correct: e.correctCount,
        }));

        const idempKey = `tiktok_leaderboard_${date}`;
        const { parsed: rawParsed } = await generateStructuredContent({
          systemPrompt: prompts.SYSTEM_PROMPT,
          userPrompt: prompts.TIKTOK_LEADERBOARD_SPOTLIGHT_PROMPT(date, topPlayers),
          jsonSchema: TIKTOK_PACKAGE_JSON_HINT,
        });

        const rawData = rawParsed as Record<string, any>;
        if (!rawData.dedupe_key) rawData.dedupe_key = `${date}:TIKTOK_LEADERBOARD_SPOTLIGHT`;
        const pkg = validateTikTokPackage(rawData, "TikTokLeaderboardSpotlight");
        const itemId = await saveTikTokItem(planId, "TIKTOK_LEADERBOARD_SPOTLIGHT", pkg, idempKey, getScheduledTime(date, 21, 0));
        if (itemId) generated.push(`TIKTOK_LEADERBOARD_SPOTLIGHT:${itemId}`);
        else generated.push("TIKTOK_LEADERBOARD_SPOTLIGHT:deduped");
      } else {
        generated.push("TIKTOK_LEADERBOARD_SPOTLIGHT:no_entries");
      }
    } else {
      generated.push("TIKTOK_LEADERBOARD_SPOTLIGHT:no_challenge");
    }
  } catch (err: any) {
    console.error("[TikTokJobs] Failed to generate leaderboard spotlight:", err?.message);
    errors.push(`leaderboard_spotlight: ${err?.message}`);
  }

  return {
    date,
    planId,
    generated,
    errors: errors.length > 0 ? errors : undefined,
  };
});
