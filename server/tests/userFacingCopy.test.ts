/**
 * PackPTS spelling + dash cleanup.
 * Acceptance checks from the Design spec: no user-visible "PackPoints",
 * and no em/en dashes left in the player-facing surfaces that spec lists.
 * Internal identifiers (storage keys, User-Agent, bundle IDs, banned-phrase
 * guards, comments) stay and are filtered the same way as the spec grep.
 * Pure Node walk: GitHub runners do not have ripgrep.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SPELLING_RE = /pack[ _-]?points/gi;
const SPELLING_KEEP =
  /packpoints-theme|packpoints_match_secret|User-Agent|com\.(bigtimedee|packpoints)\.|packpoints-dev-secret|packpointsUser|^\S+:\d+:\s*(?:\/\/|\*|\/\*\*)|^\S+:\d+:\s*"(?:packpoints|PackPoints|Pack Points)",$|must not include \/make/;

const DASH_RE = /[\u2013\u2014]/g;
const DASH_KEEP = /^\S+:\d+:\s*(?:\/\/|\*|\/\*|{\/\*)|console\./;

const DASH_FILES = [
  "server/services/emailService.ts",
  "server/services/newsletterService.ts",
  "server/middleware/rateLimiter.ts",
  "server/routes/referrals.ts",
  "server/services/tiktokSandbox.ts",
  "client/src/pages/home.tsx",
  "client/src/pages/friends.tsx",
  "client/src/pages/invite.tsx",
  "client/src/pages/roadmap.tsx",
  "client/src/pages/creators.tsx",
  "client/src/pages/profile.tsx",
  "client/src/pages/collab.tsx",
  "client/src/pages/redemptions.tsx",
  "client/src/pages/marketplace.tsx",
  "client/src/pages/match.tsx",
  "client/src/lib/setsPolish.ts",
  "client/src/lib/dailyBeatMe.ts",
  "client/src/lib/makeIdentifyUi.ts",
  "client/src/lib/prepareIdentifyImage.ts",
];

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function excludedFromSpelling(rel: string): boolean {
  const norm = toPosix(rel);
  if (norm.endsWith(".md")) return true;
  if (norm.split("/").includes("__tests__")) return true;
  if (norm === "server/tests" || norm.startsWith("server/tests/")) return true;
  return false;
}

function walk(start: string): string[] {
  const abs = path.join(ROOT, start);
  const info = statSync(abs);
  if (info.isFile()) return excludedFromSpelling(start) ? [] : [toPosix(start)];
  const out: string[] = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = toPosix(path.relative(ROOT, full));
      if (excludedFromSpelling(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

function textLines(rel: string): string[] | null {
  const buf = readFileSync(path.join(ROOT, rel));
  if (buf.includes(0)) return null;
  return buf.toString("utf8").split(/\r?\n/);
}

function matchingLines(rel: string, pattern: RegExp, drop: RegExp): string[] {
  const lines = textLines(rel);
  if (!lines) return [];
  const hits: string[] = [];
  lines.forEach((line, index) => {
    pattern.lastIndex = 0;
    if (!pattern.test(line)) return;
    const formatted = `${rel}:${index + 1}:${line}`;
    drop.lastIndex = 0;
    if (drop.test(formatted)) return;
    hits.push(formatted);
  });
  return hits;
}

describe("user-facing PackPTS spelling", () => {
  it("emailService.ts has no PackPoints or Pack Points", () => {
    const email = readFileSync(path.join(ROOT, "server/services/emailService.ts"), "utf8");
    expect(email).toContain('export const BRAND_NAME = "PackPTS"');
    expect(email).toContain("const EMAIL_FROM = `${BRAND_NAME} <noreply@packpts.com>`");
    expect(email).toContain("from: EMAIL_FROM");
    expect(email).not.toMatch(/PackPoints|Pack Points/);
  });

  it("server/routes.ts user-facing copy has no PackPoints or Pack Points", () => {
    const routes = readFileSync(path.join(ROOT, "server/routes.ts"), "utf8")
      .split("\n")
      .filter((line) => !/User-Agent/.test(line))
      .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
      .join("\n");
    expect(routes).not.toMatch(/PackPoints|Pack Points/);
    expect(routes).toContain("Verify your PackPTS account link");
  });

  it("source walk returns zero user-visible PackPoints lines", () => {
    const roots = ["client/src", "client/index.html", "client/public", "server", "shared"];
    const hits = roots.flatMap((root) =>
      walk(root).flatMap((rel) => matchingLines(rel, SPELLING_RE, SPELLING_KEEP)),
    );
    expect(hits).toEqual([]);
  });
});

describe("player-facing em and en dashes", () => {
  it("spec surfaces have no em dash or en dash outside comments and console logs", () => {
    const hits = DASH_FILES.flatMap((rel) => matchingLines(rel, DASH_RE, DASH_KEEP));
    expect(hits).toEqual([]);
  });
});
