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
An AI-powered system for content generation and social media automation. Controlled by `GROWTH_AGENT_ENABLED` env var (default: false). Core files in `server/services/growth/`. Full documentation at `docs/GROWTH_AGENT.md`. It includes a job runner with persistent retry queue, scheduler, circuit breaker, OpenAI integration (GPT-4o-mini via Replit AI Integration with user-key fallback), strict Zod validation, and a compliance validator. Platform adapters for Discord (webhook), X/Twitter (OAuth 1.0a via `twitter-api-v2`), Instagram (Graph API container/publish), and Reddit (OAuth2, `MANUAL_QUEUE` by default). Admin UI at `/admin/growth`.

Pipeline health monitoring (`server/services/growth/pipelineHealth.ts`): Startup OpenAI connectivity check with automatic fallback from Replit AI Integration to user `OPENAI_API_KEY`. Pipeline health report (GREEN/YELLOW/RED) available at `GET /api/admin/growth/overview` in `detailedPipelineHealth` field. Admin dashboard shows health banner with per-stage status (Daily Plan Generation, Content Item Generation, Auto-Posting, Daily 5 Announcement/Recap), OpenAI source, and circuit breaker state. Failed upstream jobs (e.g., `generate_daily_plan`) are surfaced as `dependencyFailed` in downstream job results, preventing silent cascading failures.

TikTok manual mode (`server/services/growth/tiktokConfig.ts`, `tiktokJobs.ts`): Controlled by `GROWTH_TIKTOK_ENABLED` and `GROWTH_TIKTOK_MODE` env vars. When enabled, generates 3 TikTok packages/day (Daily5 Announcement, Trivia Challenge, Leaderboard Spotlight) with rich metadata (hook, script, on_screen_text, caption, hashtags, cta, thumbnail_text, format_notes, audio_notes, asset_refs, legal_safe). All items go to publishing_queue as MANUAL_QUEUE. Admin Publishing Queue UI at `/admin/growth` (Queue tab) supports platform/status/date filtering, copy buttons (caption, hashtags, script), download buttons (script txt, asset list JSON), mark-as-posted/undo, bulk actions, and a manual posting checklist. No TikTok API auto-posting.

DB tables: `growth_content_plans`, `growth_content_items`, `growth_job_runs`, `publishing_queue`. X/Twitter secrets: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`. Instagram secrets: `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`.

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