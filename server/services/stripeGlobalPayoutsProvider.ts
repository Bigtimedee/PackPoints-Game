/** Deliberately sandbox-only. Never fall back to the purchase/live Stripe client. */
export const PAYOUT_API_VERSION = "2026-05-27.preview";
export const MIN_PAYOUT_CENTS = 2500;
export const BANK_FEE_RESERVE_CENTS = 150;
export function payoutConfiguration() {
  const key = process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST;
  const financialAccount = process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_TEST;
  if (process.env.STRIPE_PAYOUTS_ENABLED !== "test" || process.env.NODE_ENV === "production" || process.env.APP_ENV === "production")
    throw new Error("Cashback payouts disabled: sandbox only");
  if (!key?.startsWith("sk_test_") && !key?.startsWith("rk_test_")) throw new Error("Sandbox payout key required");
  if (!financialAccount) throw new Error("Sandbox Global Payouts financial account required");
  return { key, financialAccount };
}
export function assertSandbox(object: any) {
  if (object?.livemode !== false) throw new Error("Provider object is not verified sandbox data");
  return object;
}
export function eligibleBank(method: any) {
  assertSandbox(method);
  const bank = method.bank_account;
  if (method.type !== "bank_account" || bank?.archived || bank?.country !== "US" ||
      !bank?.supported_currencies?.includes("usd") || !bank?.enabled_delivery_options?.includes("local") ||
      method.usage_status?.payments !== "eligible" || !/^\d{4}$/.test(bank?.last4 ?? ""))
    throw new Error("Complete Stripe onboarding with an eligible US USD bank account");
  return { id: method.id, masked: `Bank ending ${bank.last4}` };
}
export function validatePayment(payment: any, expected: { amountCents: number; recipient: string; method: string; financialAccount: string }) {
  assertSandbox(payment);
  if (!payment.id || payment.amount?.value !== expected.amountCents || payment.amount?.currency !== "usd" ||
      payment.to?.recipient !== expected.recipient || payment.to?.payout_method !== expected.method ||
      payment.from?.financial_account !== expected.financialAccount)
    throw new Error("Provider payout evidence mismatch; reconciliation required");
  if (!["processing", "posted", "failed", "canceled", "returned"].includes(payment.status))
    throw new Error("Unknown provider payout status");
  return payment;
}
export class StripeGlobalPayoutsProvider {
  async call(path: string, body?: any, idempotencyKey?: string, recipient?: string) {
    const { key } = payoutConfiguration();
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": PAYOUT_API_VERSION,
        "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(recipient ? { "Stripe-Account": recipient } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    // Do not log provider bodies, banking information or credentials.
    if (!response.ok) throw new Error(`Stripe sandbox request failed (${response.status}); review configuration or reconcile before retrying`);
    return result;
  }
  async createRecipient(userId: string, email: string) {
    return assertSandbox(await this.call("/v2/core/accounts", {
      contact_email: email, identity: { country: "us", entity_type: "individual" },
      configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true } } } } },
      include: ["identity", "configuration.recipient", "requirements"],
    }, `packpts-recipient-test:${userId}`));
  }
  async onboarding(recipient: string) {
    const origin = process.env.STRIPE_PAYOUTS_RETURN_ORIGIN;
    if (!origin || !/^https:\/\//.test(origin) || new URL(origin).hostname === "packpts.com" || new URL(origin).hostname === "www.packpts.com")
      throw new Error("Dedicated HTTPS sandbox return origin required");
    return assertSandbox(await this.call("/v2/core/account_links", { account: recipient,
      use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient"],
        return_url: `${origin}/redemptions`, refresh_url: `${origin}/redemptions` } } }));
  }
  async destination(recipient: string) {
    const account = assertSandbox(await this.call(`/v2/core/accounts/${encodeURIComponent(recipient)}?include=configuration.recipient&include=identity`));
    if (account.identity?.country?.toLowerCase() !== "us" || account.configuration?.recipient?.capabilities?.bank_accounts?.local?.status !== "active")
      throw new Error("Stripe recipient verification incomplete");
    // Stripe-Account scopes this list to the owner's recipient. Never accept a client-supplied method ID.
    const methods = await this.call("/v2/money_management/payout_methods?limit=100", undefined, undefined, recipient);
    const eligible = (methods.data ?? []).filter((m: any) => {
      try { eligibleBank(m); return true; } catch { return false; }
    });
    if (methods.next_page_url || eligible.length !== 1) throw new Error("Exactly one eligible bank account required; review destination in Stripe");
    return eligibleBank(eligible[0]);
  }
  async available() {
    const { financialAccount } = payoutConfiguration();
    const account = assertSandbox(await this.call(`/v2/money_management/financial_accounts/${encodeURIComponent(financialAccount)}`));
    const available = account.balance?.available?.usd?.value;
    if (!Number.isSafeInteger(available) || available < 0) throw new Error("Cannot verify available sandbox payout funding");
    return available;
  }
  async send(id: string, amountCents: number, recipient: string, method: string) {
    const { financialAccount } = payoutConfiguration();
    return validatePayment(await this.call("/v2/money_management/outbound_payments", {
      from: { financial_account: financialAccount, currency: "usd" }, to: { recipient, payout_method: method },
      amount: { value: amountCents, currency: "usd" }, delivery_options: { bank_account: "local" },
      description: "PackPTS cashback sandbox", recipient_notification: { setting: "none" },
    }, `packpts-cashback-test:${id}`), { amountCents, recipient, method, financialAccount });
  }
  async retrieve(id: string) { return assertSandbox(await this.call(`/v2/money_management/outbound_payments/${encodeURIComponent(id)}`)); }
}
export const stripeGlobalPayoutsProvider = new StripeGlobalPayoutsProvider();
