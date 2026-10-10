import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import { gameSessionsTable, type GameSession } from '@shared/schema';
import type * as Database from '../db';
import type * as SessionWrite from '../lib/sessionWrite';
import { createGameSessionReadHandler, createSoloRoundOwnershipGuard } from '../routes/gameSessionRead';

// Full-schema PostgreSQL fixture, real field-scoped writes and actual GET/guard.
// Signed-cookie Express fixture only: no full app startup, providers, wallets or reward engine.
// Ordinary CI has its own database and must not run this destructive fixture suite.
// Opt in explicitly; validate before importing any database-backed runtime module.
const enabled = process.env.SOLO_RECOVERY_PG_TEST === '1';
if (enabled) {
 const raw = process.env.DATABASE_URL;
 if (!raw) throw Error('SOLO_RECOVERY_PG_TEST requires the isolated fixture DATABASE_URL');
 let url: URL;
 try { url = new URL(raw); } catch { throw Error('Invalid isolated fixture DATABASE_URL'); }
 if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55487' || url.pathname !== '/solo_readiness_fixture' || url.search !== '' || url.hash !== '') {
  throw Error('Refusing non-isolated database for Solo recovery integration');
 }
}
let db: typeof Database.db, pool: typeof Database.pool;
let commitSoloAnswer: typeof SessionWrite.commitSoloAnswer;
let commitSoloAdvance: typeof SessionWrite.commitSoloAdvance;
let commitSoloComplete: typeof SessionWrite.commitSoloComplete;
let replaceGameSessionQuestion: typeof SessionWrite.replaceGameSessionQuestion;
let stampGameSessionQuestionFlag: typeof SessionWrite.stampGameSessionQuestionFlag;
describe.skipIf(!enabled)('PostgreSQL Solo recovery integration (explicit isolated opt-in)', () => {
const ids:string[]=[];let server:any,base:string;
const effect=vi.fn();
async function row(id:string){return (await db.select().from(gameSessionsTable).where(eq(gameSessionsTable.id,id)))[0]}
async function getRound(id:string){const r=await row(id);return r ? {...r,guestSessionId:r.guestSessionId??undefined,completedAt:r.completedAt??undefined} as GameSession:undefined}
async function seed(owner:string|null='fixture-alice',guest:string|null=null){const id=randomUUID();ids.push(id);await db.insert(gameSessionsTable).values({id,userId:owner,guestSessionId:guest,mode:'solo',questions:[0,1,2].map(i=>({card:{id:`fixture-card-${i}`},correctAnswer:'a',options:['a','b'],pointValue:40})),totalQuestions:3,status:'active',startedAt:new Date().toISOString()});return id}
async function cookie(path:string){const r=await fetch(base+path);return r.headers.get('set-cookie')!.split(';')[0]}
async function read(id:string,cookie?:string){return fetch(base+'/api/game/session/'+id,{headers:cookie?{cookie}:{}})}
beforeAll(async()=>{
 ({ db, pool } = await import('../db'));
 ({ commitSoloAnswer, commitSoloAdvance, commitSoloComplete, replaceGameSessionQuestion, stampGameSessionQuestionFlag } = await import('../lib/sessionWrite'));

 const app=express();app.use(express.json());app.use(session({secret:'isolated-readiness-fixture-cookie-secret',resave:false,saveUninitialized:false}));
 app.get('/fixture/local/:id',(req,res)=>{req.session.localUserId=req.params.id;res.json({ok:true})});
 app.get('/fixture/guest',(req,res)=>{req.session.guestId='fixture-guest';res.json({ok:true})});
 app.get('/fixture/claim-transition',(req,res)=>{req.session.localUserId='fixture-alice';delete req.session.guestId;res.json({ok:true})});
 app.get('/api/game/session/:id',createGameSessionReadHandler({getGameSession:getRound,sanitize:r=>({id:r.id,currentQuestionIndex:r.currentQuestionIndex,score:r.score,status:r.status,correctAnswers:r.correctAnswers,questions:r.questions.map(q=>({answered:!!q.answered,userAnswer:q.userAnswer,pointsEarned:q.pointsEarned,cardId:q.card.id}))})}));
 app.post('/fixture/report/:id',createSoloRoundOwnershipGuard({getGameSession:getRound,getSessionId:req=>req.params.id}),async(req,res)=>{effect();await stampGameSessionQuestionFlag(req.params.id,0,'imageFailure',true);res.json({ok:true})});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{for(const id of ids)await db.delete(gameSessionsTable).where(eq(gameSessionsTable.id,id));await new Promise<void>(r=>server.close(()=>r()));await pool.end()});
 it('recovers committed answer and accepted Next after discarded responses, without extra round/write/reward',async()=>{
  const id=await seed();const c=await cookie('/fixture/local/fixture-alice');const q:any=(await row(id)).questions[0];
  await commitSoloAnswer({sessionId:id,questionIndex:0,question:{...q,answered:true,userAnswer:'a',pointsEarned:40},score:40,correctAnswers:1,matchPointsAwarded:40});
  let r=await read(id,c);expect(r.status).toBe(200);let b=await r.json();expect(b.score).toBe(40);expect(b.currentQuestionIndex).toBe(0);expect(b.questions[0].answered).toBe(true);
  expect(await commitSoloAdvance({sessionId:id,expectedIndex:0,skippedQuestions:0,shownAt:'2026-10-10T13:00:00Z'})).toBe(true);
  expect(await commitSoloAdvance({sessionId:id,expectedIndex:0,skippedQuestions:0,shownAt:'not-rewritten'})).toBe(false);
  const snapshot=await row(id);for(let n=0;n<3;n++){r=await read(id,c);b=await r.json();expect(b.currentQuestionIndex).toBe(1);expect(b.score).toBe(40);expect(r.headers.get('cache-control')).toBe('private, no-store')}
  expect(await row(id)).toEqual(snapshot);expect(snapshot.matchPointsAwarded).toBe(40);
  expect((await pool.query('select count(*)::int n from game_sessions')).rows[0].n).toBe(ids.length);
 });
 it('concurrent replacement/advance keeps current index, replacement, answer and unrelated question',async()=>{
  const id=await seed();const qs:any=(await row(id)).questions;const replacement={...qs[0],card:{id:'fixture-replaced'},imageFailure:true};
  await Promise.all([replaceGameSessionQuestion(id,0,replacement),commitSoloAdvance({sessionId:id,expectedIndex:0,skippedQuestions:0,shownAt:'2026-10-10T13:00:00Z'})]);
  const r=await row(id);expect(r.currentQuestionIndex).toBe(1);expect(r.questions[0]).toEqual(replacement);expect(r.questions[2]).toEqual(qs[2]);
 });
 it('completed round reload stays completed, with no restart or award write',async()=>{const id=await seed();await commitSoloComplete({sessionId:id,score:80,skippedQuestions:1,completedAt:'2026-10-10T13:00:00Z'});const before=await row(id);const c=await cookie('/fixture/local/fixture-alice');expect((await (await read(id,c)).json()).status).toBe('completed');expect(await row(id)).toEqual(before)});
 it('signed-cookie wrong/absent/tampered identity blocks read and report before SQL flag writes',async()=>{const id=await seed();const c=await cookie('/fixture/local/fixture-bob');const before=await row(id);effect.mockClear();for(const bad of [undefined,c,c.replace(/.$/,'X')]){expect((await read(id,bad)).status).toBe(403);const r=await fetch(base+'/fixture/report/'+id,{method:'POST',headers:bad?{cookie:bad}:{}});expect(r.status).toBe(403)}expect(effect).not.toHaveBeenCalled();expect(await row(id)).toEqual(before)});
 it('original guest cookie recovers; login+guestId removal fails closed without assigning the old round',async()=>{const id=await seed(null,'fixture-guest');const c=await cookie('/fixture/guest');expect((await read(id,c)).status).toBe(200);const before=await row(id);const transition=await fetch(base+'/fixture/claim-transition',{headers:{cookie:c}});expect(transition.status).toBe(200);expect((await read(id,c)).status).toBe(403);expect((await fetch(base+'/fixture/report/'+id,{method:'POST',headers:{cookie:c}})).status).toBe(403);expect(await row(id)).toEqual(before);expect(before.userId).toBeNull();expect(before.guestSessionId).toBe('fixture-guest')});
 it('owner report guard still reaches bounded local effect; missing and expired reads explicit',async()=>{const id=await seed();const c=await cookie('/fixture/local/fixture-alice');effect.mockClear();expect((await fetch(base+'/fixture/report/'+id,{method:'POST',headers:{cookie:c}})).status).toBe(200);expect(effect).toHaveBeenCalledOnce();expect((await row(id)).questions[0].imageFailure).toBe(true);expect((await read('nonexistent-fixture',c)).status).toBe(404);await db.update(gameSessionsTable).set({status:'expired'}).where(eq(gameSessionsTable.id,id));expect((await read(id,c)).status).toBe(410)});
});
