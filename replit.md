# PackPoints

## Overview
PackPoints is a card-collecting gaming platform where users identify baseball players from card images to earn points. It offers solo, 1v1, and tournament game modes, a global leaderboard, and a marketplace. Users can redeem earned points for credits on platforms like Goldin Auctions and eBay. The project aims to create an engaging baseball card recognition experience with strong monetization and user retention.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend uses React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, and shadcn/ui. State management is handled by TanStack React Query. The design is mobile-first, responsive, and gaming-inspired, supporting dark and light themes.

### Backend
The backend is built with Node.js, Express, and TypeScript, providing RESTful JSON endpoints. It uses esbuild for bundling and Drizzle ORM with PostgreSQL for data persistence, validated by Zod schemas. Key features include user authentication, game session management, point calculation, and admin tooling. WebSockets are used for real-time 1v1 game modes, including lobbies, matchmaking, and secure game logic.

### Card Image System
Baseball card images are primarily sourced from the Card Hedge API, with player names masked during gameplay. Admin tools support card data synchronization. A user reporting and admin review workflow addresses Card Hedge API data quality issues.

### Monetization & Wallet
The platform features a ledger-first wallet for user points (PackPTS) with various transaction types. A product catalog defines purchasable items. A tiered membership system (Free, Pro, Legend) offers feature access and point multipliers. A bucket-based expiration system manages point lifecycles.

### Authentication and Identity Linking
Multi-provider authentication (Replit Auth, WorkOS, local) is supported with secure identity linking. High-value account actions require magic-link verification.

### Access Control & Referral Systems
An access control system limits active users with a configurable cap, waitlist, and invite codes. A referral system allows active Founders to share pass links for user onboarding.

### Admin Tools
Comprehensive admin tools manage users, wallets, entitlements, feature flags, audit logging, and provide a metrics dashboard.

### Redemption System
A closed-loop redemption system allows conversion of PackPTS into store credit with non-linear tier pricing. Redemptions above a certain threshold require admin approval.

### Analytics System
An event tracking system logs key user actions for future analytics integrations.

### Geo Intelligence System
A privacy-safe geolocation tracking system infers user home states for market analysis using IP hashing and session patterns, including VPN detection.

### Store & PackPTS Purchase System
Integrated with Stripe, this system handles one-time PackPTS bundle purchases and monthly subscription packages, with admin interfaces for product management.

### Profit Guardrails
A system that ensures profitability for PackPTS packages and redemptions to external marketplaces (eBay/Goldin) through business math calculations and margin tracking.

### Live Listings Marketplace
A unified search feature aggregates listings from eBay and Goldin Auctions, supporting context-aware filtering, affiliate tracking, and outbound click logging.

### Non-Linear Reward System
A fame-based point calculation system awards more PackPTS for identifying obscure players and fewer for famous players, incorporating vintage and rarity multipliers. Daily and per-match point caps are enforced.

### Daily Cap UI Feedback
A visual feedback system displays daily earning progress, cap status, and provides notifications for users.

### Financial Guardrails & Fraud Prevention
A multi-layered system prevents revenue loss and abuse through user risk tracking, chargeback handling, and pattern-based fraud detection. It uses fraud scoring pipelines with event tables, rollups, signals, and risk snapshots.

### 1v1 Matchmaking System
A real-time random matchmaking system for PvP gameplay using DB-backed atomic pairing:
- **Presence Tracking**: Database-backed user_presence table tracks ONLINE/SEARCHING/IN_MATCH states with socketId consistency
- **Ticket Queue**: matchmaking_tickets table with WAITING/MATCHED/CANCELLED/EXPIRED statuses, socket_id, and last_heartbeat_at columns
- **Atomic Pairing**: Uses PostgreSQL CTE with `SELECT ... FOR UPDATE SKIP LOCKED` to atomically lock and match two tickets in the same bucket, preventing race conditions
- **Bucket Matching**: Players matched only within the same game set bucket (e.g., "random" or specific gameSetId)
- **Heartbeat System**: 30-second alive threshold; stale tickets auto-expire via cleanup job (10s intervals)
- **Server-Authoritative Stats**: Queue position and player count calculated from DB, broadcast every 3s via `search_status` WebSocket messages
- **WebSocket Lifecycle**: Heartbeat updates both presence and matchmaking ticket timestamps; match notifications sent with membership secrets
- **REST Endpoints**: /api/presence/stats for online counts, /api/matchmaking/status for user queue status
- **Implementation**: `server/services/matchmaking/dbQueue.ts` handles all matchmaking logic with `attemptPair()` running every 500ms

### Match Lifecycle State Machine
Enforces invariants to prevent matches from ending prematurely (e.g., 0/10 questions after server restart):
- **MatchStatus Enum**: LOBBY → INITIALIZING → ACTIVE → FINISHED/CANCELLED (defined in shared/schema.ts)
- **State Machine**: `server/services/matches/stateMachine.ts` with assertCanActivate, maybeFinish, and cancelMatch functions
- **Invariant Enforcement**: Matches can only finish when currentQuestionIndex >= totalQuestions, enforced via maybeFinish()
- **Client Event-Driven**: Client shows Results screen only on `match_end` WebSocket event, not local status calculation
- **Match Recovery**: MATCH_RESYNC support with 5-second timeout retrieves current state or match_end event for finished matches
- **Database Persistence**: Match state (status, endReason, currentQuestionIndex) persisted to survive server restarts
- **MatchEndResult**: Structured payload with matchId, reason, status, winner, and participants for all match completion paths

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