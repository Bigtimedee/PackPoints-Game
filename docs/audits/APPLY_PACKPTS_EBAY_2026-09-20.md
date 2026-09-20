# Audit: Can a user “apply PackPTS” to an eBay purchase?

**Date:** 2026-09-20  
**Asked by:** Dave Maloney  
**Repo:** https://github.com/Bigtimedee/PackPoints-Game  
**Live site inspected:** https://packpts.com  
**Scope:** Code + public production endpoints. No live eBay checkout was completed. No production wallet / treasury / redemption-row counts were queried.

Labels used below:

- **CODE** — observed in source, routes, schema, tests, or a public HTTP response.
- **HUNCH** — inference. Not proven.

---

## Verdict (read this first)

**Applying PackPTS does not reduce the eBay listing price, eBay checkout total, or any eBay seller fee.**

What exists today:

1. PackPTS.com can *show* a second price line (“With PackPTS: X pts + $Y”).
2. PackPTS.com can *debit the user’s PackPTS wallet* when they click Apply / Redeem.
3. PackPTS.com can *send the user to a normal eBay item URL* with eBay Partner Network (EPN) affiliate tags.

What does **not** exist:

- No eBay coupon / promo code.
- No eBay gift card issuance.
- No listing-price rewrite on eBay.
- No cashback / Stripe / PayPal reimbursement after purchase.
- No client UI to confirm “I bought it on eBay.”
- No email that tells the user how to use a credit.
- No E2E test of apply → eBay checkout → cheaper cart.

If a user applies PackPTS and then buys the card on eBay, they pay **eBay’s full price**. The only certain change is inside PackPTS (points reserved or spent). That is **CODE**.

The product copy (home FAQ, partners page, roadmap, Redeem tab) currently implies a real eBay checkout discount. That claim is **marketing-unsafe**.

---

## 1. Product / UX flow

There are **two separate redeem systems** on `/marketplace`. They look related in the UI. They do not share a payout rail to eBay.

Route: `client/src/pages/marketplace.tsx` (Wouter page `/marketplace`).

### Path A — Live listing “Apply PackPTS” (eBay / Goldin cards)

This is the flow Dave is asking about.

| Step | What the user does | What the system does | Cite |
|---|---|---|---|
| 1 | Earns PackPTS in-game | Wallet credit via ledger | wallet / reward engine (out of scope) |
| 2 | Opens `/marketplace` → **Live Listings** | Contextual or typed search | `GET /api/marketplace/contextual-search`, `GET /api/marketplace/search` (`server/routes.ts`) |
| 3 | Sees eBay / Goldin cards | eBay Browse API search (category 212) or admin-curated Goldin rows | `server/services/marketplace/ebay.ts`; Goldin: `goldinCuratedListings` |
| 4 | If signed in, sees **Buy Now $P** and optionally **With PackPTS: N pts + $Y** + **Save $Z** | Batch quote for every priced card | `POST /api/marketplace/redemption/quote-batch` |
| 5 | Clicks **Apply PackPTS** | Per-listing quote; opens modal “Use your PackPTS as credit toward this purchase on eBay” | `POST /api/marketplace/redemption/quote` → `profitGuardrailService.createQuote` |
| 6 | Moves slider, clicks **Apply N PackPTS** | Wallet spent immediately; `redemptionCredit` row `PENDING`; intent `APPROVED`; toast **“PackPTS Reserved”** | `POST /api/marketplace/redemption/apply` → `applyRedemption` |
| 7 | Still on PackPTS. Must separately click **View Listing** | 302 to eBay with EPN tags. **No discount params.** | `GET /out/ebay/:listingId` → `applyEpnTracking` |
| 8 | Pays on eBay | Full eBay price | See §2 and live redirect test below |
| 9 | (Intended, not wired in UI) User or admin “confirms purchase” | Status flip to `CREDIT_GRANTED`. **No USD leaves PackPTS.** | `POST /api/marketplace/purchase/confirm` (route comment: *“stub for admin review”*). **No client caller.** |

**CODE:** After a successful apply, `marketplace.tsx` only toasts and invalidates `/wallet`. It does **not** open eBay, attach a coupon, or navigate to a confirm-purchase screen.

**CODE:** `GET /api/marketplace/redemption/intents` and `POST /api/marketplace/redemption/cancel` exist on the server. The React app never calls them. Unused-apply cleanup: hourly job refunds PackPTS on intents still `APPROVED` after 72 hours (`server/services/staleRedemptionCleanup.ts`, registered in `server/index.ts`).

**CODE:** Quote-batch has a side effect: each visible listing calls `createQuote`, which **inserts** an `external_purchase_intent` row (`status: CREATED`). Browsing Live Listings while logged in writes a row per card. Orphans are canceled after 24 hours.

### Path B — Redeem tab “eBay Gift Card” / store credit

Second tab on the same page: **Redeem PackPTS**.

| Step | What the user sees | What actually happens | Cite |
|---|---|---|---|
| 1 | Cards titled **“$10 eBay Gift Card”**, **“$50 eBay Gift Card”**, **“$2 eBay Credit”**, plus Goldin credits | Hardcoded array, not eBay catalog, not Stripe products | `REDEMPTION_OPTIONS` in `server/storage.ts`; `GET /api/marketplace` (live 2026-09-20 returned all 6) |
| 2 | Button **Get Discount** (external-link icon) | Opens confirm dialog: “redeem your PackPTS for store credit” | `marketplace.tsx` |
| 3 | Confirm | `POST /api/redeem` spends points if a matching **tier** exists (`redemption_tiers.packptsRequired` exact match, min 1,000 pts) | `server/services/redemptionService.ts` |
| 4 | Success dialog | “Your credit has been issued! **Check your email** for instructions” + a hex **Credit Code** | UI copy in `marketplace.tsx`. API message: “Use your credit token at checkout.” |
| 5 | Email | **No redemption email exists** in `emailService.ts` | **CODE** |
| 6 | Token use | `POST /api/redemption/validate-token` and `consume-token` only flip PackPTS-side status. Nothing on eBay calls them. Endpoints are **unauthenticated**. | `server/routes.ts` |

Default seeded tiers (if the table is empty) are 1,000 / 5,000 / 25,000 / 100,000 PackPTS — **not** the 2,000 / 10,000 / 50,000 gift-card cards. Several Redeem-tab SKUs will 400 (“No valid redemption tier”) unless admin created matching tiers. **CODE** (seed + schema). Whether production tiers were seeded was **not** queried (**HUNCH:** mismatch is likely).

`/redeem` is a **Founders Pass** page (`client/src/pages/redeem.tsx`). It is not eBay checkout.

### Store vs marketplace vs Goldin

- **`/store`:** Stripe buy-PackPTS bundles. Copy says “Use your PackPTS as a discount!” and links to marketplace. Stripe does not pay eBay. **CODE**
- **Goldin:** Same Apply path as eBay. Outbound is `GET /out/goldin/:listingId` with **no** EPN-style coupon. Listings are admin-curated; no live Goldin commerce API. **CODE**
- **iOS:** Plan docs only. No native apply-to-eBay client in this repo. **CODE**

---

## 2. What “reduced fee” means technically

**It is not an eBay fee reduction.**

| Mechanism people might mean | Implemented? | Evidence |
|---|---|---|
| eBay listing / checkout price change | **No** | eBay integration is Browse search + a 302 to `itemWebUrl`. `ebay.ts` has no Trading / Offer / coupon APIs. Outbound URL builder only adds `campid`, `toolid`, `customid` (optional `mkcid`/`mksid`). |
| PackPTS-funded eBay coupon | **No** | Repo-wide search for coupon / promo / gift-card issuance in server code: no matches except the hardcoded *label* “eBay Gift Card”. |
| Cashback after purchase (Stripe / PayPal / ACH) | **No** | `confirmPurchase` and `adminGrantConfirmed` only `UPDATE` intent/credit status and consume a **treasury reservation**. `ledgerCreditEntryId` on `redemption_credit` is never written. Stripe is store-bundle checkout only. |
| Affiliate EPN credit to **PackPTS** (not the buyer) | **Partially yes** | Click → EPN URL → optional `GET /api/webhooks/epn-postback` writes `attributed_purchases`. That is PackPTS revenue attribution. It does **not** call `confirmPurchase` or refund the user. |
| Internal PackPTS wallet debit labeled “credit” | **Yes** | Apply spends PackPTS now; “grant” later is an accounting status, not money to the user. |

Schema comment on `redemption_credit` (`shared/schema.ts`): *“what we grant as store credit / rebate credit.”* The rebate never gets a payout function. **CODE**

Canonical numbers in the **formula** (not production wallet balances):

- Default `packptsValue` = $0.002 / PackPTS
- Default affiliate rate `A` = 2%, haircut `h` = 70%, min margin `m` = 25%
- `Cmax = (h·A·P·(1−m) − f)/(1+r)` → **$1.05 credit on a $100 listing** (525 PackPTS). Unit-tested in `server/tests/purchaseFulfillment.test.ts`.
- Headline ceiling `maxDiscountPct` default 15% is **reserve-gated**. If the funded reserve is empty, credit is bounded by this-transaction affiliate margin (~1% of price) and a 500-PackPTS ($1) floor. **CODE** (formula). Production reserve balance: **not read**.

**Live outbound check (2026-09-20, no purchase):**  
`GET https://packpts.com/api/marketplace/search?q=1987+Topps&source=ebay` returned real eBay items. Following `outboundUrl` returned **302** to `www.ebay.com/itm/...` with `campid`, `toolid=10001`, `customid=packpts:u_anon:...`. No price, coupon, or discount query params. Railway production service `PackPoints-Game` has `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV`, `EPN_CAMPID`, `OUTBOUND_SECRET`. `EPN_MKCID` and `EPN_MKSID` are **unset** (optional extras; redirect still works).

---

## 3. Has it been tested?

**No end-to-end “user applies PackPTS and pays less on eBay” test exists.**

| Evidence | Result |
|---|---|
| Playwright `tests/e2e/` | `auth.spec.ts`, `battle-session.spec.ts` only. No marketplace / apply / eBay spec. |
| Vitest | `computeRmax` math only (`purchaseFulfillment.test.ts`). **Zero** tests for `applyRedemption`, `confirmPurchase`, `/out/ebay`, or EPN postback → credit. |
| GitHub issues (`Bigtimedee/PackPoints-Game`) | Semantic search for apply/eBay/discount/gift-card: **0 issues**. |
| Project context | Lists “E2E … signup → game → marketplace” as still required before a sale process. |
| This audit | Did **not** complete an eBay checkout. Did **not** apply PackPTS as a logged-in user. Do not treat the 302 redirect as proof a buyer saved money. |

**HUNCH:** Nobody has proven a reduced eBay fee in production because the fee-reduction rail is not implemented. Formula tests prove “how large could an internal credit be,” not “eBay charged less.”

---

## 4. User-visible proof

### On eBay

**None.** eBay shows the seller’s normal price. Affiliate tags do not change the cart.

### On PackPTS (before apply)

Dual price is **only** on packpts.com listing cards:

- “Buy Now” = eBay/Goldin list price
- “With PackPTS: {pts} pts + ${usdDue}”
- Green “Save $X” if savings ≥ $0.50

Copy sources: `client/src/pages/marketplace.tsx`. Empty-search: “Use your PackPTS as a discount when you purchase!”

**CODE caveat:** Batch preview uses formula `quote.rMax` and a default **50%** of that as `ptsApplied`. The apply path stores `marginBackedRmax` (reserve + velocity caps). The card can advertise a savings the apply endpoint will clamp or deny.

### After apply (Path A)

- Toast: **“PackPTS Reserved”** + server message `Reserved N PackPTS for $X.XX credit`
- Header / marketplace **balance** drops (if spend succeeded)
- `GET /wallet` returns `recentTransactions`, but **no user page renders that list** (only admin user-detail shows a ledger). Hook exposes it; marketplace/header ignore it.

There is no receipt, no “your eBay order is $Y”, no email.

### After Redeem tab (Path B)

- Dialog shows a hex **Credit Code**
- Copy promises email instructions — **email is not sent**
- Token is useless at eBay checkout

### Trust model if we are honest

Today the user can only know PackPTS *moved* (balance went down; maybe a toast). They **cannot** know eBay charged less, because eBay did not. If they apply on a listing and walk away, Path A auto-refunds points after 72 hours — which can look like “it didn’t work.” If they apply and buy on eBay anyway, they paid full price **and** may have burned points until cleanup or a manual cancel (no cancel button).

---

## 5. Gaps / honesty (marketing-unsafe)

Safe to say today:

- Users can browse live eBay sports-card listings on PackPTS.
- Clicks can be EPN-attributed (campaign id is configured; postback endpoint exists).
- Users can spend PackPTS *inside PackPTS*.

**Unsafe to say:**

| Claim (live copy) | Why it’s unsafe |
|---|---|
| Home FAQ: “Apply your PackPTS **at checkout** for discounts at partner stores including eBay” | Checkout is eBay’s. PackPTS never sits in that checkout. `client/src/pages/home.tsx` |
| Partners: eBay **“10% discount on qualifying listings”** | No 10% eBay program in code. Live `/partners` HTML contains `10%`. `client/src/pages/partners.tsx` |
| Roadmap: “eBay marketplace redemption” = **Done** — “Use PackPTS for eBay card discounts.” | Feature is an internal reservation, not an eBay discount. `client/src/pages/roadmap.tsx` |
| Redeem tab **“$10 eBay Gift Card”** / “Use on any eBay sports card purchase” | No gift-card vendor, no eBay GC API. Hardcoded labels. Live `GET /api/marketplace`. |
| Success: “Check your email for instructions” | No redemption mailer. |
| API: “Use your credit token at checkout” | Token is not an eBay field. |
| Context doc (before this audit): “users still pay the **remaining** balance … via the external marketplace” | Implies eBay’s due amount is reduced. It is not. |

Other engineering gaps (all **CODE**):

- `purchase/confirm` has no UI; EPN postback does not close the loop.
- Path A “credit granted” ≠ money to the user.
- Path B consume-token is public and unused by any partner.
- Quote-batch inserts a purchase intent per card on every browse.
- Batch UI can overstate savings vs apply.
- Client success dialog looks for `status === "PENDING_REVIEW"` on the **root** JSON; the API puts status under `redemption.status` (`pending`). Review vs complete messaging is wrong even for Path B.
- ToS: points have **no cash value** (`terms-of-service.tsx`) — consistent with “not cashback,” inconsistent with “eBay gift card.”

---

## Bottom line for Dave

| Question | Answer |
|---|---|
| Has anyone tested apply-to-eBay as a real cheaper eBay cart? | **No evidence in repo, tests, or issues.** This audit did not buy a card. |
| Does the user get a reduced fee on eBay? | **No.** They pay the full eBay price. |
| Why? | PackPTS never writes a coupon, gift card, or price override into eBay. “Credit” is a PackPTS ledger / status row. |
| How would they see a reduction on eBay? | **They wouldn’t.** |
| How do they know a discount applied? | Only PackPTS-side: a toast and a lower point balance. Email / eBay price / receipt: **none.** After 72h unused Path A applies, points may come back automatically. |

**Recommended honest product sentence:**  
*“Browse real eBay listings from PackPTS. We may earn an affiliate commission. PackPTS you ‘apply’ are reserved or spent in your PackPTS wallet — they do not change the price eBay charges.”*

Until there is a real rail (eBay coupon partnership, issued gift cards, or post-purchase cash reimbursement with a visible receipt), do not claim apply-to-eBay works as a checkout discount.
