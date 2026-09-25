/**
 * Read-only count of playable_cards rows that isNonPlayerCard would exclude.
 * Does not update or delete anything.
 *
 *   npx tsx --env-file .env scripts/count-non-player-cards.ts
 */
import pg from "pg";
import { isNonPlayerCard } from "../shared/nonPlayerCard.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
await client.connect();
try {
  const { rows } = await client.query<{ player: string | null; description: string | null }>(
    "SELECT player, description FROM playable_cards",
  );
  let nonPlayer = 0;
  const samples: string[] = [];
  for (const row of rows) {
    if (!isNonPlayerCard(row.player, row.description)) continue;
    nonPlayer += 1;
    if (samples.length < 20) samples.push(row.player || "(no player)");
  }
  console.log(JSON.stringify({
    total: rows.length,
    nonPlayer,
    samples,
  }, null, 2));
} finally {
  await client.end();
}
