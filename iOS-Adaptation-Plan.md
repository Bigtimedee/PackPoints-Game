# PackPTS iOS Adaptation Plan

**Document version:** 1.0
**Assessment date:** 2026-03-24
**Assessed by:** iOS Planning Agent

---

## Part 1 — Web Application Assessment

### Application Summary

PackPTS is a sports card trivia game built on React 18, Express.js, PostgreSQL, and WebSocket. Players are shown masked baseball card images and must identify the player from multiple-choice options. The app supports:

- Solo gameplay with a fame-based dynamic points reward engine
- 1v1 friend matches and random matchmaking via WebSocket real-time play
- Daily 5 challenge (one shared challenge per day, global leaderboard)
- PackPTS wallet (earned points, Stripe-purchased bundles, point expiration)
- Point redemption for physical collectibles via Goldin/eBay integrations
- Friends system with friend match invites delivered over WebSocket
- Founder access cap with invite-code gating and waitlist management
- Subscription tiers (FREE, PRO, LEGEND) controlling game mode access and daily quotas
- Admin panel (web-only, no mobile equivalent needed)

### Authentication System

The backend uses two parallel auth paths: local username/password sessions via `express-session` stored in PostgreSQL, and WorkOS OAuth (OIDC). Session authentication is carried via HTTP-only cookies. The WebSocket connection reads the same session on upgrade. There is no existing token-based (JWT/Bearer) auth path — this is a critical gap for a native iOS client, which cannot use cookie sessions reliably across foreground/background transitions.

### Data Models (key tables for iOS)

| Table | Purpose |
|---|---|
| `users` | Core identity, status (ACTIVE/WAITLISTED/BANNED), game stats |
| `local_credentials` | bcrypt password hashes |
| `wallets` | PackPTS balance, lifetime earned/spent |
| `ledger_entries` | Append-only transaction log |
| `products` | Store SKUs with `stripe_price_id` |
| `user_entitlements` | Active subscriptions and unlocks |
| `matches` + `match_participants` + `match_questions` + `match_answers` | Full 1v1 match lifecycle |
| `lobbies` | Pre-match room with 6-digit join code |
| `friendships` + `friend_match_invites` | Social graph |
| `daily5_challenges` (inferred) + `daily5_entries` (inferred) | Daily challenge |
| `game_sessions` | Solo game state persisted server-side |
| `streaks` (inferred) | Daily play streak tracking |

### WebSocket Event Catalogue

**Client sends:** `auth`, `heartbeat`, `join_lobby`, `leave_lobby`, `start_match`, `submit_answer`, `ready_next`, `join_match`, `join_queue`, `leave_queue`, `match_resync`, `question_replace_request`

**Server sends:** `FRIEND_MATCH_INVITE`, `FRIEND_MATCH_INVITE_CANCELLED`, `FRIEND_MATCH_INVITE_EXPIRED`, `FRIEND_MATCH_ACCEPTED`, lobby state updates, match state updates, answer results, match end events, `disconnected`, `error`

### Existing API Surface (relevant to iOS)

- `POST /api/auth/register` — username/email/password registration
- `POST /api/auth/local-login` — session login
- `GET /api/auth/user` — current user
- `POST /api/auth/logout` — session destroy
- `POST /api/game/start` — create solo game session
- `POST /api/game/answer` — submit answer
- `POST /api/game/next` — advance to next question
- `GET /api/game/session/:id` — get session state
- `POST /api/game/session/:id/replace-card` — request card replacement
- `GET /api/leaderboard` — global leaderboard
- `GET /api/profile/stats` — user stats
- `GET /api/daily5/status` — today's Daily 5 status
- `POST /api/daily5/start` — begin Daily 5
- `POST /api/daily5/answer` — submit Daily 5 answer
- `POST /api/daily5/finish` — complete Daily 5
- `GET /api/daily5/leaderboard` — Daily 5 leaderboard
- `GET /api/marketplace` — redemption options
- `GET /api/store/products` — purchasable bundles
- `POST /api/store/checkout` — Stripe checkout session creation
- `GET /api/wallet/balance` — current PackPTS balance
- `GET /api/playable-sets` — available card sets
- Friends routes: list, search, add, accept, decline, block, invite to match
- Referral/invite routes: validate invite code, redeem founders pass

### Stripe Integration Scope

The store sells three product tiers of PackPTS point bundles (Starter, Pro, Legend) and subscription products. The web client calls `/api/store/checkout` which creates a Stripe Checkout Session and redirects the user to `stripe.com`. A webhook at `/api/webhooks/stripe` processes `checkout.session.completed` events and credits the user's wallet via the ledger. This entire flow is web-specific and is categorically prohibited in an iOS App Store app for digital goods under App Store Review Guideline 3.1.1. It must be replaced before App Store submission.

---

## Part 2 — Approach Evaluation

### Option A: React Native

**Reusable from existing codebase:**
- All shared TypeScript types from `/shared/schema.ts` can be imported directly
- Business logic in API hooks (TanStack Query patterns map directly to React Native)
- Zod validation schemas are runtime-portable
- The game state machines in `game.tsx` and `match.tsx` can be ported with moderate effort

**Must be rewritten:**
- Every Radix UI / shadcn/ui component has no React Native equivalent — all UI must be rebuilt using React Native primitives or a component library such as Tamagui or NativeBase
- `framer-motion` animations require replacement with React Native Reanimated
- `wouter` routing must be replaced with React Navigation
- `useWebSocket` hook must be reimplemented against a React Native WebSocket polyfill
- CSS Tailwind styling is entirely incompatible; all styling must move to StyleSheet or a compatible system
- Canvas-based image masking in `GameCard.tsx` requires a React Native canvas solution (react-native-canvas or Skia)
- The `MaskedCardImage` component uses HTML Canvas for real-time pixel masking — this is a significant engineering concern

**Estimated effort:** 14-18 weeks for a 2-person team. Code sharing with the web app is limited to types and constants — the UI layer is a near-complete rewrite.

**Verdict:** Viable but offers limited reuse benefit. The component library mismatch is severe.

### Option B: Capacitor (Ionic WebView Wrapper)

**What works:**
- The existing React app runs inside a WKWebView with minimal changes
- WebSocket connections work normally inside WKWebView
- Cookie-based session auth works as long as the app targets the same origin
- Fastest path from web to "app" — potentially 3-4 weeks to initial build

**Critical problems:**
- Apple IAP compliance: Stripe checkout requires leaving WKWebView to Safari, which App Store Review will reject for digital goods purchases. This alone blocks App Store submission regardless of approach
- The canvas-based card masking in `GameCard.tsx` may hit WKWebView canvas performance limits on older devices — real-time pixel manipulation at 60fps is problematic
- Native haptic feedback, push notification tokens, and background refresh all require Capacitor plugins and native bridge calls, fragmenting the codebase
- WKWebView has no access to `UIImpactFeedbackGenerator` — haptics require the Capacitor Haptics plugin
- App Store reviewers scrutinize WebView apps heavily; if the app looks and feels like a wrapped website it risks rejection under guideline 4.2 (Minimum Functionality)
- Performance on the real-time match screen (WebSocket + rapid state updates + card image rendering) will be noticeably inferior to native

**Verdict:** Not recommended. Stripe IAP replacement is mandatory regardless, and once that native layer is built, a Capacitor wrapper provides minimal value while introducing review risk.

### Option C: SwiftUI Native

**What the backend already provides:**
- A complete REST API over HTTP/JSON — fully consumable by `URLSession` or `Alamofire`
- WebSocket server at `/ws` with a documented event protocol — consumable by `URLSessionWebSocketTask`
- Session-based auth can be replaced with JWT Bearer tokens by adding one new auth endpoint
- All game logic lives server-side; the client is a thin display layer

**What would need to be added to the backend:**
- JWT issuance endpoint (`POST /api/auth/token`) alongside the existing session system
- APNs device token registration endpoint (`POST /api/devices/apns-token`)
- Apple IAP receipt/transaction verification endpoint to replace Stripe webhooks
- Apple Sign In user creation/linking endpoint
- Possibly a server-sent notification endpoint or polling fallback for push when WebSocket is unavailable

**Native iOS advantages:**
- `UIImpactFeedbackGenerator` for instant haptic feedback on correct/wrong answers — this is a meaningful UX differentiator
- `URLSessionWebSocketTask` with automatic reconnection handling on network changes
- APNs for match invites and streak reminders delivered even when app is closed
- `ASAuthorizationAppleIDProvider` for Sign in with Apple (App Store requirement when any social login exists)
- `StoreKit 2` for IAP with automatic receipt validation and entitlement management
- `WKWebView` is not involved — full 120Hz ProMotion rendering on supported devices
- `WidgetKit` for a streak or leaderboard home screen widget
- `UserNotifications` for local daily-play reminders
- Deep links via Universal Links for lobby join codes and invite redemption

**Estimated effort:** 20-24 weeks for a 2-person iOS team (1 senior, 1 mid-level). Higher initial investment but produces the best-quality product.

**Verdict:** Recommended for long-term quality and App Store compliance.

### Option D: Capacitor + Native Modules

This hybrid adds Swift modules for IAP and push notifications to a Capacitor base. It combines the risks of both worlds: ongoing maintenance of a native module bridge, WebView performance ceiling, and App Store WebView scrutiny. The IAP native module alone requires nearly as much work as building a SwiftUI store screen. This approach does not provide meaningful savings over Option C given the mandatory IAP rewrite.

**Verdict:** Not recommended.

---

## Part 3 — Recommended Approach

**SwiftUI Native (Option C)** is the correct choice for PackPTS.

**Justification:**

1. Stripe must be replaced with Apple IAP regardless of approach — this is non-negotiable under App Store guideline 3.1.1. This represents the single largest engineering investment in any approach. That investment is sunk cost in a Capacitor wrapper but becomes a well-integrated native purchase flow in SwiftUI.

2. The game's core interaction model — show a card image, tap an answer, feel haptic feedback, see instant score animation — is exactly the interaction pattern where native rendering and haptics are perceptible to users. The competitive real-time 1v1 match screen will feel meaningfully better native than in a WebView.

3. The backend is already a clean REST + WebSocket server. The iOS app is a thin client. There is no complex business logic to rewrite — only UI and networking.

4. Sign in with Apple is required by the App Store when any third-party login is offered. WorkOS OAuth and local auth both need Apple Sign In added. This is a native-only capability.

5. The existing web app continues to serve desktop and Android web users without any changes. iOS becomes an additive native channel, not a replacement.

---

## Part 4 — Phase-by-Phase Implementation Roadmap

### Phase 0 — Backend Preparation (Weeks 1-2, before iOS work begins)

These backend changes are prerequisites for the iOS client. They do not affect existing web app behavior.

**Backend tasks:**

1. **JWT auth endpoint** — Add `POST /api/auth/token` that accepts `{usernameOrEmail, password}` and returns a signed JWT (access token, 15-minute expiry) and a refresh token (stored in `user_refresh_tokens` table, 30-day expiry). Add `POST /api/auth/refresh` and `POST /api/auth/revoke`. All existing session endpoints continue to work unchanged for the web client.

2. **Apple Sign In endpoint** — Add `POST /api/auth/apple` that accepts the Apple identity token, verifies it against Apple's public keys, creates or links a user account, and returns a JWT pair. Store the Apple user identifier in a new `apple_credentials` table alongside the existing `local_credentials` table.

3. **APNs device token registration** — Add `POST /api/devices/register` (authenticated) that stores `{deviceToken, platform: "apns", environment: "production"|"sandbox"}` in a `device_tokens` table. Add `DELETE /api/devices/:token` for deregistration on logout.

4. **APNs push dispatch infrastructure** — Add a Node.js APNs client (using the `apn` npm package or direct HTTP/2 to api.push.apple.com). Create a `pushService.ts` that dispatches notifications given a userId: look up their `device_tokens`, send via APNs, handle token expiry/removal. Integrate push dispatch at: friend match invite received, match accepted, streak reminder (via daily cron).

5. **Apple IAP verification endpoint** — Add `POST /api/iap/apple/verify` that accepts a StoreKit 2 signed transaction JWS, verifies it using Apple's App Store server API or the `node-apple-receipt-verify` library, and credits the user's wallet via the existing ledger service. This endpoint is the iOS equivalent of the Stripe webhook. Map Apple product IDs to PackPTS grant amounts in a new `apple_products` table mirroring the existing `products` table.

6. **CORS and auth middleware updates** — Ensure all API routes accept `Authorization: Bearer <token>` in addition to cookie sessions. The `isAuthenticated` middleware should check both. WebSocket upgrade should accept a JWT passed as a query parameter (`?token=<jwt>`) since native WebSocket cannot send custom headers on upgrade.

**Complexity:** Medium. Estimated 10-12 days of backend work with no regression risk to the web app.

---

### Phase 1 — Foundation (Weeks 3-6)

**Goal:** Working app skeleton with auth, navigation, and API connectivity.

**Xcode project setup:**
- Create new Xcode project: `PackPTS.xcodeproj`, bundle ID `com.packpts.game`
- Deployment target: iOS 16.0 (covers 96%+ of active devices, required for StoreKit 2 and async/await throughout)
- Swift Package Manager dependencies: no third-party networking library needed (URLSession is sufficient); add `Alamofire` only if team prefers it; add `SDWebImageSwiftUI` or `Kingfisher` for async card image loading with disk caching
- Enable capabilities: Push Notifications, Sign in with Apple, In-App Purchase

**Architecture pattern:** MVVM with `@Observable` (iOS 17+) or `ObservableObject` + `@StateObject` for iOS 16 compatibility. A single `AppState` object holds auth state and is injected into the environment at the root.

**Networking layer:**
- `APIClient.swift` — a structured `actor` wrapping `URLSession` with automatic JWT refresh, request/response logging, and typed error handling using Swift's `Result` type
- `WebSocketClient.swift` — wraps `URLSessionWebSocketTask` with automatic reconnection on `scenePhase` changes, JWT auth via query parameter on connect, and a Combine publisher or async stream for incoming events
- All API responses decode to Swift `Codable` structs mirroring the TypeScript types in `shared/schema.ts`

**Auth flow:**
- `AuthViewModel.swift` — handles login, registration, Apple Sign In, token storage in Keychain (`Security` framework, never `UserDefaults`)
- `SignInWithAppleButton` from `AuthenticationServices` on the login screen
- On first launch, check Keychain for stored refresh token; if present, silently refresh and proceed to main app; if absent, show auth screens

**Navigation:**
- `TabView` with 5 tabs: Play, Daily 5, Leaderboard, Friends, Profile
- Each tab backed by a `NavigationStack` for drill-down
- Deep link handling via `.onOpenURL` modifier at the root for lobby join links and invite codes

**Screens to build in Phase 1:**
- `LoginView` / `SignUpView` (username, email, password + Sign in with Apple button)
- `HomeView` (stats banner, mode selection cards: Solo, 1v1 Friend, Random Match)
- `ProfileView` (stats display, level progress, streak card)
- `LeaderboardView` (podium + scrollable list)
- Placeholder screens for remaining tabs

**Complexity:** Medium-High. The networking and auth infrastructure built here underpins every subsequent phase. Invest time getting token refresh and WebSocket reconnection right.

---

### Phase 2 — Core Game (Weeks 7-12)

**Goal:** Full solo game loop and 1v1 match play working end-to-end.

**Solo game flow:**
- `GameSetPickerView` — list of playable card sets from `GET /api/playable-sets`
- `SoloGameViewModel.swift` — manages session lifecycle: `POST /api/game/start`, `POST /api/game/answer`, `POST /api/game/next`; holds current question, score, answer state
- `GameCardView.swift` — the most technically complex screen. Loads the card image via `AsyncImage` or Kingfisher. Implements the name/caption masking overlay using SwiftUI `Canvas` or a `UIViewRepresentable` wrapping a `UIView` with `CALayer` mask — this replicates the `MaskedCardImage` canvas logic from the web. The mask covers the top 18% and bottom 38% of the card image by default, with per-set overrides fetched from the same `GET /api/cardhedge/mask-config/:setKey` endpoint.
- `AnswerButtonsView.swift` — 4 answer buttons; on selection triggers haptic feedback via `UIImpactFeedbackGenerator(.medium)` for correct answers and `UINotificationFeedbackGenerator` `.error` for wrong answers
- `PointsAnimationView.swift` — SwiftUI animation overlay replicating the web's points bounce animation, including fame/rarity breakdown display
- `GameResultView.swift` — end-of-game summary with score, accuracy, streak update

**1v1 lobby and match flow:**
- `LobbyViewModel.swift` — creates/joins lobbies via REST, then connects WebSocket and sends `join_lobby` message with `membershipSecret`; responds to `lobby_updated` events
- `LobbyView.swift` — shows join code with a share sheet (`ShareLink`), guest waiting state, and start button for host
- `MatchViewModel.swift` — full WebSocket message handler for match lifecycle: `join_match`, `submit_answer`, `ready_next`, `match_resync`. Handles the disconnect grace period and auto-submit timeout by displaying a countdown UI
- `MatchView.swift` — live opponent score display, question card, answer buttons, "waiting for opponent" indicator
- `MatchResultView.swift` — win/loss/tie screen with rematch option

**Random matchmaking:**
- `QueueView.swift` — "Finding opponent" spinner; sends `join_queue`, handles `match_ready` event to navigate to `MatchView`

**Image replacement:**
- On `AsyncImage` load failure, call `POST /api/game/session/:id/replace-card` and reload the card, mirroring the web's `GameCard` retry logic

**Haptic feedback map:**

| Event | Haptic |
|---|---|
| Correct answer | `UIImpactFeedbackGenerator(.medium)` |
| Wrong answer | `UINotificationFeedbackGenerator(.error)` |
| Match start | `UIImpactFeedbackGenerator(.heavy)` |
| Points earned (large) | `UINotificationFeedbackGenerator(.success)` |
| Tap answer button | `UISelectionFeedbackGenerator` |

**Complexity:** High. The card masking system and the WebSocket match state machine are the two hardest technical problems in the entire iOS project. Budget extra time here.

---

### Phase 3 — Daily 5, Friends, and Social (Weeks 13-15)

**Goal:** Daily challenge, friends system, and friend match invites fully operational.

**Daily 5:**
- `Daily5ViewModel.swift` — fetches status, starts challenge, submits answers, finishes, polls leaderboard
- `Daily5View.swift` — countdown timer when challenge is upcoming, card-by-card answer flow identical to solo but limited to 5 questions, results screen with rank and share sheet
- `Daily5LeaderboardView.swift` — day's results table

**Friends:**
- `FriendsViewModel.swift` — wraps friend list, pending requests, search, add, accept, decline, block, and friend match invite endpoints
- `FriendsView.swift` — tabbed: Friends list, Pending requests, Search users
- `FriendMatchInviteView.swift` — incoming invite modal (triggered by WebSocket `FRIEND_MATCH_INVITE` event) with Accept/Decline buttons and expiration countdown; presented as a `.sheet` over whatever screen the user is on

**Push notification handling for social events:**
- Register for push notifications on app launch (after auth)
- Handle APNs payloads for `FRIEND_MATCH_INVITE` — deep link to `FriendsView` with invite modal
- Handle `MATCH_ACCEPTED` — deep link directly to `MatchView` with the `matchId`
- Handle `STREAK_REMINDER` — deep link to `HomeView`

**Complexity:** Medium.

---

### Phase 4 — Monetization / In-App Purchase (Weeks 16-18)

This phase is the highest-compliance-risk portion of the project and must be completed correctly before App Store submission.

**StoreKit 2 integration:**

PackPTS sells two categories of digital goods:
1. Consumable point bundles (Starter, Pro, Legend packs) — map to StoreKit `consumable` product type
2. Subscription tiers (PRO, LEGEND access) — map to StoreKit `autoRenewableSubscription` product type

All digital goods sold through the iOS app must go through Apple IAP. The existing Stripe path must not appear in the iOS binary at all — even a visible Stripe purchase button in a web page opened inside the app will trigger App Store rejection.

**Product ID mapping:**

Define Apple product IDs in App Store Connect to match the existing SKUs. Suggested mapping:

| Web SKU | Apple Product ID | Type |
|---|---|---|
| `packpts-starter` | `com.packpts.game.packstarter` | Consumable |
| `packpts-pro-bundle` | `com.packpts.game.packpro` | Consumable |
| `packpts-legend-bundle` | `com.packpts.game.packlegend` | Consumable |
| `pro-monthly` | `com.packpts.game.sub.pro.monthly` | Auto-renewable subscription |
| `legend-monthly` | `com.packpts.game.sub.legend.monthly` | Auto-renewable subscription |

**StoreKit 2 purchase flow:**

1. `StoreKitManager.swift` — an `@Observable` class that loads products via `Product.products(for:)` on init, exposes the product list to the UI, and handles purchase via `product.purchase()`
2. On successful transaction: extract the JWS `signedTransactionInfo`, send it to `POST /api/iap/apple/verify` along with the user's JWT
3. Backend verifies the JWS signature against Apple's certificate chain, checks `productId`, `purchaseDate`, and `transactionId` for idempotency, then credits the wallet via the existing ledger service
4. The `StoreKit.Transaction.updates` async sequence must be observed on app launch to catch transactions completed outside the app (e.g., promoted IAPs, family sharing)
5. Subscription status is managed via `Product.SubscriptionInfo.status` — the app must check entitlement status on foreground to update tier-gated UI

**Store screen:**
- `StoreView.swift` — displays bundles and subscriptions fetched from both `GET /api/store/products` (for display metadata like images and descriptions) and `StoreKit` (for pricing in the user's local currency). Never hardcode prices — always display the StoreKit `displayPrice`.
- `SubscriptionView.swift` — subscription tier comparison, manage subscription link via `URL("itms-apps://...")` or `ManageSubscriptionsView` (iOS 15+)

**Restore purchases:**
- Provide a "Restore Purchases" button that calls `AppStore.sync()` and re-processes active subscription transactions

**Entitlement enforcement:**
- The backend is the authority on entitlements — the iOS app always fetches entitlement state from `GET /api/auth/user` or a dedicated `GET /api/entitlements` endpoint after any purchase event
- Do not rely solely on local StoreKit state for access control

**Complexity:** High. StoreKit 2's `async` purchase API is straightforward but the backend verification endpoint and idempotency handling require careful implementation. The App Store review process for IAP apps requires sandbox testing with test accounts before submission.

---

### Phase 5 — Native iOS Features (Weeks 19-21)

These features differentiate the native app from the web experience.

**Push Notifications (APNs):**
- Request authorization with `UNUserNotificationCenter.requestAuthorization(options: [.alert, .badge, .sound])`
- Request device token via `UIApplication.registerForRemoteNotifications()`
- Register token with backend via `POST /api/devices/register`
- Handle foreground notifications with `UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:)`
- Handle background tap-to-open with `userNotificationCenter(_:didReceive:)`

**Local Notifications (streak reminders):**
- Schedule a daily local notification at 8pm user local time: "You haven't played today — keep your streak alive!"
- Cancel the notification when the user completes a game that day (observable from the server's streak response)
- Reschedule each day on app launch if the user has an active streak

**Biometric Authentication:**
- On settings screen, offer "Use Face ID / Touch ID" toggle
- Store the preference in Keychain
- On app foreground after background > 5 minutes, require biometric re-authentication via `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`

**Deep Linking (Universal Links):**
- Register the domain (e.g., `packpts.gg`) as an associated domain in Xcode entitlements
- Add `apple-app-site-association` file to the web server at `/.well-known/apple-app-site-association`
- Handle paths: `/lobby?code=XXXXXX` (join lobby), `/invite?code=XXXXXX` (redeem invite), `/p/:token` (founders pass), `/match/:matchId` (join active match)

**Share Sheet integration:**
- Replace web clipboard copy for lobby join codes with native `ShareLink` component
- Share match results using `UIActivityViewController` with a pre-composed image (generated via `ImageRenderer` from a SwiftUI view showing the score summary)

**WidgetKit (Streak Widget):**
- Create a `PackPTSWidgetExtension` target
- `StreakWidget` — small widget showing current streak count and today's status (played/not played)
- Update widget data via `WidgetCenter.shared.reloadAllTimelines()` after each game completion
- Widget reads from an App Group shared `UserDefaults` container populated by the main app

**Complexity:** Medium. Each feature is well-documented in Apple frameworks. The main care is testing APNs in the production environment (not just simulator) before submission.

---

### Phase 6 — App Store Submission (Weeks 22-24)

See Part 7 for the full checklist. This phase is testing, metadata, and review process management.

---

## Part 5 — Backend Changes Required

### New Endpoints Summary

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/token` | Issue JWT access + refresh tokens |
| `POST` | `/api/auth/refresh` | Exchange refresh token for new access token |
| `POST` | `/api/auth/revoke` | Revoke refresh token (logout) |
| `POST` | `/api/auth/apple` | Sign in with Apple — create/link account, return JWT |
| `POST` | `/api/devices/register` | Store APNs device token |
| `DELETE` | `/api/devices/:token` | Remove APNs device token on logout |
| `POST` | `/api/iap/apple/verify` | Verify StoreKit 2 JWS transaction, credit wallet |
| `GET` | `/api/iap/apple/products` | Return Apple product ID to metadata mapping |
| `POST` | `/api/iap/apple/subscription/status` | Verify subscription renewal status |

### Middleware Updates

- `isAuthenticated` must check `Authorization: Bearer <token>` header, not just cookie session. A single middleware can try cookie first, then Bearer token, making it backward-compatible.
- WebSocket upgrade handler must accept `?token=<jwt>` query parameter as an alternative to session cookie.

### WebSocket Adjustments

No structural WebSocket changes are required. The event schema is already clean JSON and works identically for a native client. The only addition is the JWT-based auth on upgrade described above.

### APNs Integration

The server needs:
- A `device_tokens` table: `(id, user_id, token, platform, environment, created_at, last_seen_at)`
- `pushService.ts` using the `apn` npm package configured with an APNs Auth Key (`.p8` file) — not a certificate, as the Auth Key does not expire
- Push dispatch called from: `friendMatchInviteService` (on invite creation), `matchService` (on match acceptance), a daily cron job for streak reminders

---

## Part 6 — In-App Purchase Migration Plan

### Compliance Requirement

App Store Review Guideline 3.1.1 states: "If you want to unlock features or functionality within your app... you must use in-app purchase." Digital goods including virtual currency (PackPTS points) and access entitlements (PRO/LEGEND tiers) are digital goods. Stripe may not be used for these purchases inside an iOS app binary.

The web app's Stripe store remains fully functional for web users. This is permitted — Apple only controls purchases made through the iOS app binary.

### Migration Architecture

**Current web flow:**
1. User taps "Buy" in web store
2. Client calls `POST /api/store/checkout` → returns Stripe Checkout URL
3. Browser redirects to `stripe.com`
4. User pays, Stripe sends webhook to `/api/webhooks/stripe`
5. Webhook handler credits wallet via ledger service

**New iOS flow:**
1. User taps "Buy" in iOS StoreKit store screen
2. App calls `product.purchase()` via StoreKit 2
3. Apple handles payment UI natively
4. On `Transaction.verified` result: app sends JWS transaction to `POST /api/iap/apple/verify`
5. Backend verifies JWS against Apple's certificates, checks idempotency key (`transactionId`), credits wallet via the same existing ledger service
6. App receives confirmation, updates UI

**Key implementation detail — transaction listener:** The `StoreKit.Transaction.updates` sequence must be observed in a long-lived task started at app init. This catches:
- Purchases completed in the background
- Promoted in-app purchases initiated from the App Store app itself
- Family sharing grants
- Subscription renewals that occur while the app is not running (these arrive when the app next launches)

**Subscription management:** Auto-renewable subscriptions renew automatically via Apple. The backend entitlement is kept current by the iOS app checking `Product.SubscriptionInfo.status` on each app foreground and syncing with `POST /api/iap/apple/subscription/status` to update the user's entitlement record.

**Apple's 30% commission:** Apple takes 30% of the purchase price (15% for small business program and subscription renewals after year 1). Pricing for IAP products must be set in App Store Connect using Apple's price tiers. Existing Stripe prices will need to be adjusted to maintain desired margin. This is a business decision, not a technical one, but must be completed before Phase 4.

**Prohibited:** The iOS app binary must not contain any Stripe SDK, Stripe Checkout URL, or any web page that accepts payment for digital goods. The admin panel (which is web-only and gated behind `requireAdmin`) is fine to exist but must not be reachable from the consumer-facing iOS app.

---

## Part 7 — Push Notification Architecture (APNs)

### Device Token Lifecycle

1. App launches → request notification permission → if granted, `UIApplication.registerForRemoteNotifications()` → `AppDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` returns a token
2. App sends token to `POST /api/devices/register` with the user's JWT
3. On logout: app calls `DELETE /api/devices/:token` and locally clears the stored token
4. The `device_tokens` table stores multiple tokens per user (same user on multiple devices)

### Notification Types and Payloads

**Friend match invite** (`FRIEND_MATCH_INVITE`):
```json
{
  "aps": {
    "alert": { "title": "Match Invite", "body": "champ99 challenged you to a 1v1!" },
    "sound": "default",
    "badge": 1
  },
  "type": "FRIEND_MATCH_INVITE",
  "inviteId": "<uuid>",
  "fromUsername": "champ99"
}
```

**Match accepted** (`MATCH_ACCEPTED`):
```json
{
  "aps": {
    "alert": { "title": "Match Starting", "body": "champ99 accepted your challenge!" },
    "sound": "default"
  },
  "type": "MATCH_ACCEPTED",
  "matchId": "<uuid>",
  "lobbyId": "<uuid>"
}
```

**Streak reminder** (`STREAK_REMINDER`) — local notification scheduled by the app, not pushed from server unless the user has opted in to server-side reminders:
```json
{
  "aps": {
    "alert": { "title": "Keep Your Streak!", "body": "Play one game today to keep your streak alive." },
    "sound": "default"
  },
  "type": "STREAK_REMINDER"
}
```

### Silent push for data sync

For background data refresh (e.g., new Daily 5 challenge available), use a silent push with `content-available: 1`. The app's `BGAppRefreshTask` handler fetches updated state. Silent pushes do not display to the user and do not require permission.

---

## Part 8 — Sign in with Apple Integration Plan

### Requirement

The App Store requires Sign in with Apple when any third-party authentication is offered. PackPTS currently offers WorkOS OAuth (social login via WorkOS). Therefore Sign in with Apple is mandatory before submission.

### iOS Client Implementation

```swift
// In LoginView.swift
SignInWithAppleButton(.signIn, onRequest: { request in
    request.requestedScopes = [.fullName, .email]
}, onCompletion: { result in
    switch result {
    case .success(let authorization):
        authViewModel.handleAppleSignIn(authorization)
    case .failure(let error):
        // handle error
    }
})
.signInWithAppleButtonStyle(.white)
.frame(height: 50)
```

`AuthViewModel.handleAppleSignIn` extracts the `ASAuthorizationAppleIDCredential`, sends the `identityToken` (a JWT) and `authorizationCode` to `POST /api/auth/apple`, receives a PackPTS JWT pair in response, stores in Keychain, and transitions to authenticated state.

### Backend Implementation

The `POST /api/auth/apple` endpoint:
1. Receives `{identityToken, authorizationCode, fullName?, email?}`
2. Verifies `identityToken` by fetching Apple's public keys from `https://appleid.apple.com/auth/keys` and validating the JWT signature and claims (`iss`, `aud`, `exp`)
3. Extracts the stable `sub` field (Apple user ID) — this is the persistent identifier
4. Looks up `apple_credentials` table by Apple user ID
5. If found: return JWT for the linked PackPTS user
6. If not found and `email` is provided (only provided on first sign-in): create new user, create `apple_credentials` record, return JWT
7. If not found and no email: return 409 with `{error: "apple_account_not_linked"}` — the iOS app should prompt the user to link via email/password

**Important:** Apple only provides the user's email and name on the very first authorization. After that, `email` and `fullName` are null. The backend must store whatever is provided on first sign-in. Users who revoke and re-authorize will present a null email — handle this gracefully.

### Credential State Monitoring

On app foreground, check `ASAuthorizationAppleIDProvider().getCredentialState(forUserID:)`. If state is `.revoked`, log the user out and clear Keychain. If `.notFound`, treat as logged out.

---

## Part 9 — App Store Submission Checklist

### Apple Developer Account

- [ ] Apple Developer Program membership active ($99/year)
- [ ] App ID registered at developer.apple.com: `com.packpts.game`
- [ ] Capabilities enabled on App ID: Push Notifications, Sign in with Apple, In-App Purchase
- [ ] APNs Auth Key (`.p8`) created and downloaded for push notification sending
- [ ] Associated Domains entitlement configured for Universal Links

### App Store Connect Setup

- [ ] App record created in App Store Connect with bundle ID `com.packpts.game`
- [ ] Age rating questionnaire completed — expected rating 4+ (no violence, no gambling mechanics if sweepstakes are declared as skill-based)
- [ ] Privacy policy URL entered (must be a live URL — the existing `/privacy-policy` page qualifies if updated for iOS data collection)
- [ ] Terms of service URL entered
- [ ] All IAP products created and submitted for review: consumable bundles + auto-renewable subscriptions
- [ ] Subscription group created with a clear group name (e.g., "PackPTS Subscription")
- [ ] Screenshots prepared: iPhone 6.9" (iPhone 16 Pro Max), iPhone 6.5" (iPhone 14 Plus), iPad Pro 12.9" (if iPad supported)
- [ ] App preview video (optional but recommended for a game)
- [ ] App description, keywords, and promotional text written (no competitor names, no superlatives without substantiation)
- [ ] Support URL provided
- [ ] Marketing URL provided

### Privacy Nutrition Labels (required)

Based on the data collected by PackPTS, the following must be declared under "Data Used to Track You" and "Data Linked to You":

**Data Linked to You:**
- Contact Info: Email address (collected at registration)
- Identifiers: User ID (assigned internally)
- Usage Data: Gameplay data, answer history, session data
- Purchases: Purchase history if IAP is used

**Data Not Linked to You (if applicable):**
- Diagnostics: Crash data (if using Crashlytics or similar)

**Data Used to Track You:** None (if no cross-app advertising is used). If UTM attribution tracking is retained in the iOS app, declare accordingly.

### Code Signing and Build

- [ ] Production provisioning profile created with all required capabilities
- [ ] App signed with Distribution certificate
- [ ] Bitcode disabled (deprecated in Xcode 14+, remove if present)
- [ ] `NSUserTrackingUsageDescription` added to `Info.plist` if ATT tracking is used (not required if no advertising)
- [ ] `NSFaceIDUsageDescription` added to `Info.plist` if biometric auth is offered: "PackPTS uses Face ID to quickly and securely sign you in."
- [ ] `NSUserNotificationsUsageDescription` is not a real key — usage strings are handled by `UNUserNotificationCenter` at runtime, no plist key required

### Technical Requirements

- [ ] No use of private APIs (App Store review scans for this)
- [ ] No calls to `UIDevice.identifierForVendor` stored on the server for tracking purposes
- [ ] No Stripe SDK present in the binary
- [ ] No web pages that accept payment for digital goods accessible from within the app
- [ ] Sign in with Apple button meets Apple's design guidelines (correct size, no modification of the Apple logo)
- [ ] Sign in with Apple button displayed at least as prominently as any other login method
- [ ] Sandbox IAP testing completed with at least 3 test accounts across all product tiers
- [ ] Push notification sandbox testing completed on a physical device (simulator does not support APNs)
- [ ] App does not crash on launch on iOS 16.0 (minimum deployment target)
- [ ] App tested on iPhone SE (smallest supported screen) and iPhone 16 Pro Max (largest)
- [ ] All network calls use HTTPS (ATS — App Transport Security — is enforced by default)
- [ ] WebSocket connects to `wss://` not `ws://` in production

### Guideline Compliance Notes

**Guideline 3.1.1 — In-App Purchase:** All digital goods sold through the iOS binary must use IAP. The web Stripe store is permitted to continue operating. Do not link to the web store from within the iOS app for purposes of completing a digital purchase.

**Guideline 4.2 — Minimum Functionality:** The app must function as a native app, not a thin wrapper. The SwiftUI approach satisfies this.

**Sweepstakes / Prize Mechanics (Guideline 5.2.2 and local laws):** PackPTS awards PackPTS points redeemable for physical collectibles. If points can be redeemed for items of real monetary value through gameplay alone (without any purchase), this is a skill-based contest, not gambling. Consult with a lawyer familiar with sweepstakes law in all markets where the app will be distributed. The app may need to be unavailable in certain states or countries where skill-based prize contests are regulated. This affects the geo-restriction feature already in the backend (`/api/admin/geo`). The App Store rating questionnaire will ask about prize/monetary rewards — answer accurately; misrepresentation is a common cause of post-launch removal.

**Guideline 1.1 — Objectionable Content:** None anticipated.

**User-generated content:** Usernames are user-generated. The existing moderation/ban system on the backend satisfies the minimum requirement, but review the guideline for any additional requirements.

### Pre-Submission Testing

- [ ] TestFlight build distributed to internal testers (minimum 5 testers who cover iPhone SE, standard iPhone, iPhone Pro Max)
- [ ] Full gameplay loop tested: register, solo game, 1v1 match, Daily 5, purchase, redeem
- [ ] Push notifications tested on physical devices (both sandbox and production APNs environments)
- [ ] All IAP products purchased in sandbox, wallet credited correctly
- [ ] Subscription subscribe, cancel, and restore tested in sandbox
- [ ] Deep links tested: lobby join, invite code, match direct join
- [ ] Sign in with Apple tested on a device with a real Apple ID
- [ ] App reviewed against App Store Review Guidelines checklist (publish internally before submitting)

---

## Part 10 — Estimated Complexity by Phase

| Phase | Weeks | Complexity | Key Risk |
|---|---|---|---|
| 0 — Backend Preparation | 1-2 | Medium | JWT middleware must not break existing web sessions |
| 1 — Foundation | 3-6 | Medium-High | Token refresh + WebSocket reconnection reliability |
| 2 — Core Game | 7-12 | High | Card masking canvas implementation; match WebSocket state machine |
| 3 — Daily 5 and Social | 13-15 | Medium | Friend invite push + in-app modal coordination |
| 4 — Monetization / IAP | 16-18 | High | Apple review of IAP products; pricing tier decisions |
| 5 — Native iOS Features | 19-21 | Medium | APNs sandbox/production environment difference |
| 6 — App Store Submission | 22-24 | Medium | Review process unpredictability; metadata preparation |

**Total calendar time:** 22-24 weeks (approximately 5-6 months) with a 2-person iOS team assuming the backend preparation runs in parallel with Phase 1 iOS work.

---

## Part 11 — Risks and Mitigations

### Risk 1: App Store rejection for IAP non-compliance

**Likelihood:** High if Stripe is present in any form.
**Impact:** Submission blocked entirely.
**Mitigation:** Review the entire binary before submission. Use a tool like `strings` on the compiled binary to verify no Stripe domain names appear. Confirm no web view in the app can navigate to a Stripe-hosted checkout page. Keep the store web URL (`/store`) inaccessible from the iOS app navigation.

### Risk 2: Sign in with Apple implementation defects

**Likelihood:** Medium. The first-sign-in / subsequent-sign-in email handling is a common source of bugs.
**Impact:** Users locked out; App Store rejection.
**Mitigation:** Test with multiple Apple ID accounts. Test revoke-and-reauthorize flow explicitly. Store the Apple user `sub` immediately on first authorization before any downstream operations can fail.

### Risk 3: WebSocket reliability on iOS background/foreground transitions

**Likelihood:** High. iOS aggressively suspends network connections when apps background.
**Impact:** Match drops, stale match state, user frustration during 1v1 play.
**Mitigation:** The `WebSocketClient` must detect `scenePhase == .background` and cleanly disconnect. On return to foreground, reconnect and send `match_resync` immediately. The backend already handles `match_resync` — the iOS client must request a full state refresh on every reconnect, not assume state is current.

### Risk 4: Card image masking performance

**Likelihood:** Medium. Real-time canvas pixel operations on large card images can drop below 60fps.
**Impact:** Visible stutter during gameplay; poor user experience.
**Mitigation:** Pre-compute the mask as a static `CALayer` mask rather than per-frame pixel manipulation. The mask is a solid overlay in two rectangular regions — this can be implemented as two `Color` overlay views in SwiftUI with no canvas rendering at all, which is far more performant. The `MaskedCardImage` web implementation uses canvas for generality; the iOS version can use simpler geometry since the mask shapes are rectangles.

### Risk 5: Sweepstakes/prize legal exposure

**Likelihood:** Unknown — depends on how point redemption is classified.
**Impact:** App Store removal post-launch; legal exposure in certain jurisdictions.
**Mitigation:** Engage a sweepstakes attorney before submission. Implement geo-blocking for jurisdictions where skill-based prize contests are prohibited. Ensure the prize mechanic is clearly described in the app description and age rating questionnaire responses.

### Risk 6: Apple 30% IAP commission impact on unit economics

**Likelihood:** Certain — Apple always takes commission.
**Impact:** Existing Stripe-based pricing yields less revenue per transaction on iOS if prices are kept the same.
**Mitigation:** Adjust iOS App Store pricing tiers upward to maintain the same net revenue per transaction, or absorb the margin reduction as a customer acquisition cost for the iOS channel. This must be decided before the IAP products are created in App Store Connect.

### Risk 7: Session-based auth conflicts during transition period

**Likelihood:** Low if implementation is careful.
**Impact:** Web users inadvertently affected by backend auth middleware changes.
**Mitigation:** The JWT middleware must be strictly additive — check the `Authorization` header only if no valid session cookie is present. Extensive regression testing of the web app login flow after backend Phase 0 changes are deployed.

### Risk 8: Daily 5 timezone handling

**Likelihood:** Medium. The Daily 5 challenge is time-gated server-side. The iOS app needs to display the correct challenge window in the user's local time.
**Impact:** Confusing UX where challenge appears open on web but closed in iOS (or vice versa).
**Mitigation:** Always use server timestamps for challenge windows. Display countdown timers in the user's device locale using `DateComponentsFormatter`. Never compute challenge availability client-side.

---

## Appendix A — Files the iOS Agent Should Reference

The following existing web files contain the source of truth for game mechanics and API contracts that the iOS agent must implement against:

- `/shared/schema.ts` — all data model types (translate to Swift `Codable` structs)
- `/server/websocket.ts` — complete WebSocket message protocol
- `/server/routes.ts` — all REST API endpoints and their request/response shapes
- `/client/src/pages/game.tsx` — solo game state machine reference implementation
- `/client/src/pages/match.tsx` — 1v1 match state machine reference implementation
- `/client/src/pages/daily5.tsx` — Daily 5 challenge flow reference
- `/client/src/components/GameCard.tsx` — card masking logic (translate to SwiftUI overlay approach)
- `/client/src/hooks/useWebSocket.ts` — WebSocket hook (translate to `WebSocketClient.swift` actor)

## Appendix B — Suggested Xcode Target Structure

```
PackPTS.xcodeproj
├── PackPTS (main app target)
│   ├── App/
│   │   ├── PackPTSApp.swift
│   │   └── AppDelegate.swift
│   ├── Core/
│   │   ├── Networking/
│   │   │   ├── APIClient.swift
│   │   │   ├── WebSocketClient.swift
│   │   │   └── Models/         (Codable response types)
│   │   ├── Auth/
│   │   │   ├── AuthManager.swift
│   │   │   ├── KeychainService.swift
│   │   │   └── AppleSignInHandler.swift
│   │   ├── Store/
│   │   │   └── StoreKitManager.swift
│   │   └── Push/
│   │       └── PushNotificationHandler.swift
│   ├── Features/
│   │   ├── Auth/
│   │   ├── Home/
│   │   ├── Game/
│   │   ├── Match/
│   │   ├── Daily5/
│   │   ├── Leaderboard/
│   │   ├── Friends/
│   │   ├── Profile/
│   │   └── Store/
│   └── Shared/
│       ├── Components/      (reusable SwiftUI views)
│       └── Extensions/
├── PackPTSWidget (WidgetKit extension target)
│   ├── StreakWidget.swift
│   └── WidgetBundle.swift
└── PackPTSTests
    └── ...
```
