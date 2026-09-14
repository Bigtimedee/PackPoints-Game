/**
 * Design-baked social PNGs — prefer when present, never invent art.
 * Drop: packpts-design/social/exports/  Hosted: client/public/assets/social/
 * Contract: docs/design/SOCIAL_PNG_QA.md
 */
import fs from "fs";
import path from "path";

export const SOCIAL_DESIGN_EXPORT_DIR = "packpts-design/social/exports";
export const SOCIAL_HOSTED_DIR = "client/public/assets/social";

/** Square 1080 (Twitter/Discord) and story 1080×1920 (TikTok). Copy-only. */
export const SOCIAL_DESIGN_EXPORTS: Record<string, { square: string; story: string }> = {
  LEADERBOARD_HIGHLIGHT: { square: "leaderboard-1080.png", story: "leaderboard-story.png" },
  STREAK_MILESTONE: { square: "streak-1080.png", story: "streak-story.png" },
  CHALLENGE: { square: "challenge-1080.png", story: "challenge-story.png" },
  NEW_USER_ACQUISITION: { square: "join-1080.png", story: "join-story.png" },
  REWARD_ANNOUNCEMENT: { square: "reward-1080.png", story: "reward-story.png" },
  TRIVIA_CARD: { square: "trivia-1080.png", story: "trivia-story.png" },
  MARKET_PRICE_SPOTLIGHT: { square: "market-1080.png", story: "market-story.png" },
};

export function socialDesignFileName(
  contentType: string,
  platform: "TWITTER" | "TIKTOK" | "DISCORD",
): string | null {
  const entry = SOCIAL_DESIGN_EXPORTS[contentType];
  if (!entry) return null;
  return platform === "TIKTOK" ? entry.story : entry.square;
}

export function socialDesignSearchDirs(cwd = process.cwd()): string[] {
  return [
    path.resolve(cwd, SOCIAL_DESIGN_EXPORT_DIR),
    path.resolve(cwd, SOCIAL_HOSTED_DIR),
    path.join("/app", SOCIAL_DESIGN_EXPORT_DIR),
    path.join("/app", SOCIAL_HOSTED_DIR),
    path.join("/app/dist/public/assets/social"),
  ];
}

export interface SocialDesignExport {
  buffer: Buffer;
  sourcePath: string;
  fileName: string;
}

export function readSocialDesignExport(
  contentType: string,
  platform: "TWITTER" | "TIKTOK" | "DISCORD",
  opts?: { searchDirs?: string[] },
): SocialDesignExport | null {
  const fileName = socialDesignFileName(contentType, platform);
  if (!fileName) return null;
  const dirs = opts?.searchDirs ?? socialDesignSearchDirs();
  for (const dir of dirs) {
    const sourcePath = path.join(dir, fileName);
    if (!fs.existsSync(sourcePath)) continue;
    return { buffer: fs.readFileSync(sourcePath), sourcePath, fileName };
  }
  return null;
}
