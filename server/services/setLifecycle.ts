import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { pool, db } from '../db';
import { gameSets, playableCards } from '@shared/schema';
import { CURRENT_MASK_VERSION, buildSetMaskHint } from '@shared/maskGeometry';
import { getMaskProfile, type MaskProfile } from '../masking/maskProfiles';
import { lifecycleSet, replaceLifecycleRegistry } from './setLifecycleRegistry';
import { digest, identityKey, profileRevision, witnessKey, type SetIdentity, type CardWitness } from './setLifecycleCore';
import { MASKED_CARDS_DIR } from '../masking/maskPlanStore';
import { readMaskFailureReason } from '../masking/maskReadySidecar';
import { maskBandFailure } from '../masking/maskBandLimit';
import { clearNameVisibilityPassed, writeNameVisibilityPassed, verifyNameVisibleOutsideMask } from '../masking/nameOutsideMask';
import { bakeMaskedCardFromUrl, downloadMaskSource } from '../masking/maskingService';
import { eligibleDealFilter } from './playableSetEligibility';
import { invalidatePublicMaskSetCache } from './publicMaskGate';

export type ReviewRecord = { card_id: string; set_id: string; revision: string; witness: CardWitness; witness_key: string; request_id: string;
  status: string; source_hash: string | null; preview_hash: string | null; plan_hash: string | null; filename: string | null; reason: string | null; approved_by: string | null };
let managed = new Set<string>();
let approved: ReviewRecord[] = [];
/** Boot and every hold refresh read persistent state. There are no automatic legacy enrollments. */
export async function refreshLifecycleRegistry() {
  const [sets, reviews] = await Promise.all([
    pool.query('SELECT * FROM admin_set_lifecycles'),
    pool.query<ReviewRecord>("SELECT * FROM admin_set_card_reviews WHERE status='approved'"),
  ]);
  managed = new Set(sets.rows.map(row => row.set_id));
  approved = reviews.rows;
  replaceLifecycleRegistry(sets.rows.map(row => ({ setId: row.set_id, identity: row.identity, revision: row.revision, profile: row.profile, published: row.published })));
}
export function managedSetIds() { return [...managed]; }
/** Never trust DB ready flags alone: missing/changed JPEG or raw-byte witness fails closed. */
export function reviewFile(row: ReviewRecord): string | null {
  if (!row.filename || !/^[0-9a-f-]+_v[0-9.]+(?:_r(?:90|180|270))?\.jpg$/i.test(row.filename)) return null;
  const root = path.join(MASKED_CARDS_DIR, row.filename);
  try {
    if (readMaskFailureReason(row.card_id)) return null;
    if (!existsSync(path.join(MASKED_CARDS_DIR, `${row.card_id}_${CURRENT_MASK_VERSION}.ok`))) return null;
    const planBytes = readFileSync(path.join(MASKED_CARDS_DIR, `${row.card_id}_${CURRENT_MASK_VERSION}.json`));
    if (digest(planBytes) !== row.plan_hash) return null;
    const plan = JSON.parse(planBytes.toString());
    if (plan.maskVersion !== CURRENT_MASK_VERSION || !Array.isArray(plan.regions) || !plan.regions.length || maskBandFailure(plan.regions)) return null;
    if (digest(readFileSync(root)) !== row.preview_hash) return null;
    if (digest(readFileSync(path.join(MASKED_CARDS_DIR, `${row.card_id}_${CURRENT_MASK_VERSION}.lifecycle-source`))) !== row.source_hash) return null;
    return root;
  } catch { return null; }
}
export function managedReadyIds() { return approved.filter(row => lifecycleSet(row.set_id)?.revision === row.revision && reviewFile(row)).map(row => row.card_id); }
export async function findSet(setId: string) {
  const [row] = await db.select().from(gameSets).where(eq(gameSets.id, setId));
  return row;
}
export async function candidate(setId: string, cardId: string) {
  const [row] = await db.select().from(playableCards).where(and(eq(playableCards.gameSetId, setId), eq(playableCards.id, cardId),
    eligibleDealFilter('playable_cards', { ignoreHeldSets: true, ignoreCardReview: true }, true),
    sql`COALESCE(${playableCards.imageReviewStatus},'') NOT IN ('excluded','rejected','flagged')`,
    sql`${playableCards.proposedUnplayable}=false`, sql`${playableCards.quarantineStatus}='OK'`));
  return row;
}
export function cardWitness(row: typeof playableCards.$inferSelect): CardWitness {
  return { cardId: row.id, setId: row.gameSetId!, player: row.player || '', number: row.number,
    imageUrl: row.imageUrl || '', imageRotation: row.imageRotation ?? 0 };
}
export async function configureLifecycle(setId: string, identity: SetIdentity, profile: MaskProfile, actor: string) {
  const revision = profileRevision(identity, profile);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO admin_set_lifecycles(set_id,identity,profile,revision,updated_by) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(set_id) DO UPDATE SET identity=EXCLUDED.identity,profile=EXCLUDED.profile,revision=EXCLUDED.revision,
    published=CASE WHEN admin_set_lifecycles.revision=EXCLUDED.revision THEN admin_set_lifecycles.published ELSE false END,
    updated_by=EXCLUDED.updated_by,updated_at=now()`, [setId, identityKey(identity), JSON.stringify(profile), revision, actor]);
    // Upsert acquires the lifecycle row lock shared by preparation/publication.
    const busy = await client.query("SELECT 1 FROM admin_set_card_reviews WHERE set_id=$1 AND status IN ('pending','processing') LIMIT 1", [setId]);
    if (busy.rowCount) throw new Error('Preparation still in progress; wait before changing the layout');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  await refreshLifecycleRegistry(); invalidatePublicMaskSetCache(setId);
  return revision;
}
export async function requestPreparation(setId: string, requestId: string, cardIds: string[], excludedIds: string[] = []) {
  const inputHash = digest(JSON.stringify([setId, [...cardIds].sort(), [...excludedIds].sort()]));
  const prior = (await pool.query('SELECT * FROM admin_set_preparation_jobs WHERE request_id=$1', [requestId])).rows[0];
  if (prior) {
    if (prior.set_id !== setId || prior.input_hash !== inputHash) throw new Error('Request already used with different inputs');
    return;
  }
  const set = await findSet(setId); const lifecycle = lifecycleSet(setId);
  if (!set || !lifecycle?.profile || lifecycle.identity !== identityKey(set)) throw new Error('Save current set layout before preparing');
  // Entire explicit batch is validated before insertion; no partial acceptance or implicit all.
  const witnesses = await Promise.all(cardIds.map(async id => {
    const row = await candidate(setId, id);
    if (!row) throw new Error(`Card ${id} is excluded, unverified, quarantined or no longer eligible`);
    return cardWitness(row);
  }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_id FROM admin_set_lifecycles WHERE set_id=$1 FOR UPDATE', [setId]);
    const [fresh] = (await client.query('SELECT revision FROM admin_set_lifecycles WHERE set_id=$1', [setId])).rows;
    if (fresh.revision !== lifecycle.revision) throw new Error('Layout changed; refresh before retry');
    const raced = (await client.query('SELECT * FROM admin_set_preparation_jobs WHERE request_id=$1', [requestId])).rows[0];
    if (raced) { if (raced.input_hash !== inputHash || raced.set_id !== setId) throw new Error('Request already used'); await client.query('COMMIT'); return; }
    const results: Record<string, { status: string; reason?: string }> = Object.fromEntries(excludedIds.map(id => [id, {status:'excluded', reason:'Not eligible at request time'}]));
    const pending = await client.query("SELECT card_id FROM admin_set_card_reviews WHERE set_id=$1 AND status IN ('pending','processing') AND request_id<>$2", [setId, requestId]);
    if (pending.rowCount) throw new Error('Preparation still in progress; refresh instead of starting another batch');
    for (const witness of witnesses) {
      const key = witnessKey(witness, lifecycle.revision);
      const [existing] = (await client.query<ReviewRecord>('SELECT * FROM admin_set_card_reviews WHERE card_id=$1', [witness.cardId])).rows;
      results[witness.cardId] = { status: 'pending' };
      if (existing?.request_id === requestId) {
        if (existing.witness_key !== key) throw new Error('Request identity changed; use a new request after refresh');
        continue;
      }
      if (existing && ['ready','approved'].includes(existing.status) && existing.witness_key === key && reviewFile(existing)) { results[witness.cardId] = {status:existing.status}; continue; }
      await client.query(`INSERT INTO admin_set_card_reviews(card_id,set_id,revision,witness,witness_key,request_id,status)
        VALUES($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT(card_id) DO UPDATE SET revision=EXCLUDED.revision,witness=EXCLUDED.witness,
        witness_key=EXCLUDED.witness_key,request_id=EXCLUDED.request_id,status='pending',reason=NULL,source_hash=NULL,preview_hash=NULL,
        filename=NULL,plan_hash=NULL,approved_by=NULL,approved_at=NULL,lease_until=NULL,updated_at=now()`,
        [witness.cardId, setId, lifecycle.revision, JSON.stringify(witness), key, requestId]);
    }
    await client.query('INSERT INTO admin_set_preparation_jobs(request_id,set_id,revision,input_hash,results) VALUES($1,$2,$3,$4,$5)', [requestId,setId,lifecycle.revision,inputHash,JSON.stringify(results)]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

let ticking = false;
/** One leased card at a time. Advisory lock lives on a dedicated connection across the bake.
 * A crash releases the lock. Expired leases recheck all flags and current input before rebaking;
 * never restores quarantine/review flags. A failed checkpoint leaves processing, not false success.
 */
export async function tickLifecycleQueue() {
  if (ticking) return; ticking = true;
  let client;
  try { client = await pool.connect(); } catch (error) { ticking = false; throw error; }
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('admin-set-lifecycle-worker')) AS acquired")).rows[0].acquired;
    if (!locked) return;
    await refreshLifecycleRegistry();
    const [job] = (await client.query<ReviewRecord>(`UPDATE admin_set_card_reviews SET status='processing',lease_until=now()+interval '20 minutes',updated_at=now()
      WHERE card_id=(SELECT card_id FROM admin_set_card_reviews WHERE status='pending' OR (status='processing' AND lease_until<now())
      ORDER BY updated_at,card_id LIMIT 1) RETURNING *`)).rows;
    if (!job) return;
    let filename: string | null = null; let sourceHash: string | null = null; let previewHash: string | null = null; let planHash: string | null = null; let reason: string | null = null;
    try {
      const set = await findSet(job.set_id); const lifecycle = lifecycleSet(job.set_id);
      const card = await candidate(job.set_id, job.card_id);
      if (!set || !lifecycle || !card || lifecycle.revision !== job.revision || lifecycle.identity !== identityKey(set)
        || witnessKey(cardWitness(card), job.revision) !== job.witness_key) throw new Error('candidate_changed');
      if (readMaskFailureReason(job.card_id)) throw new Error('existing_mask_refusal');
      const source = await downloadMaskSource(job.witness.imageUrl, job.card_id);
      if (!source) throw new Error('source_unavailable');
      sourceHash = digest(source);
      // Refusal is deliberately NOT cleared; retry cannot undo an exclusion.
      filename = await bakeMaskedCardFromUrl({ cardId: job.card_id, gameSetId: job.set_id, imageUrl: job.witness.imageUrl,
        playerName: job.witness.player, imageRotation: job.witness.imageRotation, setHint: buildSetMaskHint(set), sourceBuffer: source, deferNameVisibility: true }, 'warm');
      if (!filename) throw new Error(readMaskFailureReason(job.card_id) || 'mask_refused');
      const preview = readFileSync(path.join(MASKED_CARDS_DIR, filename));
      const planBytes = readFileSync(path.join(MASKED_CARDS_DIR, `${job.card_id}_${CURRENT_MASK_VERSION}.json`));
      const plan = JSON.parse(planBytes.toString());
      planHash = digest(planBytes);
      if (maskBandFailure(plan.regions)) throw new Error('mask_band_invalid');
      clearNameVisibilityPassed(job.card_id);
      const verdict = await verifyNameVisibleOutsideMask({ buffer: preview, playerName: job.witness.player, regions: plan.regions });
      if (verdict.skipped || !verdict.ok) throw new Error(verdict.skipped ? 'name_check_timeout' : 'name_visible_outside_mask');
      const latest = await candidate(job.set_id, job.card_id);
      const current = (await client.query('SELECT revision FROM admin_set_lifecycles WHERE set_id=$1', [job.set_id])).rows[0];
      if (!latest || current?.revision !== job.revision || witnessKey(cardWitness(latest), job.revision) !== job.witness_key) throw new Error('candidate_changed');
      previewHash = digest(preview);
      writeNameVisibilityPassed(job.card_id);
      mkdirSync(MASKED_CARDS_DIR, { recursive: true });
      writeFileSync(path.join(MASKED_CARDS_DIR, `${job.card_id}_${CURRENT_MASK_VERSION}.lifecycle-source`), source);
    } catch (error) { reason = error instanceof Error ? error.message.slice(0,240) : 'preparation_error'; }
    await client.query('BEGIN');
    const checkpoint = await client.query(`UPDATE admin_set_card_reviews SET status=$2,reason=$3,filename=$4,source_hash=$5,preview_hash=$6,plan_hash=$8,lease_until=NULL,updated_at=now()
      WHERE card_id=$1 AND request_id=$7 AND status='processing'`, [job.card_id, reason ? 'error' : 'ready', reason, filename, sourceHash, previewHash, job.request_id, planHash]);
    if (checkpoint.rowCount) await client.query(`UPDATE admin_set_preparation_jobs SET results=jsonb_set(results,ARRAY[$2]::text[],$3::jsonb) WHERE request_id=$1`, [job.request_id, job.card_id, JSON.stringify({status:reason ? 'error' : 'ready', ...(reason ? {reason} : {})})]);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('admin-set-lifecycle-worker'))").catch(() => undefined);
    client.release(); ticking = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startLifecycleWorker() {
  if (timer) return;
  const tick = () => { void tickLifecycleQueue().catch(error => console.error('[SetLifecycle] Worker stopped this tick', error)); };
  timer = setInterval(tick, 3000); timer.unref(); tick();
}
export async function lifecycleCardAllowed(cardId: string): Promise<boolean> {
  const result = await pool.query<ReviewRecord>(`SELECT ar.* FROM admin_set_card_reviews ar JOIN admin_set_lifecycles asl ON asl.set_id=ar.set_id
    JOIN playable_cards pc ON pc.id=ar.card_id JOIN game_sets gs ON gs.id=pc.game_set_id
    WHERE pc.id=$1 AND ar.status='approved' AND asl.published AND asl.revision=ar.revision
    AND ar.witness->>'imageUrl'=pc.image_url AND ar.witness->>'player'=pc.player
    AND COALESCE(ar.witness->>'number','')=COALESCE(pc.number,'') AND (ar.witness->>'imageRotation')::int=COALESCE(pc.image_rotation,0)
    AND gs.is_active AND NOT gs.is_user_created AND asl.identity::jsonb=jsonb_build_array(gs.year,gs.brand,gs.sport,gs.set_name)
    AND pc.is_playable AND COALESCE(pc.content_verified,true) AND pc.quarantine_status='OK' AND NOT pc.proposed_unplayable
    AND COALESCE(pc.image_review_status,'') NOT IN ('excluded','rejected','flagged')`, [cardId]);
  const row = result.rows[0];
  if (!row || !reviewFile(row)) return false;
  const card = await candidate(row.set_id,cardId);
  return Boolean(card && witnessKey(cardWitness(card),row.revision)===row.witness_key);
}
