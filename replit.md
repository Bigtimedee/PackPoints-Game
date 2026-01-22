# PackPoints

## Overview
PackPoints is a card-collecting gaming platform where users identify baseball players from card images to earn points. It features solo, 1v1, and tournament game modes, a global leaderboard, and a marketplace. Users can redeem earned points for credits on platforms like Goldin Auctions and eBay. The project aims to deliver an engaging baseball card recognition experience with robust monetization and user retention capabilities.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, and shadcn/ui for UI components. State management is handled by TanStack React Query. The design system emphasizes a mobile-first, responsive, and gaming-inspired aesthetic, supporting both dark and light themes.

### Backend
The backend utilizes Node.js, Express, and TypeScript, exposing RESTful JSON endpoints. It uses esbuild for bundling and Drizzle ORM with PostgreSQL for data persistence, validated by Zod schemas. Key functionalities include user authentication, game session management, point calculation, and admin tooling. Real-time 1v1 game modes are facilitated through WebSockets for lobbies, matchmaking, and secure game logic.

### Card Image System
Baseball card images are primarily sourced from the Card Hedge API, with player names masked during gameplay. Admin tools support synchronization of card data.

### CardHedge Card Details API
A dedicated integration for fetching detailed card metadata, pricing, and sales history by card ID:
- **Public Endpoint**: `GET /api/cardhedge/card/:cardId?rawImagesOnly=true|false` - Returns normalized card details with caching
- **Gameplay Endpoint**: `GET /api/cardhedge/gameplay-image/:cardId` - Optimized for gameplay, prefers raw images
- **Admin UI**: `/admin/cardhedge-card` - Test interface with card preview, sales data, and JSON inspector
- **Database Cache**: `card_details_cache` table provides persistent caching with configurable TTL
- **Rate Limiting**: 30 req/min/IP for public endpoint, 60 req/min for gameplay endpoint
- **Normalized Response**: cardId, description, player, set, number, variant, category, imageUrl, rookie, sales7d, sales30d, gain, prices, raw
- **Error Handling**: Falls back to stale cache if API fails; returns 503 CARD_DATA_TEMPORARILY_UNAVAILABLE otherwise
- **Env Vars**: CARDHEDGE_CACHE_TTL_SECONDS (default: 600)

### CardHedge Card Search API
A searchable card discovery system for admin card discovery, playable set ingestion, and fame scoring signals:
- **Admin Endpoint**: `POST /api/admin/cardhedge/search` - Search cards with filters and pagination
- **Admin UI**: `/admin/card-search` - Search interface with filters, results grid, and pagination controls
- **Database Cache**: `cardhedge_search_cache` table stores search results with configurable TTL (default: 300s)
- **Rate Limiting**: 120 req/min per admin user
- **Request Body**: `{ search, set, category, player, rookie, raw_images_only, page, page_size }`
- **Validation**: page >= 1, page_size <= 100, max string length 120 chars, empty strings coerced to null
- **Normalized Response**: `{ pages, count, cards: [{cardId, description, player, set, number, variant, category, imageUrl, sales7d, sales30d, gain, prices, raw}] }`
- **Gameplay Helper**: `getPlayableCardSearchResults()` - For seeding playable card pools, fame scoring input, and difficulty weighting
- **Error Handling**: Falls back to stale cache on API failure, returns 503 CARDHEDGE_UNAVAILABLE otherwise

### Card Image Quality Control
A user reporting and admin review workflow addresses Card Hedge API data quality issues where wrong sport images may be returned:
- **User Reporting**: Players can report wrong images during gameplay with reasons: wrong_sport, wrong_player, wrong_set, bad_image, other
- **Automatic Flagging**: Cards with 3+ reports are automatically flagged for admin review
- **Admin Review**: Endpoints to list flagged cards, view reports, approve (keeps playable) or reject (disables with reason)
- **Database Fields**: `image_review_status` (pending/approved/rejected), `report_count`, `blocked_reason` on playable_cards
- **Reports Table**: `card_image_reports` tracks individual reports with timestamps and reporter info
- **Frontend Filter**: Game UI filters to only show card sets with imported cards (cardsImportedCount > 0)

### Monetization & Wallet
The platform incorporates a ledger-first wallet for tracking user points (PackPTS) with various transaction types. A product catalog defines purchasable items. A tiered membership system (Free, Pro, Legend) provides feature access and point multipliers, enforced by match tokens and daily quotas. A bucket-based expiration system manages point lifecycles, ensuring earlier-earned points are spent first.

### Authentication and Identity Linking
The system supports multi-provider authentication (Replit Auth, WorkOS, local) with a secure identity linking mechanism to prevent account takeovers. High-value accounts require magic-link verification for certain actions.

### Founders Cap Access Control
An access control system limits active users to a configurable cap, featuring a waitlist and invite code mechanism for managing new user onboarding and reserved seats.

### Founders Pass Viral Invite System
A referral system where active Founders receive a shareable pass link. This system handles token security, redemption flow, automatic pass issuance, and global deactivation when a user cap is reached.

### Admin Tools
Comprehensive admin tools provide management capabilities for users, wallets (PackPTS adjustments), entitlements, feature flags, and audit logging. It also includes a metrics dashboard for key performance indicators.

### Redemption System
A closed-loop redemption system allows conversion of PackPTS into store credit with non-linear tier pricing. Redemptions above a certain threshold require admin approval.

### Analytics System
An event tracking system logs key user actions to an `event_log` table, providing extensibility for future analytics integrations.

### Geo Intelligence System
A privacy-safe geolocation tracking system infers user home states for market analysis. It uses IP hashing for privacy, integrates with ipinfo.io, and infers home states based on session patterns, including VPN detection.

### Store & PackPTS Purchase System
Integrated with Stripe, this system manages both one-time PackPTS bundle purchases and monthly subscription packages, with admin interfaces for subscription product management.

### Store Package Profit Guardrails
A validation system that ensures PackPTS package profitability before admin creation, with automatic margin ledger tracking:
- **Admin UI**: `/admin/package-guardrails` - Three-tab interface (Calculator, Policy, Fees) with live profit preview
- **Decision States**: PASS (green), WARN (requires confirmation), BLOCK (cannot save unless override enabled)
- **Sales Channels**: web_stripe (2.9% + $0.30), ios_iap (30% platform fee), android_iap (15% platform fee)
- **Business Math**:
  - Processor fees = priceCents × feeRate + feeFixedCents
  - Platform fees = priceCents × platformFeeRate
  - Net revenue = priceCents - processorFees - platformFees
  - Redemption cost = ptsGrant × maxValuePerPtMicrousd / 10000
  - Gross margin = (netRevenue - redemptionCost) / netRevenue
  - Implied value/pt = priceCents × 100 / ptsGrant (in microusd)
  - Margin contribution = netRevenue × reserveRate
- **Policy Settings**: minMarginRate (30%), warnMarginBand (5%), maxValuePerPtMicrousd (2000 = $0.002/pt), reserveRate (100%)
- **Database Tables**: store_fee_profiles, store_package_policy, store_package_validations
- **Margin Ledger Integration**: Automatically records PACKPTS_SALE entries on Stripe purchase completion
- **Startup Seeding**: Default policy and fee profiles created via seedPackageGuardrailConfig()

### Profit Guardrail & Marketplace Redemptions
A profit guardrail system ensures minimum profitability for PackPTS redemptions on external marketplace purchases (eBay/Goldin), applying business math formulas to calculate maximum redeemable points.

### Treasury-Backed Margin Pool System
A financial backing system that ensures a real margin is maintained on every PackPTS redemption for marketplace purchases. It tracks available margin from revenue sources and enforces redemption limits based on a dynamically calculated margin pool.

### Live Listings Marketplace
A unified marketplace search feature aggregates listings from eBay and Goldin Auctions. It supports context-aware filtering based on game sets, affiliate tracking, outbound click logging, and in-memory rate limiting.

### Non-Linear Reward System
A fame-based point calculation system that awards more PackPTS for identifying obscure players and fewer for famous players:
- **Formula**: `basePts = minPts + (maxPts - minPts) * (1 - fame_score^gamma)` where default gamma=2.0
- **Point Range**: 100-200 pts base (obscure players get up to 200pts, famous players get 100pts)
- **Vintage Multipliers**: Pre-1980: 1.15x, 1980-1999: 1.05x, 2000-2019: 1.0x, 2020+: 0.9x
- **Rarity Multipliers**: Base: 1.0x, Insert: 1.1x, Parallel: 1.2x, SP: 1.3x
- **Caps**: Daily 5000pts, per-match 1000pts enforced at award time
- **Database Tables**: reward_policy, player_fame, points_awards, user_points_counters, internal_player_stats
- **Admin Endpoints**: Policy management, player fame overrides, audit logs, fame recomputation
- **Player Stats Tracking**: Records correct/incorrect responses per player to compute fame scores from gameplay data

### Financial Guardrails & Fraud Prevention
A multi-layered system to prevent revenue loss and abuse through user risk tracking, chargeback handling, and pattern-based fraud detection:
- **User Risk States**: NORMAL, UNDER_REVIEW, FROZEN status tracked in `user_risk_state` table
- **Earning Path Enforcement**: Both FROZEN and UNDER_REVIEW statuses block all PackPTS earning:
  - Wallet service `earn()` method blocks frozen/under-review users
  - Streak service `processMatchCompletion()` blocks frozen/under-review users
  - Reward engine `checkAndAwardMatchPoints()` blocks frozen/under-review users
  - Stripe purchases (`purchaseCredit`) are NOT blocked (paid transactions still allowed)
- **Chargeback Handling**: Stripe webhook automatically sets FROZEN status on `charge.dispute.created` events and records risk signals
- **Risk Signals**: Tracked in `risk_signals` table for patterns like repeat_pairing, fast_response, high_volume_gameplay
- **Risk Engine**: Pattern detection service analyzes gameplay behavior for suspicious activity
- **Admin Endpoints**: Freeze/unfreeze users at `/api/admin/risk/:userId/freeze`, list frozen users, view risk signals
- **Frontend Integration**: Frozen/under-review accounts display shield warning in header
- **Database Tables**: user_risk_state, risk_signals, risk_actions, match_points_counters, gameplay_events
- **Stripe Integration**: Records STRIPE_REFUND and STRIPE_DISPUTE signals in risk_signals table

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **Drizzle Kit**: For database schema migrations.

### Frontend Libraries
- **Radix UI**: Accessible UI component primitives.
- **Embla Carousel**: Carousel functionality.
- **Recharts**: Data visualization.
- **Lucide React & React Icons**: Icon libraries.

### Backend Libraries
- **connect-pg-simple**: PostgreSQL-backed session storage.
- **express-session**: Session management.
- **zod**: Runtime validation.

### Build & Development
- **Vite**: Frontend build tool.
- **Replit Plugins**: Replit environment integrations.
- **esbuild**: Backend bundling.

### Payment & Billing
- **Stripe**: Payment processing for purchases and webhook management.

### Third-party APIs
- **Card Hedge API**: Primary source for baseball card images.
- **Zyla API**: Fallback for card images.
- **eBay Browse API**: Live listing search for marketplace integration.
- **Goldin Auctions**: Curated listings integrated via admin interface.
- **ipinfo.io**: Geolocation data provider.
- **WorkOS**: For multi-provider authentication.
- **Nodemailer**: For sending password reset and magic link emails.