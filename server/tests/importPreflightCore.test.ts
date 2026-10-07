import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { CreatePlayableSetSchema, ImportPreflightInput, exactImportParameters, describeImportPreflight, performImportPreflight } from '../services/importPreflightCore';
const params=exactImportParameters('"1988 Topps All-Star"','Baseball');
const cards=Array.from({length:20},(_,i)=>({card_id:`card-${i}`,player:'Player',set:'Actual source',number:`${i}`,image:'https://example.com/image.jpg'}));
describe('read-only exact import preflight',()=>{
  it('shares exact importer parameters, preserving quotes, category and paging without general search',()=>{
    expect(params).toEqual({set:'"1988 Topps All-Star"',category:'Baseball',page:1,page_size:100});
    expect(exactImportParameters('Source',null,3,50)).toEqual({set:'Source',category:undefined,page:3,page_size:50});
    expect(params).not.toHaveProperty('search');
    const source=readFileSync(new URL('../routes.ts',import.meta.url),'utf8');
    expect(source).toContain('performImportPreflight(parsed.data, cardSearch)');
    expect(source).toContain('cardSearch(exactImportParameters(gameSet.cardhedgeSetQuery, gameSet.cardhedgeCategory, page, pageSize))');
  });
  it('shows exposed provider total and pages, separately from sample count',()=>{
    const r=describeImportPreflight({cards,count:240,pages:3},params);
    expect(r.totalCards).toBe(240);expect(r.pages).toBe(3);expect(r.sampleCount).toBe(20);expect(r.cards).toHaveLength(20);
  });
  it('never infers totals or page counts from sample length',()=>{
    const r=describeImportPreflight({cards},params);expect(r.totalCards).toBeNull();expect(r.pages).toBeNull();expect(r.totalStatus).toBe('unknown');
  });
  it('preserves zero without truthy fallback, and accepts explicit total alias',()=>{
    expect(describeImportPreflight({cards:[],count:0,pages:0},params).totalCards).toBe(0);
    expect(describeImportPreflight({cards:[],total:24,pages:1},params).totalCards).toBe(24);
  });
  it('fails unknown for conflicting, invalid or smaller-than-sample totals',()=>{
    for(const bad of [{count:20,total:24},{count:-1},{count:'24'},{count:2},{count:NaN}]) expect(describeImportPreflight({cards,...bad},params).totalCards).toBeNull();
    expect(describeImportPreflight({cards,pages:0},params).pages).toBeNull();
  });
  it('rejects malformed responses and input without inventing an empty result',()=>{
    expect(()=>describeImportPreflight({},params)).toThrow();expect(()=>describeImportPreflight(null,params)).toThrow();
    expect(ImportPreflightInput.safeParse({set:''}).success).toBe(false);expect(ImportPreflightInput.safeParse({set:' ',category:'Baseball'}).success).toBe(false);
    expect(ImportPreflightInput.safeParse({set:'Exact',category:'Baseball'}).success).toBe(true);
  });
  it('sanitizes preview sources without returning raw provider data',()=>{
    const r=describeImportPreflight({cards:[{image:'javascript:alert(1)',token:'secret'},{image:'//example.com/a.jpg'}]},params);
    expect(r.cards[0].imageUrl).toBeNull();expect(r.cards[0]).not.toHaveProperty('token');expect(r.cards[1].imageUrl).toBe('https://example.com/a.jpg');
  });
  it('preserves inactive false on actual create schema and insert handler',()=>{
    const base={sport:'baseball',brand:'Topps',year:1987,setName:'QA'};
    expect(CreatePlayableSetSchema.parse({...base,isActive:false}).isActive).toBe(false);
    expect(CreatePlayableSetSchema.parse(base).isActive).toBe(true);
    expect(()=>CreatePlayableSetSchema.parse({...base,isActive:'false'})).toThrow();
    const source=readFileSync(new URL('../routes.ts',import.meta.url),'utf8');expect(source).toContain('isActive: validated.isActive');
  });
});

describe('preflight provider boundary',()=>{
  it('uses live exact-import parameters and no-cache once, never general search',async()=>{
    const provider=vi.fn().mockResolvedValue({cards,count:24,pages:1});
    const result=await performImportPreflight({set:params.set,category:params.category},provider);
    expect(result.status).toBe(200);expect(provider).toHaveBeenCalledExactlyOnceWith(params,{useCache:false});
  });
  it('does not call provider for invalid input',async()=>{
    const provider=vi.fn();expect((await performImportPreflight({set:''},provider)).status).toBe(400);expect(provider).not.toHaveBeenCalled();
  });
  it('returns a safe error rather than zero or leaked upstream credentials',async()=>{
    const provider=vi.fn().mockRejectedValue(new Error('Provider key=secret and raw diagnostics'));
    const result=await performImportPreflight({set:'Exact',category:'Football'},provider);
    expect(result.status).toBe(503);expect(JSON.stringify(result.body)).not.toContain('secret');expect(result.body).not.toHaveProperty('totalCards');
    // Source-wiring assertion (not a rendered UI test): failed/rechecking state cannot reuse old success.
    const component=readFileSync(new URL('../../client/src/components/admin-import-preflight.tsx',import.meta.url),'utf8');
    expect(component).toContain('!check.isPending && !check.isError');
  });
  it('malformed upstream cards fail unavailable, not an empty success',async()=>{
    expect((await performImportPreflight({set:'Exact'},vi.fn().mockResolvedValue({count:0}))).status).toBe(503);
  });
});
