import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
const f=vi.hoisted(()=>({ready:[] as string[],managed:false,allowed:false}));
vi.mock('../services/setLifecycle',()=>({managedReadyIds:()=>f.ready,lifecycleCardAllowed:async()=>f.allowed}));
vi.mock('../db',()=>({db:{select:()=>({from:(table:any)=>({where:()=>({limit:async()=>getTableName(table)==='playable_cards'?[{id:'card',gameSetId:'set',blockedReason:null,lifecycleManaged:f.managed}]:[{id:'set',year:2026,brand:'Fixture',sport:'baseball',setName:'Fixture',isActive:true,isUserCreated:false}]})})})}}));
vi.mock('../config/heldSets',()=>({holdReasonForIdentity:()=>null}));
vi.mock('../masking/maskDealRefusal',()=>({refusedAtCurrentMask:()=>false,maskRefusalStillClearSql:()=>{throw new Error('not called');}}));
import { managedSetCardReadySql } from '../services/playableSetEligibility';
import { publicMaskDenyReason,resetPublicMaskSetCacheForTests } from '../services/publicMaskGate';
let pg:PGlite;
async function passes(){const q=new PgDialect().sqlToQuery(managedSetCardReadySql('pc'));return (await pg.query(`SELECT id FROM playable_cards pc WHERE ${q.sql}`,q.params)).rows.length>0;}
beforeAll(async()=>{pg=new PGlite();await pg.exec(`
CREATE TABLE game_sets(id varchar,year int,brand text,sport text,set_name text,is_active boolean,is_user_created boolean);
CREATE TABLE playable_cards(id varchar,game_set_id varchar,image_url text,player text,number text,image_rotation int);
CREATE TABLE admin_set_lifecycles(set_id varchar,identity text,revision text,published boolean);
CREATE TABLE admin_set_card_reviews(card_id varchar,set_id varchar,revision text,status text,witness jsonb);
INSERT INTO game_sets VALUES ('set',2026,'Fixture','baseball','Fixture',true,false);
INSERT INTO playable_cards VALUES ('card','set','https://fixture.invalid/a','Alice','1',0);
`);});
afterAll(async()=>{await pg?.close();});
beforeEach(async()=>{f.ready=[];f.managed=false;f.allowed=false;resetPublicMaskSetCacheForTests();await pg.exec(`DELETE FROM admin_set_lifecycles;DELETE FROM admin_set_card_reviews;UPDATE game_sets SET year=2026;`);});
describe('managed deal and public-image guards',()=>{
 it('does not bypass DB enrollment when local registry/readiness is empty',async()=>{
  expect(await passes()).toBe(true);
  await pg.exec(`INSERT INTO admin_set_lifecycles VALUES ('set','[2026,"Fixture","baseball","Fixture"]','rev',false);`);
  expect(await passes()).toBe(false);
 });
 it('requires published revision, approved witness, actual-file-ready ID and exact identity',async()=>{
  await pg.exec(`INSERT INTO admin_set_lifecycles VALUES ('set','[2026,"Fixture","baseball","Fixture"]','rev',true);
  INSERT INTO admin_set_card_reviews VALUES ('card','set','rev','approved','{"imageUrl":"https://fixture.invalid/a","player":"Alice","number":"1","imageRotation":0}');`);
  expect(await passes()).toBe(false);f.ready=['card'];expect(await passes()).toBe(true);
  await pg.exec('UPDATE game_sets SET year=2027');expect(await passes()).toBe(false);await pg.exec('UPDATE game_sets SET year=2026');
  await pg.exec("UPDATE admin_set_card_reviews SET revision='stale'");expect(await passes()).toBe(false);
 });
 it('public mask checks managed approval even when an Admin asks to skip a set hold',async()=>{
  f.managed=true;expect(await publicMaskDenyReason('card',{allowHeld:true})).toBe('refused');
  f.allowed=true;expect(await publicMaskDenyReason('card')).toBeNull();
  f.managed=false;f.allowed=false;expect(await publicMaskDenyReason('card')).toBeNull();
 });
});
