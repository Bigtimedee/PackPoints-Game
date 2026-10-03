import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
vi.mock("../db", () => ({ db: {}, pool: {} }));
import { explicitPreparationIds, preparedMaskFile, prepareExplicitCards } from "../services/heldMaskPreparation";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
const id = "e85efdfd-415e-418f-b8d2-0fe1da023f36";
describe("held preparation", () => {
  it("requires bounded reviewed explicit IDs, no all or duplicates", () => {
    for (const body of [null, {}, {cardIds:[id]}, {reviewed:true,cardIds:[]}, {reviewed:true,cardIds:[id,id]},
      {reviewed:true,cardIds:['../secret']}, {reviewed:true,cardIds:[id],all:false}, {reviewed:true,cardIds:Array(21).fill(id)}])
      expect(explicitPreparationIds(body)).toBeNull();
    expect(explicitPreparationIds({reviewed:true,cardIds:[id]})).toEqual([id]);
  });
  it("preview fails closed and performs no writes, even with a JPEG and marker but no exact plan", () => {
    const dir=mkdtempSync(path.join(tmpdir(),'prepare-preview-'));
    try {
      const file=(ext:string,body:string)=>writeFileSync(path.join(dir,`${id}_${CURRENT_MASK_VERSION}.${ext}`),body);
      expect(preparedMaskFile(id,dir)).toBeNull(); expect(readdirSync(dir)).toEqual([]);
      file('jpg','fixture');file('ok','ok');
      const before=readdirSync(dir); expect(preparedMaskFile(id,dir)).toBeNull();expect(readdirSync(dir)).toEqual(before);
      file('json',JSON.stringify({maskVersion:CURRENT_MASK_VERSION,layoutClass:'BOTTOM_PLAQUE',regions:[{xPct:0,yPct:84,wPct:100,hPct:16,type:'blur'}]}));
      expect(preparedMaskFile(id,dir)).toBe(path.join(dir,`${id}_${CURRENT_MASK_VERSION}.jpg`));
      const snapshots=readdirSync(dir).map(n=>[n,readFileSync(path.join(dir,n),'utf8')]);
      preparedMaskFile(id,dir);
      expect(readdirSync(dir).map(n=>[n,readFileSync(path.join(dir,n),'utf8')])).toEqual(snapshots);
      file('fail','name uncovered');expect(preparedMaskFile(id,dir)).toBeNull();
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  it("dispatches sequentially and reports ready/refusal/errors per explicit ID", async () => {
    let active=0,max=0;const result:unknown[]=[];
    await prepareExplicitCards(['ready','refused','error'],async id=>{
      active++;max=Math.max(max,active);await Promise.resolve();active--;
      if(id==='error')throw new Error('private detail');
    },id=>id==='ready',()=> 'name_plate_unresolved',r=>result.push(r));
    expect(max).toBe(1);
    expect(result).toEqual([{cardId:'ready',status:'ready'},{cardId:'refused',status:'refused',reason:'name_plate_unresolved'},
      {cardId:'error',status:'error',reason:'bake_failed'}]);
  });
  it("does not couple the pure preview path to baking", () => {
    const source=readFileSync(new URL('../services/heldMaskPreparation.ts',import.meta.url),'utf8');
    const preview=source.slice(source.indexOf('export function preparedMaskFile'),source.indexOf('export interface PreparedCardResult'));
    expect(preview).not.toMatch(/getMaskedImagePath|writeFile|acceptWarm|ensureHeld/);
    expect(preview).not.toMatch(/readyDonrussCardIds|readdir/);
    expect(preparedMaskFile("../secret")).toBeNull();
  });
  it("protects all routes with Admin auth and keeps production containment", () => {
    const source=readFileSync(new URL('../routes/heldMaskPreparation.ts',import.meta.url),'utf8');
    expect(source).toContain('app.use(base, isAuthenticated, requireAdmin');
    expect(source).toContain('req.params.setId !== DONRUSS_1987_HOLD_ID');
    expect(source).toContain('source: "qa"');expect(source).toContain('setWhere: eq(cardReviewApprovals.source, "seed")');
    expect(source).toContain('FOR UPDATE');expect(source).toContain('ignoreHeldSets: true, ignoreCardReview: true');
    expect(source).not.toMatch(/setCardReviewGuardEnabled|clearedSetIds\(|invalidateMaskedImageCache|restorePlayable/);
    const hold=readFileSync(new URL('../config/heldSets.ts',import.meta.url),'utf8');
    expect(hold).toContain('ids.delete(DONRUSS_1987_HOLD_ID)');
  });
});
