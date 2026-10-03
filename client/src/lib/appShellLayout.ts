/**
 * App shell layout per route.
 *
 * /match/* is a fixed play viewport, so its main clips (overflow-hidden).
 * /game/* hosts the solo setup screen, the guest hard wall and Game Complete
 * as well as active play, so its main scrolls. Active play fills main with
 * `h-full overflow-hidden` (game.tsx game-active-viewport), so play itself
 * still never scrolls the page.
 * Other routes return null and use the default scroll column.
 */
export function fullscreenMainClassName(path: string): string | null {
  if (path === "/match" || path.startsWith("/match/")) return "flex-1 overflow-hidden";
  if (path.startsWith("/game/")) return "flex-1 min-h-0 overflow-y-auto overscroll-contain";
  return null;
}

/**
 * The feedback chat launcher never shows on play routes, so nothing sits over
 * a card or a guest wall there. A hard wall elsewhere hides it with
 * `body[data-reg-gate=hard]` (see guestWallChrome.ts and index.css).
 */
export function feedbackLauncherAllowed(path: string): boolean {
  if (path.startsWith("/review/")) return false;
  if (path === "/match" || path.startsWith("/match/")) return false;
  if (path.startsWith("/game/")) return false;
  return true;
}
