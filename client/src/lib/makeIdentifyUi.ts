/**
 * Locked copy + slot chrome for /make empty state and identify retry.
 * Contracts: docs/design/EMPTY_STATE.md, docs/design/IDENTIFY_RETRY.md
 */

export const MAKE_EMPTY_COPY = {
  eyebrow: "SNAP-TO-SET",
  headline: "Photo the stack. Name it. Publish.",
  subline: "Sample cards below — not your PC. Snap yours to start.",
  exampleBadge: "EXAMPLE · NOT YOUR PC",
  primaryCta: "Take photo",
  secondaryCta: "Choose from library",
  softAuth: "Sign in to photo your stack.",
} as const;

export const IDENTIFY_RETRY_COPY = {
  queued: "Queued",
  identifying: "Identifying…",
  failed: "Couldn't identify",
  tryAgain: "Try again",
  skip: "Skip",
  saved: "Saved",
  eyebrow: "SNAP-TO-SET",
  headline: "Identifying your stack",
  subline: "One card at a time. Failed slots stay actionable — skip anytime.",
  sequential: "Sequential",
  crumb: "/make · draft",
} as const;

export type IdentifySlotStatus = "queued" | "loading" | "ok" | "error";

export function draftBoardTitle(count: number): string {
  return `Draft • ${count} card${count === 1 ? "" : "s"}`;
}

export function draftPhotoLabel(index: number): string {
  return `Photo ${String(index + 1).padStart(2, "0")}`;
}

export function draftSlotTitle(
  status: IdentifySlotStatus,
  card: { year?: number; brand?: string } | undefined,
  index: number,
): string {
  if (status === "ok" && card && (card.year || card.brand)) {
    return [card.year, card.brand].filter(Boolean).join(" ");
  }
  return draftPhotoLabel(index);
}

export interface IdentifySlotChrome {
  label: string | null;
  showTryAgain: boolean;
  showSkip: boolean;
  success: boolean;
  failBorder: boolean;
}

export function identifySlotChrome(status: IdentifySlotStatus): IdentifySlotChrome {
  switch (status) {
    case "queued":
      return {
        label: IDENTIFY_RETRY_COPY.queued,
        showTryAgain: false,
        showSkip: false,
        success: false,
        failBorder: false,
      };
    case "loading":
      return {
        label: IDENTIFY_RETRY_COPY.identifying,
        showTryAgain: false,
        showSkip: false,
        success: false,
        failBorder: false,
      };
    case "ok":
      return {
        label: IDENTIFY_RETRY_COPY.saved,
        showTryAgain: false,
        showSkip: false,
        success: true,
        failBorder: false,
      };
    case "error":
      return {
        label: IDENTIFY_RETRY_COPY.failed,
        showTryAgain: true,
        showSkip: true,
        success: false,
        failBorder: true,
      };
  }
}

/** Gold at 40% — optional quiet fail border (IDENTIFY_RETRY). */
export const IDENTIFY_FAIL_BORDER = "rgba(245, 197, 24, 0.4)";
export const MAKE_CANVAS = "#0b0f16";
export const MAKE_INK = "#F0F2F5";
export const MAKE_MUTED = "#8F96A3";
export const MAKE_GOLD = "#F5C518";
export const MAKE_GREEN = "#22C55E";
export const MAKE_BLUE = "#2B6CEE";
export const MAKE_NAVY = "#1B2838";
export const MAKE_PANEL = "#12171F";
export const MAKE_CREAM = "#F3E6C8";
export const MAKE_CREAM_ALT = "#E2D3B3";
