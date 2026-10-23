import { db } from "../db";
import {
  ledgerEntries,
  packptsBucket,
  redemptionCredit,
  storePurchases,
  stripeCheckoutSessions,
  wallets,
} from "@shared/schema";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { maxBundleRedeemableCents, planPurchasedSpend, type CapPurchase, type CapUse, type SpendCapResult } from "@shared/rebateEconomics";
import { PACKPTS_BUNDLE_SKUS, PRODUCT_DEFINITIONS, type InternalSku } from "./productMap";
import { applyLedgerEntry } from "./packpts/ledgerService";

type Executor = typeof db;

function purchaseIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const id = (metadata as { storePurchaseId?: unknown }).storePurchaseId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function capFromSku(sku: string | undefined, quantity: number, amountCents?: number | null): number | null {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const def = sku ? PRODUCT_DEFINITIONS[sku as InternalSku] : undefined;
  if (def && "priceUsd" in def && def.priceUsd > 0 && "packptsGrant" in def && def.packptsGrant > 0) {
    return maxBundleRedeemableCents(def.priceUsd * qty);
  }
  if (amountCents && amountCents > 0) return maxBundleRedeemableCents(amountCents);
  return null;
}

async function openBuckets(userId: string, executor: Executor) {
  const now = new Date();
  const redeemable = sql`(${packptsBucket.redeemableAt} IS NULL OR ${packptsBucket.redeemableAt} <= ${now})`;
  const base = [
    eq(packptsBucket.userId, userId),
    eq(packptsBucket.status, "OPEN"),
    gt(packptsBucket.remainingAmount, 0),
    redeemable,
  ] as const;
  const expiring = await executor
    .select()
    .from(packptsBucket)
    .where(and(...base, sql`${packptsBucket.expiresAt} IS NOT NULL`))
    .orderBy(asc(packptsBucket.expiresAt), asc(packptsBucket.earnedAt));
  const forever = await executor
    .select()
    .from(packptsBucket)
    .where(and(...base, isNull(packptsBucket.expiresAt)))
    .orderBy(asc(packptsBucket.earnedAt));
  return [...expiring, ...forever];
}

/**
 * Quote, apply, and grant all call this. Purchased points convert only up to
 * the cap stored on each purchase. Points with no purchase id share the sum of
 * 0.25 x price across paid bundles that are not tied to a bucket.
 */
export async function previewPurchasedRebate(args: {
  userId: string;
  pointsToSpend: number;
  centsPerPoint: number;
  maxCreditCents: number;
  executor?: any;
}): Promise<SpendCapResult> {
  const executor = (args.executor ?? db) as typeof db;
  const buckets = await openBuckets(args.userId, executor);
  const purchases = await executor.select().from(storePurchases).where(and(
    eq(storePurchases.userId, args.userId),
    sql`${storePurchases.status} IN ('PAID_PENDING','SETTLED')`,
  ));
  const sessions = await executor.select().from(stripeCheckoutSessions).where(and(
    eq(stripeCheckoutSessions.userId, args.userId),
    eq(stripeCheckoutSessions.status, "PAID"),
  ));
  const credits = await executor.select({ capUses: redemptionCredit.capUses }).from(redemptionCredit).where(and(
    eq(redemptionCredit.userId, args.userId),
    sql`${redemptionCredit.capUses} IS NOT NULL`,
    sql`${redemptionCredit.status} IN ('PENDING','GRANTED')`,
  ));
  const grants = await executor.select({
    metadata: ledgerEntries.metadata,
    idempotencyKey: ledgerEntries.idempotencyKey,
    eventType: ledgerEntries.eventType,
    refId: ledgerEntries.refId,
    amount: ledgerEntries.amount,
  }).from(ledgerEntries).innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id)).where(and(
    eq(wallets.userId, args.userId),
    eq(ledgerEntries.source, "purchase"),
    eq(ledgerEntries.entryType, "PURCHASE_CREDIT"),
  ));
  const linkedMeta = await executor.select({ metadata: packptsBucket.metadata }).from(packptsBucket).where(and(
    eq(packptsBucket.userId, args.userId),
    eq(packptsBucket.sourceType, "PURCHASED"),
  ));

  const coveredSessions = new Set(purchases.map((p) => p.stripeSessionId).filter((id): id is string => !!id));
  const coveredPayments = new Set(purchases.map((p) => p.stripePaymentIntentId).filter((id): id is string => !!id));
  const capPurchases: CapPurchase[] = [];
  for (const purchase of purchases) {
    const cap = purchase.redeemableCapCents > 0
      ? purchase.redeemableCapCents
      : maxBundleRedeemableCents(purchase.priceCents);
    capPurchases.push({ id: purchase.id, capCents: cap });
  }
  for (const session of sessions) {
    if (!session.packptsGrant || session.packptsGrant <= 0) continue;
    if (coveredSessions.has(session.stripeSessionId)) continue;
    const sku = session.sku;
    if (!(PACKPTS_BUNDLE_SKUS as readonly string[]).includes(sku)) continue;
    const cap = capFromSku(sku, 1, session.amountCents);
    if (cap == null) continue;
    coveredSessions.add(session.stripeSessionId);
    capPurchases.push({ id: `session:${session.id}`, capCents: cap });
  }
  for (const grant of grants) {
    if (grant.refId && coveredSessions.has(grant.refId)) continue;
    const meta = (grant.metadata ?? {}) as { sku?: string; quantity?: number; stripeEventId?: string };
    const eventId = meta.stripeEventId
      || (grant.idempotencyKey?.startsWith("stripe:sub:") ? grant.idempotencyKey.split(":")[2] : null);
    if (eventId && coveredPayments.has(eventId)) continue;
    if (grant.eventType !== "stripe_subscription_paid" && grant.eventType !== "stripe_checkout_completed") continue;
    const cap = capFromSku(meta.sku, meta.quantity ?? 1, null);
    if (cap == null || !grant.amount || grant.amount <= 0) continue;
    if (eventId) coveredPayments.add(eventId);
    capPurchases.push({ id: `ledger:${grant.idempotencyKey ?? grant.refId ?? capPurchases.length}`, capCents: cap });
  }

  const priorUses: CapUse[] = [];
  for (const credit of credits) {
    const uses = credit.capUses;
    if (!uses) continue;
    for (const [purchaseId, cents] of Object.entries(uses.purchaseUseCents ?? {})) {
      priorUses.push({ purchaseId, cents: Number(cents) });
    }
    if (uses.unlinkedUseCents > 0) priorUses.push({ purchaseId: null, cents: uses.unlinkedUseCents });
  }

  const linkedIds = new Set(linkedMeta.map((row) => purchaseIdFromMetadata(row.metadata)).filter((id): id is string => !!id));
  const bucketsForPlan = buckets.map((bucket) => ({
    points: bucket.remainingAmount,
    source: bucket.sourceType,
    purchaseId: purchaseIdFromMetadata(bucket.metadata),
  }));
  for (const id of linkedIds) {
    if (!bucketsForPlan.some((b) => b.purchaseId === id)) {
      bucketsForPlan.push({ points: 0, source: "PURCHASED", purchaseId: id });
    }
  }

  return planPurchasedSpend({
    buckets: bucketsForPlan,
    purchases: capPurchases,
    priorUses,
    pointsToSpend: args.pointsToSpend,
    centsPerPoint: args.centsPerPoint,
    maxCreditCents: args.maxCreditCents,
  });
}

export async function recordBundlePurchase(args: {
  userId: string;
  priceCents: number;
  ptsGrant: number;
  productSku: string;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
}): Promise<{ id: string; redeemableCapCents: number } | null> {
  if (args.priceCents <= 0 || args.ptsGrant <= 0) return null;
  const redeemableCapCents = maxBundleRedeemableCents(args.priceCents);
  if (args.stripeSessionId) {
    const [existing] = await db.select().from(storePurchases).where(eq(storePurchases.stripeSessionId, args.stripeSessionId)).limit(1);
    if (existing) return { id: existing.id, redeemableCapCents: existing.redeemableCapCents || redeemableCapCents };
  }
  if (args.stripePaymentIntentId) {
    const [existing] = await db.select().from(storePurchases).where(eq(storePurchases.stripePaymentIntentId, args.stripePaymentIntentId)).limit(1);
    if (existing) return { id: existing.id, redeemableCapCents: existing.redeemableCapCents || redeemableCapCents };
  }
  const [row] = await db.insert(storePurchases).values({
    userId: args.userId,
    stripeSessionId: args.stripeSessionId ?? null,
    stripePaymentIntentId: args.stripePaymentIntentId ?? null,
    status: "SETTLED",
    ptsGrant: args.ptsGrant,
    priceCents: args.priceCents,
    productSku: args.productSku,
    redeemableCapCents,
    settledAt: new Date(),
  }).returning();
  return { id: row.id, redeemableCapCents };
}

export async function markBundlePurchasesRefunded(stripeSessionId: string): Promise<void> {
  await db.update(storePurchases).set({ status: "REFUNDED", updatedAt: new Date() }).where(eq(storePurchases.stripeSessionId, stripeSessionId));
}

/** Credit purchased points and store the rebate cap on that purchase. */
export async function grantBundlePoints(args: {
  userId: string;
  points: number;
  priceCents: number;
  sku: string;
  productName: string;
  eventType: string;
  refType: string;
  refId: string;
  idempotencyKey: string;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [existingLedger] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, args.idempotencyKey)).limit(1);
  const purchase = existingLedger ? null : await recordBundlePurchase({
    userId: args.userId,
    priceCents: args.priceCents,
    ptsGrant: args.points,
    productSku: args.sku,
    stripeSessionId: args.stripeSessionId,
    stripePaymentIntentId: args.stripePaymentIntentId,
  });
  const result = await applyLedgerEntry({
    userId: args.userId,
    direction: "credit",
    amountPackpts: args.points,
    source: "purchase",
    eventType: args.eventType,
    refType: args.refType,
    refId: args.refId,
    idempotencyKey: args.idempotencyKey,
    metadata: {
      ...args.metadata,
      sku: args.sku,
      productName: args.productName,
      storePurchaseId: purchase?.id ?? null,
      redeemableCapCents: purchase?.redeemableCapCents ?? maxBundleRedeemableCents(args.priceCents),
    },
  });
  if (!result.success && purchase) {
    await db.delete(storePurchases).where(eq(storePurchases.id, purchase.id));
  }
  return result;
}
