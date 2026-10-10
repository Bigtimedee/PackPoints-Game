import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import { PGlite } from '@electric-sql/pglite';
import { createGameSessionReadHandler, ownsStoredRound } from '../routes/gameSessionRead';
import type { GameSession } from '@shared/schema';
import type { Request } from 'express';

const round = (owner:string|null, guest?:string,status='active') => ({id:'round',userId:owner,guestSessionId:guest,status,mode:'solo',questions:[],score:10,currentQuestionIndex:1,totalQuestions:5,correctAnswers:1,startedAt:'2026-10-10T12:00:00Z'} as GameSession);
const request = (local?:string,guest?:string,claims?:string,authenticated=false)=>({session:{localUserId:local,guestId:guest},user:{claims:{sub:claims}},isAuthenticated:()=>authenticated} as unknown as Request);
describe('stored round ownership',()=>{
 it('allows same local account, refuses other account and guest',()=>{expect(ownsStoredRound(request('alice'),round('alice'))).toBe(true);expect(ownsStoredRound(request('bob'),round('alice'))).toBe(false);expect(ownsStoredRound(request(undefined,'alice'),round('alice'))).toBe(false)});
 it('trusts passport claims only with passport authentication',()=>{expect(ownsStoredRound(request(undefined,undefined,'alice',true),round('alice'))).toBe(true);expect(ownsStoredRound(request(undefined,undefined,'alice',false),round('alice'))).toBe(false)});
 it('fails closed on conflicting authenticated identities',()=>{expect(ownsStoredRound(request('alice',undefined,'bob',true),round('alice'))).toBe(false);expect(ownsStoredRound(request('alice',undefined,'bob',true),round('bob'))).toBe(false)});
 it('allows exactly the original server session guest, not hints or switched account',()=>{expect(ownsStoredRound(request(undefined,'guest-a'),round(null,'guest-a'))).toBe(true);expect(ownsStoredRound(request(undefined,'guest-b'),round(null,'guest-a'))).toBe(false);expect(ownsStoredRound(request('alice','guest-a'),round(null,'guest-a'))).toBe(false);expect(ownsStoredRound(request(),round(null))).toBe(false)});
});
describe('actual GET handler with signed cookies and isolated SQL rows',()=>{
 const db = new PGlite();let server:any,base:string;let sanitize=vi.fn((r:GameSession)=>({id:r.id,score:r.score,currentQuestionIndex:r.currentQuestionIndex}));let failed=false;
 beforeAll(async()=>{
  await db.exec('CREATE TABLE game_sessions (id text primary key, data jsonb not null)');
  for(const [id,r] of [['registered',round('alice')],['guest',round(null,'guest-a')],['expired',round('alice',undefined,'expired')]] as const) await db.query('INSERT INTO game_sessions VALUES ($1,$2)',[id,JSON.stringify({...r,id})]);
  const app=express();app.use(session({secret:'isolated-test-signing-secret-not-production',resave:false,saveUninitialized:false}));
  app.get('/fixture/login/:user',(req,res)=>{req.session.localUserId=req.params.user;res.json({ok:true})});
  app.get('/fixture/guest',(req,res)=>{req.session.guestId='guest-a';res.json({ok:true})});
  app.get('/api/game/session/:id',createGameSessionReadHandler({getGameSession:async id=>{if(failed)throw Error('isolated database unavailable'); const q=await db.query<{data:GameSession}>('SELECT data FROM game_sessions WHERE id=$1',[id]);return q.rows[0]?.data},sanitize}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 });
 afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await db.close()});
 async function cookie(path:string){const r=await fetch(base+path);return r.headers.get('set-cookie')!.split(';')[0]}
 async function read(id:string,cookie?:string){return fetch(base+'/api/game/session/'+id,{headers:cookie?{cookie}:{}})}
 it('registered cookie recovers exact persisted score/index repeatedly with no SQL mutation',async()=>{const c=await cookie('/fixture/login/alice');const before=await db.query('SELECT * FROM game_sessions ORDER BY id');for(let i=0;i<2;i++){const r=await read('registered',c);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(await r.json()).toEqual({id:'registered',score:10,currentQuestionIndex:1})}expect(await db.query('SELECT * FROM game_sessions ORDER BY id')).toEqual(before)});
 it('guest original signed cookie recovers, absent or tampered cookies do not',async()=>{const c=await cookie('/fixture/guest');expect((await read('guest',c)).status).toBe(200);expect((await read('guest')).status).toBe(403);expect((await read('guest',c.replace(/.$/,'X'))).status).toBe(403)});
 it('cross-account and guest-to-account switch fail before sanitizer without claim/migration',async()=>{const c=await cookie('/fixture/login/bob');sanitize.mockClear();expect((await read('registered',c)).status).toBe(403);expect((await read('guest',c)).status).toBe(403);expect(sanitize).not.toHaveBeenCalled()});
 it('not found, expired and failed storage are explicit without replacement or expiry writes',async()=>{const c=await cookie('/fixture/login/alice');expect((await read('missing',c)).status).toBe(404);expect((await read('expired',c)).status).toBe(410);failed=true;expect((await read('registered',c)).status).toBe(500);failed=false;expect((await read('registered',c)).status).toBe(200)});
});
