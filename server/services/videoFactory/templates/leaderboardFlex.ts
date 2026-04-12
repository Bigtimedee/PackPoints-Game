/**
 * leaderboardFlex.ts
 *
 * Template: "Leaderboard Flex" — used for GENERAL content items.
 * 3 frames: hook (3s) → leaderboard display (5s) → CTA (3s)
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
const GOLD = "#fbbf24";
const SILVER = "#94a3b8";
const BRONZE = "#c2853b";
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

/** Decorative leaderboard podium rows — uses placeholder rank/score labels */
function leaderboardRows(startY: number): string {
  const rows = [
    { rank: "1", medal: "🥇", color: GOLD, pts: "9,450 pts" },
    { rank: "2", medal: "🥈", color: SILVER, pts: "8,200 pts" },
    { rank: "3", medal: "🥉", color: BRONZE, pts: "7,600 pts" },
    { rank: "4", medal: "4️⃣", color: ACCENT, pts: "6,980 pts" },
    { rank: "5", medal: "5️⃣", color: MUTED, pts: "6,500 pts" },
  ];
  return rows
    .map(
      (r, i) => `
    <rect x="60" y="${startY + i * 160}" width="${W - 120}" height="140"
      rx="20" fill="#12122a" stroke="${r.color}" stroke-width="2" opacity="0.9" />
    <text x="130" y="${startY + i * 160 + 88}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="60" text-anchor="middle">${r.medal}</text>
    <!-- Masked player name bar -->
    <rect x="200" y="${startY + i * 160 + 36}" width="420" height="48" rx="8" fill="${r.color}" opacity="0.18" />
    <rect x="200" y="${startY + i * 160 + 36}" width="260" height="48" rx="8" fill="${r.color}" opacity="0.35" />
    <text x="${W - 120}" y="${startY + i * 160 + 88}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="52" fill="${r.color}" text-anchor="end" font-weight="700">${r.pts}</text>
  `,
    )
    .join("");
}

/** Frame 1 — hook (3 s) */
function hookFrame(item: ContentItemInput): VideoFrame {
  const lines = wrapLines(item.hook, 22);
  const centerY = H / 2 - (lines.length * 96 * 1.3) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <circle cx="${W / 2}" cy="${H / 2}" r="440" fill="none" stroke="${ACCENT}" stroke-width="2" opacity="0.15" />
    <text x="${W / 2}" y="${H / 2 - 400}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="48" fill="${ACCENT}" text-anchor="middle" font-weight="700" letter-spacing="2">
      🏆 LEADERBOARD
    </text>
    ${multilineText(lines, W / 2, centerY, 96, WHITE, "800", 120)}
    <text x="${W / 2}" y="${H - 160}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="40" fill="${MUTED}" text-anchor="middle">▼ see the rankings ▼</text>
  </svg>`;
  return { svgContent: svg, durationSeconds: 3 };
}

/** Frame 2 — leaderboard display (5 s) */
function leaderboardFrame(item: ContentItemInput): VideoFrame {
  const scriptLines = wrapLines(item.script, 30);
  const tableTop = H / 2 - 380;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}" />
    ${brandBar()}
    <!-- Section header -->
    <text x="${W / 2}" y="${tableTop - 60}"
      font-family="system-ui,Arial,Helvetica,sans-serif"
      font-size="52" fill="${AMBER}" text-anchor="middle" font-weight="700">
      Top Players This Week
    </text>
    ${leaderboardRows(tableTop)}
    <!-- Script note below table -->
    ${multilineText(scriptLines, W / 2, tableTop + 5 * 160 + 40, 48, MUTED, "400")}
  </svg>`;
  return { svgContent: svg, durationSeconds: 5 };
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
  return [hookFrame(item), leaderboardFrame(item), ctaFrame(item)];
}
