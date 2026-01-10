import { db } from "../db";
import { 
  rewardRedemptions, 
  redemptionTiers,
  REDEMPTION_REVIEW_THRESHOLD_CENTS,
  type RewardRedemption,
  type RedemptionTier,
  type RedemptionStatus
} from "@shared/schema";
import { eq, and, gte, lte, or, isNull, desc, sql } from "drizzle-orm";
import { walletService } from "./walletService";
import { analyticsService } from "./analyticsService";
import crypto from "crypto";

export interface RedemptionResult {
  success: boolean;
  redemption?: RewardRedemption;
  creditToken?: string;
  requiresReview?: boolean;
  error?: string;
}

export interface TierCalculation {
  packptsAmount: number;
  usdValueCents: number;
  tier: RedemptionTier;
  ratePerThousand: number;
}

export interface RedemptionListResult {
  redemptions: RewardRedemption[];
  total: number;
  page: number;
  pageSize: number;
}

class RedemptionService {
  private generateCreditToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  private generateIdempotencyKey(userId: string, amount: number, clientIdempotencyKey?: string): string {
    if (clientIdempotencyKey) {
      return `redeem_${userId}_${clientIdempotencyKey}`;
    }
    const timestamp = Math.floor(Date.now() / 60000);
    return `redeem_${userId}_${amount}_${timestamp}`;
  }

  async getRedemptionTiers(): Promise<RedemptionTier[]> {
    return await db
      .select()
      .from(redemptionTiers)
      .where(eq(redemptionTiers.isActive, true))
      .orderBy(redemptionTiers.minPackpts);
  }

  async calculateTierValue(packptsAmount: number): Promise<TierCalculation | null> {
    const tiers = await this.getRedemptionTiers();
    
    if (tiers.length === 0) {
      return null;
    }

    for (const tier of tiers) {
      const minMatch = packptsAmount >= tier.minPackpts;
      const maxMatch = tier.maxPackpts === null || packptsAmount <= tier.maxPackpts;
      
      if (minMatch && maxMatch) {
        const usdValueCents = Math.floor((packptsAmount / 1000) * tier.usdPerThousandPts);
        return {
          packptsAmount,
          usdValueCents,
          tier,
          ratePerThousand: tier.usdPerThousandPts,
        };
      }
    }

    return null;
  }

  async redeem(userId: string, packptsAmount: number, clientIdempotencyKey?: string): Promise<RedemptionResult> {
    if (packptsAmount < 1000) {
      return { success: false, error: "Minimum redemption is 1000 PackPTS" };
    }

    const tierCalc = await this.calculateTierValue(packptsAmount);
    if (!tierCalc) {
      return { success: false, error: "No valid redemption tier found for this amount" };
    }

    const wallet = await walletService.getWallet(userId);
    if (!wallet) {
      return { success: false, error: "Wallet not found" };
    }

    if (wallet.balance < packptsAmount) {
      return { success: false, error: "Insufficient PackPTS balance" };
    }

    const requiresReview = tierCalc.usdValueCents >= REDEMPTION_REVIEW_THRESHOLD_CENTS;
    const creditToken = this.generateCreditToken();
    const idempotencyKey = this.generateIdempotencyKey(userId, packptsAmount, clientIdempotencyKey);

    const existingByKey = await walletService.findLedgerEntryByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      const existingRedemption = await db
        .select()
        .from(rewardRedemptions)
        .where(eq(rewardRedemptions.ledgerIdempotencyKey, idempotencyKey))
        .limit(1);
      
      if (existingRedemption.length > 0) {
        return {
          success: true,
          redemption: existingRedemption[0],
          creditToken: existingRedemption[0].creditToken || undefined,
          requiresReview: existingRedemption[0].status === "pending",
        };
      }
    }

    return await db.transaction(async (tx) => {
      const spendResult = await walletService.spend(
        userId,
        packptsAmount,
        `Redemption for $${(tierCalc.usdValueCents / 100).toFixed(2)} store credit`,
        idempotencyKey,
        {
          type: "redemption",
          usdValueCents: tierCalc.usdValueCents,
          tier: tierCalc.tier.id,
        }
      );

      if (!spendResult.success) {
        return { success: false, error: spendResult.error || "Failed to spend PackPTS" };
      }

      const initialStatus: RedemptionStatus = requiresReview ? "pending" : "completed";

      const [redemption] = await tx
        .insert(rewardRedemptions)
        .values({
          userId,
          packptsSpent: packptsAmount,
          usdValue: tierCalc.usdValueCents,
          type: "store_credit",
          status: initialStatus,
          creditToken: requiresReview ? null : creditToken,
          ledgerIdempotencyKey: idempotencyKey,
          metadata: {
            tierId: tierCalc.tier.id,
            ratePerThousand: tierCalc.ratePerThousand,
            calculatedAt: new Date().toISOString(),
          },
        })
        .returning();

      analyticsService.redeemStarted(userId, {
        redemptionId: redemption.id,
        packptsAmount,
        usdValueCents: tierCalc.usdValueCents,
        requiresReview,
      });

      if (!requiresReview) {
        analyticsService.redeemCompleted(userId, {
          redemptionId: redemption.id,
          packptsAmount,
          usdValueCents: tierCalc.usdValueCents,
        });
      }

      return {
        success: true,
        redemption,
        creditToken: requiresReview ? undefined : creditToken,
        requiresReview,
      };
    });
  }

  async getRedemption(redemptionId: string): Promise<RewardRedemption | null> {
    const result = await db
      .select()
      .from(rewardRedemptions)
      .where(eq(rewardRedemptions.id, redemptionId))
      .limit(1);
    return result.length > 0 ? result[0] : null;
  }

  async getRedemptionByToken(creditToken: string): Promise<RewardRedemption | null> {
    const result = await db
      .select()
      .from(rewardRedemptions)
      .where(eq(rewardRedemptions.creditToken, creditToken))
      .limit(1);
    return result.length > 0 ? result[0] : null;
  }

  async getUserRedemptions(userId: string, limit: number = 20): Promise<RewardRedemption[]> {
    return await db
      .select()
      .from(rewardRedemptions)
      .where(eq(rewardRedemptions.userId, userId))
      .orderBy(desc(rewardRedemptions.createdAt))
      .limit(limit);
  }

  async getPendingRedemptions(page: number = 1, pageSize: number = 20): Promise<RedemptionListResult> {
    const offset = (page - 1) * pageSize;

    const [redemptions, countResult] = await Promise.all([
      db
        .select()
        .from(rewardRedemptions)
        .where(eq(rewardRedemptions.status, "pending"))
        .orderBy(desc(rewardRedemptions.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(rewardRedemptions)
        .where(eq(rewardRedemptions.status, "pending")),
    ]);

    return {
      redemptions,
      total: countResult[0]?.count || 0,
      page,
      pageSize,
    };
  }

  async getAllRedemptions(
    page: number = 1, 
    pageSize: number = 20,
    status?: RedemptionStatus
  ): Promise<RedemptionListResult> {
    const offset = (page - 1) * pageSize;
    
    const whereClause = status ? eq(rewardRedemptions.status, status) : undefined;

    const [redemptions, countResult] = await Promise.all([
      db
        .select()
        .from(rewardRedemptions)
        .where(whereClause)
        .orderBy(desc(rewardRedemptions.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(rewardRedemptions)
        .where(whereClause),
    ]);

    return {
      redemptions,
      total: countResult[0]?.count || 0,
      page,
      pageSize,
    };
  }

  async approveRedemption(redemptionId: string, adminUserId: string): Promise<RedemptionResult> {
    const redemption = await this.getRedemption(redemptionId);
    if (!redemption) {
      return { success: false, error: "Redemption not found" };
    }

    if (redemption.status !== "pending") {
      return { success: false, error: `Cannot approve redemption with status: ${redemption.status}` };
    }

    const creditToken = this.generateCreditToken();

    const [updated] = await db
      .update(rewardRedemptions)
      .set({
        status: "completed",
        creditToken,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rewardRedemptions.id, redemptionId))
      .returning();

    analyticsService.redeemCompleted(redemption.userId, {
      redemptionId: redemption.id,
      packptsAmount: redemption.packptsSpent,
      usdValueCents: redemption.usdValue,
      approvedBy: adminUserId,
    });

    return {
      success: true,
      redemption: updated,
      creditToken,
    };
  }

  async rejectRedemption(redemptionId: string, adminUserId: string, reason: string): Promise<RedemptionResult> {
    const redemption = await this.getRedemption(redemptionId);
    if (!redemption) {
      return { success: false, error: "Redemption not found" };
    }

    if (redemption.status !== "pending") {
      return { success: false, error: `Cannot reject redemption with status: ${redemption.status}` };
    }

    const refundResult = await walletService.earn(
      redemption.userId,
      redemption.packptsSpent,
      `Refund for rejected redemption: ${reason}`,
      `refund_${redemption.ledgerIdempotencyKey}`,
      {
        type: "redemption_refund",
        redemptionId: redemption.id,
        reason,
      }
    );

    if (!refundResult.success) {
      return { success: false, error: `Failed to refund PackPTS: ${refundResult.error}` };
    }

    const [updated] = await db
      .update(rewardRedemptions)
      .set({
        status: "rejected",
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reversalReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(rewardRedemptions.id, redemptionId))
      .returning();

    return {
      success: true,
      redemption: updated,
    };
  }

  async reverseRedemption(redemptionId: string, adminUserId: string, reason: string): Promise<RedemptionResult> {
    const redemption = await this.getRedemption(redemptionId);
    if (!redemption) {
      return { success: false, error: "Redemption not found" };
    }

    if (redemption.status !== "completed") {
      return { success: false, error: `Cannot reverse redemption with status: ${redemption.status}` };
    }

    if (!redemption.ledgerIdempotencyKey) {
      return { success: false, error: "Redemption has no ledger entry to reverse" };
    }

    const reversalResult = await walletService.earn(
      redemption.userId,
      redemption.packptsSpent,
      `Fraud reversal: ${reason}`,
      `fraud_reversal_${redemption.ledgerIdempotencyKey}`,
      {
        type: "fraud_reversal",
        redemptionId: redemption.id,
        originalLedgerKey: redemption.ledgerIdempotencyKey,
        reason,
        reversedBy: adminUserId,
      }
    );

    if (!reversalResult.success) {
      return { success: false, error: `Failed to reverse PackPTS: ${reversalResult.error}` };
    }

    const [updated] = await db
      .update(rewardRedemptions)
      .set({
        status: "reversed",
        creditToken: null,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reversalReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(rewardRedemptions.id, redemptionId))
      .returning();

    return {
      success: true,
      redemption: updated,
    };
  }

  async validateCreditToken(creditToken: string): Promise<{ valid: boolean; usdValueCents?: number; redemption?: RewardRedemption }> {
    const redemption = await this.getRedemptionByToken(creditToken);
    
    if (!redemption) {
      return { valid: false };
    }

    if (redemption.status !== "completed") {
      return { valid: false };
    }

    return {
      valid: true,
      usdValueCents: redemption.usdValue,
      redemption,
    };
  }

  async consumeCreditToken(creditToken: string): Promise<{ success: boolean; usdValueCents?: number; error?: string }> {
    const validation = await this.validateCreditToken(creditToken);
    
    if (!validation.valid || !validation.redemption) {
      return { success: false, error: "Invalid or expired credit token" };
    }

    await db
      .update(rewardRedemptions)
      .set({
        status: "approved",
        creditToken: null,
        updatedAt: new Date(),
        metadata: {
          ...((validation.redemption.metadata as Record<string, unknown>) || {}),
          consumedAt: new Date().toISOString(),
        },
      })
      .where(eq(rewardRedemptions.id, validation.redemption.id));

    return {
      success: true,
      usdValueCents: validation.usdValueCents,
    };
  }
}

export const redemptionService = new RedemptionService();
