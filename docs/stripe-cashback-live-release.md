# Live cashback payout draft

Not merged or deployed. No production migration, funding, keys, or payout was performed.
This includes the unmerged sandbox implementation from #192. Merge this replacement PR only, not both.

## Default and scope
STRIPE_PAYOUTS_ENABLED is unset/off by default. Live mode requires BOTH
STRIPE_PAYOUTS_ENABLED=live and STRIPE_PAYOUTS_LIVE_RELEASE_APPROVED=true.
Live payout credentials are separate from purchase credentials and test credentials.
Every payout remains REQUESTED until an authenticated admin approves it.
US USD local bank only, $25 minimum, 30-day conservative purchase review hold,
$1.50 platform-paid fee reserve. An admin confirmation shows amount, destination,
live/test mode and fee before submission. No automatic top-up or payout.
Automatic eBay cashback is hard off, even with a configured postback secret.
The existing secret-authenticated postback route remains intact. Manual purchase
confirmation/admin credit paths remain unchanged.

## Dave supplies, after review
1. In Stripe Global Payouts, open the live financial account and provide its ID
   and current available USD balance. Confirm there are no restrictions on payouts.
   Seeing the menu alone does not confirm a funded, enabled financial account.
2. Supply a dedicated LIVE payout API key through a secure vault link, never chat,
   source code, PR text, or logs. Configure STRIPE_PAYOUTS_SECRET_KEY_LIVE and
   STRIPE_PAYOUTS_FINANCIAL_ACCOUNT_LIVE as private server variables. The key must
   permit the v2 recipient account/link and payout-method operations and financial
   account/outbound-payment operations this provider uses. Verify actual permissions
   and pinned API version in an isolated sandbox before enabling live mode.
3. Fund the live account yourself with cleared business funds, choosing a reserve
   amount. Funding and its bank details/fees need their own approval. Minimum one
   $25 payout plus published $1.50 fee is $26.50, plus existing in-flight holds.
   App treasury figures are not Stripe cash. No funding amount is authorized here.
4. Confirm the live return origin https://packpts.com. Users complete fresh LIVE
   Stripe-hosted bank onboarding; sandbox recipients are never promoted.

Dave reported PackPTS is Stripe-approved and sees Global Payouts. These are owner
reports, not independent dashboard evidence. Do not widen that claim into tax/legal
clearance. Keep purchase evidence and recipient annual totals for tax review.

## Migration and release sequence
- Back up production database and record payout/recipient counts and pending holds.
- Rehearse on a COPY with fake keys, no external calls. Apply
  migrations/add_stripe_sandbox_payouts.sql first (enum additions outside a
  transaction), then migrations/add_stripe_live_payouts.sql. The latter changes
  recipient primary key to (user_id,sandbox), adds sandbox and financial-account
  columns, and never relabels Stripe test rows live. Existing NULL account bindings
  fail closed and need manual reconciliation, not blind backfill.
- Compare schema with shared/schema.ts and verify old wallet balances/holds are
  unchanged. Test migrations twice on empty and previous-sandbox schema. Railway's
  schema tooling must be reviewed before merge; merge auto-deploys main.
- Keep payout flags OFF while deploying approved code/schema. Validate health,
  authentication, UI, admin gate, unchanged eBay-off behavior and migration readback.
- Validate actual sandbox onboarding and a provider transaction (not done yet).
  Local mocked-provider tests do not establish a working Stripe integration.
- Only after live account restrictions, balance, permissions and release approval
  are checked, set both live flags. No payout is sent by deployment or reconciliation.
  First live payout requires its own admin approval with exact recipient/amount.

## Reconciliation, receipts and rollback
Known payments are polled once a minute for processing/sent status, scoped to mode
and financial account. Polling only retrieves; it cannot approve or submit.
Network uncertainty retains the wallet hold. Old ambiguous submissions stop before
Stripe's idempotency window can expire. Posted means sent, never bank received.
Confirmed failure/cancel/return restores wallet funds once. Never blindly resubmit.
Receipt is shown in app, with Stripe reference and hosted receipt when available.
Email is NOT implemented; no email delivery promise. Signed webhooks/durable email
outbox remain follow-up work. Polling needs operational health alerts before launch.
Rollback: set STRIPE_PAYOUTS_ENABLED=off to block all provider calls. Reconcile
in-flight payouts manually in Stripe until safe to re-enable retrieval. Preserve
schema, wallet holds and ledger evidence; don't drop tables or automatically refund.

## Proposed release decision (not ready to ask yet)
Once CI, sandbox provider validation, account/funding and migration checks are done:
"Enable US bank cashback withdrawals with a $25 minimum, 30-day review hold,
admin approval for every payout, and PackPTS paying the $1.50 bank fee, while
keeping automatic eBay cashback off?"
No blanket approval to fund the account or send a particular live payout is implied.

## Sources checked October 4, 2026
https://docs.stripe.com/global-payouts
https://docs.stripe.com/global-payouts/send-money
https://docs.stripe.com/global-payouts/pricing
https://docs.stripe.com/api/v2/money-management/outbound-payments/create?api-version=2026-05-27.preview
