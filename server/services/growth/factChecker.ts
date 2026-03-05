/**
 * Fact-Checker Guardrail — Layers 1, 2, and 3
 *
 * Layer 1 — Fact-Check Gate:
 *   A dedicated second LLM call reviews every generated post before it can be
 *   published. If any claim is unverifiable, uncertain, or potentially false,
 *   the post is blocked and routed to the human review queue.
 *
 * Layer 2 — Grounding:
 *   When card context is available (player, year, set), claims in the post are
 *   verified against that known data. The LLM is not allowed to invent stats or
 *   historical facts beyond what the card data supports.
 *
 * Layer 3 — Restricted Claim Types:
 *   Specific categories of claims (statistics with numbers, career records,
 *   historical rankings, attributed quotes, health/legal/financial assertions)
 *   are automatically flagged and routed to human review regardless of the
 *   fact-check verdict.
 */

import { generateStructuredContent } from "./openaiAdapter";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FactCheckVerdict = "APPROVE" | "REJECT" | "NEEDS_REVIEW";

export interface CardContext {
  player: string;
  year: number;
  set: string;
  cardId?: string;
}

export interface FactCheckResult {
  verdict: FactCheckVerdict;
  claims: FactCheckClaim[];
  overallExplanation: string;
  restrictedClaimsFound: string[];
  checkedAt: string;
}

export interface FactCheckClaim {
  claim: string;
  verdict: "VERIFIED" | "UNVERIFIED" | "FALSE" | "UNCERTAIN";
  explanation: string;
}

// ─── Layer 3: Restricted Claim Type Patterns ──────────────────────────────────

/**
 * These patterns identify claim types that are NEVER allowed to be
 * auto-published. They require human review regardless of the fact-check result
 * because they carry elevated risk of publishing inaccurate information.
 */
const RESTRICTED_PATTERNS: { label: string; pattern: RegExp }[] = [
  // Specific statistics with numbers  (e.g. ".342 batting average", "500 home runs")
  { label: "specific stat with number", pattern: /\b\d+\.?\d*\s*(home runs?|hr|rbi|batting average|era|strikeouts?|hits?|stolen bases?|wins?|losses?|saves?|points?|assists?|rebounds?)\b/i },
  { label: "percentage stat",           pattern: /\b\d+(\.\d+)?%\s*(of|career|lifetime|season|win|save|batting|on-base|slug)/i },
  { label: "career milestone",          pattern: /\b(career|lifetime|all-time|franchise)\s*(record|leader|best|most|highest|lowest|first|only)\b/i },
  { label: "historical ranking",        pattern: /\b(#\d+|number\s+\d+|ranked\s+\d+|top\s+\d+)\s*(all.?time|in\s+(history|mlb|baseball|the\s+league))\b/i },
  { label: "attributed quote",          pattern: /["']\s*.{10,200}\s*["']\s*[-—–]\s*[A-Z][a-z]+/   },
  { label: "award claim",               pattern: /\b(won|awarded|named|selected|received)\s+(the\s+)?(mvp|cy young|gold glove|silver slugger|all.?star|hof|hall of fame|rookie of the year)\b/i },
  { label: "hall of fame reference",    pattern: /\bhall of fame\b/i },
  { label: "world series championship", pattern: /\b(won|won the|captured the|claimed the)\s+(world series|championship|pennant)\b/i },
  { label: "exact year claim",          pattern: /\bin (19|20)\d{2}\b.*\b(he|they|the team|the card)\b/i },
];

/**
 * Scans content for restricted claim types.
 * Returns an array of human-readable labels for any matches found.
 */
export function detectRestrictedClaims(text: string): string[] {
  const found: string[] = [];
  for (const { label, pattern } of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) {
      found.push(label);
    }
  }
  return found;
}

// ─── Zod schema for LLM response ─────────────────────────────────────────────

const FactCheckClaimSchema = z.object({
  claim: z.string(),
  verdict: z.enum(["VERIFIED", "UNVERIFIED", "FALSE", "UNCERTAIN"]),
  explanation: z.string(),
});

const FactCheckResponseSchema = z.object({
  verdict: z.enum(["APPROVE", "REJECT", "NEEDS_REVIEW"]),
  claims: z.array(FactCheckClaimSchema).default([]),
  overallExplanation: z.string(),
});

type FactCheckResponse = z.infer<typeof FactCheckResponseSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

const FACT_CHECK_SYSTEM_PROMPT = `You are a strict fact-checker for social media posts published by PackPTS, a baseball card trivia game.

Your ONLY job is to verify whether the factual claims in a post are accurate.

RULES:
1. Extract every factual claim from the post (stats, records, dates, player history, card details, awards, achievements).
2. For each claim, return one of:
   - VERIFIED   — the claim is a well-known, widely accepted fact you are highly confident is accurate
   - UNVERIFIED — you cannot confirm the claim is accurate from your knowledge
   - FALSE      — the claim is demonstrably incorrect
   - UNCERTAIN  — the claim may be true but you are not certain
3. Set the overall verdict to:
   - APPROVE      — ALL claims are VERIFIED (or there are no factual claims)
   - NEEDS_REVIEW — one or more claims are UNCERTAIN or UNVERIFIED
   - REJECT       — one or more claims are FALSE
4. When card context is provided, verify claims against that specific card's data.
   Claims that contradict the provided player/year/set data must be marked FALSE.
5. Marketing language, opinions, and subjective statements are NOT factual claims.
   Only flag objective, verifiable assertions.
6. NEVER fabricate information. If you do not know, return UNVERIFIED.

Respond ONLY with valid JSON.`;

function buildFactCheckPrompt(
  content: { title: string; body: string },
  platform: string,
  cardContext?: CardContext,
): string {
  const cardSection = cardContext
    ? `\nVERIFIED CARD DATA (ground truth — claims must match this exactly):
Player: ${cardContext.player}
Year: ${cardContext.year}
Set: ${cardContext.set}\n`
    : "";

  return `Fact-check this ${platform} post:

Title: ${content.title}
Body: ${content.body}
${cardSection}
Return JSON:
{
  "verdict": "APPROVE" | "REJECT" | "NEEDS_REVIEW",
  "claims": [
    { "claim": "exact quote of the claim", "verdict": "VERIFIED"|"UNVERIFIED"|"FALSE"|"UNCERTAIN", "explanation": "why" }
  ],
  "overallExplanation": "one sentence summary"
}

If there are no factual claims, return: {"verdict":"APPROVE","claims":[],"overallExplanation":"No factual claims detected."}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all three layers of factual accuracy guardrails on a piece of content.
 *
 * @param content   The generated post (title + body)
 * @param platform  The target platform (for logging/prompts)
 * @param cardContext  Optional: the card the post is grounded in (Layer 2)
 * @returns FactCheckResult with final verdict and details
 */
export async function checkFactualAccuracy(
  content: { title: string; body: string },
  platform: string,
  cardContext?: CardContext,
): Promise<FactCheckResult> {
  const checkedAt = new Date().toISOString();

  // ── Layer 3: Detect restricted claim types BEFORE calling the LLM ──────────
  const fullText = `${content.title} ${content.body}`;
  const restrictedClaimsFound = detectRestrictedClaims(fullText);

  // ── Layer 1 + 2: LLM-based fact-check ──────────────────────────────────────
  let llmResult: FactCheckResponse;
  try {
    const { parsed: rawParsed } = await generateStructuredContent<FactCheckResponse>({
      systemPrompt: FACT_CHECK_SYSTEM_PROMPT,
      userPrompt: buildFactCheckPrompt(content, platform, cardContext),
      maxTokens: 800,
      temperature: 0.1, // Low temperature for deterministic, cautious fact-checking
    });

    const parsed = FactCheckResponseSchema.safeParse(rawParsed);
    if (parsed.success) {
      llmResult = parsed.data;
    } else {
      // If LLM response can't be parsed, fail safe: route to human review
      console.warn(`[FactChecker] Could not parse LLM response for ${platform}, defaulting to NEEDS_REVIEW`);
      llmResult = {
        verdict: "NEEDS_REVIEW",
        claims: [],
        overallExplanation: "Fact-check response could not be parsed — requires human review.",
      };
    }
  } catch (err: any) {
    // If the LLM call fails entirely, fail safe: route to human review
    console.error(`[FactChecker] LLM call failed for ${platform}: ${err?.message}`);
    llmResult = {
      verdict: "NEEDS_REVIEW",
      claims: [],
      overallExplanation: `Fact-check service unavailable (${err?.message?.slice(0, 100)}) — requires human review.`,
    };
  }

  // ── Combine Layer 1/2 verdict with Layer 3 restricted claims ───────────────
  //    Restricted claims always escalate to at least NEEDS_REVIEW, even if the
  //    LLM returned APPROVE.
  let finalVerdict: FactCheckVerdict = llmResult.verdict;
  if (restrictedClaimsFound.length > 0 && finalVerdict === "APPROVE") {
    finalVerdict = "NEEDS_REVIEW";
  }

  const result: FactCheckResult = {
    verdict: finalVerdict,
    claims: llmResult.claims,
    overallExplanation: llmResult.overallExplanation,
    restrictedClaimsFound,
    checkedAt,
  };

  const claimCount = llmResult.claims.length;
  const restrictedCount = restrictedClaimsFound.length;
  console.log(
    `[FactChecker] ${platform} → verdict=${finalVerdict} | claims=${claimCount} | restricted=${restrictedCount}${
      restrictedCount > 0 ? ` (${restrictedClaimsFound.join(", ")})` : ""
    }`,
  );

  return result;
}

/**
 * Convenience: maps a FactCheckResult verdict to the content item status
 * that should be stored in the database.
 *
 *   APPROVE      → "READY"          (auto-post proceeds normally)
 *   NEEDS_REVIEW → "PENDING_REVIEW" (sent to human review queue)
 *   REJECT       → "PENDING_REVIEW" (blocked, human must decide)
 */
export function verdictToStatus(verdict: FactCheckVerdict): "READY" | "PENDING_REVIEW" {
  return verdict === "APPROVE" ? "READY" : "PENDING_REVIEW";
}
