/** Play routes where a toast must not cover the card face. */
export function isPlaySurface(location: string): boolean {
  const path = (location.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return (
    path === "/game" || path.startsWith("/game/")
    || path === "/match" || path.startsWith("/match/")
    || path === "/daily5" || path.startsWith("/daily5/")
    || path === "/daily" || path.startsWith("/daily/")
  );
}

/**
 * Bottom band above the mobile tab bar (h-16) and the home-indicator inset.
 * On md+ the tab bar is hidden, so the band sits just off the bottom edge.
 * The card occupies the upper viewport on a 390px phone; this band does not.
 */
export const PLAY_TOAST_VIEWPORT_CLASS =
  "pointer-events-none top-auto bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] max-h-36 flex-col sm:right-0 md:bottom-4";
