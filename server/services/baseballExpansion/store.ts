/**
 * Insert-once original id membership. Not used by the held-prep gate.
 * A later list with the same count and different ids is rejected.
 * Player names and source URLs are not stored.
 */
import { createHash } from "crypto";
import { pool } from "../../db";
import { canonicalMembership, membershipMatches, sourceWitness } from "./identity";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

export function submissionBody(input: { cardIds: string[]; sources: { id: string; sourceUrl: string }[] }) {
  const membership = canonicalMembership(input.cardIds);
  return {
    ...membership,
    maskVersion: CURRENT_MASK_VERSION,
    sourceWitness: sourceWitness(input.sources, CURRENT_MASK_VERSION),
  };
}

type Winner = { manifest_sha256: string; card_ids: string[]; source_witness: string; mask_version: string };

function compareWinner(winner: Winner, body: { ids: string[]; hash: string; sourceWitness: string; maskVersion: string }):
  { stored: true; unchanged: boolean } | { stored: false; code: "membership_mismatch" | "witness_changed" } {
  const storedIds = Array.isArray(winner.card_ids) ? winner.card_ids : [];
  const sameIds = membershipMatches({ ids: storedIds, hash: winner.manifest_sha256 }, { ids: body.ids, hash: body.hash });
  if (!sameIds) return { stored: false, code: "membership_mismatch" };
  const sameWitness = winner.source_witness === body.sourceWitness && winner.mask_version === body.maskVersion;
  if (!sameWitness) return { stored: false, code: "witness_changed" };
  return { stored: true, unchanged: true };
}

export async function recordOriginalMembership(input: {
  setId: string;
  slug: string;
  cardIds: string[];
  sources: { id: string; sourceUrl: string }[];
}): Promise<{ stored: true; unchanged: boolean } | { stored: false; code: "membership_mismatch" | "witness_changed" | "foreign_card" }> {
  const body = submissionBody(input);
  if (body.ids.length === 0) return { stored: false, code: "foreign_card" };
  const owned = await pool.query<{ id: string }>(
    "SELECT id FROM playable_cards WHERE game_set_id = $1 AND lower(id) = ANY($2::text[])",
    [input.setId, body.ids],
  );
  const have = new Set((owned.rows ?? []).map((row) => row.id.toLowerCase()));
  if (body.ids.some((id) => !have.has(id))) return { stored: false, code: "foreign_card" };
  const inserted = await pool.query(
    `INSERT INTO design_pool_submissions
      (set_id, slug, original_count, manifest_sha256, card_ids, mask_version, source_witness)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (set_id) DO NOTHING
     RETURNING set_id`,
    [input.setId, input.slug, body.count, body.hash, JSON.stringify(body.ids), body.maskVersion, body.sourceWitness],
  );
  const winner = await pool.query<Winner>(
    "SELECT manifest_sha256, card_ids, source_witness, mask_version FROM design_pool_submissions WHERE set_id = $1",
    [input.setId],
  );
  const row = winner.rows[0];
  if (!row) return { stored: false, code: "membership_mismatch" };
  const verdict = compareWinner(row, body);
  if (!verdict.stored) return verdict;
  return { stored: true, unchanged: (inserted.rowCount ?? 0) === 0 };
}

export function witnessDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
