# Masked-image cache rebuild (v4.1)

PackPTS bakes player-name masks into JPEGs on the Railway volume and serves them at `/api/cards/:cardId/masked-image`. Gameplay (solo, Daily 5, 1v1) uses that URL. After a masking geometry change, old files stay on disk until the cache key changes.

## Cache keys

| Layer | Key | What invalidates it |
|---|---|---|
| DB row `card_image_mask_cache` | `cardId` + `rawImageUrl` + `maskVersion` | `maskVersion` bump, or admin rebuild deleting the row |
| File on volume | `/app/data/masked-cards/{cardId}_{maskVersion}.jpg` (local: `data/masked-cards/`) | version in filename, or deleting the file |
| HTTP | `/api/cards/:cardId/masked-image?v={maskVersion}` | query string (`v4.1`). `Cache-Control: public, max-age=3600` (not immutable) |

Current version: **`v4.1`** (`CURRENT_MASK_VERSION` in `shared/maskGeometry.ts`). On-demand generation in `server/masking/maskingService.ts` skips rebuild when the cached row already has this version and the file exists.

v4.1 adds PSA/slab certificate-label coverage (top ~22% of slab photos) while keeping the set plaque (1987 Topps bottom 46%, 1989 Fleer top plate). Leftover `*_v4.0.jpg` files will not be used once gameplay requests `?v=v4.1`.

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

Response includes `deletedRows`, `deletedFiles`, `maskVersion`. The next player request to `/api/cards/:id/masked-image?v=v4.1` regenerates that card.

3. Optional: hit a known 1989 Fleer card URL once and confirm the top name plate is dark and the photo is visible.
4. Optional: hit a PSA-slab scan (Topps Tiffany-class, player name on the top cert label) and confirm **ROGER CLEMENS**-style label text is covered, not only the inner-card bottom plaque.

If admin rebuild is not used, new `?v=v4.1` URLs still miss the old cache row version check and regenerate on first request. Rebuild is for clearing leftover `*_v4.0.jpg` / `*_v3.0.jpg` files and DB rows so the volume does not keep serving stale paths if something requests the URL without `v`.

## What this does not do

- It does not write CardHedge/playable card rows.
- It does not change `DEFAULT_MASK_REGIONS` for unknown bottom-plaque sets (still `yPct:54, hPct:46`).
- Client overlay in `GameCard` follows `/api/card-sets/:setKey/mask`. UUID `setKey` values resolve through `game_sets` (year + brand + sport) so 1989 Fleer Basketball gets the top plate without a `card_set_masks` row. Overlay is set-level; per-card slab labels are covered by the **baked JPEG**.
