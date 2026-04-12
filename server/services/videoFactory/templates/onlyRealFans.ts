/**
 * onlyRealFans.ts
 *
 * Template: "Only Real Fans" — used for SCORE_HIGHLIGHT content items.
 * 4 frames: hook (3s) → guess prompt (4s) → "type below" (2s) → reveal + CTA (3s)
 */
import type { VideoFrame } from "../compositor";
import { escapeXml, wrapLines } from "../svgHelpers";

export interface ContentItemInput {
  hook: string;
  script: string;
  overlayText: string;
  cta: string;
  caption: string;
}

const BG = "#0a0a18";
const ACCENT = "#6366f1";
const AMBER = "#f59e0b";
const WHITE = "#ffffff";
const MUTED = "#94a3b8";
const W = 1080;
const H = 1920;

function brandBar(): string {
  return `
    <rect x="0" y="0" width="${W}" height="8" fill="${ACCENT}" />
    <text x="${W / 2}" y="${H - 60}" font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="36" fill="${MUTED}" text-anchor="middle" font-weight="600" letter-spacing="6">
      PACKPTS
    </text>
    <rect x="0" y="${H - 8}" width="${W}" height="8" fill="${ACCENT}" />
  `;
}

function multilineText(
  lines: string[],
  cx: number,
  startY: number,
  fontSize: number,
  fill: string,
  fontWeight = "400",
  lineHeight?: number,
): string {
  const lh = lineHeight ?? fontSize * 1.3;
  return lines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${startY + i * lh}"
          font-family="system-ui,Arial,Helvetica,sans-serif"
          font-size="${fontSize}" fill="${fill}" text-anchor="middle"
          font-weight="${fontWeight}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

/** Frame 1 — hook (3 s) */
function hookFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.hook, 22);
  const centerY = H / 2 - (lines.length * 96 * 1.25) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Decorative ring -->
    <circle cx="${W / 2}" cy="${H / 2}" r="420" fill="none" stroke="${ACCENT}" stroke-width="2" opacity="0.18" />
    <circle cx="${W / 2}" cy="${H / 2}" r="340" fill="none" stroke="${ACCENT}" stroke-width="1" opacity="0.10" />
    <!-- Hook text -->
    <text x="${W / 2}" y="${H / 2 - 380}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="48" fill="${AMBER}" text-anchor="middle" font-weight="700" letter-spacing="3">
      ONLY REAL FANS KNOW
    </text>
    ${multilineText(lines, W / 2, centerY, 96, WHITE, "800", 120)}
    <!-- Swipe hint -->
    <text x="${W / 2}" y="${H - 160}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="40" fill="${MUTED}" text-anchor="middle">▼ keep watching ▼</text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 3 };
}

/** Frame 2 — guess prompt (4 s) */
function guessFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.script, 24);
  const blockH = lines.length * 72 * 1.3;
  const startY = H / 2 - blockH / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Card-style panel -->
    <rect x="60" y="${H / 2 - blockH / 2 - 100}" width="${W - 120}" height="${blockH + 200}"
      rx="32" ry="32" fill="#12122a" stroke="${ACCENT}" stroke-width="2" opacity="0.95" />
    <text x="${W / 2}" y="${H / 2 - blockH / 2 - 40}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="44" fill="${AMBER}" text-anchor="middle" font-weight="700">
      🃏 Can you guess?
    </text>
    ${multilineText(lines, W / 2, startY, 68, WHITE, "600")}
  </svg>`;
  return { svgContent: svg, durationSeconds: 4 };
}

/** Frame 3 — "type your answer below" (2 s) */
function typeFrame(_item: ContentItemInput): VideoFrame {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <text x="${W / 2}" y="${H / 2 - 160}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="120" text-anchor="middle">💬</text>
    <text x="${W / 2}" y="${H / 2 + 40}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="72" fill="${WHITE}" text-anchor="middle" font-weight="800">
      Type your answer
    </text>
    <text x="${W / 2}" y="${H / 2 + 140}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="72" fill="${ACCENT}" text-anchor="middle" font-weight="800">
      in the comments ↓
    </text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 2 };
}

/** Frame 4 — reveal + CTA (3 s) */
function revealFrame(item: ContentItemInput): VideoFrame {
  const overlayLines = wrapLines(item.overlayText, 22);
  const ctaLines = wrapLines(item.cta, 28);
  const revealY = H / 2 - 200;
  const ctaY = H / 2 + 180;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Glow backdrop -->
    <ellipse cx="${W / 2}" cy="${H / 2 - 100}" rx="440" ry="280" fill="${ACCENT}" opacity="0.08" />
    <text x="${W / 2}" y="${revealY - 80}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="52" fill="${AMBER}" text-anchor="middle" font-weight="700">
      ✅ The Answer:
    </text>
    ${multilineText(overlayLines, W / 2, revealY, 88, WHITE, "800", 108)}
    <!-- Divider -->
    <rect x="120" y="${ctaY - 40}" width="${W - 240}" height="2" fill="${ACCENT}" opacity="0.5" />
    ${multilineText(ctaLines, W / 2, ctaY, 56, MUTED, "500")}
    <!-- App badge -->
    <rect x="280" y="${H - 280}" width="520" height="100" rx="50" fill="${ACCENT}" />
    <text x="${W / 2}" y="${H - 216}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="48" fill="${WHITE}" text-anchor="middle" font-weight="700">
      Download PackPTS
    </text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 3 };
}

export function buildFrames(item: ContentItemInput): VideoFrame[] {
  return [hookFrame(item), guessFrame(item), typeFrame(item), revealFrame(item)];
}
