/** Read-only validation shared by release checks and the Admin diagnostic.
 * Keep the legacy check order and short-circuit behavior: later files are not
 * read after a failure. Passing this check alone is never approval to release.
 */
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from 'fs';
import path from 'path';
import { digest, validHash } from './setLifecycleCore';
export type ArtifactReview = { card_id:string; filename:string|null; plan_hash:string|null; preview_hash:string|null; source_hash:string|null };
export type ArtifactCheck = { state:'not_checked'|'passed'|'failed'; storedHash?:string|null; computedHash?:string; matches?:boolean };
export type ArtifactIO = { read:(file:string)=>Buffer; exists:(file:string)=>boolean; refusal:()=>string|null };
export type ArtifactResult = { file:string|null; valid:boolean; category:string; checks:Record<string,ArtifactCheck>; refusalObservation?:string };
const defaultIO = (refusal:()=>string|null):ArtifactIO => ({read:readFileSync,exists:existsSync,refusal});
export function validateReviewArtifacts(row:ArtifactReview, root:string, version:string, bandFailure:(regions:any[])=>string|null, refusal:()=>string|null, io=defaultIO(refusal)):ArtifactResult {
  const checks:Record<string,ArtifactCheck>={refusal:{state:'not_checked'},successMarker:{state:'not_checked'},plan:{state:'not_checked',storedHash:validHash(row.plan_hash)?row.plan_hash:null},preview:{state:'not_checked',storedHash:validHash(row.preview_hash)?row.preview_hash:null},source:{state:'not_checked',storedHash:validHash(row.source_hash)?row.source_hash:null}};
  let stage='filename';
  const fail=(category:string):ArtifactResult=>{if(checks[stage])checks[stage].state='failed';return {file:null,valid:false,category,checks};};
  const hashMatches=(kind:'plan'|'preview'|'source',bytes:Buffer,stored:string|null)=>{
    const computedHash=digest(bytes);checks[kind]={...checks[kind],computedHash,matches:computedHash===stored,state:computedHash===stored?'passed':'failed'};return computedHash===stored;
  };
  if(!row.filename||!/^[0-9a-f-]+_v[0-9.]+(?:_r(?:90|180|270))?\.jpg$/i.test(row.filename))return fail('invalid_filename');
  const preview=path.join(root,row.filename);
  try {
    stage='refusal';if(io.refusal())return fail('current_refusal');checks.refusal.state='passed';
    stage='successMarker';if(!io.exists(path.join(root,`${row.card_id}_${version}.ok`)))return fail('missing_success_marker');checks.successMarker.state='passed';
    stage='plan';const planBytes=io.read(path.join(root,`${row.card_id}_${version}.json`));
    if(!hashMatches('plan',planBytes,row.plan_hash))return fail('plan_hash_changed');
    let plan:any;try {plan=JSON.parse(planBytes.toString());}catch{return fail('plan_invalid_json');}
    if(!plan||plan.maskVersion!==version)return fail('plan_invalid_version');
    if(!Array.isArray(plan.regions)||!plan.regions.length)return fail('plan_invalid_regions');
    if(bandFailure(plan.regions))return fail('plan_band_rejected');
    stage='preview';if(!hashMatches('preview',io.read(preview),row.preview_hash))return fail('preview_hash_changed');
    stage='source';if(!hashMatches('source',io.read(path.join(root,`${row.card_id}_${version}.lifecycle-source`)),row.source_hash))return fail('source_hash_changed');
    return {file:preview,valid:true,category:'valid',checks};
  } catch(error) {
    const code=(error as NodeJS.ErrnoException)?.code;
    if(code==='DIAGNOSTIC_LIMIT'||code==='DIAGNOSTIC_PATH'||code==='ELOOP')return fail(code==='DIAGNOSTIC_LIMIT'?'diagnostic_read_limit':'diagnostic_unsafe_path');
    return fail(`${stage==='successMarker'?'success_marker':stage}_${code==='ENOENT'?'missing':'unreadable'}`);
  }
}
/** Diagnostic-only limits. O_NOFOLLOW prevents symlink byte reads; filenames
 * are generated internally, never accepted as query input. No writers/caches.
 * Limits/unsafe paths mean inspection was blocked, NOT a release verdict.
 */
export function diagnosticArtifactIO(root:string,cardId:string,version:string) {
  let refusalObservation='not_checked';
  const error=(code:string)=>Object.assign(new Error('Diagnostic read blocked'),{code});
  const assertPath=(file:string)=>{if(path.dirname(file)!==root)throw error('DIAGNOSTIC_PATH');};
  const read=(file:string):Buffer=>{
    assertPath(file);
    // Reject ordinary nonregular paths before open; O_NONBLOCK also prevents a
    // raced-in FIFO from blocking the event loop before the post-open fstat.
    if(!lstatSync(file).isFile())throw error('DIAGNOSTIC_PATH');
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const stat=fstatSync(fd);const limit=file.endsWith('.json')?2*1024*1024:file.endsWith('.fail')?64*1024:64*1024*1024;
      if(!stat.isFile())throw error('DIAGNOSTIC_PATH');if(stat.size>limit)throw error('DIAGNOSTIC_LIMIT');
      // A bounded read even if another process appends after fstat.
      const bytes=Buffer.alloc(stat.size);let offset=0;
      while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)break;offset+=n;}
      if(fstatSync(fd).size!==stat.size)throw error('DIAGNOSTIC_LIMIT');return bytes.subarray(0,offset);
    } finally {closeSync(fd);}
  };
  const exists=(file:string)=>{assertPath(file);try {if(lstatSync(file).isSymbolicLink())throw error('DIAGNOSTIC_PATH');return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
  const refusal=()=>{
    try {const text=read(path.join(root,`${cardId}_${version}.fail`)).toString('utf8').trim();refusalObservation=text?'present':'empty_ignored';return text||null;}
    catch(e){const code=(e as NodeJS.ErrnoException).code;if(code==='DIAGNOSTIC_LIMIT'||code==='DIAGNOSTIC_PATH'||code==='ELOOP'){refusalObservation='inspection_blocked';throw code==='ELOOP'?error('DIAGNOSTIC_PATH'):e;}
      // Legacy readMaskFailureReason also ignores unreadable/absent markers.
      refusalObservation=code==='ENOENT'?'absent':'unreadable_ignored';return null;}
  };
  return {io:{read,exists,refusal},observation:()=>refusalObservation};
}
