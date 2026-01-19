import { db } from "../db";
import { 
  marginLedger, 
  type InsertMarginLedger,
  type MarginLedger
} from "@shared/schema";
import { sql, desc } from "drizzle-orm";
import { packageGuardrailService, type SalesChannel } from "./store/packageGuardrailService";

export interface MarginContribution {
  amountCents: number;
  sourceType: "PACKPTS_SALE" | "AFFILIATE_PAYOUT" | "PARTNER_REBATE" | "MANUAL_ADJUSTMENT";
  referenceId?: string;
  note?: string;
}

class MarginLedgerService {
  async getAvailableMargin(): Promise<number> {
    const result = await db
      .select({
        total: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"),
      })
      .from(marginLedger);
    
    return result[0]?.total || 0;
  }

  async recordContribution(contribution: MarginContribution): Promise<MarginLedger> {
    if (contribution.amountCents <= 0) {
      throw new Error("Contribution amount must be positive");
    }

    const insertData: InsertMarginLedger = {
      sourceType: contribution.sourceType,
      amountCents: contribution.amountCents,
      referenceId: contribution.referenceId || null,
      note: contribution.note || null,
    };

    const [entry] = await db
      .insert(marginLedger)
      .values(insertData)
      .returning();

    return entry;
  }

  async calculateMarginFromPurchase(
    priceCents: number,
    ptsGrant: number,
    channel: SalesChannel = "web_stripe"
  ): Promise<{ marginContributionCents: number; netRevenueCents: number }> {
    try {
      const evaluation = await packageGuardrailService.evaluatePackage(priceCents, ptsGrant, channel);
      return {
        marginContributionCents: evaluation.computed.marginContributionCents,
        netRevenueCents: evaluation.computed.netRevenueCents,
      };
    } catch (error) {
      console.warn("Failed to calculate margin from guardrail service, using fallback calculation", error);
      const defaultFeeRate = channel === "ios_iap" ? 0.30 : 
                            channel === "android_iap" ? 0.15 : 0.029;
      const defaultFixedFee = channel === "web_stripe" ? 30 : 0;
      const estimatedFees = Math.round(priceCents * defaultFeeRate) + defaultFixedFee;
      const netRevenue = priceCents - estimatedFees;
      const marginContribution = Math.round(netRevenue * 1.0);
      
      return {
        marginContributionCents: Math.max(0, marginContribution),
        netRevenueCents: Math.max(0, netRevenue),
      };
    }
  }

  async recordPackPtsPurchaseMargin(params: {
    stripeEventId: string;
    userId: string;
    priceCents: number;
    ptsGrant: number;
    productName: string;
    channel?: SalesChannel;
  }): Promise<MarginLedger | null> {
    const { marginContributionCents } = await this.calculateMarginFromPurchase(
      params.priceCents,
      params.ptsGrant,
      params.channel || "web_stripe"
    );

    if (marginContributionCents <= 0) {
      console.log(`No margin contribution for purchase ${params.stripeEventId} (contribution: ${marginContributionCents})`);
      return null;
    }

    return this.recordContribution({
      sourceType: "PACKPTS_SALE",
      amountCents: marginContributionCents,
      referenceId: params.stripeEventId,
      note: `PackPTS purchase: ${params.productName} (${params.ptsGrant} pts @ $${(params.priceCents / 100).toFixed(2)}) by user ${params.userId}`,
    });
  }

  async getRecentContributions(limit: number = 20): Promise<MarginLedger[]> {
    return db
      .select()
      .from(marginLedger)
      .orderBy(desc(marginLedger.createdAt))
      .limit(limit);
  }

  async getLedgerSummary(): Promise<{
    totalMarginCents: number;
    contributionsByType: { sourceType: string; total: number; count: number }[];
    recentEntries: MarginLedger[];
  }> {
    const totalResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"),
      })
      .from(marginLedger);

    const byTypeResult = await db
      .select({
        sourceType: marginLedger.sourceType,
        total: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("total"),
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(marginLedger)
      .groupBy(marginLedger.sourceType);

    const recentEntries = await this.getRecentContributions(10);

    return {
      totalMarginCents: totalResult[0]?.total || 0,
      contributionsByType: byTypeResult.map(r => ({
        sourceType: r.sourceType,
        total: r.total,
        count: r.count,
      })),
      recentEntries,
    };
  }
}

export const marginLedgerService = new MarginLedgerService();
