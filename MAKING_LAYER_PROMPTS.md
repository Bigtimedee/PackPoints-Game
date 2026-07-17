# Making Layer — Sequential Engineering Prompts

Each prompt is a self-contained engineering task. Do not start a prompt until the previous one is verified working. **Maker Rate is the gate between Prompt 3 and Prompt 4** — do not proceed past Prompt 3 until real users have made sets.

---

## Prompt 1 — Snap-to-Set: Schema

**Objective:** Extend the database to support user-created sets with maker identity and mixtape notes.

**Tasks:**

1. Add three columns to the `game_sets` table in `shared/schema.ts`:
   - `createdByUserId: varchar("created_by_user_id").references(() => users.id)` — null for staff-created sets, populated for user-created sets
   - `makerNote: text("maker_note")` — the one sentence the maker writes about why these cards belong together
   - `isUserCreated: boolean("is_user_created").notNull().default(false)` — distinguishes maker sets from staff/imported sets

2. Update `insertGameSetSchema` and `updateGameSetSchema` in `shared/schema.ts` to include the new fields.

3. Write and apply a migration: `migrations/add_maker_fields_to_game_sets.sql`

4. Add an index on `game_sets.is_user_created` for efficient filtering.

**Verify:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'game_sets'` returns `created_by_user_id`, `maker_note`, `is_user_created`.

---

## Prompt 2 — Snap-to-Set: Card Identification Endpoint

**Objective:** Build the server endpoint that accepts a photo of a card and returns an identified, maskable card ready to be added to a set.

**Context:**
- `server/services/cardClassifier.ts` — `classifyCard()` validates whether a card is playable (no checklists, leaders, etc.)
- `server/services/maskConfig.ts` — `getMaskConfig()` returns the mask regions for a given set key
- `server/services/imageContentAnalyzer.ts` — `analyzeImageContent()` detects placeholder/silhouette images
- OpenAI is already configured in the project (see `server/services/growthAgent/`)

**Tasks:**

1. Create `server/services/snapToSet.ts` with a single exported function:
   ```
   identifyCardFromPhoto(imageBase64: string): Promise<{
     playerName: string;
     year: number;
     brand: string;
     sport: string;
     setName: string;
     confidence: "high" | "medium" | "low";
     rawText: string; // everything OCR/vision extracted
   }>
   ```
   Use OpenAI vision (`gpt-4o`) with a prompt that asks for structured card identification. If confidence is "low", return the raw text and let the user confirm manually.

2. Add `POST /api/sets/identify-card` to `server/routes.ts`:
   - Auth required (`isAuthenticated`)
   - Accepts `{ imageBase64: string }` (max 5MB, validate size)
   - Calls `identifyCardFromPhoto()`
   - Runs `classifyCard()` on the result — return 400 with `blockedReason` if not playable
   - Rate limit: 20 requests per hour per user (add `cardIdentifyLimiter` to `server/middleware/rateLimiter.ts`)
   - Returns the identification result

**Verify:** POST a base64-encoded card image → receive structured player/year/brand/sport JSON.

---

## Prompt 3 — Snap-to-Set: Creation Flow UI

**Objective:** Build the three-step maker flow at `/make`. This is the paintbrush.

**Context:**
- Existing page patterns: `client/src/pages/store.tsx`, `client/src/pages/creators.tsx`
- Existing API: `POST /api/sets/identify-card` (from Prompt 2)
- Existing set management: `GET /api/game/sets`, `POST /api/admin/game-sets` (admin only — we'll add a user equivalent)

**Tasks:**

1. Add `POST /api/sets/create` to `server/routes.ts`:
   - Auth required
   - Accepts: `{ cards: IdentifiedCard[], setName: string, makerNote: string }`
   - Validates: 5–20 cards, makerNote max 140 characters, setName max 60 characters
   - Creates a `game_sets` row with `isUserCreated: true`, `createdByUserId: req.user.id`
   - Creates `playable_cards` rows for each identified card
   - Returns the new set id and a shareable URL

2. Create `client/src/pages/make.tsx` with three steps:
   - **Step 1 — Upload:** File input (accepts images, multi-select up to 20). For each uploaded image, call `POST /api/sets/identify-card`. Show a loading state per card. Cards that fail classification show an error chip the user can dismiss.
   - **Step 2 — Review:** Grid of identified cards with player name, year, brand. User can remove any card. Minimum 5 cards to proceed.
   - **Step 3 — Publish:** Two inputs — Set Name (60 char max) and Mixtape Note (140 char max, required, placeholder: "Why do these cards belong together?"). Submit calls `POST /api/sets/create`. On success, show a share sheet with the set URL and a copy-link button.

3. Add `/make` to the route list in `client/src/App.tsx` (lazy-loaded).

4. Add a "Make a Set" entry point to the home page game modes grid in `client/src/pages/home.tsx`.

**Verify:** Complete the flow end-to-end — upload 5+ card photos, confirm identification, name the set, publish. Confirm the set appears in `game_sets` with `is_user_created = true` and the correct `created_by_user_id`.

**Gate:** This is the Maker Rate gate. Do not proceed to Prompt 4 until real users (not staff) have published at least 10 sets through this flow.

---

## Prompt 4 — Set-as-Mixtape: Identity Layer

**Objective:** Make every user-created set carry its maker's identity visibly — in-game, on set pages, and via notifications.

**Tasks:**

1. Create a public set page at `/sets/:id` (`client/src/pages/set-page.tsx`):
   - Shows set name, maker username, maker note, card count, total plays
   - "Play this set" button that starts a game using this set
   - If the viewer is the maker, show an edit button for the name and note

2. Update the in-game card display to show the set's maker note at the start of each game session (one line, subtle, below the set name). Only show for user-created sets (`isUserCreated: true`).

3. Add `GET /api/sets/:id` to `server/routes.ts`:
   - Public endpoint (no auth required)
   - Returns set metadata: name, makerNote, createdByUserId, play count (aggregate from `game_sessions`), card count
   - Joins to `users` to return maker username

4. Add a play-notification email: when a game session completes using a user-created set, send the maker a single daily digest email (not per-play — batch them) listing how many people played their set that day. Use the existing `emailService.ts`. Respect the user's email preferences.

5. Add `GET /api/my-sets` to `server/routes.ts` (auth required):
   - Returns all sets created by the authenticated user
   - Include play count per set
   - Used by the maker's profile page

6. Add a "My Sets" tab to the profile page (`client/src/pages/profile.tsx`) showing the user's created sets with play counts.

**Verify:** Publish a set, share the `/sets/:id` URL with another user, have them play it. Confirm the maker sees a play count increment on their profile and receives the digest email.

---

## Prompt 5 — Maker Metrics: Admin Dashboard

**Objective:** Add Sets Made, Maker Rate, and Set Play Depth to the admin analytics dashboard so leadership can track the health of the Making Layer.

**Tasks:**

1. Add `GET /api/admin/metrics/making-layer` to `server/routes.ts` (admin-only):
   - `setsMade`: count of `game_sets` rows where `is_user_created = true`, grouped by day for the last 30 days
   - `makerRate`: (distinct users who created ≥1 set) / (distinct active users last 30 days) — return as a decimal
   - `setPlayDepth`: average plays per user-created set (only sets with ≥1 play)
   - `topSets`: top 10 user-created sets by play count, with maker username and set name

2. Add a "Making Layer" section to the admin analytics page (`client/src/pages/admin/metrics.tsx` or equivalent) with:
   - A line chart of Sets Made per day (last 30 days)
   - A single stat tile for Maker Rate (current %)
   - A single stat tile for Set Play Depth (current average)
   - A table of top 10 sets

**Verify:** Create 2–3 test sets, play each a different number of times. Confirm the admin metrics reflect the correct counts and averages.

---

## Prompt 6 — Co-Creation: Collaborative Set Building

**Objective:** Let two users build a set together in real time — one nominates cards, the other approves or swaps.

**Context:**
- WebSockets are already implemented in the project (`ws` package, see `server/index.ts`)
- Existing lobby/matchmaking patterns: `server/services/matches/`, `lobbies` table in schema

**Tasks:**

1. Add a `collaboration_sessions` table to `shared/schema.ts`:
   - `id`, `hostUserId`, `guestUserId` (nullable until joined), `status` (waiting/active/published/abandoned), `nominatedCards: jsonb`, `approvedCards: jsonb`, `setName`, `makerNote`, `createdAt`

2. Add REST endpoints to `server/routes.ts`:
   - `POST /api/collab/create` — creates a session, returns an invite link (`/collab/:id`)
   - `POST /api/collab/:id/join` — guest joins, updates status to active
   - `POST /api/collab/:id/publish` — host publishes the approved cards as a set (minimum 5 approved)

3. Add WebSocket message handlers for the collab session:
   - `collab:nominate` — host sends a card; broadcast to guest
   - `collab:approve` — guest approves a card; broadcast to host
   - `collab:swap` — guest proposes an alternative card for a slot; broadcast to host
   - `collab:presence` — both sides send heartbeats; client shows if partner is connected

4. Create `client/src/pages/collab.tsx`:
   - Host view: card upload + nomination panel on left, approved cards on right, invite link at top
   - Guest view: pending cards to approve/swap on left, approved set building on right
   - Partner presence indicator (green dot / "waiting for partner")
   - Publish button (host only, enabled when ≥5 cards approved)

5. The published set is owned by both users — store both `hostUserId` and `guestUserId` on the `game_sets` row (add a `coCreatorUserId` column). Credit both makers on the set page.

**Verify:** Two browser sessions (different users) complete a collab session and publish a set. Confirm both usernames appear on the set page.

---

## Prompt 7 — Commerce as Byproduct

**Objective:** Surface contextual card purchase links at the moment a player wants them — after a correct answer reveals the player name on a user-created set.

**Context:**
- `server/services/marketplace/` — existing marketplace and Goldin integration
- `external_listings_snapshot` table — cached marketplace listings
- `outbound_clicks` table — tracks outbound link clicks (already instrumented)

**Tasks:**

1. Add `GET /api/sets/:id/cards/:cardId/listings` to `server/routes.ts`:
   - Queries `external_listings_snapshot` for listings matching the card's player name, year, and brand
   - Returns top 3 listings (cheapest first) with title, price, platform (goldin/ebay), and URL
   - Falls back gracefully if no listings found (returns empty array, not an error)
   - Cache results for 1 hour — these do not need to be real-time

2. Update the post-answer reveal screen (in the game client) to show a "Find this card" section when:
   - The game session is using a user-created set (`isUserCreated: true`)
   - The player answered correctly
   - At least one listing exists for the card
   - Display: up to 3 listing tiles (platform logo, price, "Buy on Goldin/eBay" button)

3. Log every listing click to `outbound_clicks` with `source: 'set-reveal'`, `setId`, `cardId`, `platform`. This is the data that demonstrates commerce conversion to an acquirer.

4. Add `outbound click-through rate by set` to the admin Making Layer metrics (from Prompt 5).

**Verify:** Play a user-created set containing a card that has marketplace listings. After a correct answer, confirm listing tiles appear. Click one and confirm a row appears in `outbound_clicks` with the correct metadata.

---

## Gates Summary

| After Prompt | Gate Before Next |
|---|---|
| Prompt 1 | Migration applied, columns present in DB |
| Prompt 2 | Card identification endpoint returning structured JSON |
| Prompt 3 | **Maker Rate gate** — 10 real user-created sets before proceeding |
| Prompt 4 | Set pages live, play notifications sending |
| Prompt 5 | Metrics dashboard populated with real data |
| Prompt 6 | At least one collab set published by two real users |
| Prompt 7 | Outbound clicks logging confirmed in DB |
