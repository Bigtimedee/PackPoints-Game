# PackPTS Go-To-Market (canonical)

Status: canonical as of October 14, 2026. Owner: Dave Maloney.
This file replaces every goal, ICP, KPI and north star in the older plans. Where an older doc disagrees with this one, this one wins. Source: the GTM audit of October 13, 2026.

## The one ICP: the Junk Wax Returner

A US adult, typically 38 to 52, who collected baseball cards as a kid between 1986 and 1992 and came back to the hobby after 2020. Buys raw vintage and junk-wax singles and sets on eBay, mostly $5 to $100 a card. Lives on hobby YouTube, r/baseballcards, card shows, set-collector Facebook groups and X baseball nostalgia accounts.

Not the ICP for the next 90 days: modern breakers and flippers, kids, Pokemon and TCG players, fantasy and DFS players, football-first and basketball-first collectors. Those sets stay playable in Browse but get no marketing and no new set work.

## The one promise

"Name the player on the cards you grew up with."

Points and rebates are secondary. Never say "pays you to play" or "earn money." Marketing leads with the bare mechanic: one masked 1986 to 1990 baseball card and "Who is this?"

## The one north star

Real daily active users (7-day average DAU), paired with D7 retention. Test, QA and staff accounts are excluded (`users.is_test`). Both are read from `/api/qa/funnel`.

Retired north stars: "Sets Made" and "Maker Rate" (PRODUCT_VISION.md). Users do not create cards.

## Economics facts (do not restate them differently anywhere)

- eBay Partner Network commission on trading cards: 3% (`TRADING_CARD_COMMISSION_RATE` = 0.03). Not 8 to 10%.
- The user rebate is 70% of the commission eBay confirms. PackPTS keeps 30%. It is capped at the points credit applied, $25 per user per day and $100 per user per week, and funded from a reserve. Rebates created before the 70/30 split keep 100% of their commission.
- Rebates hold 60 days (45 once eBay locks the sale). Payout minimum is $10. Purchased points count toward rebates.
- Rebates stay live. The EPN Loyalty/Incentive application will be filed after traction (Dave's decision, October 13, 2026).
- PackPTS earns a commission on eBay purchases through our links, and says so next to every eBay link.

## Day-90 gate: January 11, 2027

| Signal | Go | Pivot | Stop or sell the tech |
|---|---|---|---|
| Real DAU (7-day average) | 200 or more | 50 to 199 | Under 50 |
| D7 retention | 20% or more | 10 to 19% | Under 10% |
| Creator-attributed signups | 300 or more | 100 to 299 | Under 100 |
| EPN status | Approved, with confirmed sales | Pending | Rejected or terminated |
| Licensing | A Topps/Fanatics conversation underway | Counsel cleared for a limited scope | A cease-and-desist received |

The 12-month exit target is retired. The exit stays a 24 to 36 month aim, reconsidered only at the gate.

## Milestones (registered non-staff users / real DAU)

- Day 30 (Nov 12, 2026): 150 / 25
- Day 60 (Dec 12, 2026): 500 / 75
- Day 90 (Jan 11, 2027): 1,500 / 200

## Channels (in priority order)

1. Hobby creators: Creator Daily 5 with on-screen credit and a `creator_` UTM per creator.
2. r/baseballcards: one native post a week from Dave's own account, no links in titles, never automated.
3. X @PlayPackPTS: the Daily 5 every day at 8 AM CT, plus one editorial nostalgia post with a UTM link in the first reply.
4. Card shows and local card shops: QR tabletop game; any prize uses official rules with a free method of entry.
5. Email: retention only, after 200 subscribers.

Instagram and TikTok are on hold.

## Measurement

- Every brand link carries `utm_source`, `utm_medium` and `utm_campaign`.
- Weekly scorecard every Monday from `/api/qa/funnel` and `/api/qa/rebate-liability`: registered users, DAU (7-day average), D1/D7, Daily 5 completions, signups by source, EPN clicks and sales, revenue, rebate liability.

## Superseded documents

MARKETING_PLAN.md, SOCIAL_MEDIA_CAMPAIGN.md, PACKPTS_GROWTH_STRATEGY.md, PRODUCT_VISION.md, PACKPTS_MARKETING_BRAND_CONTENT_PLAN.md, PACKPTS_EXECUTION_PLAN.md, MONETIZATION_PLAN.md, REDDIT_STRATEGY.md and docs/CONTENT_MARKETING_30_DAY.md carry a "Superseded" header. Their tactics may still be useful; their goals, ICPs, KPIs and economics are not.
