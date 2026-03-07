import { db } from "../../db";
import { sql } from "drizzle-orm";
import { checkClaims, type DraftPost } from "./factChecker";
import { agentConfig } from "./config";
import { createLogger } from "./logger";

const logger = createLogger("ContentGenerator");

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

function pickHashtags(abGroup: "A" | "B"): string[] {
  const primary = HASHTAG_SETS.primary;
  const secondary = HASHTAG_SETS.secondary;
  const extra = abGroup === "A"
    ? secondary.slice(0, 2)
    : [secondary[2], secondary[1]];
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
  abGroup: "A" | "B",
): Promise<{ copyText: string; cardQueryParams: Record<string, unknown> }> {
  const { siteUrl } = agentConfig;
  const maxChars = platform === "TWITTER" ? 280 : 2200;
  let copy = "";
  let cardQueryParams: Record<string, unknown> = { sortBy: "sales_7day" };

  switch (type) {
    case "TRIVIA_CARD": {
      if (abGroup === "A") {
        copy = `The most-traded baseball cards right now are flying on the market. Can you name today's hottest card? Test your knowledge at ${siteUrl}`;
      } else {
        copy = `Think you know your cards? Challenge yourself with today's trending card trivia and climb the leaderboard at ${siteUrl}`;
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
      copy = `Today's top PackPTS player is crushing it! Can you dethrone the leaderboard? Play now at ${siteUrl}`;
      break;
    }
    case "STREAK_MILESTONE": {
      let streak = 7;
      try {
        const r = await db.execute(sql`SELECT MAX(current_days) as mx FROM streak_state`);
        streak = parseInt(String((r.rows[0] as any)?.mx ?? "7")) || 7;
      } catch { /* use default */ }
      copy = `Someone is on a ${streak}-day streak in PackPTS! Can you build yours? Daily challenges await at ${siteUrl}`;
      break;
    }
    case "MARKET_PRICE_SPOTLIGHT": {
      copy = `Baseball card prices are moving fast. Stay ahead of the market — test your card knowledge and earn rewards at ${siteUrl}`;
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
      copy = `Join ${countStr} already competing on PackPTS — the baseball card trivia game where your knowledge pays off. Sign up free at ${siteUrl}`;
      break;
    }
    case "REWARD_ANNOUNCEMENT": {
      let rewardValue = "500";
      try {
        const r = await db.execute(sql`SELECT reward_value FROM campaign_rewards WHERE is_active = TRUE LIMIT 1`);
        if (r.rows.length > 0) rewardValue = String((r.rows[0] as any)?.reward_value ?? "500");
      } catch { /* use default */ }
      copy = `New players earn ${rewardValue} bonus PackPTS on signup. Plus daily rewards for streaks and wins. Start earning at ${siteUrl}`;
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
      copy = `Can you beat ${scoreStr}? The PackPTS leaderboard challenge is live. Prove your card knowledge at ${siteUrl}`;
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
  abGroup?: "A" | "B",
): Promise<DraftPost> {
  const type = contentType ?? pickNextContentType(platform);
  const group: "A" | "B" = abGroup ?? (new Date().getDate() % 2 === 0 ? "B" : "A");

  const { copyText, cardQueryParams } = await buildCopy(type, platform, group);
  const hashtags = pickHashtags(group);

  const draft: DraftPost = { platform, contentType: type, copyText, hashtags, cardQueryParams, abGroup: group };

  const factResult = await checkClaims(draft);
  if (!factResult.passed) {
    logger.warn("fact_check_failed", { platform, contentType: type, log: factResult.log });
  }

  return {
    ...draft,
    copyText: factResult.cleanedCopyText,
  };
}
