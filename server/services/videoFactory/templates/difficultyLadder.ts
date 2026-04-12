/**
 * difficultyLadder.ts
 *
 * Template: "Difficulty Ladder" — used for CHALLENGE_RECAP content items.
 * 4 frames: hook (2s) → "can you beat it?" (3s) → challenge desc (2s) → CTA (3s)
 */
import type { VideoFrame } from "../compositor";
import { escapeXml, wrapLines } from "../svgHelpers";

export interface ContentItemInput {
  hook: string;
  script: string;
  overlayText: string;
  cta: string;
}

const BG = "#0a0a18";
const ACCENT = "#6366f1";
const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const RED = "#ef4444";
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

/** Ladder rungs decorative element */
function ladderRungs(x: number, y: number): string {
  const rungs = [
    { label: "EASY", color: GREEN, w: 220 },
    { label: "MEDIUM", color: AMBER, w: 300 },
    { label: "HARD", color: RED, w: 380 },
  ];
  return rungs
    .map(
      (r, i) => `
    <rect x="${x - r.w / 2}" y="${y + i * 120}" width="${r.w}" height="72" rx="16" fill="${r.color}" opacity="0.85" />
    <text x="${x}" y="${y + i * 120 + 48}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="40" fill="${WHITE}" text-anchor="middle" font-weight="700">${r.label}</text>
  `,
    )
    .join("");
}

/** Frame 1 — hook (2 s) */
function hookFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.hook, 22);
  const centerY = H / 2 - (lines.length * 96 * 1.3) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <text x="${W / 2}" y="${H / 2 - 420}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="48" fill="${AMBER}" text-anchor="middle" font-weight="700" letter-spacing="2">
      🎯 CHALLENGE RECAP
    </text>
    ${multilineText(lines, W / 2, centerY, 96, WHITE, "800", 120)}
    <text x="${W / 2}" y="${H - 160}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="40" fill="${MUTED}" text-anchor="middle">▼ see the difficulty ▼</text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 2 };
}

/** Frame 2 — "can you beat it?" with ladder (3 s) */
function ladderFrame(_item: ContentItemInput): VideoFrame {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <text x="${W / 2}" y="${H / 2 - 340}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="80" fill="${WHITE}" text-anchor="middle" font-weight="800">
      Can you beat it?
    </text>
    ${ladderRungs(W / 2, H / 2 - 160)}
    <text x="${W / 2}" y="${H / 2 + 360}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="52" fill="${ACCENT}" text-anchor="middle" font-weight="700">
      Where do you rank? 👇
    </text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 3 };
}

/** Frame 3 — challenge description (2 s) */
function challengeFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.script, 26);
  const blockH = lines.length * 68 * 1.3;
  const startY = H / 2 - blockH / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <rect x="60" y="${startY - 110}" width="${W - 120}" height="${blockH + 200}"
      rx="32" ry="32" fill="#12122a" stroke="${AMBER}" stroke-width="2" />
    <text x="${W / 2}" y="${startY - 50}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="44" fill="${AMBER}" text-anchor="middle" font-weight="700">
      🏆 The Challenge
    </text>
    ${multilineText(lines, W / 2, startY, 68, WHITE, "500")}
  </svg>`;
  return { svgContent: svg, durationSeconds: 2 };
}

/** Frame 4 — CTA (3 s) */
function ctaFrame(item: ContentItemInput): VideoFrame {
  const overlayLines = wrapLines(item.overlayText, 24);
  const ctaLines = wrapLines(item.cta, 30);
  const oly = H / 2 - 200;
  const ctaY = H / 2 + 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="460" ry="300" fill="${ACCENT}" opacity="0.06" />
    ${multilineText(overlayLines, W / 2, oly, 84, WHITE, "800", 104)}
    <rect x="120" y="${ctaY - 36}" width="${W - 240}" height="2" fill="${ACCENT}" opacity="0.5" />
    ${multilineText(ctaLines, W / 2, ctaY, 54, MUTED, "500")}
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
  return [hookFrame(item), ladderFrame(item), challengeFrame(item), ctaFrame(item)];
}
