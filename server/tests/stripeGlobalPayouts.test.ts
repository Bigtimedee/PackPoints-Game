import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSandbox, eligibleBank, payoutConfiguration, StripeGlobalPayoutsProvider, validatePayment } from "../services/stripeGlobalPayoutsProvider";
import { payoutReceiptText } from "../services/cashbackPayoutReceipt";
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });
function configure() { process.env.NODE_ENV = "test"; process.env.APP_ENV = "test"; process.env.STRIPE_PAYOUTS_ENABLED = "test"; process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST = "sk_test_fake"; process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_TEST = "fa_test"; }
const bank = { id: "usba_test", livemode: false, type: "bank_account", usage_status: { payments: "eligible" }, bank_account: { country: "US", supported_currencies: ["usd"], enabled_delivery_options: ["local"], last4: "6789", archived: false } };
const expected = { amountCents: 2500, recipient: "acct_test", method: "usba_test", financialAccount: "fa_test" };
const payment = { id: "obp_test", livemode: false, status: "processing", amount: { value: 2500, currency: "usd" }, to: { recipient: "acct_test", payout_method: "usba_test" }, from: { financial_account: "fa_test" } };
describe("sandbox payout guard", () => {
  it("requires explicit test enablement", () => { configure(); delete process.env.STRIPE_PAYOUTS_ENABLED; expect(() => payoutConfiguration()).toThrow(); });
  it.each(["sk_live_x", "rk_live_x", ""])('refuses live/empty key %s', key => { configure(); process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST = key; expect(() => payoutConfiguration()).toThrow(); });
  it("refuses production even with test key", () => { configure(); process.env.NODE_ENV = "production"; expect(() => payoutConfiguration()).toThrow(); });
  it("does not use purchase keys", () => { configure(); delete process.env.STRIPE_PAYOUTS_SECRET_KEY_TEST; process.env.STRIPE_SECRET_KEY = "sk_live_x"; expect(() => payoutConfiguration()).toThrow(); });
  it("requires explicit sandbox object", () => { expect(() => assertSandbox({})).toThrow(); expect(() => assertSandbox({ livemode: true })).toThrow(); });
  it("shows only masked destination", () => { expect(eligibleBank(bank)).toEqual({ id: "usba_test", masked: "Bank ending 6789" }); });
  it.each([ { type: "card" }, { livemode: true }, { usage_status: { payments: "requires_action" } }, { bank_account: { ...bank.bank_account, country: "GB" } }, { bank_account: { ...bank.bank_account, archived: true } } ])("rejects unusable destinations %j", change => { expect(() => eligibleBank({ ...bank, ...change })).toThrow(); });
  it.each([ { amount: { value: 1, currency: "usd" } }, { to: { recipient: "other", payout_method: "usba_test" } }, { from: { financial_account: "other" } }, { livemode: true }, { status: "paid" } ])("rejects mismatched provider evidence %j", change => { expect(() => validatePayment({ ...payment, ...change }, expected)).toThrow(); });
  it("sends exact amount with stable request id and sandbox key", async () => { configure(); const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payment }); vi.stubGlobal("fetch", fetcher); const provider = new StripeGlobalPayoutsProvider(); await provider.send("request1", 2500, "acct_test", "usba_test"); await provider.send("request1", 2500, "acct_test", "usba_test"); const [, options] = fetcher.mock.calls[0]; expect(options.headers["Idempotency-Key"]).toBe("packpts-cashback-test:request1"); expect(options.headers.Authorization).toBe("Bearer sk_test_fake"); expect(JSON.parse(options.body).amount.value).toBe(2500); expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(options.headers["Idempotency-Key"]); });
  it("reads real financial available.value", async () => { configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ livemode: false, balance: { available: { usd: { value: 5000, currency: "usd" } } } }) })); expect(await new StripeGlobalPayoutsProvider().available()).toBe(5000); });
  it("receipt never claims bank arrival", () => { const text = payoutReceiptText({ amountCents: 2500, destination: "Bank ending 6789", stripePaymentId: "obp_test", stripeStatus: "posted", sandbox: true }); expect(text).toContain("No real money moved"); expect(text).toContain("Bank arrival is not guaranteed"); expect(text).toContain("$25.00"); });
});
