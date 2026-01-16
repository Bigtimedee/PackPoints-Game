import Stripe from "stripe";
import { db } from "../db";
import { stripeCheckoutSessions, subscriptionProducts, type CheckoutSessionStatus as DbCheckoutSessionStatus, type SubscriptionProduct } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { PRODUCT_DEFINITIONS, PACKPTS_BUNDLE_SKUS, PACKPTS_MONTHLY_SKUS, type InternalSku, getSubscriptionProducts } from "./productMap";
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

export interface PackPtsSubscriptionProduct {
  sku: string;
  name: string;
  packptsGrant: number;
  priceUsd: number;
  description: string;
  formattedPrice: string;
  valuePerDollar: number;
  isBestValue: boolean;
  stripePriceId?: string | null;
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

  // Get available monthly PackPTS subscription products from database
  async getPackPtsSubscriptions(): Promise<PackPtsSubscriptionProduct[]> {
    try {
      const dbProducts = await db
        .select()
        .from(subscriptionProducts)
        .where(eq(subscriptionProducts.isActive, true))
        .orderBy(subscriptionProducts.sortOrder);
      
      if (dbProducts.length === 0) {
        // Fallback to hardcoded products if database is empty
        return getSubscriptionProducts();
      }
      
      return dbProducts.map(product => {
        const priceUsd = product.priceUsd / 100;
        return {
          sku: product.id, // Use database ID as SKU for DB-managed products
          name: product.name,
          packptsGrant: product.packptsGrant,
          priceUsd: product.priceUsd,
          description: product.description || "",
          formattedPrice: `$${priceUsd.toFixed(2)}/month`,
          valuePerDollar: Math.round(product.packptsGrant / priceUsd),
          isBestValue: product.isBestValue,
          stripePriceId: product.stripePriceId,
        };
      });
    } catch (error) {
      console.error("[StoreCheckout] Error getting subscription products from DB:", error);
      // Fallback to hardcoded products on error
      return getSubscriptionProducts();
    }
  }
  
  // Get a subscription product by ID from database
  async getSubscriptionProductById(productId: string): Promise<SubscriptionProduct | null> {
    const result = await db
      .select()
      .from(subscriptionProducts)
      .where(and(
        eq(subscriptionProducts.id, productId),
        eq(subscriptionProducts.isActive, true)
      ))
      .limit(1);
    
    return result[0] || null;
  }

  // Create a subscription checkout session for monthly PackPTS packages
  async createSubscriptionCheckoutSession(
    userId: string,
    sku: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutResult> {
    if (!isStripeConfigured()) {
      return { success: false, error: "Stripe is not configured" };
    }

    // Try to find product in database first (by ID)
    const dbProduct = await this.getSubscriptionProductById(sku);
    
    // Fall back to hardcoded products if not found in DB
    let productName: string;
    let packptsGrant: number;
    let priceUsd: number;
    let description: string;
    let stripePriceId: string | null = null;
    let billingInterval: string = "month";
    
    if (dbProduct) {
      // Use database product
      productName = dbProduct.name;
      packptsGrant = dbProduct.packptsGrant;
      priceUsd = dbProduct.priceUsd;
      description = dbProduct.description || `Get ${packptsGrant} PackPTS every month`;
      stripePriceId = dbProduct.stripePriceId;
      billingInterval = dbProduct.billingInterval;
    } else if (PACKPTS_MONTHLY_SKUS.includes(sku as any)) {
      // Fall back to hardcoded product
      const productDef = PRODUCT_DEFINITIONS[sku as InternalSku];
      if (!productDef || productDef.type !== "SUBSCRIPTION") {
        return { success: false, error: "Product not found or not a subscription" };
      }
      productName = productDef.name;
      packptsGrant = (productDef as { packptsGrant: number }).packptsGrant;
      priceUsd = productDef.priceUsd;
      description = (productDef as { description?: string }).description || `Get ${packptsGrant} PackPTS every month`;
    } else {
      return { success: false, error: "Invalid subscription product" };
    }

    try {
      const stripeClient = getStripe();
      
      // Build checkout session config
      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
      
      if (stripePriceId) {
        // Use pre-created Stripe Price if configured
        lineItems = [{ price: stripePriceId, quantity: 1 }];
      } else {
        // Create price on-the-fly
        lineItems = [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: productName,
                description,
              },
              unit_amount: priceUsd,
              recurring: {
                interval: billingInterval as "month" | "year",
              },
            },
            quantity: 1,
          },
        ];
      }
      
      // Create a subscription checkout session with recurring billing
      const session = await stripeClient.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: lineItems,
        subscription_data: {
          metadata: {
            userId,
            sku,
            packptsGrant: packptsGrant.toString(),
            productId: dbProduct?.id || sku,
          },
        },
        metadata: {
          userId,
          sku,
          packptsGrant: packptsGrant.toString(),
          productId: dbProduct?.id || sku,
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
        amountCents: priceUsd,
        currency: "usd",
        metadata: { 
          productName,
          isSubscription: true,
          billingInterval,
          productId: dbProduct?.id,
        },
      });

      await analyticsService.purchaseStarted(userId, {
        sku,
        sessionId: session.id,
        packptsGrant,
        amountCents: priceUsd,
        isSubscription: true,
      });

      return {
        success: true,
        url: session.url!,
        sessionId: session.id,
      };
    } catch (error) {
      console.error("[StoreCheckout] Error creating subscription checkout session:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create subscription checkout session",
      };
    }
  }
}

export const storeCheckoutService = new StoreCheckoutService();
