/**
 * Solo masked-image failure. The spinner is only legal while a replace is
 * actually in flight. Failure, an empty body, and the hard cap leave an
 * honest retry/skip state. A reveal URL paints over all of that.
 * Daily 5 never enters `replacing`.
 */

export const SOLO_REPLACE_HARD_CAP_MS = 7000;

export type SoloReplacePhase = "idle" | "replacing" | "failed" | "revealed";

export type SoloReplaceEvent =
  | { type: "image-rejected"; allowReplace: boolean }
  | { type: "replace-succeeded" }
  | { type: "replace-empty" }
  | { type: "replace-failed" }
  | { type: "replace-timeout" }
  | { type: "reveal" }
  | { type: "retry" }
  | { type: "next-card" };

export function reduceSoloReplacePhase(
  phase: SoloReplacePhase,
  event: SoloReplaceEvent,
): SoloReplacePhase {
  if (event.type === "next-card") return "idle";
  if (event.type === "reveal") return "revealed";
  if (phase === "revealed") return "revealed";

  switch (event.type) {
    case "image-rejected":
      if (!event.allowReplace) return "failed";
      if (phase === "replacing" || phase === "failed") return "failed";
      return "replacing";
    case "replace-succeeded":
      return "idle";
    case "replace-empty":
    case "replace-failed":
    case "replace-timeout":
      return "failed";
    case "retry":
      return "idle";
    default:
      return phase;
  }
}

/**
 * Locked while a replace is in flight, and after it fails, until a card is
 * actually on screen. A revealed card is not locked.
 */
export function soloAnswersLocked(phase: SoloReplacePhase): boolean {
  return phase === "replacing" || phase === "failed";
}

export type ForcedImageOverlay = "spinner" | "honest" | "replace-failed" | "default";

/**
 * `default` lets the older skip/replace-button resolver run (1v1).
 * Daily 5 (`allowClientImageReject` false) is always the honest overlay.
 * A reveal URL is not an overlay — the caller paints the r/ image.
 */
export function gameCardReplaceOverlay(opts: {
  allowClientImageReject: boolean;
  replacePhase?: SoloReplacePhase;
  revealUrl?: string | null;
}): ForcedImageOverlay {
  if (opts.revealUrl) return "default";
  if (!opts.allowClientImageReject) return "honest";
  if (opts.replacePhase === "replacing") return "spinner";
  if (opts.replacePhase === "failed") return "replace-failed";
  return "default";
}
