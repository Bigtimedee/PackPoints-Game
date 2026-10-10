import type { Express, Request, Response, NextFunction } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { gameSets, playableCards } from '@shared/schema';
import { buildSetMaskHint, CURRENT_MASK_VERSION } from '@shared/maskGeometry';
import { db, pool } from '../db';
import { isAuthenticated } from '../auth';
import { requireAdmin } from '../auth/requireAdmin';
import { isClearedSetId, isDesignApprovedSetId, refreshHeldSets } from '../config/heldSets';
import { publishGateError, refreshDesignApprovals } from '../services/setDesignApproval';
import { TOPPS_1988_SET_ID } from '../masking/topps1988Geometry';
import { getMaskProfile } from '../masking/maskProfiles';
import { MASKED_CARDS_DIR } from '../masking/maskPlanStore';
import { customBandProfile, identityKey, validRequestId, witnessKey, reviewMatches, digest, validHash } from '../services/setLifecycleCore';
import { lifecycleSet } from '../services/setLifecycleRegistry';
import { eligibleDealFilter } from '../services/playableSetEligibility';
import { candidate, cardWitness, configureLifecycle, findSet, managedReadyIds, refreshLifecycleRegistry, requestPreparation,
  reviewFile, inspectReviewFile, startLifecycleWorker, type ReviewRecord } from '../services/setLifecycle';
import { invalidatePublicMaskSetCache } from '../services/publicMaskGate';

const actor = (req: Request) => (req.user as any)?.claims?.sub || (req.session as any)?.localUserId;
const asyncRoute = (fn: (req:Request,res:Response)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => { void fn(req,res).catch(next); };
async function currentReview(setId: string, cardId: string) {
  const [row] = (await pool.query<ReviewRecord>('SELECT * FROM admin_set_card_reviews WHERE set_id=$1 AND card_id=$2', [setId,cardId])).rows;
  const card = await candidate(setId,cardId); const lifecycle = lifecycleSet(setId); const set = await findSet(setId);
  if (!row || !card || !set || !lifecycle || lifecycle.identity!==identityKey(set) || lifecycle.revision!==row.revision
    || witnessKey(cardWitness(card),row.revision)!==row.witness_key || !['ready','approved'].includes(row.status) || !reviewFile(row)) return null;
  return row;
}
export function registerAdminSetLifecycleRoutes(app: Express, options: { startWorker?: boolean } = {}) {
  const base='/api/admin/set-lifecycle/:setId';
  // Register BEFORE the existing common middleware: the diagnostic does not
  // refresh/mutate the lifecycle registry or any process-local mask cache.
  app.get(`${base}/artifact-diagnostic/:cardId`,(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();},
    isAuthenticated,requireAdmin,asyncRoute(async(req,res)=> {
      const {setId,cardId}=req.params;
      if(!validRequestId(setId)||!validRequestId(cardId)||Object.keys(req.query).length){res.status(400).json({error:'Exact set/card UUIDs required; query options are not supported'});return;}
      if(isClearedSetId(setId)||setId===TOPPS_1988_SET_ID){res.status(409).json({error:'This release uses its protected review workflow'});return;}
      try {
        const set=await findSet(setId);if(!set){res.status(404).json({error:'Set not found'});return;}
        // Ownership only: do not hide excluded/unplayable cards behind candidate().
        const [card]=await db.select({id:playableCards.id,gameSetId:playableCards.gameSetId,player:playableCards.player,
          number:playableCards.number,imageUrl:playableCards.imageUrl,imageRotation:playableCards.imageRotation})
          .from(playableCards).where(and(eq(playableCards.gameSetId,setId),eq(playableCards.id,cardId))).limit(1);
        if(!card){res.status(404).json({error:'Card not found in this set'});return;}
        const [lifecycle]=(await pool.query('SELECT revision,identity FROM admin_set_lifecycles WHERE set_id=$1 LIMIT 1',[setId])).rows;
        const [row]=(await pool.query<ReviewRecord>('SELECT card_id,set_id,status,revision,witness_key,filename,plan_hash,preview_hash,source_hash FROM admin_set_card_reviews WHERE set_id=$1 AND card_id=$2 LIMIT 1',[setId,cardId])).rows;
        if(!row){res.status(404).json({error:'No saved review for this card'});return;}
        const witness={cardId:card.id,setId:set.id,player:card.player||'',number:card.number,imageUrl:card.imageUrl||'',imageRotation:card.imageRotation??0};
        const fileCheck=inspectReviewFile(row,true);
        const sha=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{7,40}$/i.test(v)?v:null;
        res.json({setId,cardId,readAt:new Date().toISOString(),
          runtime:{cwd:process.cwd(),artifactRoot:MASKED_CARDS_DIR,maskVersion:CURRENT_MASK_VERSION,
            buildCommit:sha(process.env.BUILD_COMMIT_SHA),deploymentCommit:sha(process.env.RAILWAY_GIT_COMMIT_SHA)},
          review:{status:typeof row.status==='string'&&/^[a-z_]{1,64}$/.test(row.status)?row.status:'malformed_status_redacted',
            revision:validHash(row.revision)?row.revision:null,currentRevision:validHash(lifecycle?.revision)?lifecycle.revision:null,
            revisionMatches:!!lifecycle&&row.revision===lifecycle.revision,identityMatches:!!lifecycle&&lifecycle.identity===identityKey(set),
            storedWitnessKey:validHash(row.witness_key)?row.witness_key:null,
            computedWitnessKey:witnessKey(witness,row.revision),witnessMatches:witnessKey(witness,row.revision)===row.witness_key},
          artifacts:{valid:fileCheck.valid,category:fileCheck.category,checks:fileCheck.checks,refusalObservation:fileCheck.refusalObservation},
          scope:'Read-only, first-failure snapshot; later files are not checked. Not an approval or release decision.'});
      }catch {res.status(500).json({error:'Artifact diagnostic unavailable; no changes were made'});}
    }));
  app.use(base,isAuthenticated,requireAdmin,(req,res,next)=> {
    res.setHeader('Cache-Control','private, no-store');
    if (!validRequestId(req.params.setId)) { res.status(400).json({error:'Invalid set'}); return; }
    if (isClearedSetId(req.params.setId) || req.params.setId===TOPPS_1988_SET_ID) {
      res.status(409).json({error:'This existing release uses its current protected review workflow. Self-service is for new sets.'}); return;
    }
    void refreshLifecycleRegistry().then(()=>next()).catch(next);
  });
  app.get(base,asyncRoute(async(req,res)=> {
    const set = await findSet(req.params.setId); if (!set) {res.status(404).json({error:'Set not found'});return;}
    const lifecycle=lifecycleSet(set.id);
    const cards=await db.select({id:playableCards.id,player:playableCards.player,number:playableCards.number,imageUrl:playableCards.imageUrl,imageRotation:playableCards.imageRotation,isPlayable:playableCards.isPlayable,
      imageReviewStatus:playableCards.imageReviewStatus,quarantineStatus:playableCards.quarantineStatus,proposedUnplayable:playableCards.proposedUnplayable})
      .from(playableCards).where(eq(playableCards.gameSetId,set.id));
    const eligible=await db.select({id:playableCards.id}).from(playableCards).where(and(eq(playableCards.gameSetId,set.id),
      eligibleDealFilter('playable_cards',{ignoreHeldSets:true,ignoreCardReview:true},true)));
    const eligibleIds=new Set(eligible.map(c=>c.id));
    const reviews=(await pool.query<ReviewRecord>('SELECT * FROM admin_set_card_reviews WHERE set_id=$1',[set.id])).rows;
    const byId=new Map(reviews.map(r=>[r.card_id,r]));
    const jobs=(await pool.query('SELECT * FROM admin_set_preparation_jobs WHERE set_id=$1 ORDER BY created_at DESC LIMIT 5',[set.id])).rows;
    const registered=getMaskProfile(buildSetMaskHint(set));
    const rows=cards.map(card=> {
      const row=byId.get(card.id); const guarded=eligibleIds.has(card.id)&&card.quarantineStatus==='OK'&&!card.proposedUnplayable
        && !['excluded','rejected','flagged'].includes(card.imageReviewStatus||'');
      const current=row&&row.revision===lifecycle?.revision&&witnessKey({cardId:card.id,setId:set.id,player:card.player||'',number:card.number,imageUrl:card.imageUrl||'',imageRotation:card.imageRotation??0},row.revision)===row.witness_key;
      const status=!guarded?'excluded':!current?'unprepared':row.status;
      const available=current&&['ready','approved'].includes(status)&&reviewFile(row);
      return {...card,eligible:guarded,status:available?status:['ready','approved'].includes(status)?'stale':status,
        reason:row?.reason || (!guarded?'Card flags or normal deal filters exclude this card':null),
        challenge:available?{key:row.witness_key,sourceHash:row.source_hash,previewHash:row.preview_hash,planHash:row.plan_hash}:null,
        previewUrl:available?`${base.replace(':setId',set.id)}/preview/${card.id}?hash=${row.preview_hash}`:null,
        sourceUrl:available?`${base.replace(':setId',set.id)}/source/${card.id}?hash=${row.source_hash}`:null};
    });
    const counts:Record<string,number>={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
    res.json({set,lifecycle,registeredProfile:registered.matched?registered:null,cards:rows,counts,jobs,
      note:'Prepare every eligible imported card, inspect each source/mask pair, approve, then publish. Excluded/error cards never enter the playable pool.'});
  }));
  app.post(`${base}/layout`,asyncRoute(async(req,res)=> {
    const set=await findSet(req.params.setId);
    if (!set || set.isUserCreated) {res.status(422).json({error:'Only integrated sets can use this workflow'});return;}
    const profile=req.body?.mode==='registered'?getMaskProfile(buildSetMaskHint(set)):customBandProfile(req.body);
    if (!profile?.matched) {res.status(422).json({error:'No registered layout. Author a top/bottom name band, or keep unsupported complex layouts held.'});return;}
    const busy=(await pool.query("SELECT 1 FROM admin_set_card_reviews WHERE set_id=$1 AND status IN ('pending','processing') LIMIT 1",[set.id])).rowCount;
    if(busy){res.status(409).json({error:'Wait for preparation to finish before changing the layout'});return;}
    await configureLifecycle(set.id,set,profile,actor(req));await refreshHeldSets();
    res.json({saved:true,revision:lifecycleSet(set.id)?.revision,published:lifecycleSet(set.id)?.published});
  }));
  app.post(`${base}/prepare`,asyncRoute(async(req,res)=> {
    const requestId=req.body?.requestId;
    if(!validRequestId(requestId)||req.body?.allEligible!==true){res.status(400).json({error:'Explicit allEligible=true and requestId are required'});return;}
    // Retries of an acknowledged request return the original snapshot even after source/flags change.
    const old=(await pool.query('SELECT * FROM admin_set_preparation_jobs WHERE request_id=$1',[requestId])).rows[0];
    if(old){if(old.set_id!==req.params.setId){res.status(409).json({error:'Request belongs to another set'});return;}res.json({accepted:true,job:old});return;}
    const all=await db.select().from(playableCards).where(eq(playableCards.gameSetId,req.params.setId));
    if(all.length>2500){res.status(422).json({error:'This set exceeds the supported 2,500-card preparation snapshot; no cards queued'});return;}
    const eligible=await db.select({id:playableCards.id}).from(playableCards).where(and(eq(playableCards.gameSetId,req.params.setId),
      eligibleDealFilter('playable_cards',{ignoreHeldSets:true,ignoreCardReview:true},true)));
    const ids=all.filter(c=>eligible.some(e=>e.id===c.id)&&c.quarantineStatus==='OK'&&!c.proposedUnplayable
      &&!['excluded','rejected','flagged'].includes(c.imageReviewStatus||'')).map(c=>c.id);
    if(!ids.length){res.status(422).json({error:'No eligible cards; import and review image issues first'});return;}
    try{await requestPreparation(req.params.setId,requestId,ids,all.filter(c=>!ids.includes(c.id)).map(c=>c.id));}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:'Preparation refused'});return;}
    res.status(202).json({accepted:true,requestId,queued:ids.length,excluded:all.length-ids.length});
  }));
  for(const kind of ['preview','source'] as const)app.get(`${base}/${kind}/:cardId`,asyncRoute(async(req,res)=> {
    if(!validRequestId(req.params.cardId)){res.status(400).end();return;}
    const row=await currentReview(req.params.setId,req.params.cardId);
    const expected=kind==='preview'?row?.preview_hash:row?.source_hash;
    if(!row||req.query.hash!==expected){res.status(409).json({error:'Preview changed; refresh and review again'});return;}
    res.setHeader('X-Content-Type-Options','nosniff');
    if(kind==='preview'){res.type('jpg').send(readFileSync(reviewFile(row)!));return;}
    // Display a raster copy of captured bytes, not an arbitrary source URL or SVG on our origin.
    const source=readFileSync(path.join(MASKED_CARDS_DIR,`${row.card_id}_${CURRENT_MASK_VERSION}.lifecycle-source`));
    if(digest(source)!==row.source_hash){res.status(409).end();return;}
    res.type('png').send(await sharp(source).rotate(row.witness.imageRotation).png().toBuffer());
  }));
  app.post(`${base}/approve/:cardId`,asyncRoute(async(req,res)=> {
    if(!validRequestId(req.params.cardId)||req.body?.sourceReviewed!==true||req.body?.maskReviewed!==true
      ||typeof req.body?.note!=='string'||req.body.note.trim().length<10){res.status(400).json({error:'Inspect source and mask, confirm both, and record a review note'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT set_id FROM admin_set_lifecycles WHERE set_id=$1 FOR UPDATE',[req.params.setId]);
      await client.query('SELECT id FROM playable_cards WHERE id=$1 AND game_set_id=$2 FOR UPDATE',[req.params.cardId,req.params.setId]);
      await refreshLifecycleRegistry();
      const row=await currentReview(req.params.setId,req.params.cardId);
      if(!row||!reviewMatches({key:row.witness_key,sourceHash:row.source_hash!,previewHash:row.preview_hash!},req.body?.challenge)
        ||req.body.challenge.planHash!==row.plan_hash){await client.query('ROLLBACK');res.status(409).json({error:'Card, source or mask changed; refresh and review again'});return;}
      await client.query("UPDATE admin_set_card_reviews SET status='approved',approved_by=$2,approved_at=now(),updated_at=now() WHERE card_id=$1",[row.card_id,actor(req)]);
      await client.query(`INSERT INTO card_review_approvals(card_id,game_set_id,source,approved_by,note) VALUES($1,$2,'qa',$3,$4)
        ON CONFLICT(card_id) DO UPDATE SET source='qa',approved_by=EXCLUDED.approved_by,note=EXCLUDED.note,approved_at=now()`,[row.card_id,row.set_id,actor(req),req.body.note.trim().slice(0,1000)]);
      await client.query('COMMIT');await refreshLifecycleRegistry();res.json({approved:true});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.post(`${base}/exclude/:cardId`,asyncRoute(async(req,res)=> {
    if(!validRequestId(req.params.cardId)||typeof req.body?.reason!=='string'||req.body.reason.trim().length<10){res.status(400).json({error:'A review reason is required'});return;}
    const client=await pool.connect();try{
      await client.query('BEGIN');await client.query('SELECT set_id FROM admin_set_lifecycles WHERE set_id=$1 FOR UPDATE',[req.params.setId]);
      const count=await client.query(`UPDATE playable_cards SET image_review_status='excluded',is_playable=false,proposed_unplayable=true,
        blocked_reason=COALESCE(blocked_reason,'admin_set_review_excluded') WHERE id=$1 AND game_set_id=$2`,[req.params.cardId,req.params.setId]);
      if(!count.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Card not found'});return;}
      await client.query("UPDATE admin_set_card_reviews SET status='excluded',reason=$3,approved_by=NULL,approved_at=NULL,lease_until=NULL,updated_at=now() WHERE card_id=$1 AND set_id=$2",[req.params.cardId,req.params.setId,req.body.reason.trim().slice(0,1000)]);
      await client.query('COMMIT');await refreshLifecycleRegistry();invalidatePublicMaskSetCache(req.params.setId);res.json({excluded:true});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.post(`${base}/publish`,asyncRoute(async(req,res)=> {
    if(req.body?.publish!==true){res.status(400).json({error:'Explicit publish=true required'});return;}
    const client=await pool.connect();try{
      await client.query('BEGIN');await client.query('SELECT set_id FROM admin_set_lifecycles WHERE set_id=$1 FOR UPDATE',[req.params.setId]);
      await client.query('SELECT id FROM playable_cards WHERE game_set_id=$1 FOR UPDATE',[req.params.setId]);
      await refreshLifecycleRegistry();const set=await findSet(req.params.setId);const lifecycle=lifecycleSet(req.params.setId);
      if(!set||!set.isActive||set.isUserCreated||!lifecycle||lifecycle.identity!==identityKey(set)){
        await client.query('ROLLBACK');res.status(409).json({error:'Set identity changed or inactive; save layout and review again'});return;
      }
      await refreshDesignApprovals();
      const gate=publishGateError({setId:set.id,designApproved:isDesignApprovedSetId(set.id),hasMaskProfile:!!lifecycle.profile});
      if(gate){await client.query('ROLLBACK');res.status(409).json({error:gate,code:'design_approval_required'});return;}
      const busy=(await client.query("SELECT 1 FROM admin_set_card_reviews WHERE set_id=$1 AND status IN ('pending','processing') LIMIT 1",[set.id])).rowCount;
      const cards=await db.select().from(playableCards).where(and(eq(playableCards.gameSetId,set.id),eligibleDealFilter('playable_cards',{ignoreHeldSets:true,ignoreCardReview:true},true)));
      const reviews=(await client.query<ReviewRecord>('SELECT * FROM admin_set_card_reviews WHERE set_id=$1',[set.id])).rows;
      const byId=new Map(reviews.map(r=>[r.card_id,r]));
      const publishable=cards.filter(card=> {
        const row=byId.get(card.id);return row&&row.status==='approved'&&row.revision===lifecycle.revision
          &&witnessKey(cardWitness(card),row.revision)===row.witness_key&&card.quarantineStatus==='OK'&&!card.proposedUnplayable
          &&!['excluded','rejected','flagged'].includes(card.imageReviewStatus||'')&&reviewFile(row);
      });
      // No automatic omission of unresolved cards. Every remaining eligible card must have current approval.
      if(busy||publishable.length<5||publishable.length!==cards.length){await client.query('ROLLBACK');res.status(409).json({error:`Publication blocked: ${publishable.length}/${cards.length} eligible cards have current approval; at least 5 and full eligible coverage required`});return;}
      await client.query('UPDATE admin_set_lifecycles SET published=true,updated_by=$2,updated_at=now() WHERE set_id=$1',[set.id,actor(req)]);
      await client.query('COMMIT');await refreshHeldSets();invalidatePublicMaskSetCache(set.id);
      res.json({published:true,playable:publishable.length});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.post(`${base}/withdraw`,asyncRoute(async(req,res)=> {
    await pool.query('UPDATE admin_set_lifecycles SET published=false,updated_by=$2,updated_at=now() WHERE set_id=$1',[req.params.setId,actor(req)]);
    await refreshHeldSets();invalidatePublicMaskSetCache(req.params.setId);res.json({published:false});
  }));
  app.use(base,(error:unknown,_req:Request,res:Response,_next:NextFunction)=> {
    console.error('[SetLifecycle] Admin action failed',error);if(!res.headersSent)res.status(500).json({error:'Action failed. Refresh to check saved state before retrying.'});
  });
  if(options.startWorker!==false)startLifecycleWorker();
}
