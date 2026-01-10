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