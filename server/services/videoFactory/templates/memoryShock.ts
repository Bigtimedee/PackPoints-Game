/**
 * memoryShock.ts
 *
 * Template: "Memory Shock" — used for STREAK_MILESTONE content items.
 * 3 frames: "did you know?" opener (3s) → fact / milestone (4s) → CTA (3s)
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
const WHITE = "#ffffff";
const MUTED = "#94a3b8";
const W = 1080;
const H = 1920;

function brandBar(): string {
  return `
    <rect x="0" y="0" width="${W}" height="8" fill="${AMBER}" />
    <text x="${W / 2}" y="${H - 60}" font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="36" fill="${MUTED}" text-anchor="middle" font-weight="600" letter-spacing="6">
      PACKPTS
    </text>
    <rect x="0" y="${H - 8}" width="${W}" height="8" fill="${AMBER}" />
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

/** Flame streak icon cluster */
function flameCluster(cx: number, y: number): string {
  return `
    <text x="${cx - 80}" y="${y}" font-size="100" text-anchor="middle">🔥</text>
    <text x="${cx}" y="${y - 30}" font-size="140" text-anchor="middle">🔥</text>
    <text x="${cx + 80}" y="${y}" font-size="100" text-anchor="middle">🔥</text>
  `;
}

/** Frame 1 — "Did you know?" opener (3 s) */
function openerFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.hook, 22);
  const centerY = H / 2 - (lines.length * 96 * 1.3) / 2 + 80;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Pulsing ring effect -->
    <circle cx="${W / 2}" cy="${H / 2}" r="450" fill="none" stroke="${AMBER}" stroke-width="3" opacity="0.12" />
    <circle cx="${W / 2}" cy="${H / 2}" r="380" fill="none" stroke="${AMBER}" stroke-width="2" opacity="0.08" />
    <!-- Flames -->
    ${flameCluster(W / 2, H / 2 - 340)}
    <!-- "Did you know?" label -->
    <text x="${W / 2}" y="${H / 2 - 120}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="56" fill="${AMBER}" text-anchor="middle" font-weight="800" letter-spacing="2">
      DID YOU KNOW?
    </text>
    ${multilineText(lines, W / 2, centerY, 88, WHITE, "700", 110)}
    <text x="${W / 2}" y="${H - 160}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="40" fill="${MUTED}" text-anchor="middle">▼ keep watching ▼</text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 3 };
}

/** Frame 2 — streak milestone fact (4 s) */
function milestoneFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.script, 24);
  const blockH = lines.length * 72 * 1.3;
  const panelTop = H / 2 - blockH / 2 - 120;
  const panelH = blockH + 240;
  const startY = panelTop + 140;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Glow -->
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="420" ry="320" fill="${AMBER}" opacity="0.05" />
    <!-- Card panel -->
    <rect x="60" y="${panelTop}" width="${W - 120}" height="${panelH}"
      rx="32" ry="32" fill="#12122a" stroke="${AMBER}" stroke-width="2" />
    <text x="${W / 2}" y="${panelTop + 80}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="52" fill="${AMBER}" text-anchor="middle" font-weight="700">
      🔥 Streak Milestone
    </text>
    ${multilineText(lines, W / 2, startY, 68, WHITE, "600")}
  </svg>`;
  return { svgContent: svg, durationSeconds: 4 };
}

/** Frame 3 — CTA (3 s) */
function ctaFrame(item: ContentItemInput): VideoFrame {
  const overlayLines = wrapLines(item.overlayText, 24);
  const ctaLines = wrapLines(item.cta, 30);
  const oly = H / 2 - 220;
  const ctaY = H / 2 + 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="460" ry="300" fill="${AMBER}" opacity="0.05" />
    ${multilineText(overlayLines, W / 2, oly, 84, WHITE, "800", 104)}
    <rect x="120" y="${ctaY - 36}" width="${W - 240}" height="2" fill="${AMBER}" opacity="0.5" />
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
  return [openerFrame(item), milestoneFrame(item), ctaFrame(item)];
}
