# PackPTS iOS App Store Readiness Assessment — July 6, 2026

This is a current-state assessment against the canonical plan in `iOS-Adaptation-Plan.md` (v1.0, 2026-03-24), which recommends **SwiftUI native (Option C)**. That recommendation still holds. This document measures where we actually are and what to do next.

## Current state: native build has not started

As of today the repository contains no `ios/` directory, no Capacitor or React Native dependencies, and none of the backend prerequisites from Part 5 of the adaptation plan. Concretely, the blockers identified in March remain open: there is still no token-based (JWT/Bearer) auth path — auth is cookie-session only, which a native client cannot use reliably; Stripe remains the sole payment rail, and App Store guideline 3.1.1 mandates Apple IAP for digital goods (PackPTS bundles and subscriptions); there is no APNs push infrastructure; and there is no Sign in with Apple, which is required whenever any third-party login (WorkOS OAuth) is offered.

## What improved this session

The web app now has a proper PWA baseline: a web manifest, apple-touch-icon, 192/512 icons, theme-color, and iOS standalone-mode meta tags. This gives us an installable home-screen experience on iOS *today* — a meaningful stopgap for retention (and a prerequisite for web push on iOS 16.4+) while the native app is built. The mask-to-blur change also removes a UX blemish that would have shipped into any native WebView or been replicated in SwiftUI.

Note: the new icons are upscaled from a 128px favicon. Before App Store submission (and ideally before promoting the PWA), export a 1024×1024 master icon from the original logo artwork; the App Store requires 1024×1024.

## Recommended sequence (dependency-ordered)

1. **Backend auth: add JWT issuance alongside sessions.** This unblocks everything native and is useful for the web client too. (Adaptation plan Part 5.)
2. **Sign in with Apple** on the backend (WorkOS supports it as a provider — verify current WorkOS config).
3. **IAP product mapping**: mirror the existing `products` SKUs into App Store Connect, add a server-side App Store Server API receipt-validation endpoint that credits wallets through the existing ledger. This is the single largest work item; it was sized as such in March and nothing has changed.
4. **APNs push** — device token registration table + send pipeline. This also serves the "push notifications" growth priority.
5. **SwiftUI app phases** per Part 4 of the adaptation plan (auth → solo game → Daily 5 → wallet/store → 1v1/WebSocket → social).
6. **App Store submission checklist** per Part 9 (privacy nutrition labels, account deletion requirement, 1024px icon, screenshots, TestFlight beta).

## Timeline realism

The March plan's phasing implies roughly a quarter of focused engineering for a submittable v1 (solo + Daily 5 + wallet + IAP, deferring 1v1 to v1.1). Given the current codebase has drifted since March (mask rendering, reward engine changes), Phase 0 should include a fresh API-surface diff against the plan's Part 1 catalogue before Swift code is written.

## Decision needed from Dave

None immediately — SwiftUI native remains the right call. The first commitment point is scheduling item 1 (JWT auth path), which is backend work with no App Store dependency and can start now.
