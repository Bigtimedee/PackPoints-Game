/**
 * Design toast + confirm craft for admin Playable Sets hard-delete.
 * SoR: docs/design/ADMIN_SET_DELETE_TOAST.md
 * Eng owns API status codes and message strings; Design maps them into the toast shell.
 */

import { ApiError } from "./queryClient";

export const GAME_SET_DELETE_TOAST = {
  successTitle: "Set deleted",
  successFallback: "The game set has been permanently removed.",
  blockedTitle: "Can't delete yet",
  connectionBody: "Check your connection and try again.",
  confirmTitle: "Delete Game Set",
  confirmPrimary: "Delete permanently",
  confirmSecondary: "Cancel",
} as const;

/** Opaque strings Design bans as user-facing delete titles/bodies. */
export const GAME_SET_DELETE_BANNED_OPAQUE = [
  "Delete failed",
  "Something went wrong",
  "Failed to delete game set",
] as const;

export type GameSetDeleteToast = {
  title: string;
  description: string;
};

function trimOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isOpaqueDeleteCopy(text: string): boolean {
  const normalized = trimOneLine(text).toLowerCase();
  return GAME_SET_DELETE_BANNED_OPAQUE.some(
    (banned) => normalized === banned.toLowerCase(),
  );
}

/**
 * Success toast after DELETE 200.
 * Prefer set name + honest stored-card count; fall back when N is unknown.
 */
export function gameSetDeleteSuccessToast(opts: {
  setName?: string | null;
  storedCardCount?: number | null;
}): GameSetDeleteToast {
  const name = typeof opts.setName === "string" ? opts.setName.trim() : "";
  const count = opts.storedCardCount;
  const knownCount = typeof count === "number" && Number.isFinite(count) && count >= 0;

  if (name && knownCount) {
    return {
      title: GAME_SET_DELETE_TOAST.successTitle,
      description: `"${name}" and ${count} stored cards are gone.`,
    };
  }

  return {
    title: GAME_SET_DELETE_TOAST.successTitle,
    description: GAME_SET_DELETE_TOAST.successFallback,
  };
}

/**
 * Blocked / failed delete toast. Title is never opaque "Delete failed".
 * Prefer Eng 409 / constraint / import one-liner; connection fallback otherwise.
 */
export function gameSetDeleteBlockedToast(error: unknown): GameSetDeleteToast {
  const title = GAME_SET_DELETE_TOAST.blockedTitle;

  if (error instanceof ApiError) {
    const message = trimOneLine(error.message || "");
    if (message && !isOpaqueDeleteCopy(message)) {
      return { title, description: message };
    }
    return { title, description: GAME_SET_DELETE_TOAST.connectionBody };
  }

  if (error instanceof Error) {
    const message = trimOneLine(error.message || "");
    const networkish =
      !message ||
      /failed to fetch|networkerror|network request failed|load failed|aborted|timed out|timeout/i.test(
        message,
      ) ||
      isOpaqueDeleteCopy(message);

    if (networkish) {
      return { title, description: GAME_SET_DELETE_TOAST.connectionBody };
    }
    return { title, description: message };
  }

  return { title, description: GAME_SET_DELETE_TOAST.connectionBody };
}

/** Confirm modal body — honest COUNT(*) stored cards, not gameplay-filtered zero. */
export function gameSetDeleteConfirmBody(
  setName: string,
  storedCardCount: number,
): string {
  const name = setName.trim() || "this set";
  const count = Number.isFinite(storedCardCount) ? Math.max(0, Math.floor(storedCardCount)) : 0;
  return `Permanently delete "${name}"? This will hard-delete the set and ${count} stored cards. This cannot be undone.`;
}
