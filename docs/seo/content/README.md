# PackPTS SEO content kit (Design + Marketing), Oct 15, 2026

- core-pages.json / .md: /, /daily, /sets, /points, /how-to-play, /about. Keys: path, title (<=60), description (<=155), h1, answer (first sentence, render as the first <p>), body (paragraphs split on blank lines), faq, links, crumbs, jsonld (@graph: WebSite, Organization, VideoGame+WebApplication on /, BreadcrumbList and FAQPage on every page).
- set-pages.json / .md: one page per public set (12, from live /api/sets at 9 PM CT). Adds setId, facts, coverImages (masked covers, neutral alt). jsonld: BreadcrumbList, FAQPage, WebPage.
- Set-level facts only. No player names, card numbers or per-card checklists.
- Guardrail: scripts/seo-name-leak-check (run in CI with PACKPTS_QA_TOKEN to check the live dealable pool).
- Regenerate: python3 build_kit.py (reads _live_sets_snapshot.json).
- Card counts are snapshots; Eng should render cardCount live from /api/sets.
