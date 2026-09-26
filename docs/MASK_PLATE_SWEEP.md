# Name-plate sweep

The sweep re-checks every playable card in every active integrated set. It measures each scan, fits the name band the same way a bake does, and runs the post-bake name check in memory, including an OCR of the whole masked JPEG for a surname outside the plate. It prints pass and fail counts per set, plus `nameVisibleOutsideMask` for fails whose reason is `name_visible_outside_mask`. It also flags scans whose aspect ratio or pixel size sits away from that set's median (a tight crop such as 488x761 against a ~750x1030 Fleer median).

It does not write a masked JPEG, does not delete a cache file, and does not change `is_playable`. A card that fails during a real bake, or during the warm-up name check, is excluded by that path. This script only reports. An OCR timeout counts as fail reason `name_check_incomplete`, not as `name_visible_outside_mask`.

1989 Fleer Basketball is a 168-card checklist. The JSON includes `fleer1989Checklist: 168` and `fleer1989Playable`, which is how many of those cards are currently eligible to deal.

## Run

From the repo root, with `DATABASE_URL` pointed at the database the app deals from (Railway Postgres in production):

```bash
npm run mask:sweep
```

The command downloads each card image. A set with a few hundred cards takes a while. Failed downloads count as fail with reason `image_unreadable`.

Cache rebuild is separate. `CURRENT_MASK_VERSION` is `v4.5`, so `v4.4` JPEGs and `.ok` sidecars are not served. The next off-request bake (deal warm-up, or `POST /api/admin/masks/rebuild`) writes the v4.5 file. `GET /api/sets/.../covers/:slot` does not bake.
