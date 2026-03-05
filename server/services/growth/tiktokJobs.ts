import { db } from "../../db";
import { growthContentPlans, growthContentItems, publishingQueue, dailyChallenges, dailyChallengeEntries } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { registerJob, JobContext } from "./jobRunner";
import { generateStructuredContent } from "./openaiAdapter";
import * as prompts from "./promptTemplates";
import { TikTokPackageSchema, validateTikTokPackage, TIKTOK_PACKAGE_JSON_HINT, validateViralTikTokPackage, checkTikTokCompliance, VIRAL_TIKTOK_PACKAGE_JSON_HINT } from "./schemas";
import { isTikTokEnabled } from "./tiktokConfig";
import { selectCardsForFormat, type SelectedCard } from "./cardSelector";
import * as viralPrompts from "./viralPrompts";
import { quickValidateImageUrl, isPlaceholderUrl } from "../../videoFactory/validate";
import { checkFactualAccuracy, verdictToStatus, type CardContext } from "./factChecker";

function getChicagoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function getScheduledTime(date: string, hour: number, minute: number): Date {
  // Try both CST (-06:00) and CDT (-05:00) offsets and return whichever one
  // produces the correct Chicago wall-clock hour after DST conversion.
  // This prevents TikTok items from being scheduled 1 hour late every winter.
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const offset of ["-06:00", "-05:00"]) {
    const candidate = new Date(`${date}T${pad(hour)}:${pad(minute)}:00${offset}`);
    const chicagoHour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false })
        .formatToParts(candidate)
        .find(p => p.type === "hour")?.value || "-1",
      10
    );
    if (chicagoHour === hour) return candidate;
  }
  // Fallback: should never be reached, but prefer CST as the safer default
  return new Date(`${date}T${pad(hour)}:${pad(minute)}:00-06:00`);
}

async function saveTikTokItem(
  planId: string | null,
  type: string,
  pkg: any,
  idempKey: string,
  scheduledFor: Date,
  cardContext?: CardContext,
): Promise<string | null> {
  const existing = await db.select({ id: growthContentItems.id })
    .from(growthContentItems)
    .where(eq(growthContentItems.idempotencyKey, idempKey))
    .limit(1);

  if (existing.length > 0) {
    return null;
  }

  // Layer 1/2/3: Fact-check gate before saving. Use hook as title, script as body.
  const factCheck = await checkFactualAccuracy({ title: pkg.hook, body: pkg.script }, "tiktok", cardContext);
  const itemStatus = verdictToStatus(factCheck.verdict);
  if (itemStatus === "PENDING_REVIEW") {
    console.warn(`[TikTokJobs] ${type} held for review — fact-check verdict: ${factCheck.verdict} (${factCheck.overallExplanation})`);
  }

  const [item] = await db.insert(growthContentItems).values({
    planId,
    type,
    platform: "tiktok",
    title: pkg.hook,
    body: pkg.script,
    metadata: pkg,
    postingMode: "AUTO",
    status: itemStatus,
    factCheckResult: factCheck as any,
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

async function saveViralTikTokItem(
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

  if (pkg.cards && Array.isArray(pkg.cards)) {
    const originalCount = pkg.cards.length;
    const validCards: any[] = [];
    for (const card of pkg.cards) {
      const imgUrl = card.imageUrl || card.image_url;
      if (!imgUrl) {
        console.warn(`[ViralTikTok] Skipping card without image URL: ${card.player || card.cardId}`);
        continue;
      }
      const check = await quickValidateImageUrl(imgUrl);
      if (check.valid) {
        validCards.push(card);
      } else {
        console.warn(`[ViralTikTok] Rejected card image at save time: ${card.player || card.cardId} -- ${check.error}`);
      }
    }
    if (validCards.length === 0 && originalCount > 0) {
      console.error(`[ViralTikTok] All ${originalCount} card images failed validation for ${type} -- skipping item`);
      return null;
    }
    pkg.cards = validCards;
  }

  const [item] = await db.insert(growthContentItems).values({
    planId,
    type,
    platform: "tiktok",
    title: pkg.hook,
    body: pkg.script,
    metadata: {
      ...pkg,
      format_id: pkg.format_id,
      render_template_id: pkg.render_template_id || pkg.format_id,
      cards: pkg.cards,
      scenes: pkg.scenes,
      engagement_goal: pkg.engagement_goal,
      safety_flags: pkg.safety_flags,
    },
    postingMode: "AUTO",
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
      format_id: pkg.format_id,
      render_template_id: pkg.render_template_id,
      cards: pkg.cards,
      scenes: pkg.scenes,
    },
    status: "READY",
  });

  return item.id;
}

async function getLeaderboardData(date: string): Promise<{ username: string; score: number; correct: number; streak?: number }[]> {
  try {
    const [challenge] = await db.select().from(dailyChallenges)
      .where(eq(dailyChallenges.date, date))
      .limit(1);

    if (!challenge) return [];

    const topEntries = await db.select({
      username: sql<string>`COALESCE(u.username, 'Anonymous')`,
      score: dailyChallengeEntries.score,
      correctCount: dailyChallengeEntries.correctCount,
    })
      .from(dailyChallengeEntries)
      .innerJoin(sql`users u`, sql`u.id = ${dailyChallengeEntries.userId}`)
      .where(eq(dailyChallengeEntries.dailyChallengeId, challenge.id))
      .orderBy(desc(dailyChallengeEntries.score))
      .limit(5);

    return topEntries.map(e => ({
      username: e.username,
      score: e.score,
      correct: e.correctCount,
    }));
  } catch {
    return [];
  }
}

const VIRAL_FORMAT_SCHEDULE: { formatId: string; hour: number; minute: number; cardCount: number }[] = [
  { formatId: "only_real_fans", hour: 9, minute: 0, cardCount: 1 },
  { formatId: "memory_shock", hour: 12, minute: 0, cardCount: 1 },
  { formatId: "pack_pull_drama", hour: 15, minute: 0, cardCount: 1 },
  { formatId: "difficulty_ladder", hour: 17, minute: 0, cardCount: 3 },
  { formatId: "era_wars", hour: 19, minute: 0, cardCount: 2 },
  { formatId: "leaderboard_flex", hour: 21, minute: 30, cardCount: 0 },
];

function getViralPrompt(formatId: string, date: string, cards: SelectedCard[], leaderboardData?: any[]): string {
  switch (formatId) {
    case "only_real_fans":
      return viralPrompts.ONLY_REAL_FANS_PROMPT(date, cards);
    case "difficulty_ladder":
      return viralPrompts.DIFFICULTY_LADDER_PROMPT(date, cards);
    case "memory_shock":
      return viralPrompts.MEMORY_SHOCK_PROMPT(date, cards);
    case "pack_pull_drama":
      return viralPrompts.PACK_PULL_DRAMA_PROMPT(date, cards);
    case "leaderboard_flex":
      return viralPrompts.LEADERBOARD_FLEX_PROMPT(date, leaderboardData || [], cards);
    case "era_wars":
      return viralPrompts.ERA_WARS_PROMPT(date, cards);
    default:
      return viralPrompts.ONLY_REAL_FANS_PROMPT(date, cards);
  }
}

registerJob("generate_viral_tiktok_packages", async (ctx: JobContext) => {
  if (!isTikTokEnabled()) {
    return { skipped: true, reason: "TikTok is disabled" };
  }

  const date = getChicagoDate();

  const [plan] = await db.select().from(growthContentPlans)
    .where(and(eq(growthContentPlans.date, date), eq(growthContentPlans.status, "ACTIVE")))
    .limit(1);

  const planId = plan?.id || null;
  const generated: string[] = [];
  const errors: string[] = [];

  const leaderboardData = await getLeaderboardData(date);

  for (const schedule of VIRAL_FORMAT_SCHEDULE) {
    const idempKey = `viral_${schedule.formatId}_${date}`;

    try {
      let selectedCards: SelectedCard[] = [];

      if (schedule.cardCount > 0) {
        selectedCards = await selectCardsForFormat(schedule.formatId, date);
        if (selectedCards.length < schedule.cardCount) {
          console.warn(`[ViralTikTok] Need ${schedule.cardCount} cards for ${schedule.formatId}, got ${selectedCards.length} on ${date} -- skipping`);
          errors.push(`${schedule.formatId}: need ${schedule.cardCount} cards, only ${selectedCards.length} valid card images available`);
          continue;
        }
      }

      // Skip leaderboard_flex when no real entries exist — prevents AI from inventing
      // fictional @Player placeholder names instead of real leaderboard participants
      if (schedule.formatId === "leaderboard_flex" && leaderboardData.length === 0) {
        console.warn(`[ViralTikTok] No Daily 5 entries for ${date} — skipping leaderboard_flex`);
        errors.push(`leaderboard_flex: no Daily 5 entries found for today`);
        continue;
      }

      const prompt = getViralPrompt(schedule.formatId, date, selectedCards, leaderboardData);

      const { parsed: rawParsed } = await generateStructuredContent({
        systemPrompt: viralPrompts.VIRAL_SYSTEM_PROMPT,
        userPrompt: prompt,
        jsonSchema: VIRAL_TIKTOK_PACKAGE_JSON_HINT,
      });

      const rawData = rawParsed as Record<string, any>;

      if (!rawData.dedupe_key) rawData.dedupe_key = `${date}:${schedule.formatId}`;
      if (!rawData.format_id) rawData.format_id = schedule.formatId;
      if (!rawData.render_template_id) rawData.render_template_id = schedule.formatId;

      if (!rawData.safety_flags) {
        rawData.safety_flags = { no_gambling_language: true, no_prize_guarantees: true };
      }

      if (selectedCards.length > 0 && !rawData.cards) {
        const validatedCards: SelectedCard[] = [];
        for (const c of selectedCards) {
          if (c.imageUrl && !isPlaceholderUrl(c.imageUrl)) {
            validatedCards.push(c);
          } else {
            console.warn(`[ViralTikTok] Skipping card ${c.id} (${c.player}): placeholder/silhouette image`);
          }
        }
        rawData.cards = validatedCards.map(c => ({
          cardId: c.id,
          player: c.player,
          set: c.set,
          year: c.year,
          imageUrl: c.imageUrl,
          difficulty: c.difficulty,
          era: c.era,
        }));
      }

      const compliance = checkTikTokCompliance(rawData as any);
      if (!compliance.pass) {
        console.warn(`[ViralTikTok] Compliance issues for ${schedule.formatId}: ${compliance.issues.join("; ")}`);
      }

      const pkg = validateViralTikTokPackage(rawData, `Viral_${schedule.formatId}`);
      const contentType = `TIKTOK_VIRAL_${schedule.formatId.toUpperCase()}`;
      const itemId = await saveViralTikTokItem(
        planId,
        contentType,
        pkg,
        idempKey,
        getScheduledTime(date, schedule.hour, schedule.minute),
      );

      if (itemId) generated.push(`${contentType}:${itemId}`);
      else generated.push(`${contentType}:deduped`);

    } catch (err: any) {
      console.error(`[ViralTikTok] Failed to generate ${schedule.formatId}:`, err?.message);
      errors.push(`${schedule.formatId}: ${err?.message}`);
    }
  }

  return {
    date,
    planId,
    totalFormats: VIRAL_FORMAT_SCHEDULE.length,
    generated,
    errors: errors.length > 0 ? errors : undefined,
  };
});
