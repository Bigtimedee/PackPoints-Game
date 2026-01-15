# PackPoints

## Overview
PackPoints is a card-collecting gaming platform where users guess baseball players from card images to earn points. It offers solo, 1v1, and tournament game modes, a leaderboard, and a marketplace for redeeming points for credits on platforms like Goldin Auctions and eBay. The project aims to provide an engaging gaming experience focused on baseball card recognition and collection.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18 and TypeScript, utilizing Vite for fast development and Wouter for routing. Styling is managed with Tailwind CSS and shadcn/ui (based on Radix UI) for components, ensuring an accessible and customizable user interface. State management for server data uses TanStack React Query. The design system incorporates dark/light themes, Inter and DM Mono fonts, and a mobile-first, responsive approach with a gaming-inspired visual language.

### Backend
The backend uses Node.js with Express and TypeScript, providing RESTful JSON endpoints. It is built with esbuild for production optimization. Data storage is handled via Drizzle ORM with a PostgreSQL dialect, using Zod for schema validation. Key features include user authentication (Replit Auth and local username/password), game session management, point calculation, and administrative tools for card management and user oversight. Real-time 1v1 game modes (friend and random) are supported using WebSockets, incorporating lobby systems, matchmaking, and secure game logic with membership secrets.

### Card Image System
The platform uses a curated system for baseball card images, primarily sourcing from Card Hedge API and verified CDN URLs (S3/appforest, bubble.io). Images are verified to ensure reliability, and gameplay masks player names until answers are revealed. Admin endpoints are available for syncing and fetching card data.

### Monetization & Wallet
A comprehensive wallet system tracks user points (PackPTS) using a ledger-first architecture to ensure transactional integrity. It supports various entry types (EARN, SPEND, ADJUST, PURCHASE_CREDIT, REVERSAL). A product catalog defines purchasable items (consumables, entitlements, subscriptions). A tier system (Free, Pro, Legend) gates access to game modes and multipliers, enforced by match tokens and daily quotas.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.
- **Drizzle Kit**: Used for database schema migrations.

### Frontend Libraries
- **Radix UI**: Provides accessible component primitives.
- **Embla Carousel**: For carousels, likely for card displays.
- **Recharts**: Used for data visualization in dashboards.
- **Lucide React & React Icons**: Icon libraries.

### Backend Libraries
- **connect-pg-simple**: PostgreSQL-backed session storage.
- **express-session**: Session management.
- **zod**: Runtime validation for API payloads.

### Build & Development
- **Vite**: Frontend build tool and development server.
- **Replit Plugins**: Integrations for the Replit environment.
- **esbuild**: Backend bundling.

### Payment & Billing
- **Stripe**: Integrated for payment processing, handling webhooks for `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, and `charge.refunded` events. Environment variables are used for API keys and optional price ID mappings.

### Third-party APIs
- **Card Hedge API**: Primary source for baseball card images.
- **Zyla API**: Fallback for fetching additional card images.
- **Goldin Auctions & eBay**: Planned integration for point redemption.

### Authentication System
- **Multi-provider support**: Replit OAuth, WorkOS, and local username/password
- **Admin Portal login**: `/admin` page supports both Replit OAuth and username/password
- **Password Reset**: Token-based system with 1-hour expiry
  - Tokens stored in `password_reset_tokens` table
  - **Email delivery via Gmail SMTP** using Nodemailer with `GMAIL_USER` and `GMAIL_APP_PASSWORD` secrets
  - Email service: `server/services/emailService.ts` (supports HTML and plain text)
  - Pages: `/forgot-password`, `/reset-password?token=...`
  - Endpoints: POST `/api/auth/forgot-password`, GET `/api/auth/validate-reset-token`, POST `/api/auth/reset-password`

### Identity Linking System
Secure account linking across authentication providers to prevent account takeover:

#### Security Policy
- **Never auto-link on email alone**: Even if a provider reports a verified email, users must prove ownership
- **Three-case OAuth callback flow**:
  - Case A: Existing identity → auto-login (user has linked this provider before)
  - Case B: Email collision → challenge required (email matches existing user, must verify)
  - Case C: No match → new user creation
- **High-value account protection**: Accounts exceeding thresholds require magic-link verification (not just password)

#### High-Value Thresholds (configurable in shared/schema.ts)
- `HIGH_VALUE_PACKPTS_THRESHOLD`: 10,000 PackPTS
- Or: User has Stripe customer ID
- Or: User has redemption history

#### Database Tables
- `user_identities`: Links users to external identity providers (provider, providerUserId, email, verified)
- `pending_link_challenges`: Temporary challenges for unresolved link attempts (15-minute expiry)
- `identity_link_audit`: Full audit trail of all linking events

#### Audit Event Types
- `LINK_REQUESTED`: User initiated linking via OAuth
- `LINK_BLOCKED`: Attempted auto-link blocked (email collision)
- `LINK_COMPLETED`: Successful link after verification
- `MAGIC_LINK_SENT`: Verification email sent
- `MAGIC_LINK_VERIFIED`: User clicked valid magic link

#### Services
- `identityService.ts`: Core linking logic, challenge management, magic-link creation/verification

#### API Endpoints
- GET `/api/auth/link/challenge`: Get current pending link challenge info
- POST `/api/auth/link/confirm`: Confirm link after password login (or magic-link for high-value)
- POST `/api/auth/link/send-magic`: Send magic-link verification email
- GET `/api/auth/link/verify`: Verify magic-link token (redirects back to link-required page)
- POST `/api/auth/link/cancel`: Cancel pending link challenge
- GET `/api/auth/identities`: List user's linked identities

#### Frontend Pages
- `/auth/link-required`: Resolution page with login and email verification tabs
- `/auth/error`: Error page with linking-specific error codes (IDENTITY_IN_USE, CHALLENGE_EXPIRED, VERIFICATION_REQUIRED, etc.)

### Admin Tools
The admin system provides comprehensive management capabilities:
- **User Management**: View users, search, and access detailed user profiles
- **Admin Management**: Grant/revoke admin privileges, suspend/unsuspend users
- **Wallet Management**: Adjust PackPTS balances with audit logging via `adminService.adjustWalletBalance()`
- **Entitlement Management**: Grant/revoke user entitlements (Pro, Legend tiers)
- **Feature Flags**: Toggle platform features via `feature_flags` table
- **Audit Logging**: All admin actions recorded to `admin_audit_log` table
- **Metrics Dashboard**: DAU, conversion rates, and PackPTS liability tracking

Admin UI pages: `/admin/dashboard`, `/admin/users`, `/admin/users/:userId`, `/admin/metrics`, `/admin/audit-log`, `/admin/cards`, `/admin/redemptions`

### Redemption System
A closed-loop redemption system converts PackPTS into store credit (never cash):
- **Non-linear tier pricing**: Better rates at higher amounts (50¢/1k for 1k-5k PTS, up to $1/1k for 50k+ PTS)
- **Review threshold**: Redemptions ≥$25 require admin approval before credit token issuance
- **Idempotency**: Uses stable key generation (client-provided or minute-bucket timestamp) with ledger pre-checks to prevent double-spending
- **Admin actions**: Approve (issues token), Reject (refunds PackPTS), Reverse (fraud reversal with refund)
- **Credit tokens**: Secure tokens for store checkout, validated and consumed via dedicated endpoints
- **Service**: `redemptionService.ts` handles all redemption logic with proper ledger integration
- **Endpoints**: POST /api/redeem, /api/redeem/tiers, /api/redeem/preview, /api/redeem/history, admin approve/reject/reverse endpoints

### Analytics System
Event tracking via `analyticsService` with pluggable dispatcher pattern:
- **Events tracked**: `match_started`, `match_completed`, `pts_earned`, `pts_spent`, `store_viewed`, `purchase_started`, `purchase_completed`, `redeem_started`, `redeem_completed`
- **Database storage**: Events logged to `event_log` table
- **Extensible**: Dispatcher interface supports adding Segment/Amplitude integrations without code changes
- **Integration points**: Match lifecycle, wallet operations, store views, purchase flows

### Store & PackPTS Purchase System
Complete Stripe-integrated purchase flow for PackPTS bundles:
- **PackPTS Bundles**: PACKPTS_1500 (1500 PTS/$2.99), PACKPTS_6000 (6000 PTS/$9.99 - best value), PACKPTS_15000 (15000 PTS/$19.99)
- **Checkout Flow**: User selects bundle → Stripe Checkout session created → Webhook confirms payment → PackPTS credited via ledger
- **Database**: `stripe_checkout_sessions` table tracks session status (CREATED → PAID)
- **Idempotency**: Stripe event ID used as idempotency key for walletService.purchaseCredit() to prevent duplicate credits
- **Services**: `storeCheckoutService.ts` (session creation/status), `stripePurchaseService.ts` (webhook handling)
- **Endpoints**: GET `/api/store/products`, POST `/api/store/checkout`, GET `/api/store/checkout/:sessionId`
- **Frontend Pages**: `/store` (bundle selection), `/store/success` (payment confirmation with polling), `/store/cancel` (cancellation)

### PackPTS Expiration System
A bucket-based expiration system manages point lifecycle while preserving the append-only ledger audit trail:

#### Core Concepts
- **Buckets**: Each point award creates a "bucket" with source type, amount, and optional expiration date
- **FIFO Spending**: Points are spent from earliest-expiring buckets first to minimize waste
- **Source Types**: EARNED (gameplay, including STREAK_EARN), PURCHASED (store), BONUS (promos), ADJUSTMENT (admin)
- **Ledger Integration**: EXPIRE entry type records expirations in the immutable audit trail
- **Partial Expiration**: If wallet balance < bucket amount, only available balance is expired and bucket stays OPEN for future expiration runs

#### Expiration Policy (configurable via admin)
- **Earned points**: Expire 365 days after earning (default)
- **Purchased points**: Expire 730 days after purchase (2 years, or never)
- **Bonus points**: Expire 90 days after grant
- **Inactivity rule**: Optional - expires old points after 90 days of no wallet activity
- **Grace period**: 7-day warning before expiration for user notifications

#### Database Tables
- `packpts_bucket`: Tracks individual point awards with remaining balances and expiration dates
- `packpts_expiration_policy`: Configurable expiration rules per source type
- `packpts_spend_allocation`: Records which buckets were debited during each spend (FIFO audit trail)
- `packpts_liability_snapshot`: Daily accounting snapshots for breakage/liability reporting

#### Services
- `bucketService.ts`: Bucket CRUD, FIFO allocation, expiration info queries
- `expirationEngine.ts`: Daily expiration job, inactivity expiration, liability snapshots

#### API Endpoints
- **User endpoints**:
  - GET `/api/wallet/expirations`: Balance breakdown, upcoming expirations, policy info
  - GET `/api/wallet/expiring-soon`: Points in grace period (urgent warnings)
- **Admin endpoints**:
  - GET/PUT `/api/admin/expiration/policy`: View/update expiration policy
  - GET `/api/admin/expiration/liability`: Latest liability snapshot
  - POST `/api/admin/expiration/snapshot`: Create new liability snapshot
  - POST `/api/admin/expiration/run`: Manually run date-based expiration job
  - POST `/api/admin/expiration/run-inactivity`: Manually run inactivity expiration job
  - GET `/api/admin/users/:userId/buckets`: View user's individual buckets

#### Running Expiration Jobs
Jobs can be run manually or scheduled:
```bash
# Run date-based and inactivity expiration
npx tsx server/jobs/runExpiration.ts

# Create daily liability snapshot
npx tsx server/jobs/runLiabilitySnapshot.ts
```

For production, schedule these as daily cron jobs (recommended: 2 AM server time).