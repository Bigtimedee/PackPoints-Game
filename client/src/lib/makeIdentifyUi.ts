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

/** Staff-only Design QA: seed a Failed slot without calling identify. */
export const QA_IDENTIFY_FAIL_STORAGE_KEY = "packpts:make:qaIdentifyFail";
export const QA_IDENTIFY_FAIL_ENTRY_ID = "qa-identify-fail";

export function searchWantsQaIdentifyFail(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return params.get("qaIdentifyFail") === "1" || params.get("qa") === "identify-fail";
}

export function storageWantsQaIdentifyFail(
  getItem: (key: string) => string | null | undefined,
): boolean {
  try {
    return getItem(QA_IDENTIFY_FAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Gate: URL or one-shot storage, staff/admin only. Non-staff always false (no leak). */
export function staffWantsQaIdentifyFail(args: {
  isAdmin: boolean | undefined;
  search: string;
  readStorage?: (key: string) => string | null | undefined;
}): boolean {
  if (!args.isAdmin) return false;
  if (searchWantsQaIdentifyFail(args.search)) return true;
  if (args.readStorage && storageWantsQaIdentifyFail(args.readStorage)) return true;
  return false;
}

export function consumeQaIdentifyFailStorage(removeItem: (key: string) => void): void {
  try {
    removeItem(QA_IDENTIFY_FAIL_STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
}

export function makeQaPreviewFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "preview.jpg", {
    type: "image/jpeg",
  });
}

export function makeQaIdentifyFailEntry(file: File): {
  id: typeof QA_IDENTIFY_FAIL_ENTRY_ID;
  file: File;
  status: "error";
  error: typeof IDENTIFY_RETRY_COPY.failed;
} {
  return {
    id: QA_IDENTIFY_FAIL_ENTRY_ID,
    file,
    status: "error",
    error: IDENTIFY_RETRY_COPY.failed,
  };
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
