# PackPoints

## Overview

PackPoints is a card-collecting gaming platform where users guess baseball players from card images to earn points. The platform features multiple game modes (solo, 1v1, tournament), a leaderboard system, and a marketplace where earned points can be redeemed for credits on platforms like Goldin Auctions and eBay.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Component Library**: shadcn/ui (Radix UI primitives with custom styling)
- **Build Tool**: Vite with hot module replacement

The frontend follows a page-based structure with shared components. Key pages include Home (game mode selection), Game (active gameplay), Leaderboard, Marketplace (point redemption), and Profile.

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Style**: RESTful JSON endpoints under `/api/*`
- **Build**: esbuild for production bundling with selective dependency bundling for cold start optimization

The server uses a unified entry point (`server/index.ts`) that registers routes and serves the static frontend in production or proxies Vite in development.

### Data Storage
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Validation**: Zod schemas generated from Drizzle schemas via `drizzle-zod`
- **Current State**: In-memory storage implementation exists in `server/storage.ts` with mock data; database tables defined but require PostgreSQL connection

Key entities: Users (authentication, points, stats), GameSessions (active games), BaseballCards (card data), LeaderboardEntries, RedemptionOptions.

### Game Flow
1. User starts a game session via POST `/api/game/start`
2. Server returns session with randomized questions (card + multiple choice options)
3. User submits answers via POST `/api/game/answer`
4. Points calculated based on correctness and response time
5. Session ends after all questions answered
6. User can share their score on social media (Twitter/X, Facebook) or copy link

### Card Image System
- **Database**: PostgreSQL stores all card data with `imageVerified` flag
- **Verified Cards**: 10 cards with working CDN images (S3/appforest, bubble.io)
- **Image Sources**: Curated URLs from reliable CDNs only (eBay URLs deprecated due to expiration issues)
- **Card Hedge API**: Primary source for fetching card images (requires CARDHEDGE_API_KEY)
- **Zyla API**: Fallback for fetching additional cards (rate-limited)
- Only cards with `imageVerified=true` are used in gameplay
- Cards display with top/bottom masks to hide player names until answer is revealed
- **Fallback UI**: Styled 1987 Topps-themed placeholder shown when images fail to load

### Card Management Endpoints
- POST `/api/admin/sync-images` - Syncs images from Card Hedge API and verified CDN URLs (requires admin auth)
- POST `/api/admin/fetch-cards` - Fetches additional cards from Zyla API (requires admin auth)
- GET `/api/cards/stats` - Returns total card count, verified count, and unverified count
- **Admin Authentication**: All admin endpoints require `X-Admin-Key` header with ADMIN_API_KEY value

### Card Hedge Integration
- **Service Module**: `server/services/cardHedge.ts` handles all Card Hedge API calls
- **Fallback Logic**: When CARDHEDGE_API_KEY is not set, uses verified images from VERIFIED_1987_TOPPS_IMAGES
- **Image Validation**: Only marks images as verified if from stable CDN sources (S3/appforest, bubble.io)
- **Rate Limiting**: 200ms delay between requests to respect API limits

### Image Reliability
- **Problem Solved**: eBay image URLs were returning 404 placeholders (HTTP 200 with broken content)
- **Solution**: Use only stable CDN sources (S3/appforest, bubble.io), mark unreliable URLs as unverified
- **Prevention**: New images must come from reliable CDN sources or be self-hosted

### 1v1 Friend Mode
- **WebSocket Server**: Real-time multiplayer via `/ws` endpoint (server/websocket.ts)
- **Lobby System**: 6-character join codes, host/guest roles
- **Match Service**: server/services/matchService.ts handles game logic
- **Database Tables**: lobbies (with hostSecret/guestSecret), matches, matchParticipants
- **Security**:
  - Membership secrets: hostSecret/guestSecret issued at lobby create/join, validated on WebSocket connection
  - Identity locking: userId cannot be changed mid-session
  - Host-only start_match verification (WebSocket layer + service layer)
  - Participant validation on answer submission
  - Automatic lobby cleanup on host disconnect
  - Match forfeit on player disconnect (remaining player wins)
- **Scoring**: Uses same popularity-based formula as solo mode: `max(50, 100 + (100 - popularity) * 4)`
- **Frontend**: Lobby creation/joining (/lobby), match gameplay (/match/:matchId)

### 1v1 Random Mode
- **Matchmaking Service**: server/services/matchmakingService.ts handles queue management
- **Queue System**: In-memory queue, auto-matches players every 1 second when 2+ in queue
- **WebSocket Handlers**: join_queue, leave_queue, join_match for queue and match connections
- **Flow**:
  1. Player joins queue via WebSocket (join_queue)
  2. When matched, matchmaking service creates lobby, starts match, sends "matched" event
  3. Player stores membership secret, redirects to /match/:matchId
  4. Match page authenticates via join_match with stored secret
- **Security**: Same membership secret model as 1v1 Friend mode
- **Frontend**: Queue page (/queue) with search timer, cancel button, auto-redirect on match

### Authentication System (Replit Auth)
- **Provider**: Replit OpenID Connect (supports Google, GitHub, Apple, email/password)
- **Session Storage**: PostgreSQL via connect-pg-simple
- **Auth Routes**: /api/login, /api/logout, /api/auth/user
- **User Schema**: id, email, firstName, lastName, profileImageUrl, points, gamesPlayed, correctAnswers, totalAnswers, isAdmin
- **Protected Routes**: Game endpoints require authentication; profile/stats uses authenticated user
- **Client Hook**: useAuth() provides user, isLoading, isAuthenticated, logout

### Admin Portal
- **Access**: Navigate to `/admin`, requires authenticated user with isAdmin=true
- **Dashboard** (/admin/dashboard): Overview stats (users, games, points, cards), top players chart, most active chart
- **User Management** (/admin/users): Search users, paginated list, view user details modal
- **Authentication**: Role-based using isAuthenticated + requireAdmin middleware
- **API Endpoints**:
  - GET /api/admin/dashboard - Aggregate platform statistics (requires admin)
  - GET /api/admin/users?search=&page=&limit= - Paginated user list (requires admin)
  - GET /api/admin/users/:id - Single user details (requires admin)

### Social Sharing
- Share buttons appear on game completion screen
- Supports Twitter/X, Facebook, and clipboard copy
- Mobile devices also get native share option via Web Share API
- Share message includes score, accuracy, and challenge text

### Design System
- Dark/light theme support via CSS variables and class-based switching
- Typography: Inter (primary), DM Mono (stats/numbers)
- Card-based UI with gaming-inspired visual language
- Mobile-first responsive design with dedicated mobile navigation

## External Dependencies

### Database
- **PostgreSQL**: Required for production (connection via `DATABASE_URL` environment variable)
- **Drizzle Kit**: Database migrations via `db:push` command

### Frontend Libraries
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, tooltips, etc.)
- **Embla Carousel**: Card carousel functionality
- **Recharts**: Data visualization for stats/charts
- **Lucide React**: Icon library
- **React Icons**: Additional icons (eBay logo)

### Backend Libraries
- **connect-pg-simple**: PostgreSQL session storage (prepared but sessions not yet implemented)
- **express-session**: Session management infrastructure
- **zod**: Runtime validation for API requests

### Build & Development
- **Vite**: Development server with HMR
- **Replit Plugins**: Dev banner, cartographer, runtime error overlay for Replit environment
- **esbuild**: Production server bundling

### Planned Integrations (Referenced in Code)
- Goldin Auctions: Point redemption partner
- eBay: Point redemption partner
- These are currently mock implementations awaiting real API integration