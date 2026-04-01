async function getDb() { const { db } = await import("../../db"); return db; }
/**
 * Prompt Evolution Loop
 *
 * Mirrors Karpathy's autoresearch loop for LLM training, applied to social copy:
 *
 *   1. Read concluded A/B tests — extract winning copy patterns
 *   2. Load prompt_program.md — the human-editable research direction file
 *   3. Call OpenAI — generate next-generation variants for each content type
 *   4. Write winners back to evolved_copy_variants — contentGenerator loads from here
 *
 * Runs nightly before the daily queue build. The loop compounds: each generation
 * learns from the prior generation's winners.
 *
 * To steer the research direction, edit /prompt_program.md.
 */

import fs from "fs";
import path from "path";
import { abTests, socialPosts, evolvedCopyVariants } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "./logger";
import type { SocialContentType } from "./contentGenerator";

const logger = createLogger("PromptEvolution");

const CONTENT_TYPES: SocialContentType[] = [
  "TRIVIA_CARD",
  "LEADERBOARD_HIGHLIGHT",
  "STREAK_MILESTONE",
  "MARKET_PRICE_SPOTLIGHT",
  "NEW_USER_ACQUISITION",
  "REWARD_ANNOUNCEMENT",
  "CHALLENGE",
];

// ---------------------------------------------------------------------------
// Load the human-editable program file
// ---------------------------------------------------------------------------
function loadProgramMd(): string {
  const candidates = [
    path.resolve(process.cwd(), "prompt_program.md"),
    path.resolve(process.cwd(), "../prompt_program.md"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  logger.warn("prompt_program_not_found", { searched: candidates });
  return "";
}

// ---------------------------------------------------------------------------
// Query concluded A/B tests and pull the winning copy for each content type
// ---------------------------------------------------------------------------
interface WinnerRecord {
  contentType: SocialContentType;
  winningGroup: string;
  copyText: string;
  conversionRate: number;
  generation: number;
}

async function fetchRecentWinners(): Promise<WinnerRecord[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const concludedTests = await (await getDb())
    .select()
    .from(abTests)
    .where(
      and(
        eq(abTests.status, "CONCLUDED"),
        sql`${abTests.endedAt} >= ${cutoff}`,
      ),
    );

  if (concludedTests.length === 0) return [];

  const winners: WinnerRecord[] = [];

  for (const test of concludedTests) {
    if (!test.winner || !test.contentType) continue;

    // Find a published post from the winning group for this test
    const winningPost = await (await getDb())
      .select({ copyText: socialPosts.copyText, abGroup: socialPosts.abGroup })
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.abTestId, test.id),
          eq(socialPosts.abGroup, test.winner as any),
          eq(socialPosts.status, "PUBLISHED"),
        ),
      )
      .limit(1);

    if (winningPost.length === 0) continue;

    // Get the conversion rate for the winning group
    const statsRow = await (await getDb()).execute(sql`
      SELECT
        SUM(pa.new_signups_attributed)::float /
          NULLIF(SUM(pa.clicks), 0) AS conversion_rate
      FROM social_posts sp
      LEFT JOIN post_analytics pa ON pa.post_id = sp.id
      WHERE sp.ab_test_id = ${test.id}
        AND sp.ab_group = ${test.winner}
    `);
    const convRate = parseFloat(String((statsRow.rows[0] as any)?.conversion_rate ?? "0")) || 0;

    // Check if there is already an evolved variant for this content type to know generation
    const latestEvolved = await (await getDb())
      .select({ generation: evolvedCopyVariants.generation })
      .from(evolvedCopyVariants)
      .where(eq(evolvedCopyVariants.contentType, test.contentType as any))
      .orderBy(sql`generation DESC`)
      .limit(1);

    const nextGeneration = (latestEvolved[0]?.generation ?? 0) + 1;

    winners.push({
      contentType: test.contentType as SocialContentType,
      winningGroup: test.winner,
      copyText: winningPost[0].copyText,
      conversionRate: convRate,
      generation: nextGeneration,
    });
  }

  return winners;
}

// ---------------------------------------------------------------------------
// Call OpenAI to generate next-generation variants
// ---------------------------------------------------------------------------
interface GeneratedVariants {
  contentType: SocialContentType;
  generation: number;
  rationale: string;
  variants: { A: string; B: string; C: string };
}

async function generateNextGeneration(
  winners: WinnerRecord[],
  programMd: string,
): Promise<GeneratedVariants[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn("openai_key_missing", { message: "Skipping evolution — OPENAI_API_KEY not set" });
    return [];
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const winnersBlock = winners.map(w =>
    `Content type: ${w.contentType}\nWinning group: ${w.winningGroup}\nConversion rate: ${(w.conversionRate * 100).toFixed(2)}%\nWinning copy: "${w.copyText}"\nNext generation number: ${w.generation}`
  ).join("\n\n");

  const prompt = `You are an autonomous social media copy researcher for PackPTS.

## Your instructions (from prompt_program.md)

${programMd}

---

## Recent A/B test winners

${winnersBlock.length > 0 ? winnersBlock : "No concluded tests yet. Generate first-generation variants based on the brand voice guidelines above."}

---

## Your task

For each content type listed above (or all 7 types if there are no winners), generate the
next generation of A/B/C variants. Study the winning copy to understand what mechanic drove
conversions, then push further in that direction while staying within the brand voice constraints.

Return a JSON array where each element matches this shape exactly:
{
  "contentType": "CONTENT_TYPE_NAME",
  "generation": <integer>,
  "rationale": "One sentence explaining what you're testing and why vs the prior winner.",
  "variants": {
    "A": "copy body text only — no URL, no hashtags",
    "B": "copy body text only — no URL, no hashtags",
    "C": "copy body text only — no URL, no hashtags"
  }
}

Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 2000,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const parsed: GeneratedVariants[] = JSON.parse(raw);

    // Basic validation
    return parsed.filter(
      item =>
        item.contentType &&
        item.variants?.A &&
        item.variants?.B &&
        item.variants?.C,
    );
  } catch (err) {
    logger.error("openai_generation_failed", { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Persist new variants to DB, deactivating prior active ones for that type
// ---------------------------------------------------------------------------
async function persistVariants(generated: GeneratedVariants[]): Promise<void> {
  for (const item of generated) {
    // Deactivate existing active variants for this content type
    await (await getDb())
      .update(evolvedCopyVariants)
      .set({ isActive: false })
      .where(
        and(
          eq(evolvedCopyVariants.contentType, item.contentType as any),
          eq(evolvedCopyVariants.isActive, true),
        ),
      );

    // Insert new generation for each group
    for (const [group, copyText] of Object.entries(item.variants) as [string, string][]) {
      await (await getDb()).insert(evolvedCopyVariants).values({
        contentType: item.contentType as any,
        platform: "ALL",
        abGroup: group,
        copyText,
        generation: item.generation,
        rationale: item.rationale,
        isActive: true,
      });
    }

    logger.info("variants_persisted", {
      contentType: item.contentType,
      generation: item.generation,
      rationale: item.rationale,
    });
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function runPromptEvolution(): Promise<void> {
  logger.info("evolution_start");

  const programMd = loadProgramMd();
  if (!programMd) {
    logger.warn("evolution_skipped", { reason: "prompt_program.md not found" });
    return;
  }

  const winners = await fetchRecentWinners();
  logger.info("winners_fetched", { count: winners.length });

  const generated = await generateNextGeneration(winners, programMd);
  if (generated.length === 0) {
    logger.warn("evolution_no_output", { message: "OpenAI returned no valid variants" });
    return;
  }

  await persistVariants(generated);
  logger.info("evolution_complete", { typesEvolved: generated.length });
}

// ---------------------------------------------------------------------------
// Load active evolved variants for a given content type (used by contentGenerator)
// ---------------------------------------------------------------------------
export async function loadEvolvedVariants(
  contentType: SocialContentType,
): Promise<Record<string, string> | null> {
  const rows = await (await getDb())
    .select({ abGroup: evolvedCopyVariants.abGroup, copyText: evolvedCopyVariants.copyText })
    .from(evolvedCopyVariants)
    .where(
      and(
        eq(evolvedCopyVariants.contentType, contentType as any),
        eq(evolvedCopyVariants.isActive, true),
      ),
    );

  if (rows.length < 3) return null; // Incomplete set — fall back to hardcoded

  return Object.fromEntries(rows.map(r => [r.abGroup, r.copyText]));
}
