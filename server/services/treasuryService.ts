import { db } from "../db";
import { 
  marginLedger, 
  marginUsage, 
  redemptionReservations,
  marketplaceMarginConfig,
  redemptionCredit,
  externalPurchaseIntent,
  profitPolicy,
  InsertMarginLedger,
  InsertMarginUsage,
} from "@shared/schema";
import { eq, sql, and, sum } from "drizzle-orm";

const VALID_SOURCE_TYPES = ["PACKPTS_SALE", "AFFILIATE_PAYOUT", "PARTNER_REBATE", "ADJUSTMENT"] as const;
type MarginSourceType = typeof VALID_SOURCE_TYPES[number];

const SAFETY_THRESHOLD_CENTS = 10000; // $100 - log alert when below this

export interface TreasuryStatus {
  totalMarginCents: number;
  totalUsedCents: number;
  totalReservedCents: number;
  availableMarginPoolCents: number;
}

export interface TransactionMarginResult {
  affiliateRate: number;
  haircut: number;
  transactionMarginCents: number;
}

export interface AllowedRedemptionResult {
  availableMarginPoolCents: number;
  transactionMarginCents: number;
  allowedCapCents: number;
  requestedCreditCents: number;
  approvedCreditCents: number;
  approvedPackpts: number;
  clamped: boolean;
  rejected: boolean;
  reason?: string;
}

class TreasuryService {
  async getTreasuryStatus(): Promise<TreasuryStatus> {
    const [totalMarginResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${marginLedger.amountCents}), 0)::int` })
      .from(marginLedger);

    const [totalUsedResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${marginUsage.amountCents}), 0)::int` })
      .from(marginUsage);

    const [totalReservedResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${redemptionReservations.reservedCents}), 0)::int` })
      .from(redemptionReservations)
      .where(eq(redemptionReservations.status, "ACTIVE"));

    const totalMarginCents = totalMarginResult?.total || 0;
    const totalUsedCents = totalUsedResult?.total || 0;
    const totalReservedCents = totalReservedResult?.total || 0;

    let availableMarginPoolCents = totalMarginCents - totalUsedCents - totalReservedCents;

    if (availableMarginPoolCents < 0) {
      console.error("[Treasury] ALERT: Available margin pool is NEGATIVE:", availableMarginPoolCents);
      availableMarginPoolCents = 0;
    } else if (availableMarginPoolCents < SAFETY_THRESHOLD_CENTS) {
      console.warn("[Treasury] WARNING: Available margin pool below safety threshold:", availableMarginPoolCents);
    }

    return {
      totalMarginCents,
      totalUsedCents,
      totalReservedCents,
      availableMarginPoolCents,
    };
  }

  async getMarketplaceConfig(source: "ebay" | "goldin"): Promise<{ affiliateRate: number; haircut: number }> {
    const [config] = await db
      .select()
      .from(marketplaceMarginConfig)
      .where(eq(marketplaceMarginConfig.source, source));

    if (config) {
      return {
        affiliateRate: config.affiliateRate,
        haircut: config.haircut,
      };
    }

    // Defaults if not configured
    return {
      affiliateRate: source === "ebay" ? 0.02 : 0.00,
      haircut: 0.50,
    };
  }

  async computeTransactionMargin(source: "ebay" | "goldin", priceCents: number): Promise<TransactionMarginResult> {
    const config = await this.getMarketplaceConfig(source);
    
    const transactionMarginCents = Math.floor(
      config.affiliateRate * config.haircut * priceCents
    );

    return {
      affiliateRate: config.affiliateRate,
      haircut: config.haircut,
      transactionMarginCents,
    };
  }

  async computeAllowedRedemption(
    userId: string,
    source: "ebay" | "goldin",
    priceCents: number,
    requestedPackpts: number,
    userBalance: number
  ): Promise<AllowedRedemptionResult> {
    // Get PackPTS value from active profit policy
    const [policy] = await db
      .select()
      .from(profitPolicy)
      .where(eq(profitPolicy.enabled, true))
      .orderBy(sql`${profitPolicy.effectiveFrom} DESC`)
      .limit(1);

    const packptsValueCents = policy 
      ? policy.packptsValueVMicrousd / 10000  // Convert micro-USD to cents (2000 micro-USD = 0.2 cents)
      : 0.2; // Default $0.002 = 0.2 cents

    // Compute requested credit value
    const requestedCreditCents = Math.floor(requestedPackpts * packptsValueCents);

    // Get treasury status
    const treasury = await this.getTreasuryStatus();

    // Get transaction margin for this purchase
    const txMargin = await this.computeTransactionMargin(source, priceCents);

    // Compute allowed cap
    const allowedCapCents = treasury.availableMarginPoolCents + txMargin.transactionMarginCents;

    // Clamp to user balance first
    const balanceLimitedPackpts = Math.min(requestedPackpts, userBalance);
    const balanceLimitedCreditCents = Math.floor(balanceLimitedPackpts * packptsValueCents);

    // Then clamp to allowed cap
    let approvedCreditCents = Math.min(balanceLimitedCreditCents, allowedCapCents);
    let clamped = approvedCreditCents < requestedCreditCents;
    let rejected = false;
    let reason: string | undefined;

    if (approvedCreditCents <= 0) {
      rejected = true;
      approvedCreditCents = 0;
      reason = "INSUFFICIENT_MARGIN_BACKING";
    }

    // Convert back to PackPTS
    const approvedPackpts = Math.floor(approvedCreditCents / packptsValueCents);

    return {
      availableMarginPoolCents: treasury.availableMarginPoolCents,
      transactionMarginCents: txMargin.transactionMarginCents,
      allowedCapCents,
      requestedCreditCents,
      approvedCreditCents,
      approvedPackpts,
      clamped,
      rejected,
      reason,
    };
  }

  async createReservation(purchaseIntentId: string, reservedCents: number, txOrDb?: any): Promise<string> {
    const executor = txOrDb ?? db;
    const [reservation] = await executor
      .insert(redemptionReservations)
      .values({
        purchaseIntentId,
        reservedCents,
        status: "ACTIVE",
      })
      .onConflictDoNothing()
      .returning();

    if (!reservation) {
      const [existing] = await executor
        .select()
        .from(redemptionReservations)
        .where(eq(redemptionReservations.purchaseIntentId, purchaseIntentId));

      if (existing) {
        return existing.id;
      }
      throw new Error("Failed to create reservation");
    }

    return reservation.id;
  }

  async releaseReservation(purchaseIntentId: string, txOrDb?: any): Promise<void> {
    const executor = txOrDb ?? db;
    await executor
      .update(redemptionReservations)
      .set({ 
        status: "RELEASED",
        updatedAt: new Date(),
      })
      .where(and(
        eq(redemptionReservations.purchaseIntentId, purchaseIntentId),
        eq(redemptionReservations.status, "ACTIVE")
      ));
  }

  async consumeReservation(purchaseIntentId: string, redemptionId: string, txOrDb?: any): Promise<void> {
    const executeConsume = async (tx: any) => {
      const [reservation] = await tx
        .select()
        .from(redemptionReservations)
        .where(and(
          eq(redemptionReservations.purchaseIntentId, purchaseIntentId),
          eq(redemptionReservations.status, "ACTIVE")
        ))
        .for("update");

      if (!reservation) {
        throw new Error("No active reservation found for this purchase intent");
      }

      await tx
        .update(redemptionReservations)
        .set({ 
          status: "CONSUMED",
          updatedAt: new Date(),
        })
        .where(eq(redemptionReservations.id, reservation.id));

      await tx
        .insert(marginUsage)
        .values({
          redemptionId,
          amountCents: reservation.reservedCents,
        });
    };

    if (txOrDb) {
      await executeConsume(txOrDb);
    } else {
      await db.transaction(async (tx) => executeConsume(tx));
    }
  }

  async addMarginCredit(data: InsertMarginLedger): Promise<string> {
    if (data.amountCents <= 0) {
      throw new Error("Margin credit amount must be positive");
    }

    const [entry] = await db
      .insert(marginLedger)
      .values(data)
      .returning();

    console.log(`[Treasury] Added margin credit: ${data.amountCents} cents from ${data.sourceType}`);
    return entry.id;
  }

  async creditMarginPool(
    amountCents: number,
    type: string,
    referenceId: string | null,
    description: string
  ): Promise<any> {
    // Validate type
    if (!VALID_SOURCE_TYPES.includes(type as MarginSourceType)) {
      throw new Error(`Invalid source type: ${type}. Must be one of: ${VALID_SOURCE_TYPES.join(", ")}`);
    }

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("Credit amount must be a positive integer");
    }

    const [entry] = await db
      .insert(marginLedger)
      .values({
        amountCents,
        sourceType: type as "PACKPTS_SALE" | "AFFILIATE_PAYOUT" | "PARTNER_REBATE" | "MANUAL_ADJUSTMENT",
        referenceId,
        note: description,
      })
      .returning();

    console.log(`[Treasury] Credited margin pool: ${amountCents} cents from ${type}`);
    return entry;
  }

  async updateMarketplaceConfig(
    source: string,
    updates: { affiliateRateBps?: number; haircutRateBps?: number }
  ): Promise<any | null> {
    const [existing] = await db
      .select()
      .from(marketplaceMarginConfig)
      .where(eq(marketplaceMarginConfig.source, source as "ebay" | "goldin"));

    if (!existing) {
      return null;
    }

    const newValues: any = { updatedAt: new Date() };
    
    if (updates.affiliateRateBps !== undefined) {
      newValues.affiliateRate = updates.affiliateRateBps / 10000; // BPS to decimal
    }
    if (updates.haircutRateBps !== undefined) {
      newValues.haircut = updates.haircutRateBps / 10000;
    }

    const [updated] = await db
      .update(marketplaceMarginConfig)
      .set(newValues)
      .where(eq(marketplaceMarginConfig.source, source as "ebay" | "goldin"))
      .returning();

    return updated;
  }

  async getMarginLedger(limit: number = 50): Promise<any[]> {
    return db
      .select()
      .from(marginLedger)
      .orderBy(sql`${marginLedger.createdAt} DESC`)
      .limit(limit);
  }

  async getMarketplaceConfigs(): Promise<any[]> {
    return db.select().from(marketplaceMarginConfig);
  }

  async getActiveReservations(): Promise<any[]> {
    return db
      .select()
      .from(redemptionReservations)
      .where(eq(redemptionReservations.status, "ACTIVE"))
      .orderBy(sql`${redemptionReservations.createdAt} DESC`);
  }
}

export const treasuryService = new TreasuryService();
