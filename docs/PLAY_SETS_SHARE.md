# Play-integrated set share kit

Marketing + in-product share for sets already in PackPTS. Locked with Daily 5 · Beat-me · integrated `/sets` only.

Design drop: `packpts-design/play-sets/exports/` (copy/rename only — do not invent art).

| Design export | Served as |
|---------------|-----------|
| `play-set-1080.png` | `/assets/play-sets/play-this-set.png` (A) |
| `play-shelf-1080.png` | `/assets/play-sets/integrated-shelf.png` (B) |
| `play-beatme-1080.png` | `/assets/play-sets/beat-me-from-a-set.png` (C) |
| `play-set-story.png` | `/assets/play-sets/play-set-story.png` |
| `play-shelf-story.png` | `/assets/play-sets/play-shelf-story.png` |
| `play-beatme-story.png` | `/assets/play-sets/play-beatme-story.png` |

Surfaces, CTA, UTMs, and runtime-vs-kit rules below are the engineering contract. Cover priority matches `docs/SETS_POLISH.md`. Helper: `copyPlaySetsDesignExports`.

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
| GET | `/api/share/play-sets` | JSON: destination, UTMs, image URL, `imageKind` (`runtime` \| `kit`), `storyUrl` |
| GET | `/api/share/play-sets/image` | PNG (kit, story crop, or runtime). Query: `surface`, `set`/`slug`, `asset`, `format` |
| GET | `/api/share/play-sets/og.png` | 1200×630 letterbox for crawlers (same preference) |

Query:

- `surface` = `play_this_set` \| `integrated_shelf` \| `beat_me_from_set` (or `A` / `B` / `C`)
  - Surface C aliases: `beat_me`, `beat-me`, `beat_me_from_a_set`, `beat-me-from-a-set`, `beatme`
- `set` or `slug` (or `id`) = set UUID **or** public slug (`name-a1b2c3d4`). Full `/sets/{slug}` URLs (with locked UTMs) are cleaned before lookup. Resolved sets use `/sets/{slug}` plus the locked UTMs and prefer the runtime cover when present.
- `asset` = `kit` \| `runtime` (default: runtime when a usable cover exists)
- `format` = `square` (default, 1080) \| `story` (1080×1920). `story=1` is accepted.

## Static kit URLs (packpts.com)

After deploy:

1080 square:

- https://packpts.com/assets/play-sets/play-this-set.png
- https://packpts.com/assets/play-sets/integrated-shelf.png
- https://packpts.com/assets/play-sets/beat-me-from-a-set.png

Story (Design export names, 1080×1920):

- https://packpts.com/assets/play-sets/play-set-story.png
- https://packpts.com/assets/play-sets/play-shelf-story.png
- https://packpts.com/assets/play-sets/play-beatme-story.png

JSON always includes `storyUrl` for the matching surface crop. `GET /api/share/play-sets/image?format=story&surface=beat_me` serves that story PNG (runtime cover letterboxed to 9:16 when `set`/`slug` resolves and `asset` is not `kit`).

## OG

`/sets` and `/sets/{slug}` HTML inject title / description / `og:image` / `twitter:image`. Image prefers the runtime cover; otherwise the matching kit. Canonical URL is `/sets` or `/sets/{slug}` (no `/make`).

## Honesty

No Maker Rate, public volume, ≥10 UGC claims, Times Played, or PackPoints spelling on share destinations or meta.

Helpers: `shared/playSetsShare.ts`.
