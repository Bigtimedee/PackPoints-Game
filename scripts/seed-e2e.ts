/**
 * E2E seed script — inserts the minimum data required for Playwright tests.
 *
 * Idempotent: safe to run multiple times. Checks before inserting.
 *
 * What it creates:
 *   - 2 game sets (set A and set B)
 *   - 15 playable_cards per set (30 total)
 *   - card_image_cache rows (status "ok") so the match engine skips live URL fetches
 *
 * Run: NODE_ENV=development tsx --env-file .env scripts/seed-e2e.ts
 */

import { db } from "../server/db.js";
import { gameSets, playableCards } from "@shared/schema";
import { eq, inArray, count } from "drizzle-orm";
import { sql } from "drizzle-orm";

// Use a host in ALLOWED_IMAGE_HOSTS so URL-pattern checks pass.
// The URL does not need to be reachable — if fetch fails, analyzeCardImageContent
// returns { isPlaceholder: false } which does NOT block card selection.
const IMAGE_URL = "https://i.ebayimg.com/images/g/e2e-test-card/s-l400.jpg";

const PLAYERS = [
  "Babe Ruth", "Hank Aaron", "Willie Mays", "Ted Williams", "Joe DiMaggio",
  "Mickey Mantle", "Lou Gehrig", "Stan Musial", "Sandy Koufax", "Bob Gibson",
  "Cal Ripken Jr.", "Roberto Clemente", "Ernie Banks", "Mike Schmidt", "Johnny Bench",
];

async function seed() {
  console.log("[SeedE2E] Starting...");

  // --- Game Sets ---
  const [existingA] = await db
    .select()
    .from(gameSets)
    .where(eq(gameSets.setName, "E2E Test Set A"))
    .limit(1);

  const [existingB] = await db
    .select()
    .from(gameSets)
    .where(eq(gameSets.setName, "E2E Test Set B"))
    .limit(1);

  let setA = existingA;
  let setB = existingB;

  if (!setA) {
    [setA] = await db
      .insert(gameSets)
      .values({
        sport: "Baseball",
        brand: "E2E",
        year: 2024,
        setName: "E2E Test Set A",
        isActive: true,
      })
      .returning();
    console.log("[SeedE2E] Created Set A:", setA.id);
  } else {
    console.log("[SeedE2E] Set A already exists:", setA.id);
  }

  if (!setB) {
    [setB] = await db
      .insert(gameSets)
      .values({
        sport: "Baseball",
        brand: "E2E",
        year: 2024,
        setName: "E2E Test Set B",
        isActive: true,
      })
      .returning();
    console.log("[SeedE2E] Created Set B:", setB.id);
  } else {
    console.log("[SeedE2E] Set B already exists:", setB.id);
  }

  // --- Playable Cards ---
  for (const [setRef, setLabel] of [[setA, "A"], [setB, "B"]] as const) {
    const [{ value: existingCount }] = await db
      .select({ value: count() })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setRef.id));

    if (existingCount < 15) {
      const toInsert = PLAYERS.map((player, i) => ({
        gameSetId: setRef.id,
        cardhedgeCardId: `e2e-set-${setLabel.toLowerCase()}-${i}`,
        player,
        set: `E2E Set ${setLabel}`,
        number: String(i + 1),
        imageUrl: IMAGE_URL,
        isPlayable: true,
        quarantineStatus: "OK" as const,
        description: `${player} card`,
      }));

      await db.insert(playableCards).values(toInsert).onConflictDoNothing();
      console.log(`[SeedE2E] Inserted ${toInsert.length} cards for Set ${setLabel}`);
    } else {
      console.log(`[SeedE2E] Set ${setLabel} already has ${existingCount} cards`);
    }

    // Pre-seed card_image_cache so match engine does NOT make live HTTP requests.
    // getOrValidateCardImage checks this table first and returns early on "ok".
    const allCards = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(eq(playableCards.gameSetId, setRef.id));

    for (const { id } of allCards) {
      await db.execute(sql`
        INSERT INTO card_image_cache (card_id, source_url, normalized_url, proxied_path, status, last_checked_at)
        VALUES (${id}, ${IMAGE_URL}, ${IMAGE_URL}, ${`/api/images/card/${id}`}, 'ok', NOW())
        ON CONFLICT (card_id) DO NOTHING
      `);
    }
    console.log(`[SeedE2E] Ensured card_image_cache for ${allCards.length} cards in Set ${setLabel}`);
  }

  console.log("[SeedE2E] Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[SeedE2E] Failed:", err);
  process.exit(1);
});
