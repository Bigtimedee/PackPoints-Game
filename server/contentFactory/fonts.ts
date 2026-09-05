/**
 * Bundled Inter (SIL OFL 1.1) for score-card PNGs.
 *
 * Railway's Alpine image has no system fonts. Sharp/librsvg then draws
 * tofu boxes for every <text> node. These TTFs ship in the deploy and are
 * outlined into SVG paths at generate time so rendering never asks
 * fontconfig for a face.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import opentype, { type Font } from "opentype.js";

export const FONT_FILES = {
  regular: "Inter-Regular.ttf",
  semibold: "Inter-SemiBold.ttf",
  bold: "Inter-Bold.ttf",
} as const;

export interface ScoreCardFonts {
  regular: Font;
  semibold: Font;
  bold: Font;
  dir: string;
}

let cached: ScoreCardFonts | null = null;

function candidateFontDirs(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "fonts"));
  } catch {
    // CJS bundle has no import.meta.url
  }
  if (typeof __dirname !== "undefined") {
    dirs.push(path.join(__dirname, "assets", "fonts"));
    dirs.push(path.join(__dirname, "contentFactory", "assets", "fonts"));
  }
  dirs.push(path.join(process.cwd(), "server", "contentFactory", "assets", "fonts"));
  dirs.push("/app/server/contentFactory/assets/fonts");
  return dirs;
}

export function resolveFontsDir(): string {
  for (const dir of candidateFontDirs()) {
    if (fs.existsSync(path.join(dir, FONT_FILES.bold))) {
      return dir;
    }
  }
  throw new Error(
    `[ContentFactory] Score-card fonts missing. Expected ${FONT_FILES.bold} under server/contentFactory/assets/fonts (bundled with the deploy).`,
  );
}

export function loadScoreCardFonts(): ScoreCardFonts {
  if (cached) return cached;
  const dir = resolveFontsDir();
  cached = {
    regular: opentype.parse(fs.readFileSync(path.join(dir, FONT_FILES.regular))),
    semibold: opentype.parse(fs.readFileSync(path.join(dir, FONT_FILES.semibold))),
    bold: opentype.parse(fs.readFileSync(path.join(dir, FONT_FILES.bold))),
    dir,
  };
  return cached;
}

/** @font-face CSS with base64 TTFs — self-contained SVG, no system fonts. */
export function buildEmbeddedFontCss(fonts = loadScoreCardFonts()): string {
  const face = (family: string, file: string, weight: number) => {
    const bytes = fs.readFileSync(path.join(fonts.dir, file));
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url('data:font/ttf;base64,${bytes.toString("base64")}') format('truetype');}`;
  };
  return [
    face("Inter", FONT_FILES.regular, 400),
    face("Inter", FONT_FILES.semibold, 600),
    face("Inter", FONT_FILES.bold, 700),
  ].join("");
}

export function measureText(font: Font, text: string, fontSize: number, letterSpacing = 0): number {
  if (!text) return 0;
  const chars = [...text];
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    width += font.getAdvanceWidth(chars[i], fontSize);
    if (i < chars.length - 1) width += letterSpacing;
  }
  return width;
}

export function textToPath(
  font: Font,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  options: { anchor?: "start" | "middle" | "end"; letterSpacing?: number } = {},
): string {
  if (!text) return "";
  const letterSpacing = options.letterSpacing ?? 0;
  const width = measureText(font, text, fontSize, letterSpacing);
  let cx = x;
  if (options.anchor === "end") cx = x - width;
  if (options.anchor === "middle") cx = x - width / 2;

  const parts: string[] = [];
  for (const ch of text) {
    if (ch.trim() !== "") {
      const d = font.getPath(ch, cx, y, fontSize).toPathData({ decimalPlaces: 2, flipY: false });
      if (!d) {
        throw new Error(`[ContentFactory] Failed to outline ${JSON.stringify(ch)}`);
      }
      parts.push(`<path d="${d}" fill="${fill}"/>`);
    }
    cx += font.getAdvanceWidth(ch, fontSize) + letterSpacing;
  }
  return parts.join("");
}
