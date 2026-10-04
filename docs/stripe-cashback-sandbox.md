# Stripe cashback: sandbox draft, not a live release

## Recommendation and scope
Use Stripe Global Payouts for genuine US/USD purchase rebates. Stripe's current comparison explicitly recommends this product for rebates/rewards, rather than requiring consumers to become Express marketplace merchants. This draft supports only standard US bank payouts. It cannot use live keys, runs only outside production, and never uses the existing purchase Stripe client.

## Current account facts and unknowns
Production health reports live Stripe collection. That does not prove Connect or Global Payouts is enabled. The account's actual product approval, sender country, fees, financial account, funding and sandbox credentials must be verified before provider testing. No live money, setting, migration or deployment was changed.

## Draft controls
- Explicit test flag, test-only key and dedicated sandbox financial account. Production and live keys rejected.
- Stripe-hosted recipient onboarding. Never collect bank numbers, SSNs or tax IDs in PackPTS forms.
- Bank destination selected server-side under the recipient; exactly one verified US/USD local-bank destination. Store only IDs and masked ending.
- $25 minimum; platform reserves $1.50 bank fee separately. These are proposed settings, not business approval.
- 30-day conservative hold following any new positive grant/adjustment not tied to a withdrawal. It does not reset for hold release or failure refunds.
- Every withdrawal requires admin approval in the first release, covering first payouts and $100+ amounts. No automatic payout is authorized.
- Wallet debit at request is a hold ADJUSTMENT, not a payment. Provider processing retains the hold. Only posted evidence appends a PAYOUT with the original amount, recipient, method and financial-account checks.
- Stripe posted means sent, not bank received. Receipt shows this distinction. Provider confirmed failed/canceled/returned restores cashback once. Network ambiguity never restores or labels paid.
- Stable request/provider idempotency keys, wallet/payout row locks and shared funding lock. Requests cannot use client-supplied destinations. Reconciliation refreshes known processing/sent payments; unknown old submissions stop for manual provider reconciliation before a new idempotency window.
- Stripe test receipt is shown in existing Card components. Email body is prepared and tested, but actual emails are suppressed in this sandbox draft. A durable production email outbox and verified webhook endpoint are additional release work, not claims of completion.

## Funding and loss risk
The app's treasury ledger is not Stripe cash. Fund the Stripe financial account with cleared business funds, not simulated app reserves. Check actual available cash plus payout fee and existing in-flight holds. No automatic top-up. Stripe fees, refunds and disputes can reduce collection balances; don't spend funds held for refunds. Affiliate commission estimates and self-attested purchases are not settled cash. The 30-day hold and admin review are mitigations, not proof of settlement; launch should use verified purchase evidence and partner refund/cancellation policies. A payout already sent can be unrecoverable; never assume bank money can be clawed back. A separate credit-reversal system and loss reserve are needed for false or canceled purchases.

## Mandatory business/compliance gate
Stripe's policy lists games of skill/card games with monetary/material prizes under prohibited gambling categories, and separately restricts stored-value credits. PackPTS combines game-earned/bought points with cashback. Calling a payment a rebate does not settle eligibility. Stripe must review the real model and approve a supportable non-gambling flow before live rollout. Don't activate a prohibited flow; redesign if Stripe rejects it. Legal/tax review should decide whether purchase-linked rebates are purchase-price adjustments or game rewards/other income. Do not promise exemption or automatically issue marketplace 1099-Ks. Current IRS instructions have changed reporting thresholds; do not hard-code remembered $600 rules. Maintain annual recipient payout totals and purchase linkage for a tax professional's classification. Stripe-hosted information collection is not a substitute for platform tax obligations.

## Sandbox setup, once access is available
1. Sign into Stripe Dashboard. Select or create a Sandbox from the account picker.
2. Open Global Payouts, select Get started and complete sandbox setup only.
3. Fund the sandbox using documented test helper funds. Do not fund live mode.
4. Store a sandbox key securely as STRIPE_PAYOUTS_SECRET_KEY_TEST, the sandbox financial account ID as STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_TEST, and a dedicated HTTPS staging origin as STRIPE_PAYOUTS_RETURN_ORIGIN. Set STRIPE_PAYOUTS_ENABLED=test on an isolated nonproduction instance and isolated database.
5. Verify hosted recipient onboarding, the pinned API version and recipient-scoped payout-method listing with actual sandbox responses. Test pending, posted, failed, returned and timeouts; match provider references to wallet and ledger readbacks.
6. No live promotion until business approval, live restricted-key permissions, cleared funding, tax handling, signed events/durable reconciliation and email outbox are separately complete and reviewed.

## Exact next decision
"Proceed with the isolated Stripe sandbox test, keeping real payouts disabled until Stripe approves the PackPTS model and the funding/tax checks are complete?"
This is not a question to enable live payouts or merge this draft into auto-deploying main.

## Sources read
- https://docs.stripe.com/global-payouts
- https://docs.stripe.com/global-payouts/compare-with-connect
- https://docs.stripe.com/global-payouts/recipient-creation-options
- https://docs.stripe.com/global-payouts/send-money
- https://docs.stripe.com/global-payouts/manage-payouts
- https://docs.stripe.com/global-payouts/pricing
- https://docs.stripe.com/global-payouts/testing
- https://docs.stripe.com/api/v2/core/account-links/create
- https://docs.stripe.com/api/v2/money-management/outbound-payments/retrieve?api-version=2026-05-27.preview
- https://docs.stripe.com/api/v2/money-management/payout-methods/list?api-version=2026-05-27.preview
- https://stripe.com/legal/restricted-businesses
- https://www.irs.gov/instructions/i1099mec

Published US standard bank price: $1.50/payout, typically 0-1 business days. Account-specific pricing/eligibility not verified. Treasury cash-rewards is a different balance-interest preview, not this cashback use case.
