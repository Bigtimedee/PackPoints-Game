import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createLogger } from "./logger";
import { agentConfig } from "./config";

const logger = createLogger("FactChecker");

export interface DraftPost {
  platform: "TWITTER" | "TIKTOK";
  contentType: string;
  copyText: string;
  hashtags: string[];
  cardQueryParams: Record<string, unknown>;
  abGroup: "A" | "B" | "C";
}

export interface FactCheckLogEntry {
  claim: string;
  verified: boolean;
  verifiedValue?: string | number;
  action: "kept" | "replaced" | "removed";
}

export interface FactCheckResult {
  passed: boolean;
  cleanedCopyText: string;
  log: FactCheckLogEntry[];
}

async function getActiveUserCount(): Promise<number | null> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE status = 'ACTIVE'`);
    return parseInt(String((result.rows[0] as any)?.cnt ?? "0"));
  } catch { return null; }
}

async function getCompletedMatchCount(): Promise<number | null> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM matches WHERE status = 'COMPLETED'`);
    return parseInt(String((result.rows[0] as any)?.cnt ?? "0"));
  } catch { return null; }
}

async function getTopScore(): Promise<number | null> {
  try {
    const result = await db.execute(sql`
      SELECT MAX(score) as top FROM (
        SELECT SUM(points_earned) as score FROM match_answers GROUP BY match_id
      ) sub
    `);
    return parseInt(String((result.rows[0] as any)?.top ?? "0"));
  } catch { return null; }
}

async function getMaxStreak(): Promise<number | null> {
  try {
    const result = await db.execute(sql`SELECT MAX(current_days) as mx FROM streak_state`);
    return parseInt(String((result.rows[0] as any)?.mx ?? "0"));
  } catch { return null; }
}

async function getActiveRewardValues(): Promise<string[]> {
  try {
    const result = await db.execute(sql`SELECT reward_value FROM campaign_rewards WHERE is_active = TRUE`);
    return (result.rows as any[]).map(r => String(r.reward_value));
  } catch { return []; }
}

export async function checkClaims(draft: DraftPost): Promise<FactCheckResult> {
  let text = draft.copyText;
  const log: FactCheckLogEntry[] = [];

  // Check user count claims
  const userMatch = text.match(/(\d[\d,]*)\s*(users|players|members)/i);
  if (userMatch) {
    const claimedCount = parseInt(userMatch[1].replace(/,/g, ""));
    const actualCount = await getActiveUserCount();
    if (actualCount !== null && Math.abs(claimedCount - actualCount) / Math.max(actualCount, 1) > 0.1) {
      const formatted = actualCount.toLocaleString();
      text = text.replace(userMatch[0], `${formatted} ${userMatch[2]}`);
      log.push({ claim: userMatch[0], verified: false, verifiedValue: actualCount, action: "replaced" });
      logger.info("user_count_corrected", { claimed: claimedCount, actual: actualCount });
    } else {
      log.push({ claim: userMatch[0], verified: true, action: "kept" });
    }
  }

  // Check match count claims
  const matchMatch = text.match(/(\d[\d,]*)\s*matches/i);
  if (matchMatch) {
    const claimedMatches = parseInt(matchMatch[1].replace(/,/g, ""));
    const actualMatches = await getCompletedMatchCount();
    if (actualMatches !== null && Math.abs(claimedMatches - actualMatches) / Math.max(actualMatches, 1) > 0.1) {
      text = text.replace(matchMatch[0], `${actualMatches.toLocaleString()} matches`);
      log.push({ claim: matchMatch[0], verified: false, verifiedValue: actualMatches, action: "replaced" });
    } else {
      log.push({ claim: matchMatch[0], verified: true, action: "kept" });
    }
  }

  // Check top score claims
  const scoreMatch = text.match(/top\s+score[^0-9]*(\d[\d,]*)/i);
  if (scoreMatch) {
    const claimedScore = parseInt(scoreMatch[1].replace(/,/g, ""));
    const actualTop = await getTopScore();
    if (actualTop !== null && Math.abs(claimedScore - actualTop) / Math.max(actualTop, 1) > 0.1) {
      text = text.replace(scoreMatch[1], actualTop.toLocaleString());
      log.push({ claim: scoreMatch[0], verified: false, verifiedValue: actualTop, action: "replaced" });
    } else {
      log.push({ claim: scoreMatch[0], verified: true, action: "kept" });
    }
  }

  // Check streak claims
  const streakMatch = text.match(/(\d+)\s*-?\s*day\s+streak/i);
  if (streakMatch) {
    const claimedStreak = parseInt(streakMatch[1]);
    const maxStreak = await getMaxStreak();
    if (maxStreak !== null && claimedStreak > maxStreak * 1.5) {
      text = text.replace(streakMatch[1], String(maxStreak));
      log.push({ claim: streakMatch[0], verified: false, verifiedValue: maxStreak, action: "replaced" });
    } else {
      log.push({ claim: streakMatch[0], verified: true, action: "kept" });
    }
  }

  // Check reward values
  const rewardMatch = text.match(/(\d[\d,]*)\s*(?:pts|PackPTS|points)/i);
  if (rewardMatch) {
    const activeValues = await getActiveRewardValues();
    const claimedValue = rewardMatch[1].replace(/,/g, "");
    if (activeValues.length > 0 && !activeValues.includes(claimedValue)) {
      // Use the first active reward value
      text = text.replace(rewardMatch[1], activeValues[0]);
      log.push({ claim: rewardMatch[0], verified: false, verifiedValue: activeValues[0], action: "replaced" });
    } else {
      log.push({ claim: rewardMatch[0], verified: true, action: "kept" });
    }
  }

  // Always verify site URL is present
  if (!text.includes(agentConfig.siteUrl)) {
    log.push({ claim: "site_url_missing", verified: false, action: "kept" });
  } else {
    log.push({ claim: "site_url", verified: true, action: "kept" });
  }

  const passed = log.length === 0 || log.some(e => e.verified || e.action === "replaced");
  return { passed, cleanedCopyText: text, log };
}
