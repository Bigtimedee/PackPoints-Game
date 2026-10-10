/** Independent, bounded evidence reads. Never repairs a marker or approves a card. */
import * as fs from 'fs';
import path from 'path';
import { digest, validHash, validRequestId } from './setLifecycleCore';
import type { ArtifactReview } from './lifecycleArtifactValidation';
export type InventoryState = 'present'|'missing'|'unreadable'|'unsafe'|'bounded'|'read_changed';
export type FileObservation = {state:InventoryState; storedHash?:string|null; computedHash?:string; matches?:boolean; sizeBytes?:number; nonempty?:boolean; structure?:string};
const blocked=(code:string)=>Object.assign(new Error('Inventory read blocked'),{code});
const same=(a:fs.Stats,b:fs.Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
/** Same reviewed no-follow/nonblocking/regular-file/bounded guards as PR215,
 * plus pre/open/post/path identity and exact-length checks. No cross-file snapshot.
 * fs dependency is injectable only by local tests, never via an HTTP parameter.
 */
export function readInventoryBytes(file:string,root:string,limit:number,io:Pick<typeof fs,'lstatSync'|'openSync'|'fstatSync'|'readSync'|'closeSync'>=fs):Buffer {
  if(path.dirname(file)!==root)throw blocked('INVENTORY_UNSAFE');
  const before=io.lstatSync(file);if(!before.isFile())throw blocked('INVENTORY_UNSAFE');
  if(before.size>limit)throw blocked('INVENTORY_BOUND');
  const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const opened=io.fstatSync(fd);if(!opened.isFile())throw blocked('INVENTORY_UNSAFE');
    if(!same(before,opened))throw blocked('INVENTORY_CHANGED');
    if(opened.size>limit)throw blocked('INVENTORY_BOUND');
    const bytes=Buffer.alloc(opened.size);let offset=0;
    while(offset<bytes.length){const n=io.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)throw blocked('INVENTORY_CHANGED');offset+=n;}
    const extra=Buffer.alloc(1);if(io.readSync(fd,extra,0,1,offset)!==0)throw blocked('INVENTORY_CHANGED');
    const after=io.fstatSync(fd);let final:fs.Stats;
    try{final=io.lstatSync(file);}catch{throw blocked('INVENTORY_CHANGED');}
    if(!after.isFile()||!final.isFile()||!same(opened,after)||!same(after,final))throw blocked('INVENTORY_CHANGED');
    return bytes;
  }finally{io.closeSync(fd);}
}
const stateFor=(e:unknown):InventoryState=>{
  const code=(e as NodeJS.ErrnoException)?.code;
  return code==='ENOENT'?'missing':code==='INVENTORY_CHANGED'?'read_changed':code==='INVENTORY_BOUND'?'bounded':code==='INVENTORY_UNSAFE'||code==='ELOOP'?'unsafe':'unreadable';
};
export function inventoryReviewArtifacts(row:ArtifactReview,root:string,version:string,bandFailure:(regions:any[])=>string|null,read=readInventoryBytes) {
  const checks:Record<string,FileObservation>={};
  const hash=(v:string|null)=>validHash(v)?v:null;
  const escape=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Exact current-version, same-card filename only. No stale/cross-card/path inputs.
  if(!validRequestId(row.card_id)||!/^v[0-9.]+$/.test(version)||!row.filename||!new RegExp(`^${escape(row.card_id)}_${escape(version)}(?:_r(?:90|180|270))?\\.jpg$`).test(row.filename)) {
    for(const name of ['successMarker','refusal','plan','preview','source'])checks[name]={state:'unsafe'};
    return {checks,scope:'Inventory blocked by invalid saved filename. No files read. Not an approval or release decision.'};
  }
  function probe(kind:string,filename:string,limit:number,stored?:string|null) {
    const observation:FileObservation=stored===undefined?{state:'unreadable'}:{state:'unreadable',storedHash:hash(stored)};
    try {
      const bytes=read(path.join(root,filename),root,limit);
      observation.state='present';observation.sizeBytes=bytes.length;
      if(stored!==undefined){observation.computedHash=digest(bytes);observation.matches=validHash(stored)&&observation.computedHash===stored;}
      if(kind==='refusal')observation.nonempty=bytes.toString('utf8').trim().length>0;
      if(kind==='plan') {
        let plan:any;try{plan=JSON.parse(bytes.toString('utf8'));}catch{observation.structure='invalid_json';}
        if(!observation.structure){
          if(!plan||plan.maskVersion!==version)observation.structure='invalid_version';
          else if(!Array.isArray(plan.regions)||!plan.regions.length)observation.structure='invalid_regions';
          else {try{observation.structure=bandFailure(plan.regions)?'band_rejected':'accepted';}catch{observation.structure='validation_unavailable';}}
        }
      }
    }catch(e){observation.state=stateFor(e);}
    checks[kind]=observation;
  }
  probe('successMarker',`${row.card_id}_${version}.ok`,64*1024);
  probe('refusal',`${row.card_id}_${version}.fail`,64*1024);
  probe('plan',`${row.card_id}_${version}.json`,2*1024*1024,row.plan_hash);
  probe('preview',row.filename,64*1024*1024,row.preview_hash);
  probe('source',`${row.card_id}_${version}.lifecycle-source`,64*1024*1024,row.source_hash);
  return {checks,scope:'Independent per-file inventory, not an atomic snapshot. Presence or matching hashes do not approve a card. The original release check is unchanged; missing success markers still block release.'};
}
