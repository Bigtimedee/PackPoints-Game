import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, wallets, rebatePayoutAccounts, rebatePayoutRequests, rebateLedger, userRiskState } from "@shared/schema";
import { cashbackPayoutService as service } from "../services/cashbackPayoutService";
import { stripeGlobalPayoutsProvider as provider } from "../services/stripeGlobalPayoutsProvider";
const userId = `payout-${randomUUID()}`;
const env = {...process.env};
let id: string;
const payment = (status: string) => ({id:'obp_'+id,livemode:true,status,amount:{value:2500,currency:'usd'},from:{financial_account:'fa_live'},to:{recipient:'acct_'+userId,payout_method:'usba_test'}});
beforeAll(async()=>{
 process.env.STRIPE_PAYOUTS_ENABLED='live';process.env.STRIPE_PAYOUTS_LIVE_RELEASE_APPROVED='true';process.env.STRIPE_PAYOUTS_SECRET_KEY_LIVE='rk_live_fake';process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_LIVE='fa_live'; process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST='sk_test_fake'; process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_TEST='fa_test'; process.env.NODE_ENV='test';process.env.APP_ENV='test';
 await db.insert(users).values({id:userId,username:userId,email:'test@example.invalid'});
 await db.insert(wallets).values({userId,rebateBalanceCents:10000});
 await db.insert(rebatePayoutAccounts).values({userId,stripeRecipientId:'acct_'+userId,sandbox:false,financialAccountId:'fa_live'});
 vi.spyOn(provider,'destination').mockResolvedValue({id:'usba_test',masked:'Bank ending 6789'});
 vi.spyOn(provider,'available').mockResolvedValue(100000);
});
afterAll(async()=>{vi.restoreAllMocks();process.env={...env}; await db.delete(rebateLedger).where(eq(rebateLedger.userId,userId));await db.delete(rebatePayoutRequests).where(eq(rebatePayoutRequests.userId,userId));await db.delete(rebatePayoutAccounts).where(eq(rebatePayoutAccounts.userId,userId));await db.delete(userRiskState).where(eq(userRiskState.userId,userId));await db.delete(wallets).where(eq(wallets.userId,userId));await db.delete(users).where(eq(users.id,userId));});
async function balance(){return (await db.select().from(wallets).where(eq(wallets.userId,userId)))[0].rebateBalanceCents;}
async function row(){return (await db.select().from(rebatePayoutRequests).where(eq(rebatePayoutRequests.id,id)))[0];}
describe.sequential('live-mode payout accounting (no network) with mocked provider',()=>{
 it('holds exactly once on concurrent duplicate request; no payout entry',async()=>{const key=randomUUID();const results=await Promise.all([service.request(userId,2500,key),service.request(userId,2500,key)]);id=results[0].requestId;expect(results[1].requestId).toBe(id);expect(await balance()).toBe(7500);expect((await db.select().from(rebateLedger).where(eq(rebateLedger.payoutRequestId,id))).map(x=>x.type)).toEqual(['ADJUSTMENT']);});
 it('minimum and mismatch retry cannot debit twice',async()=>{await expect(service.request(userId,1,randomUUID())).rejects.toThrow('Minimum');await expect(service.request(userId,3000,(await row()).requestKey!)).rejects.toThrow('retry');expect(await balance()).toBe(7500);});
 it('network ambiguity retains hold, never marks paid',async()=>{vi.spyOn(provider,'send').mockRejectedValueOnce(new Error('network timeout'));await expect(service.approve(id,'test-admin')).rejects.toThrow('timeout');expect((await row()).status).toBe('PROCESSING');expect(await balance()).toBe(7500);});
 it('retry uses same intent; processing is not paid',async()=>{vi.spyOn(provider,'send').mockResolvedValueOnce(payment('processing'));await service.approve(id,'test-admin');expect((await row()).status).toBe('PROCESSING');expect((await row()).stripePaymentId).toBe('obp_'+id);expect((await db.select().from(rebateLedger).where(eq(rebateLedger.payoutRequestId,id))).filter(x=>x.type==='PAYOUT')).toHaveLength(0);});
 it('another user cannot refresh payout',async()=>{await expect(service.refresh(id,'other-user')).rejects.toThrow('not found');});
 it('posted writes payout once, keeps reserved balance unchanged',async()=>{await service.applyProviderState(id,payment('posted'));await service.applyProviderState(id,payment('posted'));expect((await row()).status).toBe('SENT');expect(await balance()).toBe(7500);expect((await db.select().from(rebateLedger).where(eq(rebateLedger.payoutRequestId,id))).filter(x=>x.type==='PAYOUT')).toHaveLength(1);});
 it('stale processing cannot downgrade sent',async()=>{await service.applyProviderState(id,payment('processing'));expect((await row()).status).toBe('SENT');});
 it('returned refunds once, repeated/out-of-order evidence harmless',async()=>{await service.applyProviderState(id,payment('returned'));await service.applyProviderState(id,payment('returned'));await service.applyProviderState(id,payment('posted'));expect(await balance()).toBe(10000);expect((await row()).status).toBe('RETURNED');});
 it('freeze blocks request',async()=>{await db.insert(userRiskState).values({userId,status:'FROZEN'});await expect(service.request(userId,2500,randomUUID())).rejects.toThrow('frozen');await db.delete(userRiskState).where(eq(userRiskState.userId,userId));});
 it('confirmed failure releases hold once',async()=>{id=(await service.request(userId,2500,randomUUID())).requestId;vi.spyOn(provider,'send').mockResolvedValueOnce(payment('failed'));await service.approve(id,'test-admin');await service.applyProviderState(id,payment('failed'));expect(await balance()).toBe(10000);expect((await row()).status).toBe('FAILED');});
 it('deny restores unsubmitted funds, repeated deny rejected',async()=>{id=(await service.request(userId,2500,randomUUID())).requestId;await service.deny(id,'test-admin','not cleared');await expect(service.deny(id,'test-admin','again')).rejects.toThrow('unsubmitted');expect(await balance()).toBe(10000);});
 it('live configuration cannot approve, deny, refresh or reconcile a test row',async()=>{
 id=(await service.request(userId,2500,randomUUID())).requestId;
 await db.update(rebatePayoutRequests).set({sandbox:true}).where(eq(rebatePayoutRequests.id,id));
 await expect(service.approve(id,'test-admin')).rejects.toThrow('mode');
 await expect(service.refresh(id)).rejects.toThrow('mode');
 await expect(service.deny(id,'test-admin','no')).rejects.toThrow('unsubmitted');
 await expect(service.applyProviderState(id,payment('posted'))).rejects.toThrow('state');
 await db.update(rebatePayoutRequests).set({sandbox:false}).where(eq(rebatePayoutRequests.id,id)); await service.deny(id,'test-admin','test cleanup');
 });
 it('changed financial account fails closed before send',async()=>{
 id=(await service.request(userId,2500,randomUUID())).requestId;
 process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_LIVE='fa_other';
 await expect(service.approve(id,'test-admin')).rejects.toThrow('financial account');
 await expect(service.request(userId,2500,randomUUID())).rejects.toThrow('financial account');
 process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_LIVE='fa_live';await service.deny(id,'test-admin','cleanup');
 });
 it('recent positive grant blocks withdrawal',async()=>{await db.insert(rebateLedger).values({userId,amountCents:1,balanceAfterCents:10000,type:'GRANT',idempotencyKey:randomUUID()});await expect(service.request(userId,2500,randomUUID())).rejects.toThrow('30-day');});
});
