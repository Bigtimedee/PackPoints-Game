import Stripe from "stripe";
import { db } from "../db";
import { stripeCheckoutSessions, type CheckoutSessionStatus as DbCheckoutSessionStatus } from "@shared/schema";
import { eq } from "drizzle-orm";
import { PRODUCT_DEFINITIONS, PACKPTS_BUNDLE_SKUS, type InternalSku } from "./productMap";
import { analyticsService } from "./analyticsService";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!STRIPE_SECRET_KEY;
}

export interface PackPtsBundleProduct {
  sku: string;
  name: string;
  packptsGrant: number;
  priceUsd: number;
  description: string;
  formattedPrice: string;
  valuePerDollar: number;
  isBestValue: boolean;
}

export interface CheckoutResult {
  success: boolean;
  url?: string;
  sessionId?: string;
  error?: string;
}

export interface CheckoutSessionStatusInfo {
  sessionId: string;
  userId: string;
  sku: string;
  status: string;
  packptsGrant: number | null;
  amountCents: number | null;
}

class StoreCheckoutService {
  getPackPtsBundles(): PackPtsBundleProduct[] {
    const bundles: PackPtsBundleProduct[] = [];
    
    for (const sku of PACKPTS_BUNDLE_SKUS) {
      const product = PRODUCT_DEFINITIONS[sku];
      if (product && product.type === "CONSUMABLE" && "packptsGrant" in product) {
        const priceUsd = product.priceUsd / 100;
        const valuePerDollar = product.packptsGrant / priceUsd;
        
        bundles.push({
          sku,
          name: product.name,
          packptsGrant: product.packptsGrant,
          priceUsd: product.priceUsd,
          description: product.description || "",
          formattedPrice: `$${priceUsd.toFixed(2)}`,
          valuePerDollar: Math.round(valuePerDollar),
          isBestValue: sku === "PACKPTS_6000",
        });
      }
    }
    
    return bundles;
  }

  async createCheckoutSession(
    userId: string,
    sku: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutResult> {
    if (!isStripeConfigured()) {
      return { success: false, error: "Stripe is not configured" };
    }

    if (!PACKPTS_BUNDLE_SKUS.includes(sku as any)) {
      return { success: false, error: "Invalid SKU - only PackPTS bundles can be purchased" };
    }

    const productDef = PRODUCT_DEFINITIONS[sku as InternalSku];
    if (!productDef || productDef.type !== "CONSUMABLE") {
      return { success: false, error: "Product not found or not a consumable" };
    }
    
    const packptsGrant = (productDef as { packptsGrant: number }).packptsGrant;
    const description = (productDef as { description?: string }).description || `Get ${packptsGrant} PackPTS`;

    try {
      const stripeClient = getStripe();
      
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: productDef.name,
                description,
              },
              unit_amount: productDef.priceUsd,
            },
            quantity: 1,
          },
        ],
        metadata: {
          userId,
          sku,
          packptsGrant: packptsGrant.toString(),
        },
        client_reference_id: userId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      await db.insert(stripeCheckoutSessions).values({
        userId,
        sku,
        stripeSessionId: session.id,
        status: "CREATED",
        packptsGrant,
        amountCents: productDef.priceUsd,
        currency: "usd",
        metadata: { productName: productDef.name },
      });

      await analyticsService.purchaseStarted(userId, {
        sku,
        sessionId: session.id,
        packptsGrant,
        amountCents: productDef.priceUsd,
      });

      return {
        success: true,
        url: session.url!,
        sessionId: session.id,
      };
    } catch (error) {
      console.error("[StoreCheckout] Error creating checkout session:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create checkout session",
      };
    }
  }

  async getCheckoutSessionStatus(stripeSessionId: string): Promise<CheckoutSessionStatusInfo | null> {
    const result = await db
      .select()
      .from(stripeCheckoutSessions)
      .where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const session = result[0];
    return {
      sessionId: session.stripeSessionId,
      userId: session.userId,
      sku: session.sku,
      status: session.status,
      packptsGrant: session.packptsGrant,
      amountCents: session.amountCents,
    };
  }

  async updateCheckoutSessionStatus(
    stripeSessionId: string,
    status: "CREATED" | "PAID" | "CANCELED" | "EXPIRED"
  ): Promise<void> {
    await db
      .update(stripeCheckoutSessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(stripeCheckoutSessions.stripeSessionId, stripeSessionId));
  }
}

export const storeCheckoutService = new StoreCheckoutService();
