import Stripe from "stripe";
import { db } from "../db";
import { purchaseEvents, stripeCustomers, stripeCheckoutSessions, userRiskState, riskSignals, type PurchaseEventStatus } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { walletService } from "./walletService";
import { storage } from "../storage";
import { getInternalSku, PRODUCT_DEFINITIONS, type InternalSku, isPackPtsSubscription } from "./productMap";
import { analyticsService } from "./analyticsService";
import { getStripeClient, getStripeSync, isStripeConfiguredSync, isStripeConfiguredAsync } from "../stripeClient";
import { marginLedgerService } from "./marginLedgerService";

export function isStripeConfigured(): boolean {
  return isStripeConfiguredSync();
}

export async function checkStripeConfigured(): Promise<boolean> {
  return isStripeConfiguredAsync();
}

export interface WebhookProcessResult {
  success: boolean;
  eventId: string;
  status: PurchaseEventStatus;
  message?: string;
  error?: string;
}

export interface SyncResult {
  userId: string;
  processedEvents: number;
  grantedPackPts: number;
  grantedEntitlements: string[];
  errors: string[];
}

class StripePurchaseService {
  async verifyAndParseWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<Stripe.Event> {
    const stripeSync = await getStripeSync();
    const event = await stripeSync.constructWebhookEvent(payload, signature);
    return event;
  }

  async processWebhookEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
    const eventId = event.id;
    const eventType = event.type;

    const existingEvent = await db
      .select()
      .from(purchaseEvents)
      .where(eq(purchaseEvents.eventId, eventId))
      .limit(1);

    if (existingEvent.length > 0) {
      return {
        success: true,
        eventId,
        status: existingEvent[0].status as PurchaseEventStatus,
        message: "Event already processed (idempotent)",
      };
    }

    let userId: string | null = null;
    try {
      userId = this.extractUserId(event);
    } catch (e) {
      // userId remains null
    }

    await db.insert(purchaseEvents).values({
      eventId,
      eventType,
      userId,
      payload: event as unknown as Record<string, unknown>,
      status: "received",
    });

    try {
      const result = await this.handleEvent(event);
      
      await db
        .update(purchaseEvents)
        .set({
          status: result.status,
          errorMessage: result.error || null,
          processedAt: new Date(),
          updatedAt: new Date(),
          userId: result.userId || userId,
        })
        .where(eq(purchaseEvents.eventId, eventId));

      return {
        success: result.status === "processed",
        eventId,
        status: result.status,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      await db
        .update(purchaseEvents)
        .set({
          status: "failed",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(purchaseEvents.eventId, eventId));

      return {
        success: false,
        eventId,
        status: "failed",
        error: errorMessage,
      };
    }
  }

  private extractUserId(event: Stripe.Event): string | null {
    const obj = event.data.object as any;
    
    if (obj.metadata?.userId) {
      return obj.metadata.userId;
    }
    
    if (obj.client_reference_id) {
      return obj.client_reference_id;
    }

    return null;
  }

  private async handleEvent(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    switch (event.type) {
      case "checkout.session.completed":
        return this.handleCheckoutCompleted(event);
      
      case "invoice.paid":
        return this.handleInvoicePaid(event);
      
      case "customer.subscription.updated":
        return this.handleSubscriptionUpdated(event);
      
      case "customer.subscription.deleted":
        return this.handleSubscriptionDeleted(event);
      
      case "charge.refunded":
        return this.handleChargeRefunded(event);
      
      case "charge.dispute.created":
        return this.handleChargeDispute(event);
      
      default:
        return {
          status: "ignored",
          message: `Event type ${event.type} not handled`,
        };
    }
  }

  private async handleCheckoutCompleted(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const session = event.data.object as Stripe.Checkout.Session;
    
    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId) {
      return {
        status: "failed",
        error: "No userId found in session metadata or client_reference_id",
      };
    }

    if (session.customer) {
      await this.ensureStripeCustomerMapping(
        userId,
        typeof session.customer === "string" ? session.customer : session.customer.id
      );
    }

    if (session.mode === "subscription") {
      return {
        status: "processed",
        message: "Subscription checkout completed - will be processed via invoice.paid",
        userId,
      };
    }

    const lineItems = await this.getSessionLineItems(session.id);
    if (!lineItems || lineItems.length === 0) {
      return {
        status: "failed",
        error: "No line items found in checkout session",
        userId,
      };
    }

    let totalPackPts = 0;
    const entitlementsGranted: string[] = [];

    for (const item of lineItems) {
      const priceId = item.price?.id;
      if (!priceId) continue;

      const internalSku = getInternalSku(priceId) || this.extractSkuFromPriceId(priceId);
      if (!internalSku) {
        console.warn(`Unknown price ID: ${priceId}`);
        continue;
      }

      const productDef = PRODUCT_DEFINITIONS[internalSku as InternalSku];
      if (!productDef) {
        console.warn(`Unknown internal SKU: ${internalSku}`);
        continue;
      }

      const quantity = item.quantity || 1;
      if (quantity <= 0) {
        console.warn(`Invalid quantity ${quantity} for price ID: ${priceId}`);
        continue;
      }
      
      const idempotencyKey = `stripe_event_${event.id}_${priceId}`;

      if (productDef.type === "CONSUMABLE" && "packptsGrant" in productDef) {
        const amount = productDef.packptsGrant * quantity;
        if (amount <= 0) {
          console.warn(`Invalid amount ${amount} for product: ${productDef.name}`);
          continue;
        }
        const result = await walletService.purchaseCredit(
          userId,
          amount,
          `Purchase: ${productDef.name}`,
          idempotencyKey,
          { stripeEventId: event.id, priceId, quantity, sku: internalSku }
        );

        if (result.success && !result.idempotent) {
          totalPackPts += amount;
          
          const priceCents = "priceUsd" in productDef ? productDef.priceUsd * quantity : 0;
          if (priceCents > 0) {
            try {
              await marginLedgerService.recordPackPtsPurchaseMargin({
                stripeEventId: event.id,
                userId,
                priceCents,
                ptsGrant: amount,
                productName: productDef.name,
                channel: "web_stripe",
              });
            } catch (marginError) {
              console.error("Failed to record margin contribution:", marginError);
            }
          }
        }
      } else if (productDef.type === "ENTITLEMENT" && "entitlementKey" in productDef) {
        await storage.grantEntitlement({
          userId,
          entitlementKey: productDef.entitlementKey,
          source: "purchase",
          sourceReference: event.id,
          expiresAt: null,
        });
        entitlementsGranted.push(productDef.entitlementKey);
      }
    }
    
    if (totalPackPts > 0 || entitlementsGranted.length > 0) {
      await analyticsService.purchaseCompleted(userId, {
        sessionId: session.id,
        stripeEventId: event.id,
        mode: session.mode,
        packptsGranted: totalPackPts,
        entitlementsGranted,
        amountTotal: session.amount_total,
        currency: session.currency,
      });
    }

    // Update checkout session status to PAID for UI polling
    await db
      .update(stripeCheckoutSessions)
      .set({ status: "PAID", updatedAt: new Date() })
      .where(eq(stripeCheckoutSessions.stripeSessionId, session.id));

    return {
      status: "processed",
      message: `Granted ${totalPackPts} PackPTS, ${entitlementsGranted.length} entitlements`,
      userId,
    };
  }

  private async handleInvoicePaid(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const invoice = event.data.object as Stripe.Invoice;
    
    const userId = (invoice as any).subscription_details?.metadata?.userId 
      || invoice.metadata?.userId
      || await this.getUserIdFromStripeCustomer(
          typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as any)?.id
        );

    if (!userId) {
      return {
        status: "failed",
        error: "No userId found for invoice",
      };
    }

    const subscriptionId = typeof (invoice as any).subscription === "string" 
      ? (invoice as any).subscription 
      : (invoice as any).subscription?.id;

    if (!subscriptionId) {
      return {
        status: "ignored",
        message: "Invoice is not for a subscription",
        userId,
      };
    }

    const stripeClient = await getStripeClient();
    const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
    
    const priceId = subscription.items.data[0]?.price?.id;
    if (!priceId) {
      return {
        status: "failed",
        error: "No price found in subscription",
        userId,
      };
    }

    const internalSku = getInternalSku(priceId) || this.extractSkuFromPriceId(priceId);
    const productDef = internalSku ? PRODUCT_DEFINITIONS[internalSku as InternalSku] : null;

    if (!productDef || productDef.type !== "SUBSCRIPTION") {
      return {
        status: "failed",
        error: `Unknown or invalid subscription product: ${priceId}`,
        userId,
      };
    }

    const currentPeriodEnd = new Date((subscription as any).current_period_end * 1000);
    const gracePeriod = 3 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(currentPeriodEnd.getTime() + gracePeriod);

    let packptsGranted = 0;
    let entitlementGranted: string | null = null;

    // Check if this is a PackPTS subscription (grants points) vs entitlement subscription (grants access)
    if ("packptsGrant" in productDef && productDef.packptsGrant > 0) {
      // Monthly PackPTS subscription - credit points to user's wallet
      const idempotencyKey = `stripe_sub_${event.id}_${priceId}`;
      const result = await walletService.purchaseCredit(
        userId,
        productDef.packptsGrant,
        `Monthly subscription: ${productDef.name}`,
        idempotencyKey,
        { stripeEventId: event.id, subscriptionId, priceId, sku: internalSku }
      );

      if (result.success && !result.idempotent) {
        packptsGranted = productDef.packptsGrant;
        
        const priceCents = "priceUsd" in productDef ? productDef.priceUsd : 0;
        if (priceCents > 0) {
          try {
            await marginLedgerService.recordPackPtsPurchaseMargin({
              stripeEventId: event.id,
              userId,
              priceCents,
              ptsGrant: packptsGranted,
              productName: productDef.name,
              channel: "web_stripe",
            });
          } catch (marginError) {
            console.error("Failed to record margin contribution for subscription:", marginError);
          }
        }
      }
      
      await analyticsService.purchaseCompleted(userId, {
        subscriptionId,
        stripeEventId: event.id,
        type: "subscription_renewal",
        sku: internalSku,
        packptsGranted,
        amountTotal: invoice.amount_paid,
        currency: invoice.currency,
      });

      return {
        status: "processed",
        message: `Subscription credited ${packptsGranted} PackPTS for '${productDef.name}'`,
        userId,
      };
    } else if ("entitlementKey" in productDef) {
      // Entitlement subscription - grant access (Pro tier, etc.)
      await storage.grantEntitlement({
        userId,
        entitlementKey: productDef.entitlementKey,
        source: "purchase",
        sourceReference: event.id,
        expiresAt,
      });
      
      entitlementGranted = productDef.entitlementKey;
      
      await analyticsService.purchaseCompleted(userId, {
        subscriptionId,
        stripeEventId: event.id,
        type: "subscription_renewal",
        entitlementKey: productDef.entitlementKey,
        expiresAt: expiresAt.toISOString(),
        amountTotal: invoice.amount_paid,
        currency: invoice.currency,
      });

      return {
        status: "processed",
        message: `Subscription entitlement '${productDef.entitlementKey}' granted until ${expiresAt.toISOString()}`,
        userId,
      };
    }

    return {
      status: "failed",
      error: `Subscription product ${internalSku} has neither packptsGrant nor entitlementKey`,
      userId,
    };
  }

  private async handleSubscriptionUpdated(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const subscription = event.data.object as Stripe.Subscription;
    
    const userId = subscription.metadata?.userId 
      || await this.getUserIdFromStripeCustomer(
          typeof subscription.customer === "string" ? subscription.customer : (subscription.customer as any)?.id
        );

    if (!userId) {
      return {
        status: "failed",
        error: "No userId found for subscription",
      };
    }

    if (subscription.status === "active" || subscription.status === "trialing") {
      const priceId = subscription.items.data[0]?.price?.id;
      const internalSku = priceId ? (getInternalSku(priceId) || this.extractSkuFromPriceId(priceId)) : null;
      const productDef = internalSku ? PRODUCT_DEFINITIONS[internalSku as InternalSku] : null;

      if (productDef && productDef.type === "SUBSCRIPTION" && "entitlementKey" in productDef) {
        const currentPeriodEnd = new Date((subscription as any).current_period_end * 1000);
        const gracePeriod = 3 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(currentPeriodEnd.getTime() + gracePeriod);

        await storage.grantEntitlement({
          userId,
          entitlementKey: productDef.entitlementKey,
          source: "purchase",
          sourceReference: event.id,
          expiresAt,
        });

        return {
          status: "processed",
          message: `Subscription entitlement updated, expires ${expiresAt.toISOString()}`,
          userId,
        };
      }
    }

    return {
      status: "ignored",
      message: `Subscription status: ${subscription.status}`,
      userId,
    };
  }

  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const subscription = event.data.object as Stripe.Subscription;
    
    const userId = subscription.metadata?.userId 
      || await this.getUserIdFromStripeCustomer(
          typeof subscription.customer === "string" ? subscription.customer : (subscription.customer as any)?.id
        );

    if (!userId) {
      return {
        status: "ignored",
        message: "No userId found for canceled subscription",
      };
    }

    return {
      status: "processed",
      message: "Subscription canceled - entitlement will expire naturally",
      userId,
    };
  }

  private async handleChargeRefunded(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const charge = event.data.object as Stripe.Charge;
    
    const userId = charge.metadata?.userId 
      || await this.getUserIdFromStripeCustomer(
          typeof charge.customer === "string" ? charge.customer : (charge.customer as any)?.id
        );

    if (!userId) {
      return {
        status: "ignored",
        message: "No userId found for refunded charge",
      };
    }

    const paymentIntentId = typeof charge.payment_intent === "string" 
      ? charge.payment_intent 
      : (charge.payment_intent as any)?.id;

    let reversedAmount = 0;
    const reversalErrors: string[] = [];

    if (paymentIntentId) {
      const stripeClient = await getStripeClient();
      
      try {
        const sessions = await stripeClient.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });

        if (sessions.data.length > 0) {
          const session = sessions.data[0];
          const lineItems = await this.getSessionLineItems(session.id);

          if (lineItems) {
            for (const item of lineItems) {
              const priceId = item.price?.id;
              if (!priceId) continue;

              const internalSku = getInternalSku(priceId) || this.extractSkuFromPriceId(priceId);
              const productDef = internalSku ? PRODUCT_DEFINITIONS[internalSku as InternalSku] : null;

              if (!productDef) continue;

              if (productDef.type === "CONSUMABLE" && "packptsGrant" in productDef) {
                const quantity = item.quantity || 1;
                const amount = productDef.packptsGrant * quantity;
                
                const reversalIdempotencyKey = `stripe_refund_${event.id}_${priceId}`;
                
                const originalEntry = await this.findOriginalPurchaseEntry(
                  userId, 
                  priceId, 
                  session.id
                );
                
                if (originalEntry) {
                  const originalIdempotencyKey = originalEntry.idempotencyKey!;
                  const reversalResult = await walletService.reversal(
                    userId,
                    amount,
                    `Refund: ${productDef.name}`,
                    reversalIdempotencyKey,
                    originalIdempotencyKey,
                    { stripeRefundEventId: event.id, chargeId: charge.id, priceId }
                  );

                  if (reversalResult.success && !reversalResult.idempotent) {
                    reversedAmount += amount;
                  } else if (!reversalResult.success) {
                    reversalErrors.push(reversalResult.error || "Unknown reversal error");
                  }
                } else {
                  console.warn(`No original purchase found for refund: userId=${userId}, priceId=${priceId}, sessionId=${session.id}`);
                }
              } else if ((productDef.type === "ENTITLEMENT" || productDef.type === "SUBSCRIPTION") 
                  && "entitlementKey" in productDef) {
                await storage.revokeEntitlement(userId, productDef.entitlementKey, `Refund: ${event.id}`);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error processing refund:", error);
        reversalErrors.push(error instanceof Error ? error.message : "Unknown error");
      }
    }

    const message = reversedAmount > 0
      ? `Reversed ${reversedAmount} PackPTS for charge ${charge.id}`
      : `Refund logged for charge ${charge.id}. ${reversalErrors.length > 0 ? `Errors: ${reversalErrors.join(", ")}` : "No consumables to reverse."}`;

    console.warn(`Refund processed for user ${userId}: ${message}`);

    // Record refund risk signal
    await this.recordRiskSignal(userId, "HIGH_VOLUME", 2, {
      type: "refund",
      chargeId: charge.id,
      reversedAmount,
      stripeEventId: event.id,
    });

    return {
      status: "processed",
      message,
      userId,
    };
  }

  private async handleChargeDispute(event: Stripe.Event): Promise<{
    status: PurchaseEventStatus;
    message?: string;
    error?: string;
    userId?: string;
  }> {
    const dispute = event.data.object as Stripe.Dispute;
    
    const userId = (dispute as any).metadata?.userId 
      || await this.getUserIdFromStripeCustomer(
          typeof (dispute as any).customer === "string" 
            ? (dispute as any).customer 
            : ((dispute as any).customer as any)?.id
        );

    if (!userId) {
      return {
        status: "ignored",
        message: "No userId found for disputed charge",
      };
    }

    // CRITICAL: Freeze user account immediately on chargeback
    await this.freezeUser(userId, `Chargeback: ${dispute.id} - Reason: ${dispute.reason}`);

    // Record high-severity risk signal
    await this.recordRiskSignal(userId, "HIGH_VOLUME", 5, {
      type: "chargeback",
      disputeId: dispute.id,
      reason: dispute.reason,
      amount: dispute.amount,
      stripeEventId: event.id,
    });

    console.error(`CHARGEBACK: User ${userId} frozen due to dispute ${dispute.id}`);

    return {
      status: "processed",
      message: `User frozen due to chargeback dispute ${dispute.id}`,
      userId,
    };
  }

  /**
   * Freeze a user account - prevents earning points and flags for review
   */
  private async freezeUser(userId: string, reason: string): Promise<void> {
    await db
      .insert(userRiskState)
      .values({
        userId,
        status: "FROZEN",
        reason,
        frozenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userRiskState.userId,
        set: {
          status: "FROZEN",
          reason,
          frozenAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Record a risk signal for pattern detection
   */
  private async recordRiskSignal(
    userId: string, 
    signalType: "REPEAT_PAIRING" | "WIN_TRADING" | "FAST_RESPONSES" | "HIGH_VOLUME" | "MULTI_ACCOUNT",
    severity: number,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      await db.insert(riskSignals).values({
        userId,
        signalType,
        severity,
        details,
      });
    } catch (e) {
      console.error("Failed to record risk signal:", e);
    }
  }

  async syncUserPurchases(userId: string, stripeCustomerId?: string): Promise<SyncResult> {
    const result: SyncResult = {
      userId,
      processedEvents: 0,
      grantedPackPts: 0,
      grantedEntitlements: [],
      errors: [],
    };

    const configured = await isStripeConfiguredAsync();
    if (!configured) {
      result.errors.push("Stripe is not configured");
      return result;
    }

    const stripeClient = await getStripeClient();

    let customerId = stripeCustomerId;
    if (!customerId) {
      const customerMapping = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.userId, userId))
        .limit(1);
      
      customerId = customerMapping[0]?.stripeCustomerId;
    }

    if (!customerId) {
      result.errors.push("No Stripe customer found for user");
      return result;
    }

    try {
      const paymentIntents = await stripeClient.paymentIntents.list({
        customer: customerId,
        limit: 100,
      });

      for (const pi of paymentIntents.data) {
        if (pi.status !== "succeeded") continue;

        const syntheticEventId = `sync_pi_${pi.id}`;
        
        const existing = await db
          .select()
          .from(purchaseEvents)
          .where(eq(purchaseEvents.eventId, syntheticEventId))
          .limit(1);

        if (existing.length > 0) continue;

        const piUserId = pi.metadata?.userId;
        if (piUserId && piUserId !== userId) continue;

        await db.insert(purchaseEvents).values({
          eventId: syntheticEventId,
          eventType: "sync.payment_intent.succeeded",
          userId,
          payload: pi as unknown as Record<string, unknown>,
          status: "processed",
          processedAt: new Date(),
        });

        result.processedEvents++;
      }

      const subscriptions = await stripeClient.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });

      for (const sub of subscriptions.data) {
        if (sub.status !== "active" && sub.status !== "trialing") continue;

        const priceId = sub.items.data[0]?.price?.id;
        if (!priceId) continue;

        const internalSku = getInternalSku(priceId) || this.extractSkuFromPriceId(priceId);
        const productDef = internalSku ? PRODUCT_DEFINITIONS[internalSku as InternalSku] : null;

        if (!productDef || productDef.type !== "SUBSCRIPTION" || !("entitlementKey" in productDef)) {
          continue;
        }

        const hasEntitlement = await storage.hasEntitlement(userId, productDef.entitlementKey);
        
        if (!hasEntitlement) {
          const currentPeriodEnd = new Date((sub as any).current_period_end * 1000);
          const gracePeriod = 3 * 24 * 60 * 60 * 1000;
          const expiresAt = new Date(currentPeriodEnd.getTime() + gracePeriod);

          await storage.grantEntitlement({
            userId,
            entitlementKey: productDef.entitlementKey,
            source: "sync",
            sourceReference: `sync_sub_${sub.id}`,
            expiresAt,
          });

          result.grantedEntitlements.push(productDef.entitlementKey);
        }
      }

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Unknown error during sync");
    }

    return result;
  }

  private async getSessionLineItems(sessionId: string): Promise<Stripe.LineItem[] | null> {
    try {
      const stripeClient = await getStripeClient();
      const lineItems = await stripeClient.checkout.sessions.listLineItems(sessionId);
      return lineItems.data;
    } catch (error) {
      console.error("Error fetching session line items:", error);
      return null;
    }
  }

  private async ensureStripeCustomerMapping(userId: string, stripeCustomerId: string): Promise<void> {
    await db
      .insert(stripeCustomers)
      .values({
        userId,
        stripeCustomerId,
      })
      .onConflictDoNothing();
  }

  private async getUserIdFromStripeCustomer(stripeCustomerId: string | undefined): Promise<string | null> {
    if (!stripeCustomerId) return null;

    const mapping = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.stripeCustomerId, stripeCustomerId))
      .limit(1);

    return mapping[0]?.userId || null;
  }

  private extractSkuFromPriceId(priceId: string): string | null {
    const patterns: Record<string, string> = {
      "packpts_500": "PACKPTS_500",
      "packpts_1500": "PACKPTS_1500",
      "packpts_6000": "PACKPTS_6000",
      "pro_monthly": "PRO_MONTHLY",
      "legend_mode": "LEGEND_MODE_PASS",
    };

    const lowerPriceId = priceId.toLowerCase();
    for (const [pattern, sku] of Object.entries(patterns)) {
      if (lowerPriceId.includes(pattern)) {
        return sku;
      }
    }

    return null;
  }

  private async findOriginalPurchaseEntry(
    userId: string, 
    priceId: string, 
    sessionId: string
  ): Promise<{ idempotencyKey: string; amount: number } | null> {
    const checkoutEvents = await db
      .select()
      .from(purchaseEvents)
      .where(
        eq(purchaseEvents.eventType, "checkout.session.completed")
      )
      .orderBy(sql`${purchaseEvents.createdAt} DESC`)
      .limit(100);

    for (const evt of checkoutEvents) {
      const payload = evt.payload as any;
      const eventSessionId = payload?.data?.object?.id;
      
      if (eventSessionId === sessionId) {
        const originalIdempotencyKey = `stripe_event_${evt.eventId}_${priceId}`;
        const ledgerEntry = await walletService.findLedgerEntryByIdempotencyKey(originalIdempotencyKey);
        
        if (ledgerEntry) {
          return {
            idempotencyKey: originalIdempotencyKey,
            amount: ledgerEntry.amount,
          };
        }
      }
    }

    const patternKey = `stripe_event_%_${priceId}`;
    const { ledgerEntries: ledgerEntriesTable, wallets: walletsTable } = await import("@shared/schema");
    
    const matchingEntries = await db
      .select({
        idempotencyKey: ledgerEntriesTable.idempotencyKey,
        amount: ledgerEntriesTable.amount,
        walletUserId: walletsTable.userId,
      })
      .from(ledgerEntriesTable)
      .innerJoin(walletsTable, eq(ledgerEntriesTable.walletId, walletsTable.id))
      .where(
        sql`${ledgerEntriesTable.idempotencyKey} LIKE ${'stripe_event_%'} 
            AND ${ledgerEntriesTable.idempotencyKey} LIKE ${'%' + priceId}
            AND ${walletsTable.userId} = ${userId}
            AND ${ledgerEntriesTable.entryType} = 'PURCHASE_CREDIT'`
      )
      .orderBy(sql`${ledgerEntriesTable.createdAt} DESC`)
      .limit(1);

    if (matchingEntries.length > 0 && matchingEntries[0].idempotencyKey) {
      return {
        idempotencyKey: matchingEntries[0].idempotencyKey,
        amount: matchingEntries[0].amount,
      };
    }

    return null;
  }

  async getPurchaseEvent(eventId: string) {
    const events = await db
      .select()
      .from(purchaseEvents)
      .where(eq(purchaseEvents.eventId, eventId))
      .limit(1);
    return events[0] || null;
  }

  async reprocessEvent(eventId: string): Promise<WebhookProcessResult> {
    const storedEvent = await this.getPurchaseEvent(eventId);
    if (!storedEvent) {
      return {
        success: false,
        eventId,
        status: "failed",
        error: "Event not found",
      };
    }

    const event = storedEvent.payload as unknown as Stripe.Event;
    
    await db
      .update(purchaseEvents)
      .set({ status: "received", errorMessage: null, updatedAt: new Date() })
      .where(eq(purchaseEvents.eventId, eventId));

    try {
      const result = await this.handleEvent(event);
      
      await db
        .update(purchaseEvents)
        .set({
          status: result.status,
          errorMessage: result.error || null,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(purchaseEvents.eventId, eventId));

      return {
        success: result.status === "processed",
        eventId,
        status: result.status,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      await db
        .update(purchaseEvents)
        .set({
          status: "failed",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(purchaseEvents.eventId, eventId));

      return {
        success: false,
        eventId,
        status: "failed",
        error: errorMessage,
      };
    }
  }
}

export const stripePurchaseService = new StripePurchaseService();
