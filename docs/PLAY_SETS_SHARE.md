# Play-integrated set share kit

Marketing + in-product share for sets already in PackPTS. Locked with Daily 5 · Beat-me · integrated `/sets` only.

Design drop referenced `packpts-design/play-sets/ENG_HANDOFF.md` (not in this repo). Surfaces, CTA, UTMs, and runtime-vs-kit rules below are the engineering contract. Cover priority matches `docs/SETS_POLISH.md`.

## Surfaces

| Id | Name | Cold kit PNG | Default destination |
|----|------|--------------|---------------------|
| A | Play this set | `/assets/play-sets/play-this-set.png` | `/sets/{slug}` when known, else `/sets` |
| B | Integrated shelf | `/assets/play-sets/integrated-shelf.png` | `/sets` |
| C | Beat me from a set | `/assets/play-sets/beat-me-from-a-set.png` | `/sets/{slug}` when known, else `/sets` |

Surface C is a **marketing creative**. It is not a new Daily 5-style signed challenge token. The href is still `/sets` or `/sets/{slug}` plus the locked UTMs.

## CTA + UTM lock

Share destinations are **only**:

```
https://packpts.com/sets
https://packpts.com/sets/{slug}
```

Locked query:

```
utm_source=share&utm_medium=play_sets&utm_campaign=integrated
```

Never `/make`. Never Snap-to-Set publish CTAs. Brand spelling is **PackPTS**.

## Runtime covers vs kit templates

1. **Per-set share, OG, `/sets` heroes** — prefer the set’s runtime cover (`shareImageUrl` / masked stack crop) when it exists and is not stock fan `maker-set-1080.png`.
2. **Kit PNGs** — Marketing cold posts and placeholders until that set’s runtime art is wired. Do **not** substitute kit A for a real set’s runtime cover once available.
3. Marketing can request:
   - `asset=kit` — static template PNG
   - `asset=runtime` — existing runtime cover, or a server-rendered crop for a known set id/slug
4. Deep link when the slug (or UUID) is known; otherwise the `/sets` index.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/share/play-sets` | JSON: destination, UTMs, image URL, `imageKind` (`runtime` \| `kit`) |
| GET | `/api/share/play-sets/image` | PNG (kit or runtime crop). Query: `surface`, `set`, `asset` |
| GET | `/api/share/play-sets/og.png` | 1200×630 letterbox for crawlers (same preference) |

Query:

- `surface` = `play_this_set` \| `integrated_shelf` \| `beat_me_from_set` (or `A` / `B` / `C`)
- `set` = set UUID or public slug (`name-a1b2c3d4`)
- `asset` = `kit` \| `runtime` (default: runtime when a usable cover exists)

## Static kit URLs (packpts.com)

After deploy:

- https://packpts.com/assets/play-sets/play-this-set.png
- https://packpts.com/assets/play-sets/integrated-shelf.png
- https://packpts.com/assets/play-sets/beat-me-from-a-set.png

## OG

`/sets` and `/sets/{slug}` HTML inject title / description / `og:image` / `twitter:image`. Image prefers the runtime cover; otherwise the matching kit. Canonical URL is `/sets` or `/sets/{slug}` (no `/make`).

## Honesty

No Maker Rate, public volume, ≥10 UGC claims, Times Played, or PackPoints spelling on share destinations or meta.

Helpers: `shared/playSetsShare.ts`.
