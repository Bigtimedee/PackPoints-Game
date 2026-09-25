# Masked-image cache rebuild (v4.5)

PackPTS bakes player-name masks into JPEGs on the Railway volume and serves them at `/api/cards/:cardId/masked-image`. Gameplay (solo, Daily 5, 1v1) uses that URL. After a masking geometry change, old files stay on disk until the cache key changes.

## Cache keys

| Layer | Key | What invalidates it |
|---|---|---|
| DB row `card_image_mask_cache` | `cardId` + `rawImageUrl` + `maskVersion` | `maskVersion` bump, or admin rebuild deleting the row |
| File on volume | `/app/data/masked-cards/{cardId}_{maskVersion}.jpg` (local: `data/masked-cards/`) | version in filename, or deleting the file |
| HTTP | `/api/cards/:cardId/masked-image?v={maskVersion}` | query string (`v4.5`). `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` (not immutable). Warm volume hits skip DB/OCR (`X-Mask-Cache: hit`, `Server-Timing`). `ETag` + `X-Mask-Version` are the current bake id. |

Current version: **`v4.5`** (`CURRENT_MASK_VERSION` in `shared/maskGeometry.ts`). v4.5 also writes a `{cardId}_v4.5.json` bake plan beside the JPEG and nullable `layout_class` / `regions` columns on `card_image_mask_cache` (boot `drizzle-kit push` adds them). Unregistered sets with no OCR name hit are `UNKNOWN` and are not served. On-demand generation in `server/masking/maskingService.ts` skips rebuild when the cached row already has this version and the file exists.

**The handler ignores `?v=`.** Older `?v=` values return the same on-disk JPEG until gameplay requests the current version and the file is regenerated. Design QA must use `?v=v4.5`. Leftover `*_v4.4.jpg` files are not the object the game loads.

v4.2 geometry still applies: PSA/slab certificate labels (top ~22% of slab photos) via a center-column red→white detector plus a dark-holder fallback, and OCR tokens `PSA` / `GEM` / `MINT` / `PSA9` in the top third. 1987 Topps baseball stays the bottom 46% plaque. 1989 Fleer basketball stays the top plate.

v4.3 changes the **fill**, not the regions. v4.2 composited `{ r:10, g:14, b:22, alpha:0.94 }` and blurred that rectangle. The blur does not blur the card, so ~6% of the original contrast stayed sharp. Design re-QA on 2026-09-21 (after `{ "all": true }` rebuild) still read **ROGER CLEMENS** / **MINT 9** on slab `c6e890d5-015d-4e33-868a-77a69ca320ef` and 1989 Fleer top-plate names. v4.3 composites an opaque RGB rect (`#0a0e16`, no alpha, no overlay blur). Photo pixels outside the name region are unchanged. v4.4 keeps that opaque fill.

v4.4 changes **which band** is painted when sport differs. Profiles are keyed by `gameSetId`, then `sport|year|brand`. A year+brand match that ignores sport is not used. **1987 Topps Football** (`91cfdf3f-a620-4e73-adc8-22b8df221716`) is `TOP_PLATE` (opaque top 24%: team + position + player name). **1987 Topps baseball** stays the bottom 46% plaque. **1994 Topps Football** (`a09b2fe7-728e-431b-9df8-bbf2652aa3b2`) was audited on live scans: every card is 1994 Topps Finest with the name on the **bottom** bar, so it is `BOTTOM_PLAQUE` at 28%, not a top plate and not the baseball 46% plaque.

Before a JPEG is written or returned, `assertOpaqueIdentityCover` checks the name band is near-solid `#0a0e16`, the photo zone is not that fill, and a matched name token in the top or bottom identity zone sits inside a mask region. Failure does not write the file. `GET /api/cards/:id/masked-image` responds **422** `code: mask_name_uncovered` (`Cache-Control: no-store`, `X-Mask-Coverage: fail`) and the playable card is flagged (`isPlayable=false`, `blockedReason=mask_name_uncovered`, `quarantineStatus=QUARANTINED_ADMIN_REVIEW`).

## Production (Railway)

Do **not** wipe Postgres or run a hand `drizzle-kit push` just to rebuild JPEGs. Masked JPEGs are files plus `card_image_mask_cache` rows. The new nullable `layout_class` and `regions` columns are additive and land on the normal boot push.

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

Response includes `deletedRows`, `deletedFiles`, `maskVersion`. The next player request to `/api/cards/:id/masked-image?v=v4.4` regenerates that card.

3. **Required for this release:** rebuild the two football sets (admin session). Version bump means `?v=v4.4` misses `*_v4.3.jpg`, but rebuild drops the stale rows so the volume does not keep them.

```http
POST /api/admin/masks/rebuild
Content-Type: application/json

{ "setId": "91cfdf3f-a620-4e73-adc8-22b8df221716" }
```

```http
POST /api/admin/masks/rebuild
Content-Type: application/json

{ "setId": "a09b2fe7-728e-431b-9df8-bbf2652aa3b2" }
```

4. Design QA (`?v=v4.4`). Name must be unreadable. Photo must still be guessable.

1987 Topps Football — opaque **top** band (team + name):

- Hanford Dixon: `/api/cards/bf3b8f6e-cbff-4c20-ad1d-5abe9036f38e/masked-image?v=v4.4`
- Bernie Kosar: `/api/cards/f0c65ed5-9531-4cf8-802f-eab6e4619efd/masked-image?v=v4.4`
- Art Monk: `/api/cards/7953a361-3724-496d-963d-06ae6351e07b/masked-image?v=v4.4`

1994 Topps Football (Finest, name on the **bottom** bar — not a top plate):

- Albert Lewis: `/api/cards/f95170cd-265b-4fea-bc3f-8a26b150ecdc/masked-image?v=v4.4`
- Emmitt Smith: `/api/cards/f5aa4450-fac4-40ff-bfab-0d61940a1f84/masked-image?v=v4.4`
- Emmitt Smith (second scan): `/api/cards/cd853c68-c124-403a-90fd-50b6c7b8fffa/masked-image?v=v4.4`

5. Optional: 1989 Fleer top plate still covers the name and leaves the photo. Clemens PSA slab `c6e890d5-015d-4e33-868a-77a69ca320ef?v=v4.4` still covers the top cert and the bottom plaque. `?v=v4.3` is the previous object.

**Eng, after this merges:** run the two `setId` rebuilds above. `{ "all": true }` is optional; it clears leftover `*_v4.3.jpg` rows for every other set. Without it, the next `?v=v4.4` request still regenerates because the cache version will not match.

## Deal warmup (between-card lag)

`preMaskCards()` used to be defined and never called. Session/challenge/match start now **kicks** a background bake (`kickPreMask` in `server/masking/preMaskDeal.ts`) for the dealt card ids. It does **not** block start JSON. First GET of a still-cold card still generates on demand (OCR concurrency 2).

Clients prefetch remaining **masked** URLs as soon as the deal is known (`client/src/lib/prefetchPlayCardImages.ts`). Unmasked `/api/images/card/:id` is prefetched only after a successful submit.

**Volume cold after rebuild or a new Daily 5 day:** the first player (or the kick) pays the bake. Later positions should already be warm. Ops: after `{ "all": true }` rebuild, either wait for organic play or hit the five Daily 5 card URLs once so the volume is not cold at CT midnight.

## What this does not do

- It does not write CardHedge/playable card rows.
- It does not change `DEFAULT_MASK_REGIONS` for unknown bottom-plaque sets (still `yPct:54, hPct:46`).
- Client overlay in `GameCard` follows `/api/card-sets/:setKey/mask`. UUID `setKey` values resolve through `game_sets` (year + brand + sport) so 1989 Fleer Basketball gets the top plate without a `card_set_masks` row. Overlay is set-level; per-card slab labels are covered by the **baked JPEG**.
