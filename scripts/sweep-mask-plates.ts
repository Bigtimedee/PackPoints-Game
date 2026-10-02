/**
 * Re-evaluate every playable card in every active integrated set.
 * Flags scans whose aspect or size sits away from that set's median, and
 * prints pass/fail counts per set. Report only: it does not bake a cache
 * file and it does not change playable rows.
 *
 *   npm run mask:sweep
 *   npm run mask:sweep -- --expect pairs.json
 *
 * `--expect` reads a JSON array of `{ cardId, leak }` and checks those cards
 * by id, including cards the deal filter already dropped. `leak` means the
 * surname was read outside the mask (`name_visible_outside_mask`). The process
 * exits 1 when any pair does not match. The full set sweep stays the default
 * when `--expect` is absent.
 *
 * DATABASE_URL must point at the database the app deals from (Railway Postgres
 * in production). 1989 Fleer Basketball is a 168-card checklist; its row is
 * printed with the other sets.
 */
import { readFileSync } from "fs";
import { and, eq, inArray } from "drizzle-orm";
import { gameSets, playableCards } from "@shared/schema";
import { db, pool } from "../server/db";
import { eligibleDealFilter } from "../server/services/playableSetEligibility";
import { buildSetMaskHint } from "@shared/maskGeometry";
import { FLEER_1989_BASKETBALL_CARDS, compareExpectedLeaks, evaluateCardBuffer, parseExpectedLeaks, reportMaskSweep, type SweepCardResult } from "../server/masking/maskPlateSweep";

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

function expectPathFromArgv(argv: string[]): string | null {
  const index = argv.indexOf("--expect");
  if (index === -1) return null;
  const file = argv[index + 1];
  if (!file || file.startsWith("-")) {
    throw new Error("--expect needs a JSON file of { cardId, leak } pairs");
  }
  return file;
}

async function runExpectList(file: string): Promise<void> {
  const pairs = parseExpectedLeaks(readFileSync(file, "utf8"));
  const ids = [...new Set(pairs.map((pair) => pair.cardId))];
  const cards = ids.length === 0 ? [] : await db
    .select({
      id: playableCards.id,
      player: playableCards.player,
      imageUrl: playableCards.imageUrl,
      setName: playableCards.set,
      category: playableCards.category,
      gameSetId: playableCards.gameSetId,
      sport: gameSets.sport,
      brand: gameSets.brand,
      year: gameSets.year,
      catalogName: gameSets.setName,
    })
    .from(playableCards)
    .innerJoin(gameSets, eq(playableCards.gameSetId, gameSets.id))
    .where(inArray(playableCards.id, ids));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const evaluated: SweepCardResult[] = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (!card) continue;
    const buffer = card.imageUrl ? await download(card.imageUrl) : null;
    if (!buffer) {
      evaluated.push({ id: card.id, width: 0, height: 0, pass: false, reason: "image_unreadable" });
      continue;
    }
    const hint = buildSetMaskHint({
      year: card.year,
      brand: card.brand,
      sport: card.sport,
      setName: card.setName || card.catalogName,
      category: card.category,
    });
    evaluated.push(await evaluateCardBuffer({
      id: card.id,
      buffer,
      playerName: card.player || "",
      setHint: hint,
      gameSetId: card.gameSetId,
    }));
  }
  const rows = compareExpectedLeaks(pairs, evaluated);
  const mismatches = rows.filter((row) => !row.match);
  console.log(JSON.stringify({
    mode: "expect",
    checked: rows.length,
    mismatches: mismatches.length,
    rows,
  }, null, 2));
  if (mismatches.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const expectFile = expectPathFromArgv(process.argv.slice(2));
  if (expectFile) {
    await runExpectList(expectFile);
    return;
  }

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
      nameVisibleOutsideMask: row.nameVisibleOutsideMask,
      layoutDisagreed: row.layoutDisagreed,
      exclusionsByReason: row.exclusionsByReason,
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
