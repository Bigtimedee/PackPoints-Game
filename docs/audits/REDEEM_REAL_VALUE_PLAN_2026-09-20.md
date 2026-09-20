# Plan: Redeem PackPTS for real economic value (eBay / Goldin)

**Date:** 2026-09-20  
**Repo:** https://github.com/Bigtimedee/PackPoints-Game  
**Related:** #95 / #96 (`docs/audits/APPLY_PACKPTS_EBAY_2026-09-20.md`)  
**This memo is the Phase A archaeology + the shipped Phase B decision.**

Labels: **CODE** (verified in source) · **HUNCH** (inference)

---

## Verdict

eBay Partner Network and the Browse API **cannot** rewrite the buyer’s eBay cart. Goldin has **no** affiliate/coupon/API in this repo or in any connected vendor. Stripe Connect, Tremendous, Tango, and gift-card issuance are **not** scaffolded.

The implementable rail that actually puts USD in the user’s hands **without a new vendor contract** is:

**Post-purchase PackPTS cashback** — debit PackPTS on Apply, buy at full price via tracked `/out/ebay|goldin`, then **grant a USD rebate balance** on confirmed attribution. Proof is a PackPTS **Redemption Receipt** (page + email). Users can request a withdrawal; ops marks it paid after sending money. eBay/Goldin checkout stays full price.

That loop is what this change ships. It is **not** an eBay checkout discount. #96 honesty copy stays.

---

## 1. What prior plans promised

| Source | Promise | Status |
|---|---|---|
| `PRODUCT_VISION.md` | “You redeem for real cards”; commerce as a byproduct of play | Aspiration. No payout rail. |
| `MONETIZATION_PLAN.md` | Wallet, IAP, `POST /api/wallet/redeem` for “rewards” | Inbound Stripe + PackPTS ledger. No outbound USD. |
| `PACKPTS_EXECUTION_PLAN.md` | Attribution loop, hold periods, price validation, risk | Attribution **to PackPTS** (EPN commission). Not to the buyer. |
| `PACKPTS_PROJECT_CONTEXT.md` (pre-this-PR) | Meaningful discounts funded by treasury + affiliate haircut; apply → reserve → confirm | Formula + solvency **CODE**. Confirm/grant was **status-only**. |
| Live marketing (pre-#96) | “Apply at checkout”, “eBay Gift Card”, “10% discount” | **Unsafe.** Killed in #96. |

The economic model in context was always: *affiliate commission + PackPTS sale margin fund a credit*. The missing piece was ever **delivering** that credit as money the user can see and spend.

---

## 2. What was half-built vs fake

### Path A — Live listing Apply (**half-built**)

**CODE:** quote → apply spends PackPTS, writes `redemptionCredit` `PENDING`, reserves treasury margin, intent `APPROVED`.

**Fake / unfinished:**

- `POST /api/marketplace/purchase/confirm` — “stub for admin review”. `evidence` accepted, **never persisted**. Grant only flips status. `ledgerCreditEntryId` never written.
- No client caller for confirm / cancel / intents.
- EPN postback writes `attributed_purchases` and **does not** grant the user anything.
- 72h stale job refunds unused applies — looks like “it didn’t work.”
- Dual-price UI implied a cheaper cart; #96 made copy honest but left the dead confirm.

### Path B — Redeem tab “gift cards” (**fake**)

**CODE:** hardcoded `REDEMPTION_OPTIONS` + `POST /api/redeem` mint a hex `creditToken`. `#96` relabeled them “PackPTS Credit Token” and said they are not eBay/Goldin gift cards.

Still fake as a payout: no email, no partner consume, unauthenticated validate/consume. Default tiers (1k/5k/25k/100k) do not match catalog SKUs (2k/10k/50k). **HUNCH:** several cards 400 in production.

### Rails that do not exist (**CODE**)

- Stripe Connect / Transfer / payout
- Gift-card vendor (Tremendous / Tango / eBay GC API)
- Goldin affiliate postback or promo codes
- User receipt page or redemption email

---

## 3. Why it never shipped

1. **Technical impossibility of rewriting eBay checkout via EPN.** Browse + 302 with `campid`/`customid` is click tracking. EPN pays **PackPTS**, not the buyer. There is no coupon, Trading, or Offer API in this repo.
2. **No Goldin partner API.** Curated `destinationUrl` only.
3. **No payout vendor.** Stripe is inbound bundle checkout only.
4. **Treasury insolvency risk (real, later mitigated in formula).** Pre-July-2026 Rmax treated `m` as a fraction of **price** → permanently 0. After the fix, credit is ~1% of price unless the reserve is funded. Generosity is reserve-gated — correct — but nobody built the grant that spends that reserve on the user.
5. **Missing UX.** Apply toasted “Reserved” and left the user on PackPTS. Confirm had no button. Receipt had no page.

---

## 4. Feasible mechanisms (ranked)

| Rank | Mechanism | Real $ to user? | Blocker | Decision |
|---|---|---|---|---|
| 1 | **Post-purchase USD cashback** on PackPTS wallet + receipt + withdrawal request | Yes, once ops pays or user holds a USD liability we honor | Needs funded treasury; EPN URL must be configured for auto-grant | **SHIPPED** |
| 2 | Stripe Connect / Transfer to user’s bank | Yes, automatic | Not scaffolded; new Connect onboarding = new vendor workflow | Rejected for this PR |
| 3 | Buy/email a real third-party gift card | Yes | No Tremendous/Tango/eBay GC keys in Railway/env | Rejected — do not fake |
| 4 | Goldin promo codes | Maybe | No public/partner API in repo | Rebate via Path 1 |
| 5 | eBay cart price rewrite | No | Partner-impossible via EPN/Browse | Forbidden |
| 6 | Hex credit tokens (Path B) | No | Nothing consumes them | Keep labeled fake; point users at Path 1 |

**Recommendation:** Path 1. Document ops: fund `POST /api/admin/treasury/credit`; point EPN conversion postback at `https://packpts.com/api/webhooks/epn-postback`; pay withdrawal requests (PayPal/Venmo/ACH) until Connect exists.

---

## 5. Shipped loop (Phase B)

```
Apply PackPTS
  → wallet debit + PENDING credit + treasury reservation
Buy on eBay/Goldin (full price) via /out/ebay|goldin
  → outbound_clicks (+ EPN customid on eBay)
Confirm
  → EPN postback (customid match) auto-grants
  → or user “I’ve purchased” + order id / note / receipt URL
  → high-value user attestations (≥$25) hold for admin
Grant
  → consume reservation
  → credit wallets.rebate_balance_cents
  → rebate_ledger GRANT (idempotent)
  → CREDIT_GRANTED / GRANTED
  → email + /redemptions/:id receipt
Withdraw
  → user requests payout
  → admin marks PAID after sending money (or DENIED → refund rebate)
```

**Honesty (required):** UI says eBay/Goldin checkout stays full price; PackPTS pays you back $X as cashback. Guard: `server/tests/ebayApplyCopyHonesty.test.ts`.

**Fake catalog:** Redeem-tab SKUs stay marked as internal tokens; banner sends users to Live Listings → cashback.

---

## 6. Ops prerequisites (not optional for production value)

1. **Treasury funding.** `POST /api/admin/treasury/credit` with `sourceType=MANUAL_ADJUSTMENT` (or `AFFILIATE_PAYOUT` when EPN actually pays). Until funded, quotes stay ~affiliate-margin-sized (~1% of price) or ineligible if below 500 PackPTS. Goldin default affiliate rate is **0%** — Goldin cashback is **100% reserve-funded**.
2. **EPN postback URL.** In eBay Partner Network, set the conversion postback to  
   `https://packpts.com/api/webhooks/epn-postback?customid={customid}&item_id={item_id}&transaction_id={transaction_id}&sale_price={sale_price}&commission={commission}&transaction_date={transaction_date}`  
   (param names must match `GET /api/webhooks/epn-postback`). Without this, eBay grants use the confirm+evidence path.
3. **Withdrawal fulfillment.** Admin → Redemptions → Purchase rebates / Payouts. Send real USD, then **Mark paid**. Until that happens, the user still has a visible granted balance and a receipt — a real PackPTS liability, not a vanishing PENDING reserve.
4. **Resend.** Receipt email uses existing `RESEND_API_KEY` + verified `packpts.com`. If unset, grant still succeeds; email is skipped (logged).
5. **Profit policy row.** Must exist (`POST /api/admin/profit-policy`) after any DB rebuild.

---

## 7. What this is not

- Not an eBay or Goldin checkout discount.
- Not a real eBay gift card.
- Not Stripe Connect automated bank payout (yet).
- Not a reason to reintroduce #96-banned copy.
