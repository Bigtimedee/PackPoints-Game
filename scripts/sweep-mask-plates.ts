/**
 * Re-evaluate every playable card in every active integrated set.
 * Flags scans whose aspect or size sits away from that set's median, and
 * prints pass/fail counts per set. Report only: it does not bake a cache
 * file and it does not change playable rows.
 *
 *   npm run mask:sweep
 *
 * DATABASE_URL must point at the database the app deals from (Railway Postgres
 * in production). 1989 Fleer Basketball is a 168-card checklist; its row is
 * printed with the other sets.
 */
import { and, eq } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db, pool } from "../server/db";
import { eligibleDealFilter } from "../server/services/playableSetEligibility";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { FLEER_1989_BASKETBALL_CARDS, evaluateCardBuffer, reportMaskSweep, type SweepCardResult } from "../server/masking/maskPlateSweep";

const FETCH_MS = 12_000;

async function download(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const sets = await db
    .select({
      id: gameSets.id,
      setName: gameSets.setName,
      sport: gameSets.sport,
      brand: gameSets.brand,
      year: gameSets.year,
    })
    .from(gameSets)
    .where(and(eq(gameSets.isActive, true), eq(gameSets.isUserCreated, false)));

  const reports: Array<{ setId: string; setName: string; cards: SweepCardResult[] }> = [];
  for (const set of sets) {
    const cards = await db
      .select({
        id: playableCards.id,
        player: playableCards.player,
        imageUrl: playableCards.imageUrl,
        setName: playableCards.set,
        category: playableCards.category,
      })
      .from(playableCards)
      .where(and(
        eq(playableCards.gameSetId, set.id),
        eligibleDealFilter("playable_cards"),
      ));
    const evaluated: SweepCardResult[] = [];
    for (const card of cards) {
      const buffer = card.imageUrl ? await download(card.imageUrl) : null;
      if (!buffer) {
        evaluated.push({ id: card.id, width: 0, height: 0, pass: false, reason: "image_unreadable" });
        continue;
      }
      const hint = buildSetMaskHint({
        year: set.year,
        brand: set.brand,
        sport: set.sport,
        setName: card.setName || set.setName,
        category: card.category,
      });
      evaluated.push(await evaluateCardBuffer({
        id: card.id,
        buffer,
        playerName: card.player || "",
        setHint: hint,
        gameSetId: set.id,
      }));
    }
    reports.push({ setId: set.id, setName: set.setName, cards: evaluated });
  }

  const summary = reportMaskSweep(reports);
  const fleer = summary.find((row) => /1989/i.test(row.setName) && /fleer/i.test(row.setName) && /basketball/i.test(row.setName));
  console.log(JSON.stringify({
    fleer1989Checklist: FLEER_1989_BASKETBALL_CARDS,
    fleer1989Playable: fleer?.cardCount ?? null,
    sets: summary.map((row) => ({
      setId: row.setId,
      setName: row.setName,
      cardCount: row.cardCount,
      pass: row.pass,
      fail: row.fail,
      outliers: row.outliers.length,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
