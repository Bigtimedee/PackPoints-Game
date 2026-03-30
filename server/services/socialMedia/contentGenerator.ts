import { db } from "../../db";
import { sql } from "drizzle-orm";
import { checkClaims, type DraftPost } from "./factChecker";
import { agentConfig } from "./config";
import { createLogger } from "./logger";
import { loadEvolvedVariants } from "./promptEvolution";

const logger = createLogger("ContentGenerator");

// Graceful check: warn at startup if OPENAI_API_KEY is not set
if (!process.env.OPENAI_API_KEY) {
  console.warn('[ContentGenerator] OPENAI_API_KEY is not set — AI content generation is disabled. Posts will use fallback templates.');
}

/**
 * Returns a simple template-based fallback post when AI content generation is unavailable.
 */
function generateFallbackContent(type: string): string {
  const { siteUrl } = agentConfig;
  switch (type) {
    case 'LEADERBOARD_HIGHLIGHT':
      return `This week's top PackPTS player is crushing the leaderboard! Can you take the top spot? Play free at ${siteUrl} #PackPTS #SportsCards`;
    case 'STREAK_MILESTONE':
      return `Daily streaks = bonus points. Keep your PackPTS streak alive and watch your rewards grow! Play at ${siteUrl} #PackPTS #CardCollector`;
    case 'CHALLENGE':
      return `New daily challenge is live! Test your sports card knowledge and climb the leaderboard at ${siteUrl} #PackPTS #TradingCards`;
    case 'MARKET_PRICE_SPOTLIGHT':
      return `The hottest baseball cards on the market right now — can you name them all? Prove it at ${siteUrl} #PackPTS #SportsCards`;
    case 'REWARD_ANNOUNCEMENT':
      return `Earn real rewards for your card knowledge! Join PackPTS free and start collecting points at ${siteUrl} #PackPTS #Collectibles`;
    case 'NEW_USER_ACQUISITION':
      return `Free to play. Real rewards. PackPTS turns your sports card knowledge into points you can actually use. Start at ${siteUrl} #PackPTS #SportsCards`;
    case 'TRIVIA_CARD':
    default:
      return `Think you know your baseball cards? Test yourself with today's trivia and earn PackPTS! Play free at ${siteUrl} #PackPTS #TradingCards`;
  }
}

export type Platform = "TWITTER" | "TIKTOK";
export type SocialContentType =
  | "TRIVIA_CARD"
  | "LEADERBOARD_HIGHLIGHT"
  | "STREAK_MILESTONE"
  | "MARKET_PRICE_SPOTLIGHT"
  | "NEW_USER_ACQUISITION"
  | "REWARD_ANNOUNCEMENT"
  | "CHALLENGE";

const CONTENT_TYPE_ROTATION: SocialContentType[] = [
  "TRIVIA_CARD",
  "NEW_USER_ACQUISITION",
  "CHALLENGE",
  "LEADERBOARD_HIGHLIGHT",
  "MARKET_PRICE_SPOTLIGHT",
  "REWARD_ANNOUNCEMENT",
  "STREAK_MILESTONE",
];

const HASHTAG_SETS = {
  primary: ["#PackPTS", "#SportsCards", "#TradingCards"],
  secondary: ["#MLB", "#CardCollector", "#Collectibles"],
};

// In-memory rotation tracking (resets on restart — acceptable)
const lastContentType: Record<string, SocialContentType> = {};

function pickNextContentType(platform: Platform): SocialContentType {
  const last = lastContentType[platform];
  const available = last
    ? CONTENT_TYPE_ROTATION.filter(t => t !== last)
    : CONTENT_TYPE_ROTATION;
  const idx = Math.floor(Math.random() * available.length);
  const chosen = available[idx];
  lastContentType[platform] = chosen;
  return chosen;
}

function pickHashtags(abGroup: "A" | "B" | "C"): string[] {
  const primary = HASHTAG_SETS.primary;
  const secondary = HASHTAG_SETS.secondary;
  const extra = abGroup === "A"
    ? secondary.slice(0, 2)
    : abGroup === "B"
    ? [secondary[2], secondary[1]]
    : [secondary[0], secondary[2]];
  return [...primary, ...extra];
}

function fitToLength(copy: string, url: string, hashtags: string[], maxChars: number): string {
  const suffix = `\n${url}`;
  const tagStr = "\n" + hashtags.join(" ");
  const reserved = suffix.length + tagStr.length;
  const maxCopy = maxChars - reserved;
  if (copy.length > maxCopy) {
    return copy.slice(0, maxCopy - 1) + "…";
  }
  return copy;
}

async function buildCopy(
  type: SocialContentType,
  platform: Platform,
  abGroup: "A" | "B" | "C",
): Promise<{ copyText: string; cardQueryParams: Record<string, unknown> }> {
  // Prompt evolution: use AI-generated evolved variants when available.
  // These are written nightly by promptEvolution.ts and supersede hardcoded copy.
  try {
    const evolved = await loadEvolvedVariants(type);
    if (evolved?.[abGroup]) {
      const { siteUrl } = agentConfig;
      const maxChars = platform === "TWITTER" ? 280 : 2200;
      const hashtags = pickHashtags(abGroup);
      const trimmed = fitToLength(evolved[abGroup], siteUrl, hashtags, maxChars);
      logger.info("evolved_variant_used", { type, abGroup, generation: "active" });
      return { copyText: trimmed, cardQueryParams: { sortBy: "sales_7day", category: "Baseball" } };
    }
  } catch (err) {
    logger.warn("evolved_variant_load_failed", { type, error: String(err) });
  }

  if (!process.env.OPENAI_API_KEY) {
    // Return a fallback template-based content instead of crashing
    return { copyText: generateFallbackContent(type), cardQueryParams: { sortBy: "sales_7day" } };
  }

  const { siteUrl } = agentConfig;
  const maxChars = platform === "TWITTER" ? 280 : 2200;
  let copy = "";
  let cardQueryParams: Record<string, unknown> = { sortBy: "sales_7day" };

  switch (type) {
    case "TRIVIA_CARD": {
      if (abGroup === "A") {
        copy = `The most-traded baseball cards right now are flying on the market. Can you name today's hottest card? Test your knowledge at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `Think you know your cards? Challenge yourself with today's trending card trivia and climb the leaderboard at ${siteUrl}`;
      } else {
        copy = `Hot cards. Real trivia. Big points. How many can you identify? Play PackPTS free at ${siteUrl}`;
      }
      cardQueryParams = { sortBy: "sales_7day", category: "Baseball" };
      break;
    }
    case "LEADERBOARD_HIGHLIGHT": {
      let topPlayer = "a PackPTS champion";
      try {
        const r = await db.execute(sql`
          SELECT u.username, SUM(ma.points_earned) as score
          FROM match_answers ma
          JOIN matches m ON m.id = ma.match_id
          JOIN users u ON u.id = ma.user_id
          WHERE m.status = 'COMPLETED' AND m.created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY u.username ORDER BY score DESC LIMIT 1
        `);
        if (r.rows.length > 0) topPlayer = String((r.rows[0] as any)?.username ?? topPlayer);
      } catch { /* use default */ }
      if (abGroup === "A") {
        copy = `Today's top PackPTS player is crushing it! Can you dethrone the leaderboard? Play now at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `${topPlayer} is leading the PackPTS leaderboard right now. Think you can top them? Jump in at ${siteUrl}`;
      } else {
        copy = `The PackPTS daily leaderboard resets every 24 hours. Today's spot is up for grabs — claim it at ${siteUrl}`;
      }
      break;
    }
    case "STREAK_MILESTONE": {
      let streak = 7;
      try {
        const r = await db.execute(sql`SELECT MAX(current_days) as mx FROM streak_state`);
        streak = parseInt(String((r.rows[0] as any)?.mx ?? "7")) || 7;
      } catch { /* use default */ }
      if (abGroup === "A") {
        copy = `Someone is on a ${streak}-day streak in PackPTS! Can you build yours? Daily challenges await at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `${streak} days straight. That's dedication. Start your own PackPTS streak today at ${siteUrl}`;
      } else {
        copy = `Daily streaks = bonus points. Play PackPTS every day and watch your rewards stack up at ${siteUrl}`;
      }
      break;
    }
    case "MARKET_PRICE_SPOTLIGHT": {
      if (abGroup === "A") {
        copy = `Baseball card prices are moving fast. Stay ahead of the market — test your card knowledge and earn rewards at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `The hottest cards on the market this week — can you name them all? Test yourself at PackPTS: ${siteUrl}`;
      } else {
        copy = `Card collectors: how well do you know the market's top movers? Prove it and earn points at ${siteUrl}`;
      }
      cardQueryParams = { sortBy: "sales_7day", category: "Baseball" };
      break;
    }
    case "NEW_USER_ACQUISITION": {
      let userCount = 0;
      try {
        const r = await db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE status = 'ACTIVE'`);
        userCount = parseInt(String((r.rows[0] as any)?.cnt ?? "0"));
      } catch { /* use default */ }
      const countStr = userCount > 0 ? `${userCount.toLocaleString()} players` : "thousands of players";
      if (abGroup === "A") {
        copy = `Join ${countStr} already competing on PackPTS — the baseball card trivia game where your knowledge pays off. Sign up free at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `Free to play. Real rewards. PackPTS turns your baseball card knowledge into points you can actually use. Start at ${siteUrl}`;
      } else {
        copy = `If you collect cards, you should be playing PackPTS. Identify cards, earn points, win rewards. Free signup at ${siteUrl}`;
      }
      break;
    }
    case "REWARD_ANNOUNCEMENT": {
      let rewardValue = "500";
      try {
        const r = await db.execute(sql`SELECT reward_value FROM campaign_rewards WHERE is_active = TRUE LIMIT 1`);
        if (r.rows.length > 0) rewardValue = String((r.rows[0] as any)?.reward_value ?? "500");
      } catch { /* use default */ }
      if (abGroup === "A") {
        copy = `New players earn ${rewardValue} bonus PackPTS on signup. Plus daily rewards for streaks and wins. Start earning at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `Signup bonus. Streak rewards. Referral points. PackPTS pays you to play. Claim your ${rewardValue} pts today at ${siteUrl}`;
      } else {
        copy = `Your card knowledge is worth real rewards. New to PackPTS? You get ${rewardValue} bonus points just for joining at ${siteUrl}`;
      }
      break;
    }
    case "CHALLENGE": {
      let topScore = 0;
      try {
        const r = await db.execute(sql`
          SELECT MAX(score) as top FROM (
            SELECT SUM(points_earned) as score FROM match_answers GROUP BY match_id
          ) sub
        `);
        topScore = parseInt(String((r.rows[0] as any)?.top ?? "0"));
      } catch { /* use default */ }
      const scoreStr = topScore > 0 ? `${topScore.toLocaleString()} points` : "the record";
      if (abGroup === "A") {
        copy = `Can you beat ${scoreStr}? The PackPTS leaderboard challenge is live. Prove your card knowledge at ${siteUrl}`;
      } else if (abGroup === "B") {
        copy = `The PackPTS challenge of the day is up. Think you've got what it takes? Find out at ${siteUrl}`;
      } else {
        copy = `${scoreStr} is the mark to beat. Card experts only. Take the PackPTS challenge at ${siteUrl}`;
      }
      break;
    }
  }

  const hashtags = pickHashtags(abGroup);
  const trimmed = fitToLength(copy, siteUrl, hashtags, maxChars);
  return { copyText: trimmed, cardQueryParams };
}

export async function generateDraftPost(
  platform: Platform,
  contentType?: SocialContentType,
  abGroup?: "A" | "B" | "C",
): Promise<DraftPost> {
  const type = contentType ?? pickNextContentType(platform);
  const day = new Date().getDate() % 3;
  const group: "A" | "B" | "C" = abGroup ?? (day === 0 ? "A" : day === 1 ? "B" : "C");

  const { copyText, cardQueryParams } = await buildCopy(type, platform, group);
  const hashtags = pickHashtags(group);

  const draft: DraftPost = { platform, contentType: type, copyText, hashtags, cardQueryParams, abGroup: group as any };

  const factResult = await checkClaims(draft);
  if (!factResult.passed) {
    logger.warn("fact_check_failed", { platform, contentType: type, log: factResult.log });
  }

  return {
    ...draft,
    copyText: factResult.cleanedCopyText,
    factCheckPassed: factResult.passed,
    factCheckLog: factResult.log,
  };
}
