import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import express from 'express';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { CURRENT_MASK_VERSION } from '@shared/maskGeometry';
import { customBandProfile, digest, identityKey, witnessKey, profileRevision, reviewMatches } from '../services/setLifecycleCore';
const fixture=vi.hoisted(()=>({ pg:null as any,db:null as any,dir:'',refusal:null as string|null,ocrSkip:false,bakes:0,admin:true,designApproved:true,queries:[] as string[],diagnosticDbError:false }));
vi.mock('../db',()=>({db:new Proxy({}, {get:(_t,p)=>(...args:any[])=>fixture.db[p](...args)}),pool:{
  query:async(text:string,values?:unknown[])=> {fixture.queries.push(text);if(fixture.diagnosticDbError&&text.startsWith('SELECT revision,identity'))throw new Error('DO_NOT_EXPOSE_DB_SECRET');const r=await fixture.pg.query(text,values);return {...r,rowCount:/^\s*SELECT/i.test(text)?r.rows.length:(r.affectedRows??r.rows.length)};},
  connect:async()=>({query:async(text:string,values?:unknown[])=>{if(text.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};if(text.includes('pg_advisory_unlock'))return {rows:[]};const r=await fixture.pg.query(text,values);return {...r,rowCount:/^\s*SELECT/i.test(text)?r.rows.length:(r.affectedRows??r.rows.length)};},release:()=>{}})
}}));
vi.mock('../auth',()=>({isAuthenticated:(req:any,res:any,next:any)=>{if(req.headers['x-fixture-user']){req.session={localUserId:'fixture-admin'};next();}else res.status(401).end();}}));
vi.mock('../storage',()=>({storage:{getUser:async()=>({isAdmin:fixture.admin})}}));
vi.mock('../masking/maskPlanStore',()=>({get MASKED_CARDS_DIR(){return fixture.dir;}}));
vi.mock('../masking/maskReadySidecar',()=>({readMaskFailureReason:()=>fixture.refusal}));
vi.mock('../masking/maskBandLimit',()=>({maskBandFailure:(r:any[])=>r.some(b=>b.hPct>55)?'mask_band_oversized':null,isMaskBandExcluded:()=>false}));
vi.mock('../masking/nameOutsideMask',()=>({clearNameVisibilityPassed:()=>{},writeNameVisibilityPassed:()=>{},verifyNameVisibleOutsideMask:async()=>({ok:true,skipped:fixture.ocrSkip,reason:fixture.ocrSkip?'timeout':null})}));
vi.mock('../masking/maskingService',()=>({downloadMaskSource:async()=>Buffer.from('captured-fixture-source'),bakeMaskedCardFromUrl:async(input:any)=>{
  fixture.bakes++; const name=`${input.cardId}_${CURRENT_MASK_VERSION}.jpg`;
  writeFileSync(path.join(fixture.dir,name),'fixture-masked-image');writeFileSync(path.join(fixture.dir,`${input.cardId}_${CURRENT_MASK_VERSION}.ok`),'ok');
  writeFileSync(path.join(fixture.dir,`${input.cardId}_${CURRENT_MASK_VERSION}.json`),JSON.stringify({maskVersion:CURRENT_MASK_VERSION,regions:[{xPct:0,yPct:84,wPct:100,hPct:16,type:'blur'}]}));return name;
}}));
// Isolate lifecycle behavior; canonical eligibility's own regression tests remain separate.
vi.mock('../services/playableSetEligibility',()=>({eligibleDealFilter:()=>sql`is_playable=true AND content_verified=true`}));
vi.mock('../services/publicMaskGate',()=>({invalidatePublicMaskSetCache:()=>{}}));
vi.mock('../config/heldSets',()=>({isClearedSetId:(id:string)=>id==='3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4',isDesignApprovedSetId:()=>fixture.designApproved,refreshHeldSets:async()=>{}}));
vi.mock('../services/setDesignApproval',async(orig)=>({...await orig<any>(),refreshDesignApprovals:async()=>{}}));
import { lifecycleSet, replaceLifecycleRegistry } from '../services/setLifecycleRegistry';
import { registerAdminSetLifecycleRoutes } from '../routes/adminSetLifecycle';
import { configureLifecycle, refreshLifecycleRegistry, requestPreparation, tickLifecycleQueue, reviewFile, managedReadyIds, lifecycleCardAllowed } from '../services/setLifecycle';
const setId=randomUUID();const identity={year:2026,brand:'Fixture',sport:'baseball',setName:'Fixture new set'};
const profile=customBandProfile({edge:'bottom',height:16})!;
let server:ReturnType<typeof createServer>,origin:string;
async function api(suffix='',body?:unknown,auth=true){return fetch(`${origin}/api/admin/set-lifecycle/${setId}${suffix}`,{method:body===undefined?'GET':'POST',headers:{...(auth?{'x-fixture-user':'yes'}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
async function insertCard(){const id=randomUUID();await fixture.db.insert(schema.playableCards).values({id,gameSetId:setId,player:'Alice Player',number:id.slice(0,5),imageUrl:'https://fixture.invalid/card.jpg',imageRotation:0,isPlayable:true,contentVerified:true,quarantineStatus:'OK',proposedUnplayable:false,imageReviewStatus:'unreviewed',category:'baseball'});return id;}
beforeAll(async()=>{
  fixture.dir=mkdtempSync(path.join(tmpdir(),'lifecycle-test-'));fixture.pg=new PGlite();fixture.db=drizzle(fixture.pg,{schema});
  for(const table of [schema.gameSets,schema.playableCards,schema.cardReviewApprovals]){
    const c=getTableConfig(table);const cols=c.columns.map(col=>`"${col.name}" ${col.getSQLType()}${col.name==='id'||col.name==='card_id'?' PRIMARY KEY':''}`);
    await fixture.pg.exec(`CREATE TABLE "${c.name}" (${cols.join(',')})`);
  }
  await fixture.pg.exec(readFileSync(new URL('../../migrations/add_admin_set_lifecycle.sql',import.meta.url),'utf8'));
  await fixture.pg.exec(readFileSync(new URL('../../migrations/add_admin_set_lifecycle.sql',import.meta.url),'utf8'));
  await fixture.db.insert(schema.gameSets).values({id:setId,...identity,isActive:true,isUserCreated:false});
  const app=express();app.use(express.json());registerAdminSetLifecycleRoutes(app,{startWorker:false});server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(fixture.pg)await fixture.pg.close();if(fixture.dir)rmSync(fixture.dir,{recursive:true,force:true});});
beforeEach(async()=>{fixture.diagnosticDbError=false;fixture.queries=[];fixture.admin=true;fixture.refusal=null;fixture.ocrSkip=false;fixture.bakes=0;await fixture.pg.exec('DELETE FROM admin_set_preparation_jobs;DELETE FROM admin_set_card_reviews;DELETE FROM admin_set_lifecycles;DELETE FROM card_review_approvals;DELETE FROM playable_cards;UPDATE game_sets SET year=2026;');for(const f of readdirSync(fixture.dir))rmSync(path.join(fixture.dir,f));await refreshLifecycleRegistry();});
describe('self-service lifecycle',()=>{
  it('bounds authored layouts and binds every identity/source/rotation/hash field',()=>{
    for(const value of [null,{}, {edge:'left',height:10},{edge:'top',height:36},{edge:'bottom',height:56},{edge:'bottom',height:NaN},{edge:'top',height:'10'}])expect(customBandProfile(value)).toBeNull();
    expect(customBandProfile({edge:'top',height:5})?.regions[0].yPct).toBe(0);
    const w={cardId:'a',setId,player:'Alice Player',number:'1',imageUrl:'https://fixture.invalid/a',imageRotation:0};const revision=profileRevision(identity,profile);
    for(const k of ['cardId','setId','player','number','imageUrl','imageRotation'] as const)expect(witnessKey({...w,[k]:k==='imageRotation'?90:'changed'},revision)).not.toBe(witnessKey(w,revision));
    expect(profileRevision({...identity,year:2027},profile)).not.toBe(revision);
    const proof={key:digest('key'),sourceHash:digest('source'),previewHash:digest('mask')};expect(reviewMatches(proof,proof)).toBe(true);expect(reviewMatches(proof,{...proof,previewHash:digest('other')})).toBe(false);
  });
  it('requires login and Admin; protects exact legacy IDs before enrollment',async()=>{
    expect((await api('',undefined,false)).status).toBe(401);fixture.admin=false;expect((await api()).status).toBe(403);fixture.admin=true;
    for(const id of ['3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4','affd57b8-2b1d-4ea3-9f51-1530d8088e5c'])expect((await fetch(`${origin}/api/admin/set-lifecycle/${id}/layout`,{method:'POST',headers:{'x-fixture-user':'yes','content-type':'application/json'},body:JSON.stringify({mode:'custom',edge:'bottom',height:16})})).status).toBe(409);
    expect((await fixture.pg.query('SELECT * FROM admin_set_lifecycles')).rows).toHaveLength(0);
  });
  it('durable all-card snapshot, idempotent retry, expired-lease recovery and no implicit approval',async()=>{
    await configureLifecycle(setId,identity,profile,'admin');const ids=await Promise.all(Array.from({length:23},insertCard));const requestId=randomUUID();
    await requestPreparation(setId,requestId,ids);await requestPreparation(setId,requestId,[...ids].reverse());
    expect((await fixture.pg.query('SELECT * FROM admin_set_card_reviews')).rows).toHaveLength(23);expect((await fixture.pg.query('SELECT * FROM admin_set_preparation_jobs')).rows).toHaveLength(1);
    await expect(requestPreparation(setId,requestId,ids.slice(1))).rejects.toThrow('different inputs');
    await fixture.pg.query("UPDATE admin_set_card_reviews SET status='processing',lease_until=now()-interval '1 minute' WHERE card_id=$1",[ids[0]]);
    for(let i=0;i<23;i++)await tickLifecycleQueue();
    expect((await fixture.pg.query("SELECT * FROM admin_set_card_reviews WHERE status='ready'")).rows).toHaveLength(23);expect(fixture.bakes).toBe(23);expect(managedReadyIds()).toEqual([]);
    const job=(await fixture.pg.query('SELECT results FROM admin_set_preparation_jobs')).rows[0];expect(Object.values(job.results).every((r:any)=>r.status==='ready')).toBe(true);
  });
  it('skipped OCR is an error, never ready; retry does not restore excluded flags',async()=>{
    await configureLifecycle(setId,identity,profile,'admin');const id=await insertCard();await requestPreparation(setId,randomUUID(),[id]);fixture.ocrSkip=true;await tickLifecycleQueue();
    expect((await fixture.pg.query('SELECT status FROM admin_set_card_reviews')).rows[0].status).toBe('error');
    expect((await api(`/exclude/${id}`,{reason:'Unsupported source design'})).status).toBe(200);
    await expect(requestPreparation(setId,randomUUID(),[id])).rejects.toThrow('excluded');
    expect((await fixture.pg.query('SELECT is_playable,proposed_unplayable FROM playable_cards')).rows[0]).toEqual({is_playable:false,proposed_unplayable:true});
  });
  it('exact source/mask approval + full coverage publication; changed bytes and identity fail closed',async()=>{
    expect((await api('/layout',{mode:'custom',edge:'bottom',height:16})).status).toBe(200);const ids=await Promise.all(Array.from({length:5},insertCard));await requestPreparation(setId,randomUUID(),ids);for(let i=0;i<5;i++)await tickLifecycleQueue();
    expect((await api('/publish',{publish:true})).status).toBe(409);
    let snap=await (await api()).json();const first=snap.cards[0];
    expect((await api(`/approve/${first.id}`,{sourceReviewed:true,maskReviewed:true,note:'Reviewed exact images',challenge:{...first.challenge,sourceHash:digest('wrong')}})).status).toBe(409);
    for(const card of snap.cards)expect((await api(`/approve/${card.id}`,{sourceReviewed:true,maskReviewed:true,note:'Reviewed exact images',challenge:card.challenge})).status).toBe(200);
    fixture.designApproved=false;const gated=await api('/publish',{publish:true});expect(gated.status).toBe(409);expect((await gated.json()).code).toBe('design_approval_required');fixture.designApproved=true;
    expect((await api('/publish',{publish:true})).status).toBe(200);expect(await lifecycleCardAllowed(ids[0])).toBe(true);expect(managedReadyIds()).toHaveLength(5);
    const row=(await fixture.pg.query('SELECT * FROM admin_set_card_reviews WHERE card_id=$1',[ids[0]])).rows[0];expect(reviewFile(row)).not.toBeNull();
    writeFileSync(path.join(fixture.dir,row.filename),'tampered');expect(reviewFile(row)).toBeNull();expect(await lifecycleCardAllowed(ids[0])).toBe(false);
    await fixture.pg.query('UPDATE playable_cards SET image_url=$2 WHERE id=$1',[ids[1],'https://fixture.invalid/changed.jpg']);snap=await(await api()).json();expect(snap.cards.find((c:any)=>c.id===ids[1]).challenge).toBeNull();expect(await lifecycleCardAllowed(ids[1])).toBe(false);
    await fixture.pg.query('UPDATE game_sets SET year=2027 WHERE id=$1',[setId]);expect(await lifecycleCardAllowed(ids[2])).toBe(false);
    expect((await api('/withdraw',{})).status).toBe(200);
  });
  it('refusal sidecars stay refused; valid previews reuse without rebaking or approving',async()=>{
    await configureLifecycle(setId,identity,profile,'admin');const id=await insertCard();await requestPreparation(setId,randomUUID(),[id]);fixture.refusal='mask_name_uncovered';await tickLifecycleQueue();
    expect(fixture.bakes).toBe(0);expect((await fixture.pg.query('SELECT status,reason FROM admin_set_card_reviews')).rows[0]).toEqual({status:'error',reason:'existing_mask_refusal'});
    expect((await fixture.pg.query('SELECT is_playable FROM playable_cards')).rows[0].is_playable).toBe(true);
    fixture.refusal=null;await requestPreparation(setId,randomUUID(),[id]);await tickLifecycleQueue();expect(fixture.bakes).toBe(1);
    await requestPreparation(setId,randomUUID(),[id]);await tickLifecycleQueue();expect(fixture.bakes).toBe(1);expect((await fixture.pg.query('SELECT status FROM admin_set_card_reviews')).rows[0].status).toBe('ready');
  });
  it('rejects missing/tampered source, plan, success marker and preview independently',async()=>{
    await configureLifecycle(setId,identity,profile,'admin');const id=await insertCard();await requestPreparation(setId,randomUUID(),[id]);await tickLifecycleQueue();
    const row=(await fixture.pg.query('SELECT * FROM admin_set_card_reviews')).rows[0];
    for(const filename of [row.filename,`${id}_${CURRENT_MASK_VERSION}.json`,`${id}_${CURRENT_MASK_VERSION}.lifecycle-source`,`${id}_${CURRENT_MASK_VERSION}.ok`]){
      const file=path.join(fixture.dir,filename);const bytes=readFileSync(file);rmSync(file);expect(reviewFile(row)).toBeNull();writeFileSync(file,bytes);expect(reviewFile(row)).not.toBeNull();
      if(!filename.endsWith('.ok')){writeFileSync(file,'changed');expect(reviewFile(row)).toBeNull();writeFileSync(file,bytes);}
    }
  });
  it('restores persisted registry and invalidates release on layout change or incomplete coverage',async()=>{
    await configureLifecycle(setId,identity,profile,'admin');const ids=await Promise.all(Array.from({length:5},insertCard));await requestPreparation(setId,randomUUID(),ids);
    await expect(configureLifecycle(setId,identity,customBandProfile({edge:'top',height:12})!,'admin')).rejects.toThrow('Preparation still in progress');
    for(let i=0;i<5;i++)await tickLifecycleQueue();
    const snap=await(await api()).json();for(const card of snap.cards)expect((await api(`/approve/${card.id}`,{sourceReviewed:true,maskReviewed:true,note:'Reviewed exact images',challenge:card.challenge})).status).toBe(200);
    expect((await api('/publish',{publish:true})).status).toBe(200);await refreshLifecycleRegistry();expect(managedReadyIds()).toHaveLength(5);
    const sixth=await insertCard();expect((await api('/publish',{publish:true})).status).toBe(409);expect(await lifecycleCardAllowed(sixth)).toBe(false);
    await configureLifecycle(setId,identity,customBandProfile({edge:'top',height:12})!,'admin');expect(managedReadyIds()).toEqual([]);expect(await lifecycleCardAllowed(ids[0])).toBe(false);expect((await(await api()).json()).lifecycle.published).toBe(false);
  });

});

describe('Admin exact-card artifact diagnostic GET',()=>{
  async function prepared() {
    await configureLifecycle(setId,identity,profile,'admin');const id=await insertCard();await requestPreparation(setId,randomUUID(),[id]);await tickLifecycleQueue();return id;
  }
  async function businessSnapshot() {
    const out:Record<string,unknown>={};for(const table of ['admin_set_lifecycles','admin_set_card_reviews','admin_set_preparation_jobs','card_review_approvals','playable_cards','game_sets'])out[table]=(await fixture.pg.query(`SELECT * FROM ${table}`)).rows;
    out.files=readdirSync(fixture.dir).sort().map(name=>[name,digest(readFileSync(path.join(fixture.dir,name)))]);return out;
  }
  it('authenticated Admin only, malformed IDs/options blocked, no-store even errors',async()=>{
    const id=randomUUID();for(const [auth,admin,status] of [[false,true,401],[true,false,403]] as const){fixture.admin=admin;fixture.queries=[];const response=await api(`/artifact-diagnostic/${id}`,undefined,auth);expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(fixture.queries).toHaveLength(0);}
    fixture.admin=true;
    for(const url of [`${origin}/api/admin/set-lifecycle/bad/artifact-diagnostic/${id}`,`${origin}/api/admin/set-lifecycle/${setId}/artifact-diagnostic/bad`,`${origin}/api/admin/set-lifecycle/${setId}/artifact-diagnostic/${id}?path=/etc/passwd`]){
      fixture.queries=[];const response=await fetch(url,{headers:{'x-fixture-user':'yes'}});expect(response.status).toBe(400);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(fixture.queries).toHaveLength(0);
    }
  });
  it('protects cleared/1988 workflows before any diagnostic data query',async()=>{
    for(const id of ['3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4','affd57b8-2b1d-4ea3-9f51-1530d8088e5c']){
      fixture.queries=[];const response=await fetch(`${origin}/api/admin/set-lifecycle/${id}/artifact-diagnostic/${randomUUID()}`,{headers:{'x-fixture-user':'yes'}});expect(response.status).toBe(409);expect(fixture.queries).toHaveLength(0);
    }
  });
  it('404s missing set/card/review and wrong-set ownership, never falls back to another row',async()=>{
    const id=await insertCard();expect((await api(`/artifact-diagnostic/${id}`)).status).toBe(404);
    expect((await api(`/artifact-diagnostic/${randomUUID()}`)).status).toBe(404);
    const missing=await fetch(`${origin}/api/admin/set-lifecycle/${randomUUID()}/artifact-diagnostic/${id}`,{headers:{'x-fixture-user':'yes'}});expect(missing.status).toBe(404);
    await fixture.pg.query('UPDATE playable_cards SET game_set_id=$2 WHERE id=$1',[id,randomUUID()]);expect((await api(`/artifact-diagnostic/${id}`)).status).toBe(404);
  });
  it('returns raw saved status/revision/witness and exact byte comparisons without mutation or registry refresh',async()=>{
    const id=await prepared();const row=(await fixture.pg.query('SELECT * FROM admin_set_card_reviews WHERE card_id=$1',[id])).rows[0];
    replaceLifecycleRegistry([{setId,identity:identityKey(identity),revision:digest('old cached revision'),profile,published:false}]);
    const cached=lifecycleSet(setId);const before=await businessSnapshot();fixture.queries=[];
    for(let i=0;i<2;i++){
      const response=await api(`/artifact-diagnostic/${id}`);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
      const result=await response.json();expect(result.review.status).toBe('ready');expect(result.review.revision).toBe(row.revision);expect(result.review.revisionMatches).toBe(true);expect(result.review.witnessMatches).toBe(true);expect(result.review.identityMatches).toBe(true);
      expect(result.artifacts.valid).toBe(true);expect(result.artifacts.checks.preview.computedHash).toBe(row.preview_hash);expect(result.runtime.cwd).toBe(process.cwd());expect(result.runtime.artifactRoot).toBe(fixture.dir);expect(result).not.toHaveProperty('witness');expect(result.artifacts).not.toHaveProperty('file');expect(result).not.toHaveProperty('sourceUrl');
    }
    expect(fixture.queries).toHaveLength(4);expect(fixture.queries.every(q=>/^SELECT .* WHERE .* LIMIT 1$/.test(q))).toBe(true);
    expect(lifecycleSet(setId)).toBe(cached);expect(await businessSnapshot()).toEqual(before);
  });
  it('shows changed preview while retaining the saved approval; excluded cards still diagnosable',async()=>{
    const id=await prepared();await fixture.pg.query("UPDATE admin_set_card_reviews SET status='approved' WHERE card_id=$1",[id]);
    const row=(await fixture.pg.query('SELECT * FROM admin_set_card_reviews WHERE card_id=$1',[id])).rows[0];writeFileSync(path.join(fixture.dir,row.filename),'changed fixture preview');
    await fixture.pg.query("UPDATE playable_cards SET is_playable=false,proposed_unplayable=true,image_review_status='excluded' WHERE id=$1",[id]);
    const before=await businessSnapshot();const result=await(await api(`/artifact-diagnostic/${id}`)).json();expect(result.review.status).toBe('approved');expect(result.artifacts.category).toBe('preview_hash_changed');expect(result.artifacts.checks.preview.storedHash).toBe(row.preview_hash);expect(result.artifacts.checks.preview.computedHash).toBe(digest('changed fixture preview'));expect(result.artifacts.checks.source.state).toBe('not_checked');expect(await businessSnapshot()).toEqual(before);
  });
  it('reports current refusal without returning marker text or non-allowlisted environment',async()=>{
    const id=await prepared();writeFileSync(path.join(fixture.dir,`${id}_${CURRENT_MASK_VERSION}.fail`),'DO_NOT_EXPOSE_MARKER_TEXT');
    const saved=process.env.BUILD_COMMIT_SHA;process.env.BUILD_COMMIT_SHA='DO_NOT_EXPOSE_ENV_VALUE';
    try {
      const before=await businessSnapshot();const result=await(await api(`/artifact-diagnostic/${id}`)).json();
      expect(result.artifacts.category).toBe('current_refusal');expect(result.artifacts.refusalObservation).toBe('present');expect(result.artifacts.checks.plan.state).toBe('not_checked');expect(result.runtime.buildCommit).toBeNull();
      expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE');expect(await businessSnapshot()).toEqual(before);
    }finally{if(saved===undefined)delete process.env.BUILD_COMMIT_SHA;else process.env.BUILD_COMMIT_SHA=saved;}
  });
  it('reports revision/witness/identity mismatches separately from file validity',async()=>{
    const id=await prepared();await fixture.pg.query('UPDATE playable_cards SET image_rotation=90 WHERE id=$1',[id]);await fixture.pg.query('UPDATE admin_set_lifecycles SET revision=$2 WHERE set_id=$1',[setId,digest('changed revision')]);await fixture.pg.query('UPDATE game_sets SET year=2027 WHERE id=$1',[setId]);
    const result=await(await api(`/artifact-diagnostic/${id}`)).json();expect(result.review.revisionMatches).toBe(false);expect(result.review.witnessMatches).toBe(false);expect(result.review.identityMatches).toBe(false);expect(result.artifacts.valid).toBe(true);
  });
  it('bounds filename ownership and returns a sanitized database failure without side effects',async()=>{
    const id=await prepared();await fixture.pg.query('UPDATE admin_set_card_reviews SET filename=$2 WHERE card_id=$1',[id,`${randomUUID()}_${CURRENT_MASK_VERSION}.jpg`]);
    expect((await(await api(`/artifact-diagnostic/${id}`)).json()).artifacts.category).toBe('diagnostic_filename_not_owned');
    const before=await businessSnapshot();fixture.diagnosticDbError=true;const response=await api(`/artifact-diagnostic/${id}`);expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.text()).not.toContain('DO_NOT_EXPOSE_DB_SECRET');expect(await businessSnapshot()).toEqual(before);
  });
});
