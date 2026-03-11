import { db } from "../../../db";
import { abTests } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../logger";
import type { SocialContentType } from "../contentGenerator";

const logger = createLogger("ABTestManager");

export interface ABTestAssignment {
  abTestId: string;
  abGroup: "A" | "B" | "C";
}

export async function getOrCreateAbTest(
  campaignId: string,
  contentType: SocialContentType,
): Promise<ABTestAssignment> {
  // Look for existing RUNNING test
  const existing = await db
    .select()
    .from(abTests)
    .where(
      and(
        eq(abTests.campaignId, campaignId),
        eq(abTests.contentType, contentType),
        eq(abTests.status, "RUNNING"),
      ),
    )
    .limit(1);

  let testId: string;

  if (existing.length > 0) {
    testId = existing[0].id;
  } else {
    // Create new test
    const inserted = await db
      .insert(abTests)
      .values({
        campaignId,
        contentType,
        testName: `${contentType}-${campaignId}-${Date.now()}`,
        hypothesis: `Variant A (data-led) vs Variant B (challenge-led) for ${contentType}`,
        variantADescription: "Data-led copy emphasizing stats and facts",
        variantBDescription: "Challenge-led copy emphasizing competition",
        status: "RUNNING",
      })
      .returning({ id: abTests.id });

    testId = inserted[0].id;
    logger.info("ab_test_created", { testId, campaignId, contentType });
  }

  // Assign group: day % 3 maps to A / B / C, matching contentGenerator logic
  const dayMod = new Date().getDate() % 3;
  const abGroup: "A" | "B" | "C" = dayMod === 0 ? "A" : dayMod === 1 ? "B" : "C";
  return { abTestId: testId, abGroup };
}
