# PackPoints

## Overview
PackPoints is a card-collecting gaming platform centered on baseball card recognition. It allows users to identify players from card images to earn redeemable points. The platform offers solo, 1v1, and tournament game modes, a global leaderboard, and a marketplace. Its primary goal is to engage baseball card enthusiasts, monetize the platform effectively, and ensure user retention.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Technologies
The frontend uses React 18, TypeScript, Vite, Wouter for routing, Tailwind CSS, shadcn/ui, and TanStack React Query. The backend is built with Node.js, Express, TypeScript, Drizzle ORM with PostgreSQL, and Zod for validation. esbuild is used for backend bundling, and WebSockets enable real-time functionality.

### Card Management
The system manages baseball card images, including masking player names during gameplay via server-side processing or CSS overlays. It incorporates validation, proxying, and multi-layer content-based placeholder detection. An anti-pruning system prevents removal of active cards through mutation guards, quarantine flows, and audit logging.

### Monetization & Wallet
A ledger-first "PackPTS" wallet supports various transaction types, a product catalog, and a tiered membership system (Free, Pro, Legend). Points have a bucket-based expiration system. `wallets.balance` is the authoritative source for PackPTS. Stripe is integrated for one-time bundle purchases and monthly subscriptions, supported by a robust webhook system for processing purchase events with retry mechanisms and reconciliation. Financial guardrails ensure profitability and fraud prevention.

### Game Modes & Persistence
The platform supports solo, 1v1, and Daily 5 challenge modes. Solo game sessions are persisted to PostgreSQL, ensuring continuity. Daily progress, including cards answered and matches completed, is tracked server-side and applied atomically. The Daily 5 challenge features a deterministic card selection system, daily leaderboards, and anti-abuse safeguards. 1v1 matchmaking uses a real-time, database-backed atomic pairing process, and match integrity is maintained by a robust, database-backed state machine.

### Authentication & Access Control
Multi-provider authentication (Replit Auth, WorkOS, local) with identity linking and magic-link verification is supported. An access control system manages user caps, waitlists, invite codes, and a referral program.

### Admin & Analytics
Comprehensive admin tools manage users, wallets, entitlements, and feature flags. A closed-loop redemption system converts PackPTS to store credit. An event tracking system records user actions, and a privacy-safe geolocation system infers user states.

### Marketplace
Aggregates listings from eBay and Goldin Auctions, providing filtering, affiliate tracking, and outbound click logging.

### Reward System
A non-linear reward system calculates points based on player obscurity, vintage, and rarity, with daily and per-match point caps.

### Growth Agent System
An AI-powered system for content generation and social media automation. It includes a job runner, scheduler, circuit breaker, OpenAI integration, strict Zod validation for all generated content, and a compliance validator. It features platform adapters for Discord, X/Twitter, Instagram, and Reddit, with auto-posting capabilities and anti-abuse safeguards for content diversity. An admin UI provides monitoring and control.

### System Hardening
Includes centralized rate limiting, panic switches for disabling features, structured logging with request IDs, and a health endpoint for monitoring system status.

## External Dependencies

- PostgreSQL
- Drizzle Kit
- Radix UI
- Embla Carousel
- Recharts
- Lucide React
- React Icons
- connect-pg-simple
- express-session
- zod
- Vite
- Replit Plugins
- esbuild
- Stripe
- Card Hedge API
- eBay Browse API
- Goldin Auctions
- ipinfo.io
- WorkOS
- Nodemailer
- OpenAI (GPT-4o-mini)
- twitter-api-v2 (for X/Twitter)
- Facebook Graph API (for Instagram)