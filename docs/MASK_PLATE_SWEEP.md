# Name-plate sweep

The sweep re-checks every playable card in every active integrated set. Per set it prints `layoutDisagreed` (the detected name plate was not the set profile's plate) and `exclusionsByReason` (fail counts by reason, including `name_visible_outside_mask` and `name_plate_unresolved`). It measures each scan, fits the name band the same way a bake does, and runs the post-bake name check in memory, including an OCR of the whole masked JPEG for a surname outside the plate. The band stays on the printed name plate. The sweep does not widen it. It prints pass and fail counts per set, plus `nameVisibleOutsideMask` for fails whose reason is `name_visible_outside_mask`. It also flags scans whose aspect ratio or pixel size sits away from that set's median (a tight crop such as 488x761 against a ~750x1030 Fleer median).

It does not write a masked JPEG, does not delete a cache file, and does not change `is_playable`. A card that fails during a real bake, or during the warm-up name check, is excluded by that path. This script only reports. An OCR timeout counts as fail reason `name_check_incomplete`, not as `name_visible_outside_mask`.

A surname leak is 4 or more consecutive letters of the surname outside the mask, or the whole surname when the surname is 4 letters or shorter. `KOUN` from `ANTETOKOUNMPO` counts. `KOU` does not. `LEE` counts when that whole surname is present. A 4-letter run is ignored only when that run is the entire OCR token and the token is in `COMMON_OCR_WORDS` (`server/masking/nameOutsideMask.ts`). `the` and `and` are 3 letters, so they are not on that list.

1989 Fleer Basketball is a 168-card checklist. The JSON includes `fleer1989Checklist: 168` and `fleer1989Playable`, which is how many of those cards are currently eligible to deal.

## Run

From the repo root, with `DATABASE_URL` pointed at the database the app deals from (Railway Postgres in production):

```bash
npm run mask:sweep
```

The command downloads each card image. A set with a few hundred cards takes a while. Failed downloads count as fail with reason `image_unreadable`.

To check a known list of covers, pass a JSON array of `{ "cardId": "<uuid>", "leak": true }` pairs. `leak` is only the outside-mask surname result. The lookup is by card id and includes cards the deal filter has already dropped. A missing card is `card_not_found`. The process exits 1 when any pair does not match. It still does not change playable rows.

```bash
npm run mask:sweep -- --expect pairs.json
```

```json
[
  { "cardId": "00000000-0000-4000-8000-000000000001", "leak": true },
  { "cardId": "00000000-0000-4000-8000-000000000002", "leak": false }
]
```

Cache rebuild is separate. `CURRENT_MASK_VERSION` is `v4.6`, so `v4.5` and `v4.4` JPEGs and `.ok` sidecars are not served. The next off-request bake (deal warm-up, or `POST /api/admin/masks/rebuild`) writes the v4.6 file. `GET /api/sets/.../covers/:slot` does not bake.
