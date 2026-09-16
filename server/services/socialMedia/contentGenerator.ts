import { checkClaims, type DraftPost } from "./factChecker";
import { agentConfig } from "./config";
import { createLogger } from "./logger";
import { loadEvolvedVariants } from "./promptEvolution";
import {
  AUTO_CONTENT_TYPE,
  buildDaily5Copy,
  detectMarketingSorViolation,
  inferDaily5Ritual,
  sparseHashtags,
  type Daily5Ritual,
} from "./marketingSor";

const logger = createLogger("ContentGenerator");

if (!process.env.OPENAI_API_KEY) {
  console.warn("[ContentGenerator] OPENAI_API_KEY is not set — auto posts still use Marketing SoR Daily 5 templates (no AI FOMO copy).");
}

export type Platform = "TWITTER" | "TIKTOK" | "DISCORD";

export interface CardContext {
  player?: string;
  set?: string;
  cardPrice?: number;
  cardSales7d?: number;
}

export type SocialContentType =
  | "TRIVIA_CARD"
  | "LEADERBOARD_HIGHLIGHT"
  | "STREAK_MILESTONE"
  | "MARKET_PRICE_SPOTLIGHT"
  | "NEW_USER_ACQUISITION"
  | "REWARD_ANNOUNCEMENT"
  | "CHALLENGE";

/** Auto rotation is Daily 5 ritual only (Marketing SoR). Banned acquisition types never enter the queue. */
const CONTENT_TYPE_ROTATION: SocialContentType[] = [AUTO_CONTENT_TYPE];

function pickNextContentType(_platform: Platform): SocialContentType {
  void _platform;
  return CONTENT_TYPE_ROTATION[0] ?? AUTO_CONTENT_TYPE;
}

/**
 * Fallback used when AI is unavailable. Always Daily 5 SoR copy — never signup-bonus spam.
 */
export function generateFallbackContent(type: string, siteUrl = agentConfig.siteUrl): string {
  void type;
  return buildDaily5Copy("announcement", "A", siteUrl);
}

function pickHashtags(): string[] {
  return sparseHashtags();
}

async function buildCopy(
  type: SocialContentType,
  platform: Platform,
  abGroup: "A" | "B" | "C",
  ritual: Daily5Ritual,
): Promise<{ copyText: string; cardQueryParams: Record<string, unknown> }> {
  void platform;
  const { siteUrl } = agentConfig;

  // Evolved variants may still be FOMO from prior generations — only use CHALLENGE + SoR-clean copy.
  if (type === AUTO_CONTENT_TYPE) {
    try {
      const evolved = await loadEvolvedVariants(type);
      const candidate = evolved?.[abGroup];
      if (candidate) {
        const violation = detectMarketingSorViolation(candidate, pickHashtags());
        if (!violation.matched) {
          logger.info("evolved_variant_used", { type, abGroup, ritual });
          return { copyText: candidate, cardQueryParams: { ritual, sortBy: "sales_7day", category: "Baseball" } };
        }
        logger.warn("evolved_variant_rejected_sor", { type, abGroup, reason: violation.reason });
      }
    } catch (err) {
      logger.warn("evolved_variant_load_failed", { type, error: String(err) });
    }
  }

  const copyText = buildDaily5Copy(ritual, abGroup, siteUrl);
  return { copyText, cardQueryParams: { ritual, sortBy: "sales_7day", category: "Baseball" } };
}

export async function generateDraftPost(
  platform: Platform,
  contentType?: SocialContentType,
  abGroup?: "A" | "B" | "C",
  _cardContext?: CardContext,
  ritual?: Daily5Ritual,
): Promise<DraftPost> {
  void _cardContext;
  const type = pickNextContentType(platform);
  void contentType;
  const day = new Date().getDate() % 3;
  const group: "A" | "B" | "C" = abGroup ?? (day === 0 ? "A" : day === 1 ? "B" : "C");
  const resolvedRitual = ritual ?? inferDaily5Ritual();

  const { copyText, cardQueryParams } = await buildCopy(type, platform, group, resolvedRitual);
  const hashtags = pickHashtags();

  const sor = detectMarketingSorViolation(copyText, hashtags);
  const safeCopy = sor.matched ? buildDaily5Copy(resolvedRitual, "A", agentConfig.siteUrl) : copyText;
  if (sor.matched) {
    logger.warn("generated_copy_replaced_sor", { reason: sor.reason, contentType: type });
  }

  const draft: DraftPost = {
    platform,
    contentType: type,
    copyText: safeCopy,
    hashtags,
    cardQueryParams,
    abGroup: group as any,
  };

  const factResult = await checkClaims(draft);
  if (!factResult.passed) {
    logger.warn("fact_check_failed", { platform, contentType: type, log: factResult.log });
  }

  let cleaned = factResult.cleanedCopyText;
  const afterFact = detectMarketingSorViolation(cleaned, hashtags);
  if (afterFact.matched) {
    cleaned = buildDaily5Copy(resolvedRitual, "A", agentConfig.siteUrl);
    logger.warn("fact_checked_copy_replaced_sor", { reason: afterFact.reason });
  }

  return {
    ...draft,
    copyText: cleaned,
    factCheckPassed: factResult.passed,
    factCheckLog: factResult.log,
  };
}

export { CONTENT_TYPE_ROTATION };
