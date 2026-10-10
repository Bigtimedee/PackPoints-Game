import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { submitAnswerSchema } from '@shared/schema';
import * as ownership from '../routes/gameSessionRead';

// Executes the checked-in route registrations and exact handler prefixes up to
// the first replay/effect boundary. No providers, rewards, or real identities.
const source = readFileSync(new URL('../routes.ts', import.meta.url),'utf8');
const ast = ts.createSourceFile('routes.ts',source,ts.ScriptTarget.Latest,true);
const registrations = new Map<string,ts.CallExpression>();
function visit(n:ts.Node) { if(ts.isCallExpression(n) && n.expression.getText(ast)==='app.post' && ts.isStringLiteral(n.arguments[0])) registrations.set(n.arguments[0].text,n); ts.forEachChild(n,visit) } visit(ast);
function prefix(expr:string, marker:string) {const end=expr.indexOf(marker);if(end<0)throw Error('Missing tested boundary '+marker);return expr.slice(0,end)+' return onAllowed(req,res); } catch(error) { throw error; } }'}
const reportStart = source.indexOf('const reportCardImage = ')+ 'const reportCardImage = '.length;
const reportPrefix = prefix(source.slice(reportStart),'// @shared/schema imports moved');
const paths=['/api/game/answer','/api/game/next','/api/game/session/:id/replace-card','/api/cards/:cardId/report','/api/game/session/:id/report-image','/api/play/report'];
function fixture(path:string, round:any) {
 const effects=vi.fn((_req:any,res:any)=>res.json({allowed:true}));
 const storage={getGameSession:vi.fn(async()=>structuredClone(round))};
 const globals:any={storage,...ownership,submitAnswerSchema,formatZodError:()=>'',answerSubmitLimiter:(_q:any,_r:any,next:any)=>next(),onAllowed:effects,findQuestionIndexByCardId:()=>0,handlePlayImageReport:effects,resolveReportedCardId:vi.fn()};
 function evaluate(expr:string){const code=ts.transpile('const handler = '+expr, {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});return new Function(...Object.keys(globals),code+';return handler;')(...Object.values(globals))}
 globals.reportCardImage=evaluate(reportPrefix);
 const call=registrations.get(path)!;
 const handlers=call.arguments.slice(1).map(arg=>{
  let expr=arg.getText(ast);
  if(ts.isArrowFunction(arg)) {
   if(path==='/api/game/answer')expr=prefix(expr,'if (userId) {');
   if(path==='/api/game/next')expr=prefix(expr,'if (reason === "image_failure")');
   if(path.endsWith('/replace-card'))expr=prefix(expr,'if (session.status !== "active")');
   if(path==='/api/play/report')expr=expr.replace(/await handlePlayImageReport[\s\S]*/, 'return onAllowed(req,res); }');
  }
  return evaluate(expr);
 });
 return {effects,storage,async run(identity:any,body:any={}){
  const req:any={body:{sessionId:'fixture',questionIndex:0,selectedAnswer:'a',scope:'solo',...body},params:{id:'fixture',cardId:'fixture-card'},session:identity.session||{},user:identity.user,isAuthenticated:()=>!!identity.authenticated};
  const res:any={code:200,status(n:number){this.code=n;return this},json(value:any){this.value=value;return this}};
  for(const h of handlers){let next=false;await h(req,res,()=>{next=true});if(!next)break}
  return res;
 }};
}
const registered={id:'fixture',userId:'alice',guestSessionId:null,status:'active',questions:[{card:{id:'fixture-card'}}],currentQuestionIndex:0};
const guest={...registered,userId:null,guestSessionId:'guest-a'};
const negatives=[['no identity',{},registered],['other local',{session:{localUserId:'bob'}},registered],['other authenticated passport',{user:{claims:{sub:'bob'}},authenticated:true},registered],['untrusted passport claim',{user:{claims:{sub:'alice'}}},registered],['conflicting identities',{session:{localUserId:'alice'},user:{claims:{sub:'bob'}},authenticated:true},registered],['wrong guest',{session:{guestId:'guest-b'}},guest],['claimed guest with residual cookie',{session:{localUserId:'alice',guestId:'guest-a'}},guest]] as const;
for(const path of paths)describe(path,()=>{
 for(const [name,identity,round] of negatives)it('rejects '+name+' before replay/effects',async()=>{const f=fixture(path,round);expect((await f.run(identity)).code).toBe(403);expect(f.effects).not.toHaveBeenCalled()});
 for(const [name,identity,round] of [['local',{session:{localUserId:'alice'}},registered],['passport',{user:{claims:{sub:'alice'}},authenticated:true},registered],['original guest',{session:{guestId:'guest-a'}},guest]] as const)it('allows '+name+' to reach existing handler',async()=>{const f=fixture(path,round);expect((await f.run(identity)).code).toBe(200);expect(f.effects).toHaveBeenCalledOnce()});
 it('keeps missing round explicit',async()=>{const f=fixture(path,undefined);expect((await f.run({})).code).toBe(404);expect(f.effects).not.toHaveBeenCalled()});
});
it('keeps public card report without session context anonymous',async()=>{const f=fixture('/api/cards/:cardId/report',undefined);expect((await f.run({}, {sessionId:undefined,questionIndex:undefined})).code).toBe(200);expect(f.effects).toHaveBeenCalledOnce()});
it('leaves non-Solo play report authorization outside this bounded change',async()=>{const f=fixture('/api/play/report',undefined);expect((await f.run({}, {scope:'d5'})).code).toBe(200);expect(f.storage.getGameSession).not.toHaveBeenCalled()});
