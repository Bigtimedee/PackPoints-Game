# Score-card fonts

Latin-subset **Inter** TTFs, SIL Open Font License 1.1 (`OFL.txt`).

These files ship in the Railway image. `fonts.ts` outlines them into SVG
paths so Sharp never depends on Alpine system fonts (which are absent and
produce tofu glyphs). Maker-share v1 uses the same Inter outlines; DejaVu
Sans is the documented fallback if Inter is missing on a host that has it
(`/usr/share/fonts/truetype/dejavu/`).

Source: [Inter](https://github.com/rsms/inter) via Fontsource latin subsets
(`inter@5.2.8` 400 / 600 / 700).
