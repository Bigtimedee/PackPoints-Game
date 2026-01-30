# PackPoints

## Overview
PackPoints is a card-collecting gaming platform focused on baseball card recognition. Users identify players from card images to earn points, which can be redeemed for credits on platforms like Goldin Auctions and eBay. The platform supports solo, 1v1, and tournament game modes, features a global leaderboard, and includes a marketplace for card listings. Its core purpose is to create an engaging experience for baseball card enthusiasts while offering robust monetization and retention strategies.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Technologies
The frontend is built with React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, and shadcn/ui, using TanStack React Query for state management. The backend utilizes Node.js, Express, and TypeScript, employing Drizzle ORM with PostgreSQL for data persistence and Zod for validation. esbuild is used for backend bundling. Real-time features, such as 1v1 game modes, are powered by WebSockets.

### Card Image System
A sophisticated system manages baseball card images, primarily sourced from the Card Hedge API, ensuring player names are masked during gameplay. This involves:
- **Server-Side Image Masking**: Pre-processing images to obscure player names using `sharp` for template masks and `tesseract.js` for OCR-based text detection. Masked images are cached and served via a dedicated API endpoint.
- **CSS Overlay Masks**: Frontend-applied CSS masks provide an additional layer of defense against accidental reveals.
- **Per-Set Configurable Masks**: Masking profiles are dynamically configured per card set to adapt to varying nameplate positions.
- **Anti-Reveal Hardening**: Measures like context menu prevention and `pointer-events: none` are implemented to prevent circumvention.

### Image Validation & Proxy
All card images undergo HTTP validation and are proxied through the PackPoints server. This system checks image integrity, content type, and size, quarantining problematic images.

### Content-Based Placeholder Detection
A multi-layer defense system prevents placeholder/silhouette images from reaching gameplay:

**Layer 1 - Database Filtering**:
- `playable_cards.content_verified` boolean column (indexed) gates all card queries
- `getRandomCardsFromSet()` and `getRandomCards()` in storage.ts return cards where `content_verified IS NULL OR content_verified = true` (allows newly imported cards)
- Batch verification script (`server/scripts/verifyAllCards.ts`) pre-scans all cards on import
- Current stats: ~5900 verified authentic cards, ~1900 silhouettes blocked at database level
- Admin panel uses IDENTICAL query logic as gameplay to prevent count mismatches

**Admin Diagnostic Tools**:
- `/api/admin/game-sets/:id/diagnose` - Comprehensive card count breakdown, last 5 inserted cards, foreign key sanity checks, intelligent issue diagnosis
- `/api/admin/game-sets/repair` - Finds and fixes sets with stale counts, reports before/after with specific issues
- Purge/reimport logging: Logs total inserted, playable counts, content_verified breakdown, sample cards, and warns if imported > 0 but playable = 0

**Layer 2 - Server-Side Image Analysis** (`server/services/imageContentAnalyzer.ts`):
- **Multi-Signal Analysis**: Uses `sharp` to analyze entropy, color diversity (quantized to 32 levels), dominant color percentage, and edge detection
- **Scoring System**: Low unique colors (<50: 40pts), low entropy (<4.0: 40pts), high dominant color (>60%: 30pts), no edges (25pts)
- **Quarantine Threshold**: Cards with ≥60% placeholder confidence are automatically quarantined
- **Real Card Characteristics**: Authentic cards show 300-500 unique colors, 7.5+ entropy, <10% dominant color
- **Caching**: Results cached in-memory for 24 hours per image URL (1000 entry limit)

**Layer 3 - Frontend Detection** (`client/src/components/GameCard.tsx`):
- Canvas-based analysis on image load as final safety net
- Detection thresholds: <30 unique colors OR >50% dominant color triggers placeholder detection
- Auto-reports detected placeholders and triggers replacement flow

### CardHedge Integration Layer
A comprehensive server-side integration with the CardHedge API provides card search, sorting, details lookup, and visual image search:
- **Server-Side API Endpoints**: `/api/cardhedge/search`, `/api/cardhedge/search-sorted`, `/api/cardhedge/card-details`, `/api/cardhedge/image-search` - all server-side to protect API key
- **Caching Strategy**: TTL-based LRU cache with 60s for searches, 5min for card details, no cache for image search
- **Image Search**: 85% similarity threshold for best match detection, supports URL or base64 input
- **Placeholder Detection**: Pattern-based filtering to reject stock/placeholder images
- **React Query Hooks**: `useCardSearch`, `useCardSearchSorted`, `useCardDetails`, `useImageSearch` for admin workflows
- **Files**: `server/services/cardhedge/client.ts`, `server/routes/cardhedge.routes.ts`, `client/src/hooks/use-cardhedge.ts`, `shared/cardhedge/types.ts`

### Monetization & Wallet
The platform features a ledger-first wallet for "PackPTS," a point system with various transaction types. A product catalog defines purchasable items. A tiered membership system (Free, Pro, Legend) offers access and multipliers. A bucket-based system manages point expiration.

### Authentication & Access Control
Multi-provider authentication (Replit Auth, WorkOS, local) supports secure identity linking and magic-link verification for high-value actions. An access control system manages user caps, waitlists, and invite codes, alongside a referral system.

### Admin Tools & Redemption
Comprehensive admin tools manage users, wallets, entitlements, feature flags, and provide metrics. A closed-loop redemption system converts PackPTS into store credit, with admin approval for high-value redemptions.

### Analytics & Geo Intelligence
An event tracking system logs key user actions. A privacy-safe geolocation system infers user home states for market analysis.

### Store & PackPTS Purchase
Integrated with Stripe, this system handles one-time PackPTS bundle purchases and monthly subscriptions.

### Financial Guardrails
Systems are in place to ensure profitability for PackPTS packages and redemptions, track margins, and prevent fraud through user risk tracking and pattern-based detection.

### Marketplace
A unified search aggregates listings from eBay and Goldin Auctions, supporting filtering, affiliate tracking, and outbound click logging.

### Non-Linear Reward System
A fame-based point calculation system rewards users more for identifying obscure players and less for famous ones, incorporating vintage and rarity multipliers, with daily and per-match point caps.

### Daily Progress Tracking
Server-authoritative tracking of daily progress, including cards answered and matches completed, synchronized across match modes.

### 1v1 Matchmaking System
A real-time, random matchmaking system uses a DB-backed atomic pairing process with presence tracking, a ticket queue, and heartbeats.

### Match Lifecycle State Machine
A robust state machine (`LOBBY → INITIALIZING → ACTIVE → FINISHED/CANCELLED`) with database-backed state ensures match integrity and prevents premature endings. It incorporates invariant enforcement, race condition prevention, audit logging, and match recovery mechanisms. Winner determination is based on correct answers.

### Transactional Answer Submission
Ensures synchronized state during 1v1 matches through database locking, idempotent inserts, and atomic updates, broadcasting `ANSWER_STATUS` events to both players.

## External Dependencies

### Database
- PostgreSQL
- Drizzle Kit

### Frontend Libraries
- Radix UI
- Embla Carousel
- Recharts
- Lucide React
- React Icons

### Backend Libraries
- connect-pg-simple
- express-session
- zod

### Build & Development Tools
- Vite
- Replit Plugins
- esbuild

### Payment & Billing
- Stripe

### Third-party APIs
- Card Hedge API
- Zyla API
- eBay Browse API
- Goldin Auctions (integration via admin)
- ipinfo.io
- WorkOS
- Nodemailer