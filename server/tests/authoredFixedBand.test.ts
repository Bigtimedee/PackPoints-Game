import { afterEach, describe, expect, it } from 'vitest';
import { resolveNameMaskPlan } from '../masking/nameLocalization';
import { replaceLifecycleRegistry } from '../services/setLifecycleRegistry';
import { customBandProfile, profileRevision } from '../services/setLifecycleCore';
import { readFileSync } from 'fs';
const id='00000000-0000-4000-8000-000000000099';
function plan(edge:'top'|'bottom',height:number,extra:Record<string,unknown>={}){
  const profile=customBandProfile({edge,height})!;
  replaceLifecycleRegistry([{setId:id,identity:'test',revision:'test',profile,published:false}]);
  return resolveNameMaskPlan({playerName:'Willie Mays',gameSetId:id,setHint:'1969 QA Deckle',words:[],imageWidth:705,imageHeight:1200,...extra});
}
afterEach(()=>replaceLifecycleRegistry([]));
describe('exact Admin-authored bands',()=>{
  it('does not shrink a saved45% band to a smaller detected bottom plate',()=>{
    const p=plan('bottom',45,{plateBox:{x:0,y:950,w:705,h:200}});
    expect(p.regions).toEqual(customBandProfile({edge:'bottom',height:45})!.regions);
    expect(p.regions[0]).toMatchObject({yPct:55,hPct:45});
    expect(p.plateTrace.decision).toBe('authored_fixed_band');
    expect(p.namePlateUnresolved).toBe(false);
  });
  it('does not expand a top band based on detector guesses',()=>{
    expect(plan('top',12,{plateBox:{x:0,y:0,w:705,h:250}}).regions).toEqual(customBandProfile({edge:'top',height:12})!.regions);
  });
  it('refuses slabs without changing the declared geometry',()=>{
    const p=plan('bottom',45,{slabLayout:true});
    expect(p.namePlateUnresolved).toBe(true);
    expect(p.regions).toEqual(customBandProfile({edge:'bottom',height:45})!.regions);
  });
  it('refuses a recognized off-band surname instead of moving or enlarging the band',()=>{
    const p=plan('bottom',45,{words:[{text:'Mays',confidence:95,x:50,y:500,w:150,h:50}]});
    expect(p.namePlateUnresolved).toBe(true);
    expect(p.regions[0]).toMatchObject({yPct:55,hPct:45});
  });
  it('allows a recognized in-band surname with unchanged geometry',()=>{
    const p=plan('bottom',45,{words:[{text:'Mays',confidence:95,x:50,y:720,w:150,h:70}]});
    expect(p.namePlateUnresolved).toBe(false);
    expect(p.nameBoxes.length).toBeGreaterThan(0);
  });
  it('changes profile revision so old masks/approvals cannot satisfy the repaired layout',()=>{
    const current=customBandProfile({edge:'bottom',height:45})!;
    const {fixedNameBand:_,...old}=current;
    const identity={year:1969,brand:'QA',sport:'baseball',setName:'QA Deckle'};
    expect(profileRevision(identity,current)).not.toBe(profileRevision(identity,old));
  });
  it('hydrates controls from saved revision rather than showing a fresh16% default on reopening',()=>{
    const src=readFileSync(new URL('../../client/src/components/admin-set-lifecycle.tsx',import.meta.url),'utf8');
    expect(src).toContain('const profile=data?.lifecycle?.profile');
    expect(src).toContain('[data?.lifecycle?.revision]');
    expect(src).toContain('setHeight(Math.round(fraction*10000)/100)');
  });
});
