import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, symlinkSync, truncateSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import path from 'path';
import { randomUUID } from 'crypto';
vi.mock('../db',()=>({db:{}}));
vi.mock('../masking/maskPlanStore',()=>({MASKED_CARDS_DIR:'/unused-test-root',warmMaskPlanFilename:(id:string)=>`${id}_v4.6.json`}));
import { CURRENT_MASK_VERSION } from '@shared/maskGeometry';
import { maskBandFailure } from '../masking/maskBandLimit';
import { digest } from '../services/setLifecycleCore';
import { validateReviewArtifacts, diagnosticArtifactIO, type ArtifactReview } from '../services/lifecycleArtifactValidation';
let root:string,row:ArtifactReview;
const version=CURRENT_MASK_VERSION;
const file=(kind:string)=>path.join(root,`${row.card_id}_${version}.${kind}`);
const refusal=()=>{try{return readFileSync(file('fail'),'utf8').trim()||null;}catch{return null;}};
// Frozen production predicate from f62f9a99, independent of the new helper.
function legacy():string|null {
  if(!row.filename||!/^[0-9a-f-]+_v[0-9.]+(?:_r(?:90|180|270))?\.jpg$/i.test(row.filename))return null;
  const preview=path.join(root,row.filename);
  try {
    if(refusal())return null;if(!existsSync(file('ok')))return null;
    const bytes=readFileSync(file('json'));if(digest(bytes)!==row.plan_hash)return null;
    const plan=JSON.parse(bytes.toString());if(plan.maskVersion!==version||!Array.isArray(plan.regions)||!plan.regions.length||maskBandFailure(plan.regions))return null;
    if(digest(readFileSync(preview))!==row.preview_hash)return null;
    if(digest(readFileSync(file('lifecycle-source')))!==row.source_hash)return null;return preview;
  }catch{return null;}
}
const inspect=(bounded=false)=>validateReviewArtifacts(row,root,version,maskBandFailure,refusal,bounded?diagnosticArtifactIO(root,row.card_id,version).io:undefined);
function plan(value:unknown) {const bytes=Buffer.from(JSON.stringify(value));writeFileSync(file('json'),bytes);row.plan_hash=digest(bytes);}
function snapshot(){return readdirSync(root).map(name=>[name,digest(readFileSync(path.join(root,name)))]);}
beforeEach(()=>{
  root=mkdtempSync(path.join(tmpdir(),'artifact-diagnostic-'));row={card_id:randomUUID(),filename:null,plan_hash:null,preview_hash:digest('synthetic-preview'),source_hash:digest('synthetic-source')};
  row.filename=`${row.card_id}_${version}.jpg`;writeFileSync(file('jpg'),'synthetic-preview');writeFileSync(file('lifecycle-source'),'synthetic-source');writeFileSync(file('ok'),'ok');
  plan({maskVersion:version,regions:[{xPct:0,yPct:90,wPct:100,hPct:10,type:'blur'}]});
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
describe('read-only artifact validation, real temporary files and SHA-256, actual band validator',()=>{
  it('validates all three byte hashes and leaves files unchanged on repeated reads',()=>{
    const before=snapshot();for(let i=0;i<3;i++) {const result=inspect(true);expect(result.file).toBe(legacy());expect(result.valid).toBe(true);expect(result.checks.plan.matches).toBe(true);expect(result.checks.preview.computedHash).toBe(row.preview_hash);expect(result.checks.source.computedHash).toBe(row.source_hash);}
    expect(snapshot()).toEqual(before);
  });
  const scenarios:[string,string,(r:ArtifactReview)=>void][]=[
    ['filename traversal','invalid_filename',r=>{r.filename='../private.jpg';}],
    ['no filename','invalid_filename',r=>{r.filename=null;}],
    ['current refusal','current_refusal',()=>writeFileSync(file('fail'),'mask_name_uncovered')],
    ['missing success marker','missing_success_marker',()=>rmSync(file('ok'))],
    ['missing plan','plan_missing',()=>rmSync(file('json'))],
    ['changed plan bytes','plan_hash_changed',()=>writeFileSync(file('json'),'changed')],
    ['invalid JSON with matching hash','plan_invalid_json',r=>{writeFileSync(file('json'),'{');r.plan_hash=digest('{');}],
    ['wrong mask version','plan_invalid_version',()=>plan({maskVersion:'v0',regions:[{}]})],
    ['null plan','plan_invalid_version',()=>plan(null)],
    ['empty regions','plan_invalid_regions',()=>plan({maskVersion:version,regions:[]})],
    ['non-array regions','plan_invalid_regions',()=>plan({maskVersion:version,regions:{}})],
    ['oversized top band','plan_band_rejected',()=>plan({maskVersion:version,regions:[{yPct:0,hPct:36,wPct:100}]})],
    ['oversized bottom band','plan_band_rejected',()=>plan({maskVersion:version,regions:[{yPct:44,hPct:56,wPct:100}]})],
    ['misplaced band','plan_band_rejected',()=>plan({maskVersion:version,regions:[{yPct:40,hPct:10,wPct:100}]})],
    ['missing preview','preview_missing',()=>rmSync(file('jpg'))],
    ['changed preview','preview_hash_changed',()=>writeFileSync(file('jpg'),'changed')],
    ['missing source','source_missing',()=>rmSync(file('lifecycle-source'))],
    ['changed source','source_hash_changed',()=>writeFileSync(file('lifecycle-source'),'changed')],
    ['unset plan hash','plan_hash_changed',r=>{r.plan_hash=null;}],
    ['unset preview hash','preview_hash_changed',r=>{r.preview_hash=null;}],
    ['unset source hash','source_hash_changed',r=>{r.source_hash=null;}],
  ];
  for(const [name,category,change] of scenarios)it(`matches frozen reviewFile: ${name}`,()=>{
    change(row);expect(legacy()).toBeNull();expect(inspect().file).toBe(legacy());const result=inspect(true);expect(result.category).toBe(category);expect(result.valid).toBe(false);
    if(category.startsWith('plan_'))expect(result.checks.source.state).toBe('not_checked');
  });
  it('uses actual legacy band boundaries (35 top, 55 bottom pass)',()=>{
    for(const region of [{yPct:0,hPct:35,wPct:100},{yPct:45,hPct:55,wPct:100}]){plan({maskVersion:version,regions:[region]});expect(inspect(true).file).toBe(legacy());expect(inspect(true).valid).toBe(true);}
  });
  it('does not invent a rejection for an empty refusal marker',()=>{
    writeFileSync(file('fail'),' \n');expect(inspect(true).file).toBe(legacy());expect(inspect(true).valid).toBe(true);
  });
  it('classifies unreadability without leaking raw error text (injected EACCES)',()=>{
    const io=diagnosticArtifactIO(root,row.card_id,version).io;
    const read=io.read;io.read=(p)=>{if(p.endsWith('.jpg'))throw Object.assign(new Error('DO_NOT_EXPOSE_SECRET'),{code:'EACCES'});return read(p);};
    const result=validateReviewArtifacts(row,root,version,maskBandFailure,refusal,io);
    expect(result.category).toBe('preview_unreadable');expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE_SECRET');
  });
  it('blocks symlink byte reads without changing release semantics',()=>{
    rmSync(file('jpg'));symlinkSync(file('lifecycle-source'),file('jpg'));row.preview_hash=row.source_hash;
    expect(legacy()).not.toBeNull();expect(inspect().file).toBe(legacy());expect(inspect(true).category).toBe('diagnostic_unsafe_path');
  });
  it('bounds diagnostic reads only; does not allocate/read an oversized image',()=>{
    truncateSync(file('jpg'),64*1024*1024+1);expect(inspect(true).category).toBe('diagnostic_read_limit');
  });
  for(const kind of ['json','jpg','lifecycle-source','fail'])it(`rejects a FIFO ${kind} without opening/blocking or reading bytes`,()=>{
    const target=file(kind);if(existsSync(target))rmSync(target);execFileSync('mkfifo',[target]);
    const started=Date.now();const result=inspect(true);expect(result.category).toBe('diagnostic_unsafe_path');expect(Date.now()-started).toBeLessThan(1000);
    expect(result.valid).toBe(false);expect(result.file).toBeNull();
  });
  it('rejects nonregular directory artifacts before open',()=>{
    rmSync(file('jpg'));execFileSync('mkdir',[file('jpg')]);expect(inspect(true).category).toBe('diagnostic_unsafe_path');
  });
  it('preserves legacy rotated filename semantics',()=>{
    row.filename=`${row.card_id}_${version}_r90.jpg`;writeFileSync(path.join(root,row.filename),'synthetic-preview');expect(inspect(true).file).toBe(legacy());expect(inspect(true).valid).toBe(true);
  });
});
