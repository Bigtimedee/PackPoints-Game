/**
 * PackPTS spelling + dash cleanup.
 * Acceptance checks from the Design spec: no user-visible "PackPoints",
 * and no em/en dashes left in the player-facing surfaces that spec lists.
 * Internal identifiers (storage keys, User-Agent, bundle IDs, banned-phrase
 * guards, comments) stay and are filtered the same way as the spec grep.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(script: string): string {
  try {
    return execFileSync("bash", ["-lc", script], { cwd: ROOT, encoding: "utf8" });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = String(e.stdout ?? "");
    if (e.status === 1) return stdout;
    throw err;
  }
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

  it("source grep returns zero user-visible PackPoints lines", () => {
    const out = run(`rg -n -i 'pack[ _-]?points' client/src client/index.html client/public server shared \
      --glob '!**/__tests__/**' --glob '!server/tests/**' --glob '!*.md' \
      | rg -v 'packpoints-theme|packpoints_match_secret|User-Agent|com\\.(bigtimedee|packpoints)\\.|packpoints-dev-secret|packpointsUser|^\\S+:\\d+:\\s*(//|\\*|/\\*\\*)|^\\S+:\\d+:\\s*"(packpoints|PackPoints|Pack Points)",$|must not include /make'`);
    expect(out.trim()).toBe("");
  });
});

describe("player-facing em and en dashes", () => {
  it("spec surfaces have no em dash or en dash outside comments and console logs", () => {
    const out = run(`rg -n '[\\x{2013}\\x{2014}]' server/services/emailService.ts server/services/newsletterService.ts \
      server/middleware/rateLimiter.ts server/routes/referrals.ts server/services/tiktokSandbox.ts \
      client/src/pages/home.tsx client/src/pages/friends.tsx client/src/pages/invite.tsx \
      client/src/pages/roadmap.tsx client/src/pages/creators.tsx client/src/pages/profile.tsx \
      client/src/pages/collab.tsx client/src/pages/redemptions.tsx client/src/pages/marketplace.tsx \
      client/src/pages/match.tsx \
      client/src/lib/setsPolish.ts client/src/lib/dailyBeatMe.ts client/src/lib/makeIdentifyUi.ts \
      client/src/lib/prepareIdentifyImage.ts \
      | rg -v '^\\S+:\\d+:\\s*(//|\\*|/\\*|\\{/\\*)|console\\.'`);
    expect(out.trim()).toBe("");
  });
});
