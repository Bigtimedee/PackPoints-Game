# PackPTS SEO Plan (Oct 15, 2026)

Source: BowTiedBills, "The Most Valuable SEO Article Ever Written" (article.md). Audit run live on packpts.com Oct 15, 2026, 9 PM CT, with curl (Googlebot UA), Lighthouse 12 mobile, web search, and the repo Bigtimedee/PackPoints-Game (read-only).

## 1. What carries over from the article, and what doesn't

| Article lesson | For PackPTS |
|---|---|
| Map pack, Google Business Profile, NAP citations, local directories, local reviews | Does not apply. PackPTS has no storefront and no service area. Skip it. |
| Three surfaces (map, blue links, AI answer) | Two apply: blue links and AI answers. Like the article's peptide brand, PackPTS lives entirely there. |
| Buying, comparison, question keyword tiers | Applies, renamed: Play intent, Comparison, Question. |
| One page per service and per location | Becomes one page per set (sets are our "services"). There are no location pages. |
| Site Google can read, 3-click depth, Core Web Vitals | Applies hard. It is our biggest gap (see audit). |
| Schema | Applies: WebSite, Organization, VideoGame or WebApplication, FAQPage, BreadcrumbList, ItemList. No LocalBusiness. |
| E-E-A-T and YMYL | Mostly not YMYL. The one YMYL edge is points and eBay rebates (money). Keep that copy factual, with no promised amounts. |
| Reviews | Swap for player social proof: shares, X posts, Reddit threads in r/baseballcards and r/sportscards. |
| Links | Applies: hobby blogs, card podcasts, Reddit, daily-game roundup lists (Wordle-alternative lists). |
| Direct-answer openings, consistent entity info, Bing Webmaster Tools | Applies fully. |

## 2. Audit findings (with evidence)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| A1 | Client-side rendered SPA. Without JS, Googlebot sees only a spinner and "Loading PackPTS..." plus a 4-link legal footer. No H1, no body copy, no internal nav links on any route. | Raw HTML of /, /daily, /sets, /sets/1988-topps-baseball-affd57b8, /points is 6.9 to 7.3 KB; body is `#initial-loader` + static footer (Terms, Privacy, DMCA, mailto). Web search for the brand returns packpts.com with the snippet "Loading PackPTS..." | Critical |
| A2 | robots.txt and sitemap.xml do not exist. Both return the SPA shell (HTTP 200, text/html, 7,285 bytes, homepage title). | `curl https://packpts.com/robots.txt` and `/sitemap.xml` | Critical |
| A3 | Soft 404s. Any unknown URL returns 200 with homepage meta and canonical to `/`. | `/nope-xyz` and `/how-it-works`: 200, title "PackPTS", canonical `https://packpts.com/` | High |
| A4 | Wrong canonicals. /daily canonicalizes to `/` (so Google is told to drop it). /points serves homepage title, description and canonical to `/`. | /daily: `<link rel="canonical" href="https://packpts.com/">` while og:url is /daily. /points: identical head to `/` | High |
| A5 | Titles are weak. Homepage title is just "PackPTS" (an HTML comment says it must equal the TikTok app name). Set titles are "1988 Topps Baseball · PackPTS" with no intent words. /sets description is "Play sets already in PackPTS." Set description is "Play 1988 Topps Baseball on PackPTS." | Raw `<title>` and meta description per route | High |
| A6 | Meta and schema still name Goldin, which product copy no longer does. | Homepage description: "browse live eBay and Goldin listings"; JSON-LD description: "...eBay and Goldin listings." | Medium |
| A7 | Good base to build on: server already injects per-route head for /daily, /sets and /sets/:id (slugged canonical `/sets/1988-topps-baseball-affd57b8`, og tags, 1200x630 og images). Homepage has WebApplication JSON-LD with a free Offer. | Raw heads; repo `server/lib/playSetsHtml.ts`, `server/lib/playSetsOg.ts`, `client/index.html` | Positive |
| A8 | No H1 in server HTML anywhere; set pages have JSON-LD only via the homepage block (no BreadcrumbList, ItemList, FAQPage, Organization sameAs, WebSite). | grep of raw HTML: 0 `<h1>` | High |
| A9 | Core Web Vitals, Lighthouse mobile: `/` Performance 77, SEO 92, LCP 4.3 s, CLS 0, TBT 60 ms, 432 KiB. `/sets` Performance 63, SEO 92, LCP 14.9 s, CLS 0.016, 2,617 KiB. LCP fails the 2.5 s target on both; /sets is driven by cover renders (known 7 to 8 s cold renders). | lighthouse JSON, Oct 15 | High |
| A10 | Caching off for HTML: `cache-control: private, no-store`, `cdn-cache-control: no-store`. Every crawl and visit hits Railway origin. | `curl -I /` | Medium |
| A11 | Internal linking and click depth: in raw HTML, nothing links to /daily, /sets or any set. Crawlers that don't run JS reach 0 game pages; with JS, sets are 2 clicks deep but only via JS buttons. 12 live sets exist. | Raw `<a>` count on set page: 4 (all legal). `/api/sets` lists 12 sets | High |
| A12 | Thin and duplicate pages: every set page shares one template, a one-line description and no unique text. Two sets have vague names ("2024 Basketball", "1989 Topps", "1987 Topps") that won't match how people search. | `/api/sets` setName values | Medium |
| A13 | No indexable set or checklist content exists. Set pages are a game launcher only. | Raw HTML of /sets/:id | High |
| A14 | Search visibility is near zero. `site:packpts.com` returned no results in web search; brand query "PackPTS card game" returns only the homepage with a "Loading" snippet, below unrelated "Pack It" and Pokemon "Pack Points" results. | WebSearch, Oct 15 | High |
| A15 | Competitors already own the intent terms with server-rendered, text-rich pages: feverbaseball.com/cardback (answer archive linking to player pages), whosthatguy.app/mlb-trivia-game (FAQ copy), draftchallenger.com/mlb-wordle, guessmyplayer.com. Checklist and value terms are owned by baseballcardpedia, PSA price guide, cardcenteringtool.com, cardlines.com. | WebSearch | Context |
| A16 | Anti-cheat constraint: players' names must never appear readable for cards in play. Fever's model (publish answers next day) is not safe for us because our pool is reused, not one card per day. | Product rule; PR #268/#269 history | Constraint |

## 3. Prioritized fixes

| Pri | Fix | Owner | Effort |
|---|---|---|---|
| P0 | Serve a real `/robots.txt` (allow all, block `/api/qa/`, `/api/play/`, `/admin`, point to sitemap) and a generated `/sitemap.xml` (/, /daily, /sets, /how-to-play, /points, each public set page, later guides). Return correct content types. | Eng | S |
| P0 | Fix canonicals: /daily self-canonical; /points gets its own title, description, canonical. Every route gets a self-referencing canonical. | Eng | S |
| P0 | Real 404s: unknown routes return HTTP 404 with noindex. Unknown set ids return 404. | Eng | S |
| P0 | Server-render crawlable content into the HTML for /, /daily, /sets, /sets/:slug, /points, /how-to-play: one H1, 150 to 400 words of real copy, and plain `<a href>` nav to Daily 5, Sets, each set, How to play, Points. Extend the existing `playSetsHtml.ts` injection rather than migrating frameworks. React then mounts over it. | Eng | M |
| P0 | Remove "Goldin" from homepage meta and JSON-LD. Rewrite titles: Home "PackPTS: Name the Player on Classic Sports Cards" (if TikTok review truly needs title = "PackPTS", keep `<title>` and set og:title and H1 to the descriptive version; confirm the TikTok rule first). | Eng + Marketing | S |
| P0 | Verify packpts.com in Google Search Console and Bing Webmaster Tools; submit sitemap; request indexing of the 6 core URLs. Bing feeds ChatGPT and Copilot answers. Enable IndexNow. | Marketing (Dave has the DNS) | S |
| P1 | Set landing pages (see section 4) with unique copy per set and FAQ. | Design (template) + Marketing (copy) + Eng | M |
| P1 | Schema: WebSite + Organization (logo, sameAs X/TikTok/Instagram), VideoGame/WebApplication on /, BreadcrumbList on set pages, ItemList on /sets, FAQPage on how-to-play and sets. Same name, description and logo everywhere. | Eng | S |
| P1 | LCP: pre-rendered cached covers (in progress), serve covers as sized WebP with width/height, lazy-load below the fold, preload the hero image, cache HTML at the CDN for 60 s with stale-while-revalidate (safe, no user data in shell). Target LCP < 2.5 s mobile. | Eng | M |
| P1 | Rename vague sets for search: "2024 Basketball" to its real product name, "1989 Topps" to "1989 Topps Baseball", "1987 Topps" to "1987 Topps Baseball". Slugs follow, old slugs 301. | Eng + Design | S |
| P1 | How to Play page and Points page with direct-answer openings (section 5). | Marketing + Design | S |
| P2 | Guides hub: junk wax era explainer, per-set history pages (question tier). Author byline (Dave, collector bio) for E-E-A-T. | Marketing | M |
| P2 | Link building: submit to daily-game and "Wordle alternatives" lists, r/baseballcards, card podcasts and newsletters, hobby blogs. | Marketing | ongoing |
| P2 | Per-set and Daily 5 og images, set-specific, with no money claims or dollar amounts. | Design | S |

## 4. Page architecture

```
/                    Home: H1 "Name the player on classic sports cards". Daily 5 CTA, set list links.
/daily               Daily 5: what it is, resets when, streaks. No card content in HTML.
/how-to-play         Rules, masks, four choices, scoring, FAQ.
/points              What points are, how eBay rebates work (factual, no amounts promised), hold period, FAQ.
/sets                All sets: ItemList, sport filters as crawlable links.
/sets/{slug}         Set landing page (one per set, ~490 words unique)
/guides/junk-wax-era Question-tier explainer, links to every junk wax set page
/guides/{set}-history (optional later) set history, design, key rookies
```

**Set landing page (`/sets/1988-topps-baseball-affd57b8`)**, in server HTML:
- H1 "1988 Topps Baseball: Name the Player Game". Title "1988 Topps Baseball Card Game: Guess the Player | PackPTS".
- Direct-answer opening: "Play 1988 Topps Baseball on PackPTS: we deal a real 1988 Topps card with the name masked and you pick the player from four choices. Free, no download."
- Set facts: year, brand, sport, card count in our pool, design notes, era (for example junk wax), what makes the set notable.
- Play button, link to Daily 5, links to sibling sets from the same era or brand, link to the era guide.
- FAQPage: "How many cards are in 1988 Topps?", "Is 1988 Topps junk wax?", "How does the game work?"
- Masked cover images only (the ones already approved), with neutral alt text ("Masked 1988 Topps card"). Never a player name in alt, filename, title or schema.

**Checklist pages that are not answer keys.** Rule: no page on packpts.com may pair a card image, card number or any card identifier we deal with a player name. Options, safest first:
1. Set-level facts only (counts, subsets, design, era, rookie class described in prose). No per-card list. Default for all live sets.
2. Name list without linkage: "Notable players in this set" as plain names, no card numbers, no images, no ordering tied to deals, and only once the set's pool is big enough (400+) that a name list gives no edge on a 4-choice question. Needs Design and Eng sign-off per set; the game already shows four names, so this is weak help, but default is off.
3. Full numbered checklists: do not publish for any set that is in play. Link out to baseballcardpedia or PSA for full checklists instead.
Never expose card ids, mask plans, or per-card URLs. Never let the og image for a set page be an unmasked card.

**Points page**: factual explanation that users earn points by playing, and the rebate equals the commission eBay confirms, held 60 days. No dollar figures or percentages in og or social images.

## 5. AI answers and E-E-A-T

- **Direct-answer openings:** the first sentence of every page answers its query in under 30 words (see the set page example). The article cites Pew: clicks drop from 15% to 8% when an AI summary shows, so we want to be the quoted source.
- **Consistent entity info:** one canonical description used in meta, JSON-LD, X bio, TikTok bio, app stores: "PackPTS is a free sports card game: name the player on a real card with the name masked. Earn points for eBay rebates." Same logo and name spelling (PackPTS) everywhere. Organization schema with sameAs.
- **Bing Webmaster Tools** plus IndexNow (P0), since ChatGPT search and Copilot draw on Bing.
- **Schema** per section 3.
- **E-E-A-T:** About page with Dave as founder and collector, contact email, how cards are sourced and masked. Guides carry a byline and cite sources (Topps, PSA population data, baseballcardpedia).
- **YMYL edge:** points and rebate copy states only what is true today, with no earnings claims.

## 6. Keyword map

Volumes not pulled (no keyword tool access); verify in Google Keyword Planner or Ahrefs before week 3. Terms drawn from search results and competitor pages.

| Tier | Keyword | Target page |
|---|---|---|
| Play intent | sports card trivia game, sports card game online free | / |
| Play intent | guess the baseball card player, name the player baseball card game | / and /sets/{baseball sets} |
| Play intent | daily baseball card game, daily sports card game, card guessing game daily | /daily |
| Play intent | guess the basketball card player, football card trivia | /sets/{sport sets}, sport filter on /sets |
| Play intent | {year} {brand} game, e.g. 1988 Topps game, 1986 Topps quiz | /sets/{slug} |
| Comparison | wordle for baseball cards, sports wordle games, baseball wordle alternative | /how-to-play (section "Like Wordle, but with real cards") |
| Comparison | games like The Card Back, Who's That Guy alternative, MLB guess the player games | /how-to-play, outreach to roundup lists |
| Comparison | sports card apps with rewards, cash back on sports cards eBay | /points |
| Question | 1987 Topps checklist, 1988 Topps checklist | /sets/{slug} set-facts section (no card list; link out) |
| Question | what is 1988 Topps worth, are junk wax cards worth anything | /guides/junk-wax-era (prose, cite PSA, no promises) |
| Question | junk wax era cards, what years are junk wax | /guides/junk-wax-era |
| Question | how does PackPTS work, what are PackPTS points | /how-to-play, /points |
| Brand | PackPTS, packpts game | / |

Note: "checklist" and "worth" pages are dominated by PSA, baseballcardpedia and price guides. We compete with era and set context that links into play, not with full checklists or price tables.

## 7. 90-day timeline

| Weeks | Work | Done when |
|---|---|---|
| 1 to 2 | All P0: robots, sitemap, canonicals, real 404s, server-rendered H1 and copy and links on 6 core routes, Goldin removed, title rewrite, GSC and Bing verified, sitemap submitted | `curl` shows H1, copy, links; GSC sitemap "Success" |
| 3 to 5 | Schema set, set-name fixes and 301s, How to Play and Points pages, set landing template + copy for 12 sets, keyword volumes verified | Rich Results Test passes; 12 set pages indexed |
| 5 to 8 | LCP work (covers cached, WebP, CDN HTML cache); junk wax guide; About page with byline | Lighthouse mobile LCP < 2.5 s on / and /sets |
| 8 to 13 | Outreach: 10 roundup and hobby sites, Reddit posts, podcast mentions; add set pages as new sets clear; refresh copy on pages ranking 8 to 20 | 10+ referring domains |

The article says organic moves in 2 to 4 week cycles; judge changes on that cadence, not daily.

## 8. KPIs

| KPI | Now | Day 90 target |
|---|---|---|
| Indexed URLs (GSC) | ~1 (homepage, "Loading" snippet) | 20+ |
| Brand query "PackPTS" | #1 with broken snippet | #1 with real snippet + sitelinks |
| Non-brand impressions (GSC) | ~0 | 20k / month |
| Non-brand organic clicks | ~0 | 500 / month |
| Top 10 rankings for set game terms ("1988 Topps game" etc.) | 0 | 8 of 12 sets |
| Top 20 for 3 play-intent head terms | 0 | 2 of 3 |
| Lighthouse mobile LCP / | 4.3 s; /sets 14.9 s | < 2.5 s both |
| Referring domains | unknown, likely ~0 | 10+ |
| AI answer citations (manual check in ChatGPT, Perplexity, Google AI Overviews for 10 tracked questions) | 0 | 3 of 10 |
| Organic visitor to first game started | not tracked | tracked; 40%+ |

Guardrail KPI: 0 pages anywhere on packpts.com that pair a dealt card image or identifier with a player name (Eng adds a CI test that greps server-rendered HTML for card names from the live pool).
