import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
const state = vi.hoisted(() => ({ rows: [] as any[], bake: vi.fn(), file: null as string | null }));
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: async () => state.rows, leftJoin: () => ({ where: async () => state.rows }) }) }) } }));
vi.mock("../auth", () => ({ isAuthenticated: (req:any,res:any,next:any) => req.headers['x-test-auth'] ? next() : res.status(401).json({error:'unauthorized'}) }));
vi.mock("../auth/requireAdmin", () => ({ requireAdmin: (req:any,res:any,next:any) => req.headers['x-test-admin'] ? next() : res.status(403).json({error:'admin required'}) }));
vi.mock("../masking/maskingService", () => ({ getMaskedImagePath: state.bake }));
vi.mock("../masking/maskReadySidecar", () => ({ readMaskFailureReason: () => null, maskReadySidecarDir: () => '/tmp' }));
vi.mock("../services/heldMaskPreparation", async (original) => ({ ...await original<typeof import('../services/heldMaskPreparation')>(), preparedMaskFile: () => state.file }));
import { registerHeldMaskPreparationRoutes } from "../routes/heldMaskPreparation";
const setId='3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4';const cardId='e85efdfd-415e-418f-b8d2-0fe1da023f36';
const app=express();app.use(express.json());registerHeldMaskPreparationRoutes(app);const server=createServer(app);let base='';
beforeAll(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/held-sets`;});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
const headers={'x-test-auth':'1','x-test-admin':'1','Content-Type':'application/json'};
describe('held mask routes',()=>{
 it('requires auth/Admin, only known held set, and explicit preparation confirmation',async()=>{
  expect((await fetch(`${base}/${setId}/review`)).status).toBe(401);
  expect((await fetch(`${base}/${setId}/review`,{headers:{'x-test-auth':'1'}})).status).toBe(403);
  expect((await fetch(`${base}/other/review`,{headers})).status).toBe(404);
  expect((await fetch(`${base}/${setId}/prepare`,{method:'POST',headers,body:JSON.stringify({cardIds:[cardId]})})).status).toBe(400);
  expect(state.bake).not.toHaveBeenCalled();
 });
 it('does not bake a cold GET preview or review listing',async()=>{
  state.rows=[{id:cardId,cardId,source:'seed'}];state.file=null;
  expect((await fetch(`${base}/${setId}/preview/${cardId}`,{headers})).status).toBe(409);
  const review=await fetch(`${base}/${setId}/review`,{headers});expect(review.status).toBe(200);
  expect((await review.json()).cards[0]).toMatchObject({source:'seed',maskReady:false});
  expect(state.bake).not.toHaveBeenCalled();
 });
 it('rejects the entire wrong/excluded batch before dispatch and starts only explicit eligible IDs',async()=>{
  state.rows=[];
  const request={method:'POST',headers,body:JSON.stringify({reviewed:true,cardIds:[cardId]})};
  expect((await fetch(`${base}/${setId}/prepare`,request)).status).toBe(422);expect(state.bake).not.toHaveBeenCalled();
  state.rows=[{id:cardId}];state.file=null;state.bake.mockResolvedValue('mask.jpg');
  const response=await fetch(`${base}/${setId}/prepare`,request);expect(response.status).toBe(202);
  const data=await response.json();
  const status=await fetch(`${base}/${setId}/prepare/${data.id}`,{headers});expect(status.status).toBe(200);
  const job=await status.json();expect(job.cardIds).toEqual([cardId]);expect(state.bake).toHaveBeenCalledWith(cardId,{priority:'warm'});
 });
 it('requires visual confirmation, note and current version before any approval write',async()=>{
  const response=await fetch(`${base}/${setId}/approve-reviewed`,{method:'POST',headers,body:JSON.stringify({reviewed:true,cardIds:[cardId],note:'review'})});
  expect(response.status).toBe(400);
 });
});
