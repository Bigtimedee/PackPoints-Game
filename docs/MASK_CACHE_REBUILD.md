# Masked-image cache rebuild (v4.2)

PackPTS bakes player-name masks into JPEGs on the Railway volume and serves them at `/api/cards/:cardId/masked-image`. Gameplay (solo, Daily 5, 1v1) uses that URL. After a masking geometry change, old files stay on disk until the cache key changes.

## Cache keys

| Layer | Key | What invalidates it |
|---|---|---|
| DB row `card_image_mask_cache` | `cardId` + `rawImageUrl` + `maskVersion` | `maskVersion` bump, or admin rebuild deleting the row |
| File on volume | `/app/data/masked-cards/{cardId}_{maskVersion}.jpg` (local: `data/masked-cards/`) | version in filename, or deleting the file |
| HTTP | `/api/cards/:cardId/masked-image?v={maskVersion}` | query string (`v4.2`). `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` (not immutable). Warm volume hits skip DB/OCR (`X-Mask-Cache: hit`, `Server-Timing`). `ETag` + `X-Mask-Version` are the current bake id. |

Current version: **`v4.2`** (`CURRENT_MASK_VERSION` in `shared/maskGeometry.ts`). On-demand generation in `server/masking/maskingService.ts` skips rebuild when the cached row already has this version and the file exists.

**The handler ignores `?v=`.** `?v=v4.0` and `?v=v4.1` (and any other `v`) return the same on-disk JPEG. Design QA 2026-09-16 hashed those two URLs as byte-identical — that is expected from the route, not proof that v4.1 geometry ran. Gameplay must request the **current** `?v=` so CDNs treat it as a new object. Leftover `*_v4.1.jpg` / `*_v4.0.jpg` files will not be used once gameplay requests `?v=v4.2`.

v4.2 covers PSA/slab certificate labels (top ~22% of slab photos) with a center-column red→white detector plus a dark-holder fallback, and OCR tokens `PSA` / `GEM` / `MINT` / `PSA9` in the top third. Set plaque stays (1987 Topps bottom 46%, 1989 Fleer top plate).

## Production (Railway)

Do **not** run `drizzle-kit push` or wipe Postgres for this. Masked JPEGs are files + `card_image_mask_cache` rows, not schema.

After this code is on `main` (auto-deploy):

1. Confirm the app boot is healthy.
2. Invalidate old JPEGs (admin session required):

```http
POST /api/admin/masks/rebuild
Content-Type: application/json

{ "all": true }
```

Per set (uses `game_sets.id`, not invented card rows):

```http
POST /api/admin/masks/rebuild
Content-Type: application/json

{ "setId": "<game_sets.id>" }
```

Per card (Clemens slab sample):

```http
POST /api/admin/masks/rebuild
Content-Type: application/json

{ "cardIds": ["c6e890d5-015d-4e33-868a-77a69ca320ef"] }
```

Response includes `deletedRows`, `deletedFiles`, `maskVersion`. The next player request to `/api/cards/:id/masked-image?v=v4.2` regenerates that card.

3. Optional: hit a known 1989 Fleer card URL once and confirm the top name plate is dark and the photo is visible.
4. Optional: hit the Clemens PSA slab `c6e890d5-015d-4e33-868a-77a69ca320ef?v=v4.2` and confirm the top cert label (**ROGER CLEMENS**) is covered, not only the inner-card bottom plaque. `?v=v4.1` may still look identical to an older bake until this rebuild; only `?v=v4.2` is the new object.

If admin rebuild is not used, new `?v=v4.2` URLs still miss the old cache row version check and regenerate on first request. Rebuild is for clearing leftover `*_v4.1.jpg` / `*_v4.0.jpg` / `*_v3.0.jpg` files and DB rows so the volume does not keep serving stale paths if something requests the URL without `v`.

## Deal warmup (between-card lag)

`preMaskCards()` used to be defined and never called. Session/challenge/match start now **kicks** a background bake (`kickPreMask` in `server/masking/preMaskDeal.ts`) for the dealt card ids. It does **not** block start JSON. First GET of a still-cold card still generates on demand (OCR concurrency 2).

Clients prefetch remaining **masked** URLs as soon as the deal is known (`client/src/lib/prefetchPlayCardImages.ts`). Unmasked `/api/images/card/:id` is prefetched only after a successful submit.

**Volume cold after rebuild or a new Daily 5 day:** the first player (or the kick) pays the bake. Later positions should already be warm. Ops: after `{ "all": true }` rebuild, either wait for organic play or hit the five Daily 5 card URLs once so the volume is not cold at CT midnight.

## What this does not do

- It does not write CardHedge/playable card rows.
- It does not change `DEFAULT_MASK_REGIONS` for unknown bottom-plaque sets (still `yPct:54, hPct:46`).
- Client overlay in `GameCard` follows `/api/card-sets/:setKey/mask`. UUID `setKey` values resolve through `game_sets` (year + brand + sport) so 1989 Fleer Basketball gets the top plate without a `card_set_masks` row. Overlay is set-level; per-card slab labels are covered by the **baked JPEG**.
