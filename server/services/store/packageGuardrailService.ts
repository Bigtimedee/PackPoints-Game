import { db } from "../../db";
import { 
  storeFeeProfiles, 
  storePackagePolicy, 
  storePackageValidations,
  products,
  type StoreFeeProfile,
  type StorePackagePolicy,
  type InsertStorePackageValidation
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export type SalesChannel = "web_stripe" | "ios_iap" | "android_iap";

export type PackageDecision = "PASS" | "WARN" | "BLOCK" | "OVERRIDE";

export interface ComputedPackageMetrics {
  priceCents: number;
  ptsGrant: number;
  channel: SalesChannel;
  feeRate: number;
  feeFixedCents: number;
  platformFeeRate: number;
  processorFeeCents: number;
  platformFeeCents: number;
  totalFeesCents: number;
  netRevenueCents: number;
  grossMarginRate: number;
  impliedValuePerPtMicrousd: number;
  marginContributionCents: number;
}

export interface EvaluationResult {
  decision: PackageDecision;
  reasons: string[];
  computed: ComputedPackageMetrics;
  policy: {
    minMarginRate: number;
    warnMarginBand: number;
    maxValuePerPtMicrousd: number;
    allowOverride: boolean;
    reserveRate: number;
  };
  feeProfile: {
    channel: SalesChannel;
    feeRate: number;
    feeFixedCents: number;
    platformFeeRate: number;
  };
}

class PackageGuardrailService {
  async getActivePolicy(): Promise<StorePackagePolicy | null> {
    const policies = await db
      .select()
      .from(storePackagePolicy)
      .where(eq(storePackagePolicy.isActive, true))
      .orderBy(desc(storePackagePolicy.createdAt))
      .limit(1);
    
    return policies[0] || null;
  }

  async getFeeProfile(channel: SalesChannel): Promise<StoreFeeProfile | null> {
    const profiles = await db
      .select()
      .from(storeFeeProfiles)
      .where(
        and(
          eq(storeFeeProfiles.channel, channel),
          eq(storeFeeProfiles.isActive, true)
        )
      )
      .limit(1);
    
    return profiles[0] || null;
  }

  async getAllFeeProfiles(): Promise<StoreFeeProfile[]> {
    return db
      .select()
      .from(storeFeeProfiles)
      .where(eq(storeFeeProfiles.isActive, true));
  }

  computeMetrics(
    priceCents: number,
    ptsGrant: number,
    channel: SalesChannel,
    feeProfile: StoreFeeProfile,
    policy: StorePackagePolicy
  ): ComputedPackageMetrics {
    const processorFeeCents = Math.round(priceCents * feeProfile.feeRate) + feeProfile.feeFixedCents;
    const platformFeeCents = Math.round(priceCents * feeProfile.platformFeeRate);
    const totalFeesCents = processorFeeCents + platformFeeCents;
    const netRevenueCents = priceCents - totalFeesCents;
    const grossMarginRate = priceCents > 0 ? netRevenueCents / priceCents : 0;
    const impliedValuePerPtMicrousd = ptsGrant > 0 
      ? Math.round((netRevenueCents / ptsGrant) * 10000)
      : 0;
    const marginContributionCents = Math.round(netRevenueCents * policy.reserveRate);

    return {
      priceCents,
      ptsGrant,
      channel,
      feeRate: feeProfile.feeRate,
      feeFixedCents: feeProfile.feeFixedCents,
      platformFeeRate: feeProfile.platformFeeRate,
      processorFeeCents,
      platformFeeCents,
      totalFeesCents,
      netRevenueCents,
      grossMarginRate,
      impliedValuePerPtMicrousd,
      marginContributionCents,
    };
  }

  evaluateMetrics(
    computed: ComputedPackageMetrics,
    policy: StorePackagePolicy
  ): { decision: PackageDecision; reasons: string[] } {
    const reasons: string[] = [];
    let decision: PackageDecision = "PASS";

    if (computed.grossMarginRate < policy.minMarginRate) {
      decision = "BLOCK";
      reasons.push(
        `Gross margin ${(computed.grossMarginRate * 100).toFixed(1)}% is below minimum ${(policy.minMarginRate * 100).toFixed(1)}%`
      );
    }

    if (decision !== "BLOCK") {
      if (computed.grossMarginRate < policy.minMarginRate + policy.warnMarginBand) {
        if (decision === "PASS") decision = "WARN";
        reasons.push(
          `Gross margin ${(computed.grossMarginRate * 100).toFixed(1)}% is within warning band of minimum (${((policy.minMarginRate + policy.warnMarginBand) * 100).toFixed(1)}%)`
        );
      }

      if (computed.impliedValuePerPtMicrousd > policy.maxValuePerPtMicrousd) {
        if (decision === "PASS") decision = "WARN";
        const impliedValueUsd = computed.impliedValuePerPtMicrousd / 1000000;
        const maxValueUsd = policy.maxValuePerPtMicrousd / 1000000;
        reasons.push(
          `Implied value per PackPTS ($${impliedValueUsd.toFixed(6)}) exceeds max ($${maxValueUsd.toFixed(6)}) - too generous`
        );
      }

      if (computed.netRevenueCents < 0) {
        decision = "BLOCK";
        reasons.push("Net revenue is negative after fees");
      }
    }

    if (reasons.length === 0) {
      reasons.push("All guardrails passed");
    }

    return { decision, reasons };
  }

  async evaluatePackage(
    priceCents: number,
    ptsGrant: number,
    channel: SalesChannel = "web_stripe"
  ): Promise<EvaluationResult> {
    const policy = await this.getActivePolicy();
    if (!policy) {
      throw new Error("No active store package policy configured");
    }

    const feeProfile = await this.getFeeProfile(channel);
    if (!feeProfile) {
      throw new Error(`No active fee profile for channel: ${channel}`);
    }

    const computed = this.computeMetrics(priceCents, ptsGrant, channel, feeProfile, policy);
    const { decision, reasons } = this.evaluateMetrics(computed, policy);

    return {
      decision,
      reasons,
      computed,
      policy: {
        minMarginRate: policy.minMarginRate,
        warnMarginBand: policy.warnMarginBand,
        maxValuePerPtMicrousd: policy.maxValuePerPtMicrousd,
        allowOverride: policy.allowOverride,
        reserveRate: policy.reserveRate,
      },
      feeProfile: {
        channel: feeProfile.channel as SalesChannel,
        feeRate: feeProfile.feeRate,
        feeFixedCents: feeProfile.feeFixedCents,
        platformFeeRate: feeProfile.platformFeeRate,
      },
    };
  }

  async recordValidation(
    evaluation: EvaluationResult,
    productId: string | null,
    adminUserId: string | null,
    overrideNote?: string
  ): Promise<string> {
    const policy = await this.getActivePolicy();
    const feeProfile = await this.getFeeProfile(evaluation.computed.channel);

    if (!policy || !feeProfile) {
      throw new Error("Missing policy or fee profile");
    }

    const validation: InsertStorePackageValidation = {
      productId: productId || undefined,
      policyId: policy.id,
      feeProfileId: feeProfile.id,
      priceCents: evaluation.computed.priceCents,
      ptsGrant: evaluation.computed.ptsGrant,
      channel: evaluation.computed.channel,
      totalFeesCents: evaluation.computed.totalFeesCents,
      netRevenueCents: evaluation.computed.netRevenueCents,
      grossMarginRate: evaluation.computed.grossMarginRate,
      impliedValuePerPtMicrousd: evaluation.computed.impliedValuePerPtMicrousd,
      decision: overrideNote ? "OVERRIDE" : evaluation.decision,
      reasons: evaluation.reasons,
      adminUserId: adminUserId || undefined,
      overrideNote,
    };

    const [result] = await db
      .insert(storePackageValidations)
      .values(validation)
      .returning({ id: storePackageValidations.id });

    return result.id;
  }

  async getValidationHistory(productId: string): Promise<typeof storePackageValidations.$inferSelect[]> {
    return db
      .select()
      .from(storePackageValidations)
      .where(eq(storePackageValidations.productId, productId))
      .orderBy(desc(storePackageValidations.createdAt));
  }

  async getLatestValidation(productId: string): Promise<typeof storePackageValidations.$inferSelect | null> {
    const validations = await db
      .select()
      .from(storePackageValidations)
      .where(eq(storePackageValidations.productId, productId))
      .orderBy(desc(storePackageValidations.createdAt))
      .limit(1);

    return validations[0] || null;
  }

  async createPackage(
    sku: string,
    name: string,
    priceCents: number,
    ptsGrant: number,
    channel: SalesChannel,
    adminUserId: string,
    confirm: boolean = false
  ): Promise<{ productId: string; validationId: string; evaluation: EvaluationResult }> {
    const evaluation = await this.evaluatePackage(priceCents, ptsGrant, channel);

    if (evaluation.decision === "BLOCK") {
      throw new BlockedPackageError(evaluation);
    }

    if (evaluation.decision === "WARN" && !confirm) {
      throw new WarnPackageError(evaluation);
    }

    const [product] = await db
      .insert(products)
      .values({
        sku,
        name,
        type: "CONSUMABLE",
        packptsGrant: ptsGrant,
        priceUsd: priceCents,
        isActive: true,
        metadata: { channel },
      })
      .returning({ id: products.id });

    const validationId = await this.recordValidation(
      evaluation,
      product.id,
      adminUserId
    );

    return { productId: product.id, validationId, evaluation };
  }

  async updatePackage(
    productId: string,
    updates: {
      sku?: string;
      name?: string;
      priceCents?: number;
      ptsGrant?: number;
      channel?: SalesChannel;
    },
    adminUserId: string,
    confirm: boolean = false
  ): Promise<{ validationId: string; evaluation: EvaluationResult }> {
    const [existingProduct] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!existingProduct) {
      throw new Error("Product not found");
    }

    const metadata = existingProduct.metadata as { channel?: SalesChannel } | null;
    const channel = updates.channel || metadata?.channel || "web_stripe";
    const priceCents = updates.priceCents ?? existingProduct.priceUsd ?? 0;
    const ptsGrant = updates.ptsGrant ?? existingProduct.packptsGrant ?? 0;

    const evaluation = await this.evaluatePackage(priceCents, ptsGrant, channel);

    if (evaluation.decision === "BLOCK") {
      throw new BlockedPackageError(evaluation);
    }

    if (evaluation.decision === "WARN" && !confirm) {
      throw new WarnPackageError(evaluation);
    }

    await db
      .update(products)
      .set({
        sku: updates.sku ?? existingProduct.sku,
        name: updates.name ?? existingProduct.name,
        priceUsd: priceCents,
        packptsGrant: ptsGrant,
        metadata: { ...metadata, channel },
      })
      .where(eq(products.id, productId));

    const validationId = await this.recordValidation(
      evaluation,
      productId,
      adminUserId
    );

    return { validationId, evaluation };
  }

  async overridePackage(
    productId: string,
    note: string,
    adminUserId: string
  ): Promise<{ validationId: string }> {
    const policy = await this.getActivePolicy();
    if (!policy?.allowOverride) {
      throw new Error("Policy does not allow overrides");
    }

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) {
      throw new Error("Product not found");
    }

    const metadata = product.metadata as { channel?: SalesChannel } | null;
    const channel = metadata?.channel || "web_stripe";
    const priceCents = product.priceUsd ?? 0;
    const ptsGrant = product.packptsGrant ?? 0;

    const evaluation = await this.evaluatePackage(priceCents, ptsGrant, channel);

    const validationId = await this.recordValidation(
      evaluation,
      productId,
      adminUserId,
      note
    );

    return { validationId };
  }

  async updatePolicy(
    updates: Partial<{
      minMarginRate: number;
      warnMarginBand: number;
      maxValuePerPtMicrousd: number;
      allowOverride: boolean;
      reserveRate: number;
    }>
  ): Promise<StorePackagePolicy> {
    const currentPolicy = await this.getActivePolicy();
    
    if (currentPolicy) {
      await db
        .update(storePackagePolicy)
        .set({ isActive: false })
        .where(eq(storePackagePolicy.id, currentPolicy.id));
    }

    const [newPolicy] = await db
      .insert(storePackagePolicy)
      .values({
        minMarginRate: updates.minMarginRate ?? currentPolicy?.minMarginRate ?? 0.30,
        warnMarginBand: updates.warnMarginBand ?? currentPolicy?.warnMarginBand ?? 0.05,
        maxValuePerPtMicrousd: updates.maxValuePerPtMicrousd ?? currentPolicy?.maxValuePerPtMicrousd ?? 2000,
        allowOverride: updates.allowOverride ?? currentPolicy?.allowOverride ?? false,
        reserveRate: updates.reserveRate ?? currentPolicy?.reserveRate ?? 1.0,
        isActive: true,
      })
      .returning();

    return newPolicy;
  }

  async updateFeeProfile(
    channel: SalesChannel,
    updates: Partial<{
      feeRate: number;
      feeFixedCents: number;
      platformFeeRate: number;
    }>
  ): Promise<StoreFeeProfile> {
    const [updatedProfile] = await db
      .update(storeFeeProfiles)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(storeFeeProfiles.channel, channel))
      .returning();

    if (!updatedProfile) {
      throw new Error(`Fee profile for channel ${channel} not found`);
    }

    return updatedProfile;
  }
}

export class BlockedPackageError extends Error {
  public evaluation: EvaluationResult;

  constructor(evaluation: EvaluationResult) {
    super(`Package blocked: ${evaluation.reasons.join(", ")}`);
    this.name = "BlockedPackageError";
    this.evaluation = evaluation;
  }
}

export class WarnPackageError extends Error {
  public evaluation: EvaluationResult;

  constructor(evaluation: EvaluationResult) {
    super(`Package requires confirmation: ${evaluation.reasons.join(", ")}`);
    this.name = "WarnPackageError";
    this.evaluation = evaluation;
  }
}

export const packageGuardrailService = new PackageGuardrailService();
