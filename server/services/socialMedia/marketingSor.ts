/**
 * Marketing SoR lock for autonomous social posts.
 *
 * Organic Daily 5 reference: https://x.com/PlayPackPTS/status/2100232354249728403
 * Copy kit: client/public/assets/x-hotfix-2026-09-13/CAPTIONS.md (post2 ritual)
 *
 * Auto X posts: Daily 5 announcement/recap only, sparse hashtags (≤2).
 * Signup-bonus / 250-free / FOMO acquisition copy must never auto-publish.
 */

export const MARKETING_SOR_HASHTAGS = ["#PackPTS", "#Daily5"] as const;
export const MAX_AUTO_HASHTAGS = 2;
export const DAILY5_CTA_PATH = "/daily";
export const AUTO_CAMPAIGN_ID = "daily5-ritual-v1";
export const AUTO_CONTENT_TYPE = "CHALLENGE" as const;

export const FORBIDDEN_AUTO_CONTENT_TYPES = new Set([
  "NEW_USER_ACQUISITION",
  "REWARD_ANNOUNCEMENT",
]);

export type Daily5Ritual = "announcement" | "recap";
export type AbGroup = "A" | "B" | "C";

export interface SorReject {
  matched: true;
  reason: string;
}

export interface SorPass {
  matched: false;
}

export type SorCopyCheck = SorReject | SorPass;

/** Patterns that are the P0 FOMO / signup-bonus spam, not Daily 5 scoring ("earned 250 points"). */
export const FOMO_ACQUISITION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "250_free", re: /250\s*free/i },
  { name: "free_packpts_bonus", re: /free\s+packpts/i },
  { name: "signup_bonus", re: /sign[\s-]?up\s+bonus/i },
  { name: "new_players_get", re: /new\s+players\s+get/i },
  { name: "new_accounts_get", re: /new\s+accounts\s+get/i },
  { name: "claim_yours", re: /claim\s+yours/i },
  { name: "claim_your_points", re: /claim\s+your\s+\d+/i },
  { name: "no_catch", re: /\bno\s+catch\b/i },
  { name: "no_purchase_needed", re: /no\s+purchase\s+needed/i },
  { name: "just_for_joining", re: /just\s+for\s+joining/i },
  { name: "welcome_bonus", re: /welcome\s+bonus/i },
  { name: "bonus_for_joining", re: /bonus\s+(?:for|on)\s+(?:new|joining|signup|sign[\s-]?up)/i },
  { name: "limited_time_spots", re: /limited\s+(?:time|spots)/i },
  { name: "expire_tonight", re: /expire[sd]?\s+tonight/i },
  { name: "dont_miss", re: /don['’]?t\s+miss/i },
  { name: "last_chance", re: /last\s+chance/i },
  { name: "spots_remaining", re: /spots?\s+remaining/i },
  { name: "free_pts_on_signup", re: /free\s+(?:pts|points|packpts).{0,40}sign[\s-]?up/i },
  { name: "on_signup_free_pts", re: /sign[\s-]?up.{0,40}(?:250|free\s+(?:pts|points))/i },
];

export function isForbiddenAutoContentType(contentType: string): boolean {
  return FORBIDDEN_AUTO_CONTENT_TYPES.has(contentType);
}

export function collectHashtags(copyText: string, extra?: readonly string[] | null): string[] {
  const fromCopy = copyText.match(/#\w+/g) ?? [];
  const fromExtra = (extra ?? []).filter((t) => typeof t === "string" && t.startsWith("#"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromCopy, ...fromExtra]) {
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function isHashtagDump(copyText: string, extra?: readonly string[] | null): boolean {
  return collectHashtags(copyText, extra).length > MAX_AUTO_HASHTAGS;
}

export function detectFomoAcquisitionCopy(text: string): SorCopyCheck {
  for (const { name, re } of FOMO_ACQUISITION_PATTERNS) {
    if (re.test(text)) {
      return { matched: true, reason: `fomo_acquisition_copy: ${name}` };
    }
  }
  return { matched: false };
}

export function detectMarketingSorViolation(
  copyText: string,
  hashtags?: readonly string[] | null,
): SorCopyCheck {
  const fomo = detectFomoAcquisitionCopy(copyText);
  if (fomo.matched) return fomo;
  const tags = collectHashtags(copyText, hashtags);
  if (tags.length > MAX_AUTO_HASHTAGS) {
    return {
      matched: true,
      reason: `hashtag_dump: ${tags.length} tags (max ${MAX_AUTO_HASHTAGS})`,
    };
  }
  return { matched: false };
}

export function sparseHashtags(): string[] {
  return [...MARKETING_SOR_HASHTAGS];
}

export function daily5CtaUrl(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${DAILY5_CTA_PATH}`;
}

export function buildDaily5Copy(
  ritual: Daily5Ritual,
  abGroup: AbGroup,
  siteUrl: string,
): string {
  const cta = daily5CtaUrl(siteUrl);
  if (ritual === "recap") {
    const lines =
      abGroup === "A"
        ? "Today's Daily 5 is done. Come back tomorrow for a new five."
        : abGroup === "B"
        ? "Daily 5 is closed for today. New five tomorrow."
        : "That's the Daily 5. See you tomorrow.";
    return `${lines}\n\nKnowledge pays.\n\n→ ${cta}`;
  }

  // Announcement — CAPTIONS.md post2 ritual (SoR reference)
  const lines =
    abGroup === "A"
      ? "Daily 5. Guess who. Keep the streak."
      : abGroup === "B"
      ? "Daily 5 is live. Guess who. Keep the streak."
      : "Daily 5. Same five cards. Keep the streak.";
  return `${lines}\n\nKnowledge pays.\n\n→ ${cta}`;
}

export function inferDaily5Ritual(now = new Date()): Daily5Ritual {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourPart, 10);
  return hour >= 15 ? "recap" : "announcement";
}

export function resolveAutoContentType(requested?: string): typeof AUTO_CONTENT_TYPE {
  void requested;
  return AUTO_CONTENT_TYPE;
}
