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

### Profit Guardrail & Marketplace Redemptions
A profit guardrail system ensures minimum profitability for PackPTS redemptions on external marketplace purchases (eBay/Goldin), applying business math formulas to calculate maximum redeemable points.

### Treasury-Backed Margin Pool System
A financial backing system that ensures a real margin is maintained on every PackPTS redemption for marketplace purchases. It tracks available margin from revenue sources and enforces redemption limits based on a dynamically calculated margin pool.

### Live Listings Marketplace
A unified marketplace search feature aggregates listings from eBay and Goldin Auctions. It supports context-aware filtering based on game sets, affiliate tracking, outbound click logging, and in-memory rate limiting.

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