// Field readers that work on both pre-basil and basil/clover Stripe API shapes.
// Stripe moved these fields in API 2025-03-31.basil:
//   invoice.subscription                -> invoice.parent.subscription_details.subscription
//   invoice.subscription_details        -> invoice.parent.subscription_details
//   invoice.lines.data[].price          -> invoice.lines.data[].pricing.price_details.price
//   subscription.current_period_end     -> subscription.items.data[].current_period_end (per item)

function idOf(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return typeof v.id === "string" ? v.id : null;
}

export function getInvoiceSubscriptionId(invoice: any): string | null {
  return idOf(invoice?.parent?.subscription_details?.subscription) ?? idOf(invoice?.subscription);
}

export function getInvoiceSubscriptionMetadata(invoice: any): Record<string, string> | undefined {
  return invoice?.parent?.subscription_details?.metadata ?? invoice?.subscription_details?.metadata ?? undefined;
}

export function getInvoiceLinePriceId(invoice: any): string | undefined {
  const line = invoice?.lines?.data?.[0];
  const p = line?.pricing?.price_details?.price ?? line?.price;
  return idOf(p) ?? undefined;
}

// Period end (seconds since epoch) for the subscription item that carries the purchased product.
// The webhook handlers derive the product from items.data[0], so by default we read that same
// item's period end. Items can have different periods on mixed subscriptions, so we never take
// the max across items. Pass priceId to select a specific item instead. Falls back to the
// pre-basil subscription-level field.
export function getSubscriptionPeriodEndSeconds(sub: any, priceId?: string): number | undefined {
  const items: any[] = sub?.items?.data ?? [];
  const item = (priceId ? items.find((i) => i?.price?.id === priceId) : undefined) ?? items[0];
  if (typeof item?.current_period_end === "number") return item.current_period_end;
  return typeof sub?.current_period_end === "number" ? sub.current_period_end : undefined;
}

export function getSubscriptionPeriodEnd(sub: any, priceId?: string): Date {
  const s = getSubscriptionPeriodEndSeconds(sub, priceId);
  if (s === undefined) {
    throw new Error("Stripe subscription has no current_period_end (neither on the subscription item nor the subscription)");
  }
  return new Date(s * 1000);
}
