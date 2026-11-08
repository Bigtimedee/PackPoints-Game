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

export async function recordOriginalMembership(input: {
  setId: string;
  slug: string;
  cardIds: string[];
  sources: { id: string; sourceUrl: string }[];
}): Promise<{ stored: true; unchanged: boolean } | { stored: false; code: "membership_mismatch" }> {
  const body = submissionBody(input);
  const existing = await pool.query<{ manifest_sha256: string; card_ids: string[] }>(
    "SELECT manifest_sha256, card_ids FROM design_pool_submissions WHERE set_id = $1",
    [input.setId],
  );
  const row = existing.rows[0];
  if (row) {
    const storedIds = Array.isArray(row.card_ids) ? row.card_ids : [];
    const same = membershipMatches(
      { ids: storedIds, hash: row.manifest_sha256 },
      { ids: body.ids, hash: body.hash },
    );
    if (!same) return { stored: false, code: "membership_mismatch" };
    return { stored: true, unchanged: true };
  }
  await pool.query(
    `INSERT INTO design_pool_submissions
      (set_id, slug, original_count, manifest_sha256, card_ids, mask_version, source_witness)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (set_id) DO NOTHING`,
    [input.setId, input.slug, body.count, body.hash, JSON.stringify(body.ids), body.maskVersion, body.sourceWitness],
  );
  return { stored: true, unchanged: false };
}

export function witnessDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
