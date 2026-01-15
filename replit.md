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

### Admin Tools
Comprehensive admin tools provide user, admin, wallet (PackPTS adjustment), and entitlement management. It includes feature flags, audit logging, and a metrics dashboard for DAU, conversion, and PackPTS liability.

### Redemption System
A closed-loop redemption system allows conversion of PackPTS into store credit with non-linear tier pricing. Redemptions above a certain threshold require admin approval. The system ensures idempotency and provides secure credit tokens for store checkout.

### Analytics System
An event tracking system via `analyticsService` logs key user actions (e.g., `match_started`, `pts_earned`, `purchase_completed`) to an `event_log` table, with an extensible dispatcher for future integrations.

### Store & PackPTS Purchase System
Integrated with Stripe, this system handles the purchase of PackPTS bundles. It manages checkout sessions, processes payments via webhooks, and credits PackPTS to user wallets using idempotency keys to prevent double-crediting.

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
- **Goldin Auctions & eBay**: Planned integration for point redemption.

### Authentication System
- **WorkOS**: For multi-provider authentication.
- **Nodemailer**: For sending password reset and magic link emails via Gmail SMTP.