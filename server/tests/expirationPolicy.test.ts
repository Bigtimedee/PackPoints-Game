import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  ledgerEntries,
  packptsBucket,
  packptsExpirationPolicy,
  packptsSpendAllocation,
  users,
  wallets,
} from "@shared/schema";
import { db } from "../db";
import {
  bucketService,
  ensureExpirationPolicy,
  formatActiveExpirationPolicyLog,
  NO_ACTIVE_EXPIRATION_POLICY_LOG,
} from "../services/bucketService";
import { expirationEngine, formatExpirationRunSummary } from "../services/expirationEngine";
import { walletService } from "../services/walletService";

function expectExpiresInDays(earnedAt: Date | string, expiresAt: Date | string | null, days: number) {
  expect(expiresAt).not.toBeNull();
  const earned = new Date(earnedAt);
  const expected = new Date(earned);
  expected.setDate(expected.getDate() + days);
  const actual = new Date(expiresAt!);
  expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(2000);
}

async function countPolicies(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(packptsExpirationPolicy);
  return Number(row?.count ?? 0);
}

async function deactivateAllPolicies(): Promise<void> {
  await db
    .update(packptsExpirationPolicy)
    .set({ enabled: false, updatedAt: new Date() })
    .where(sql`true`);
}

describe("expiration policy log format", () => {
  it("formats the boot line and the missing-policy warning", () => {
    expect(formatActiveExpirationPolicyLog({
      id: "pol_1",
      earnedDaysToExpire: 365,
      bonusDefaultDaysToExpire: 90,
      purchasedDaysToExpire: null,
    })).toBe("[Expiration] policy=pol_1 earned=365 bonus=90 purchased=never");

    expect(formatActiveExpirationPolicyLog({
      id: "pol_2",
      earnedDaysToExpire: 100,
      bonusDefaultDaysToExpire: 30,
      purchasedDaysToExpire: 730,
    })).toBe("[Expiration] policy=pol_2 earned=100 bonus=30 purchased=730");

    expect(formatActiveExpirationPolicyLog(null)).toBe(NO_ACTIVE_EXPIRATION_POLICY_LOG);
  });

  it("formats the job summary suffix", () => {
    expect(formatExpirationRunSummary({
      policyId: null,
      nullExpiryOpen: 4,
      nextExpiresAt: null,
    })).toBe("policy=none nullExpiryOpen=4 nextExpiresAt=none");

    expect(formatExpirationRunSummary({
      policyId: "pol_9",
      nullExpiryOpen: 0,
      nextExpiresAt: new Date("2027-01-02T03:04:05.000Z"),
    })).toBe("policy=pol_9 nullExpiryOpen=0 nextExpiresAt=2027-01-02T03:04:05.000Z");
  });

  it("terms do not claim purchased points expire or that existing balances expire", () => {
    const terms = readFileSync(path.resolve("client/src/pages/terms-of-service.tsx"), "utf8");
    expect(terms).toContain("Purchased PackPTS do not expire.");
    expect(terms).toContain("Newly earned points may expire 365 days after they are earned");
    expect(terms).not.toContain("Unused points may expire");
  });
});

describe("expiration policy ensure and bucket dates", () => {
  let userId: string;
  let ledgerId: string;
  let priorPolicies: Array<{ id: string; enabled: boolean }> = [];

  beforeAll(async () => {
    priorPolicies = await db
      .select({ id: packptsExpirationPolicy.id, enabled: packptsExpirationPolicy.enabled })
      .from(packptsExpirationPolicy);

    userId = `exp-policy-${randomUUID()}`;
    await db.insert(users).values({
      id: userId,
      username: `exppolicy_${Date.now()}`,
      points: 0,
      gamesPlayed: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      isAdmin: false,
    });

    await deactivateAllPolicies();
    const earned = await walletService.earn(userId, 25, "setup", `exp-setup-${randomUUID()}`);
    expect(earned.success).toBe(true);
    ledgerId = earned.ledgerEntry!.id;
  });

  afterAll(async () => {
    const current = await db.select({ id: packptsExpirationPolicy.id }).from(packptsExpirationPolicy);
    const priorIds = new Set(priorPolicies.map((row) => row.id));
    const extras = current.map((row) => row.id).filter((id) => !priorIds.has(id));
    if (extras.length > 0) {
      await db.delete(packptsExpirationPolicy).where(inArray(packptsExpirationPolicy.id, extras));
    }
    for (const row of priorPolicies) {
      await db
        .update(packptsExpirationPolicy)
        .set({ enabled: row.enabled })
        .where(eq(packptsExpirationPolicy.id, row.id));
    }

    const bucketIds = await db.select({ id: packptsBucket.id }).from(packptsBucket).where(eq(packptsBucket.userId, userId));
    if (bucketIds.length > 0) {
      await db.delete(packptsSpendAllocation).where(inArray(packptsSpendAllocation.bucketId, bucketIds.map((b) => b.id)));
    }
    await db.delete(packptsBucket).where(eq(packptsBucket.userId, userId));
    const wallet = await walletService.getWallet(userId);
    if (wallet) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.walletId, wallet.id));
      await db.delete(wallets).where(eq(wallets.userId, userId));
    }
    await db.delete(users).where(eq(users.id, userId));
  });

  it("ensureExpirationPolicy inserts once and the second call inserts nothing", async () => {
    await deactivateAllPolicies();
    const before = await countPolicies();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = await ensureExpirationPolicy();
    const afterFirst = await countPolicies();
    const second = await ensureExpirationPolicy();
    const afterSecond = await countPolicies();

    expect(first).not.toBeNull();
    expect(first!.earnedDaysToExpire).toBe(365);
    expect(first!.bonusDefaultDaysToExpire).toBe(90);
    expect(first!.purchasedDaysToExpire).toBeNull();
    expect(first!.enabled).toBe(true);
    expect(afterFirst).toBe(before + 1);
    expect(second!.id).toBe(first!.id);
    expect(afterSecond).toBe(afterFirst);
    expect(log).toHaveBeenCalledWith(
      `[Expiration] policy=${first!.id} earned=365 bonus=90 purchased=never`
    );
    log.mockRestore();
  });

  it("does not change an existing effective policy", async () => {
    await deactivateAllPolicies();
    const created = await ensureExpirationPolicy();
    await db
      .update(packptsExpirationPolicy)
      .set({ earnedDaysToExpire: 111 })
      .where(eq(packptsExpirationPolicy.id, created!.id));

    const before = await countPolicies();
    const again = await ensureExpirationPolicy();
    expect(again!.id).toBe(created!.id);
    expect(again!.earnedDaysToExpire).toBe(111);
    expect(await countPolicies()).toBe(before);
  });

  it("is race-safe when two ensures run together", async () => {
    await deactivateAllPolicies();
    const before = await countPolicies();
    const [a, b] = await Promise.all([ensureExpirationPolicy(), ensureExpirationPolicy()]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).toBe(b!.id);
    expect(a!.purchasedDaysToExpire).toBeNull();
    expect(await countPolicies()).toBe(before + 1);
  });

  it("sets EARNED +365d, BONUS +90d, and null for PURCHASED and ADJUSTMENT", async () => {
    await deactivateAllPolicies();
    const policy = await ensureExpirationPolicy();
    expect(policy!.earnedDaysToExpire).toBe(365);
    expect(policy!.bonusDefaultDaysToExpire).toBe(90);
    expect(policy!.purchasedDaysToExpire).toBeNull();

    const earned = await bucketService.createBucket(userId, 40, "EARNED", ledgerId);
    const bonus = await bucketService.createBucket(userId, 15, "BONUS", ledgerId);
    const purchased = await bucketService.createBucket(userId, 80, "PURCHASED", ledgerId);
    const adjustment = await bucketService.createBucket(userId, 5, "ADJUSTMENT", ledgerId);

    expect(earned.success).toBe(true);
    expect(bonus.success).toBe(true);
    expect(purchased.success).toBe(true);
    expect(adjustment.success).toBe(true);

    expectExpiresInDays(earned.bucket!.earnedAt!, earned.bucket!.expiresAt ?? null, 365);
    expectExpiresInDays(bonus.bucket!.earnedAt!, bonus.bucket!.expiresAt ?? null, 90);
    expect(purchased.bucket!.expiresAt).toBeNull();
    expect(adjustment.bucket!.expiresAt).toBeNull();
  });

  it("createBucket warns when no policy exists and leaves expiresAt null", async () => {
    await deactivateAllPolicies();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const created = await bucketService.createBucket(userId, 7, "EARNED", ledgerId);
    expect(created.success).toBe(true);
    expect(created.bucket!.expiresAt).toBeNull();
    expect(warn).toHaveBeenCalledWith(NO_ACTIVE_EXPIRATION_POLICY_LOG);
    warn.mockRestore();
  });

  it("admin upsert creates a policy when none is active", async () => {
    await deactivateAllPolicies();
    const before = await countPolicies();
    const created = await expirationEngine.updateExpirationPolicy({ gracePeriodDays: 8 });
    expect(created).not.toBeNull();
    expect(created!.gracePeriodDays).toBe(8);
    expect(created!.earnedDaysToExpire).toBe(365);
    expect(created!.bonusDefaultDaysToExpire).toBe(90);
    expect(created!.purchasedDaysToExpire).toBeNull();
    expect(created!.enabled).toBe(true);
    expect(await countPolicies()).toBe(before + 1);

    const updated = await expirationEngine.updateExpirationPolicy({ gracePeriodDays: 9 });
    expect(updated!.id).toBe(created!.id);
    expect(updated!.gracePeriodDays).toBe(9);
    expect(await countPolicies()).toBe(before + 1);
  });
});
