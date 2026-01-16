# PackPoints

## Overview
PackPoints is a card-collecting gaming platform where users guess baseball players from card images to earn points. It offers solo, 1v1, and tournament game modes, a leaderboard, and a marketplace for redeeming points for credits on platforms like Goldin Auctions and eBay. The project aims to provide an engaging gaming experience focused on baseball card recognition and collection with strong monetization and retention features.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend uses React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, and shadcn/ui for components. State management uses TanStack React Query. The design system supports dark/light themes, specific fonts, and is mobile-first, responsive, and gaming-inspired.

### Backend
The backend is built with Node.js, Express, and TypeScript, providing RESTful JSON endpoints. It uses esbuild for optimization and Drizzle ORM with PostgreSQL for data storage, validated by Zod. Key features include user authentication (Replit Auth, local), game session management, point calculation, and admin tools. Real-time 1v1 games are supported via WebSockets for lobbies, matchmaking, and secure game logic.

### Card Image System
Baseball card images are sourced from the Card Hedge API and verified CDN URLs. The system masks player names during gameplay. Admin endpoints facilitate card data synchronization.

### Monetization & Wallet
A ledger-first wallet tracks user points (PackPTS) with various entry types (EARN, SPEND, ADJUST, PURCHASE_CREDIT, REVERSAL). A product catalog defines purchasable items. A tier system (Free, Pro, Legend) gates access to features and multipliers, enforced by match tokens and daily quotas. A bucket-based expiration system manages point lifecycles, spending points from earliest-expiring buckets first.

### Authentication and Identity Linking
The system supports multi-provider authentication (Replit OAuth, WorkOS, local) with a secure identity linking system to prevent account takeover. It includes a three-case OAuth callback flow for existing identities, email collisions, and new user creation, requiring proof of ownership for linking. High-value accounts (e.g., those with significant PackPTS or Stripe customer IDs) require magic-link verification for linking or certain actions. A password reset system is also implemented.

### Founders Cap Access Control
An access control system limits active users to a configurable cap with waitlist and invite code mechanisms. It features reserved seats for invite code holders, atomic activation using database locks, and email normalization for unique users.

### Founders Pass Viral Invite System
A viral referral system where each active Founder receives a one-time shareable pass link. Key components:
- **Token Security**: SHA-256 hashing with secret pepper (FOUNDERS_PASS_PEPPER env var)
- **Pass Flow**: GET /p/:token → stores hash in session → POST /api/founders-pass/redeem → approved → registration consumes pass atomically
- **Auto-Issuance**: New passes automatically issued to activated Founders while cap is not reached
- **Global Deactivation**: All remaining passes deactivated when 500th user activates
- **Database Tables**: `founders_pass` (stores pass metadata), `founders_pass_events` (audit trail)
- **Frontend Components**: `/redeem` page for invited users, FoundersPassCard on profile, FoundersCounter on landing page
- **Admin Endpoints**: List passes, deactivate-all, view events

### Admin Tools
Comprehensive admin tools provide user, admin, wallet (PackPTS adjustment), and entitlement management. It includes feature flags, audit logging, and a metrics dashboard for DAU, conversion, and PackPTS liability.

### Redemption System
A closed-loop redemption system allows conversion of PackPTS into store credit with non-linear tier pricing. Redemptions above a certain threshold require admin approval. The system ensures idempotency and provides secure credit tokens for store checkout.

### Analytics System
An event tracking system via `analyticsService` logs key user actions (e.g., `match_started`, `pts_earned`, `purchase_completed`) to an `event_log` table, with an extensible dispatcher for future integrations.

### Store & PackPTS Purchase System
Integrated with Stripe, this system handles both one-time PackPTS bundle purchases and monthly subscription packages. Key components:
- **One-Time Bundles**: PACKPTS_1500, PACKPTS_6000, PACKPTS_15000 for instant PackPTS credit
- **Monthly Subscriptions**: PACKPTS_MONTHLY_500 ($4.99/mo), PACKPTS_MONTHLY_2000 ($14.99/mo), PACKPTS_MONTHLY_5000 ($29.99/mo)
- **Product Map**: `productMap.ts` defines all products with type, priceUsd, packptsGrant, and billingInterval
- **Subscription Checkout**: Creates Stripe subscription-mode sessions with metadata for webhook processing
- **Webhook Handler**: `invoice.paid` event credits PackPTS for subscription renewals using idempotency keys
- **Store UI**: Tabbed interface separating one-time purchases from monthly subscriptions
- **API Endpoints**: GET /api/store/subscriptions, POST /api/store/subscribe (authenticated)

## External Dependencies

### Database
- **PostgreSQL**: Primary database.
- **Drizzle Kit**: For database schema migrations.

### Frontend Libraries
- **Radix UI**: Accessible component primitives.
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
- **Stripe**: Payment processing for purchases and managing webhooks.

### Third-party APIs
- **Card Hedge API**: Primary source for baseball card images.
- **Zyla API**: Fallback for card images.
- **eBay Browse API**: Live listing search via OAuth 2.0 client credentials flow.
- **Goldin Auctions**: Curated listings managed via admin interface.

### Live Listings Marketplace
A unified marketplace search feature aggregates listings from eBay and Goldin Auctions with context-aware filtering. Key components:
- **Database Tables**: `marketplace_cache` (TTL-based caching), `outbound_clicks` (click tracking), `external_listings_snapshot` (historical data), `goldin_curated_listings` (admin-managed feed with contextTags), `game_sets` (playable card sets), `user_active_sets` (user's recently played sets), `match_context_log` (match-to-set association events)
- **eBay Integration**: OAuth 2.0 client credentials, Browse API search with sandbox/production support via EBAY_ENV
- **Goldin Feed**: DB-backed curated listings with admin CRUD endpoints, filtered by contextTags matching game set context
- **Outbound Tracking**: HMAC-signed redirect tokens with 1-hour expiry, click logging with session/IP attribution
- **Affiliate Tracking**: eBay Partner Network (EPN) parameter injection via EBAY_EPN_CAMPAIGN_ID and EBAY_EPN_TRACKING_ID
- **Rate Limiting**: In-memory rate limiter (20 requests/min per IP) for search endpoint
- **Context-Aware Search**: Marketplace can filter listings by game set context (sport:year:brand). Users can toggle between contextual search (limited to their played sets) and freeform search. Context tabs show recently played sets with one-click filtering.
- **Frontend**: Tabbed marketplace page with context chips, contextual/freeform toggle, search within context, source/sort filters, listing cards, and affiliate disclosure. Post-match CTA links to marketplace with setId parameter.
- **Admin Endpoints**: CRUD for game sets (GET/POST/PUT/DELETE /api/admin/game-sets), Goldin contextTags management
- **Environment Variables**: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_ENV, EBAY_EPN_CAMPAIGN_ID, EBAY_EPN_TRACKING_ID, OUTBOUND_SECRET

### Authentication System
- **WorkOS**: For multi-provider authentication.
- **Nodemailer**: For sending password reset and magic link emails via Gmail SMTP.