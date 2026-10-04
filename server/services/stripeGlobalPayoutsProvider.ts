/** Dedicated payout rail, disabled by default. No purchase-key fallback. */
export const PAYOUT_API_VERSION = "2026-05-27.preview";
export const MIN_PAYOUT_CENTS = 2500;
export const BANK_FEE_RESERVE_CENTS = 150;
export function payoutConfiguration() {
  const mode = process.env.STRIPE_PAYOUTS_ENABLED;
  if (mode !== "test" && mode !== "live") throw new Error("Cashback payouts disabled");
  const sandbox = mode === "test";
  if (sandbox && (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production"))
    throw new Error("Cashback payouts disabled: sandbox only outside production");
  if (!sandbox && process.env.STRIPE_PAYOUTS_LIVE_RELEASE_APPROVED !== "true")
    throw new Error("Live cashback release is not enabled");
  const key = sandbox ? process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST : process.env.STRIPE_PAYOUTS_SECRET_KEY_LIVE;
  const financialAccount = sandbox ? process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_TEST : process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_LIVE;
  if (!key || !(sandbox ? /^(sk|rk)_test_/ : /^(sk|rk)_live_/).test(key))
    throw new Error(sandbox ? "Sandbox payout key required" : "Dedicated live payout key required");
  if (!financialAccount) throw new Error("Global Payouts financial account required");
  return { key, financialAccount, sandbox, mode };
}
export function assertPayoutMode(object: any) {
  if (object?.livemode !== !payoutConfiguration().sandbox) throw new Error("Provider object mode mismatch");
  return object;
}
export function assertSandbox(object: any) {
  if (object?.livemode !== false) throw new Error("Provider object is not verified sandbox data");
  return object;
}
export function eligibleBank(method: any) {
  assertPayoutMode(method);
  const bank = method.bank_account;
  if (method.type !== "bank_account" || bank?.archived || bank?.country !== "US" ||
      !bank?.supported_currencies?.includes("usd") || !bank?.enabled_delivery_options?.includes("local") ||
      method.usage_status?.payments !== "eligible" || !/^\d{4}$/.test(bank?.last4 ?? ""))
    throw new Error("Complete Stripe onboarding with an eligible US USD bank account");
  return { id: method.id, masked: `Bank ending ${bank.last4}` };
}
export function validatePayment(payment: any, expected: { amountCents: number; recipient: string; method: string; financialAccount: string }) {
  assertPayoutMode(payment);
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
    if (!response.ok) throw new Error(`Stripe payout request failed (${response.status}); review configuration or reconcile before retrying`);
    return result;
  }
  async createRecipient(userId: string, email: string) {
    return assertPayoutMode(await this.call("/v2/core/accounts", {
      contact_email: email, identity: { country: "us", entity_type: "individual" },
      configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true } } } } },
      include: ["identity", "configuration.recipient", "requirements"],
    }, `packpts-recipient-${payoutConfiguration().mode}:${userId}`));
  }
  async onboarding(recipient: string) {
    const origin = process.env.STRIPE_PAYOUTS_RETURN_ORIGIN;
    const sandbox = payoutConfiguration().sandbox;
    if (!origin || !/^https:\/\//.test(origin)) throw new Error("HTTPS payout return origin required");
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) throw new Error("Bare payout return origin required");
    const production = ["packpts.com", "www.packpts.com"].includes(parsed.hostname);
    if (sandbox ? production : !production) throw new Error("Payout return origin does not match mode");
    return assertPayoutMode(await this.call("/v2/core/account_links", { account: recipient,
      use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient"],
        return_url: `${origin}/redemptions`, refresh_url: `${origin}/redemptions` } } }));
  }
  async destination(recipient: string) {
    const account = assertPayoutMode(await this.call(`/v2/core/accounts/${encodeURIComponent(recipient)}?include=configuration.recipient&include=identity`));
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
    const account = assertPayoutMode(await this.call(`/v2/money_management/financial_accounts/${encodeURIComponent(financialAccount)}`));
    const available = account.balance?.available?.usd?.value;
    if (!Number.isSafeInteger(available) || available < 0) throw new Error("Cannot verify available payout funding");
    return available;
  }
  async send(id: string, amountCents: number, recipient: string, method: string) {
    const { financialAccount } = payoutConfiguration();
    return validatePayment(await this.call("/v2/money_management/outbound_payments", {
      from: { financial_account: financialAccount, currency: "usd" }, to: { recipient, payout_method: method },
      amount: { value: amountCents, currency: "usd" }, delivery_options: { bank_account: "local" },
      description: payoutConfiguration().sandbox ? "PackPTS cashback sandbox" : "PackPTS cashback", recipient_notification: { setting: "none" },
    }, `packpts-cashback-${payoutConfiguration().mode}:${id}`), { amountCents, recipient, method, financialAccount });
  }
  async retrieve(id: string) { return assertPayoutMode(await this.call(`/v2/money_management/outbound_payments/${encodeURIComponent(id)}`)); }
}
export const stripeGlobalPayoutsProvider = new StripeGlobalPayoutsProvider();
