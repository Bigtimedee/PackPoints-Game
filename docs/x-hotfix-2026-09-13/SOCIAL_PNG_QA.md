# SOCIAL PNG QA — tofu prevention gate

**Incident:** @PlayPackPTS share PNG shipped with □ tofu glyphs — text was drawn without fonts available at render time (Inter/system assume).  
**Rule:** No social media PNG ships until this gate passes.

Applies to: Design + Eng. Before any X / IG / OG / share PNG leave the box or CI.

---

## 1. Fonts (hard lock)

| Allowed | Path on box / CI |
|---------|------------------|
| DejaVu Sans Bold | `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` |
| DejaVu Sans | `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` |
| DejaVu Sans Mono Bold | `/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf` |

- **Must** open fonts via absolute TTF paths in the renderer (`ImageFont.truetype(...)`).
- **Must not** assume Inter, system UI fonts, CSS `@font-face` remote loads, or browser default fallbacks for final raster.
- If Inter (or other brand UI fonts) are desired later: **embed** the TTF in the render package and assert `Path.exists()` before draw. Until then: DejaVu only.
- Renderer must `raise` if any required TTF is missing — never silently fall back to a default bitmap font.

---

## 2. Render environment

- Render on the **box or CI image that has DejaVu installed** (Debian/Ubuntu `fonts-dejavu-core`).
- Do **not** render share PNGs in a headless browser / Playwright screenshot of HTML that loads Google Fonts / Inter from CDN unless fonts are local + preflight-checked.
- Prefer PIL/Pillow (or similar) with explicit FreeType loads — same pattern as `x-hotfix-2026-09-13/render_hotfix.py`.

---

## 3. Pre-export assertions (automated)

For every text string drawn:

1. Call `font.getbbox(text)` (or per-character) and reject empty / near-empty boxes.
2. Reject missing glyphs (tofu candidates) before `save()`.

For every exported PNG:

1. File size **> 50 KB** for 1080×1080 craft cards (empty/near-empty renders fail this).
2. Sample each drawn text band; reject:
   - near-empty **white** bands on dark canvas (classic □ tofu slab)
   - near-empty **dark** bands (text never inked)
3. Optional: tesseract/OCR smoke — if available, fail on `□` and soft-warn if expected tokens are absent.

Write `docs/x-hotfix-2026-09-13/QA_PASS.txt` (or a CI check log) listing sizes + “no tofu”. Do not put that note in `client/public`.

---

## 4. Visual QA (human, 60 seconds)

Open each PNG at 100% zoom:

- [ ] No □ / replacement boxes anywhere
- [ ] Every headline, sub, CTA, and footer URL is readable
- [ ] Spelling is **PackPTS** (never PackPoints)
- [ ] Colors: canvas `#0b0f16`, ink `#F0F2F5`, muted `#8F96A3`, gold `#F5C518`, blue `#2B6CEE`
- [ ] CTA is `packpts.com` / `/daily` / `/sets` — not `/make` publish
- [ ] No neon / web3 / gambling FOMO treatment

---

## 5. Reject & re-render triggers

Fail the ship if any of:

- Font path missing or renderer fell back to default font
- `getbbox` empty / tofu character detected
- File size ≤ 50 KB for a full 1080 craft card
- White or empty text-band sample fails
- Visual □ spotted in preview
- Brand misspelling or wrong CTA path

Fix: re-render with DejaVu on box/CI; do not “fix in Figma export” without re-running this gate.

---

## 6. Checklist (copy into PR / drop notes)

```
SOCIAL PNG QA
[ ] DejaVu (or embedded) TTFs asserted present
[ ] Rendered on box/CI with those fonts
[ ] getbbox + size >50KB + text-band sample PASS
[ ] Visual: no □ / tofu
[ ] PackPTS spelling + approved CTA
[ ] docs/x-hotfix-2026-09-13/QA_PASS.txt (or CI log) attached
```

---

*Gate owner: PackPTS Design. Eng must not publish share assets that skip this gate.*
