import Stripe from "stripe";
import { db } from "../db";
import { stripeCheckoutSessions, subscriptionProducts, products, type CheckoutSessionStatus as DbCheckoutSessionStatus, type SubscriptionProduct } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { PRODUCT_DEFINITIONS, PACKPTS_BUNDLE_SKUS, PACKPTS_MONTHLY_SKUS, type InternalSku, getSubscriptionProducts } from "./productMap";
import { analyticsService } from "./analyticsService";
import { getStripeClient, isStripeConfiguredSync, isStripeConfiguredAsync } from "../stripeClient";

export function isStripeConfigured(): boolean {
  return isStripeConfiguredSync();
}

export async function checkStripeConfigured(): Promise<boolean> {
  return isStripeConfiguredAsync();
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
  private getHardcodedBundles(): PackPtsBundleProduct[] {
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
          isBestValue: sku === "PACKPTS_45000",
        });
      }
    }
    return bundles;
  }

  async getPackPtsBundles(): Promise<PackPtsBundleProduct[]> {
    try {
      const dbProducts = await db
        .select()
        .from(products)
        .where(and(
          eq(products.isActive, true),
          eq(products.type, "CONSUMABLE")
        ))
        .orderBy(products.sortOrder);

      if (dbProducts.length === 0) {
        return this.getHardcodedBundles();
      }

      return dbProducts.map(product => {
        const priceUsd = (product.priceUsd || 0) / 100;
        const packptsGrant = product.packptsGrant || 0;
        const valuePerDollar = priceUsd > 0 ? packptsGrant / priceUsd : 0;
        return {
          sku: product.sku,
          name: product.name,
          packptsGrant,
          priceUsd: product.priceUsd || 0,
          description: product.description || "",
          formattedPrice: `$${priceUsd.toFixed(2)}`,
          valuePerDollar: Math.round(valuePerDollar),
          isBestValue: product.isBestValue ?? false,
        };
      });
    } catch (error) {
      console.error("[StoreCheckout] Error getting bundles from DB:", error);
      return this.getHardcodedBundles();
    }
  }

  async createCheckoutSession(
    userId: string,
    sku: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutResult> {
    const configured = await isStripeConfiguredAsync();
    if (!configured) {
      return { success: false, error: "Stripe is not configured" };
    }

    let productName: string;
    let packptsGrant: number;
    let priceUsd: number;
    let description: string;
    let stripePriceId: string | null = null;

    const dbProduct = await db
      .select()
      .from(products)
      .where(and(
        eq(products.sku, sku),
        eq(products.isActive, true),
        eq(products.type, "CONSUMABLE")
      ))
      .limit(1);

    if (dbProduct.length > 0) {
      const product = dbProduct[0];
      productName = product.name;
      packptsGrant = product.packptsGrant || 0;
      priceUsd = product.priceUsd || 0;
      description = product.description || `Get ${packptsGrant} PackPTS`;
      stripePriceId = product.stripePriceId || null;
    } else if (PACKPTS_BUNDLE_SKUS.includes(sku as any)) {
      const productDef = PRODUCT_DEFINITIONS[sku as InternalSku];
      if (!productDef || productDef.type !== "CONSUMABLE") {
        return { success: false, error: "Product not found or not a consumable" };
      }
      productName = productDef.name;
      packptsGrant = (productDef as { packptsGrant: number }).packptsGrant;
      priceUsd = productDef.priceUsd;
      description = (productDef as { description?: string }).description || `Get ${packptsGrant} PackPTS`;
    } else {
      return { success: false, error: "Invalid SKU - product not found" };
    }

    if (!packptsGrant || packptsGrant <= 0) {
      return { success: false, error: "Invalid product configuration - missing PackPTS grant" };
    }
    if (!priceUsd || priceUsd <= 0) {
      return { success: false, error: "Invalid product configuration - missing price" };
    }

    try {
      const stripeClient = await getStripeClient();

      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

      if (stripePriceId) {
        lineItems = [{ price: stripePriceId, quantity: 1 }];
      } else {
        lineItems = [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: productName,
                description,
              },
              unit_amount: priceUsd,
            },
            quantity: 1,
          },
        ];
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
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
        amountCents: priceUsd,
        currency: "usd",
        metadata: { productName },
      });

      await analyticsService.purchaseStarted(userId, {
        sku,
        sessionId: session.id,
        packptsGrant,
        amountCents: priceUsd,
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
    const configured = await isStripeConfiguredAsync();
    if (!configured) {
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
      const stripeClient = await getStripeClient();
      
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
