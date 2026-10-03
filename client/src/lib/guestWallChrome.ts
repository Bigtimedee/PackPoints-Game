import { useEffect } from "react";

/**
 * While a guest hard wall (Register to keep playing) is on screen, the
 * feedback chat launcher is hidden (index.css `body[data-reg-gate=hard]`).
 * Counted so two walls mounted at once (block screen plus the gate dialog)
 * release the flag only when the last one unmounts.
 */
export const GUEST_WALL_BODY_ATTR = "data-reg-gate";

let activeWalls = 0;

export function guestWallActiveCount(): number {
  return activeWalls;
}

export function acquireGuestWallChrome(): () => void {
  activeWalls += 1;
  if (typeof document !== "undefined") document.body.setAttribute(GUEST_WALL_BODY_ATTR, "hard");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeWalls = Math.max(0, activeWalls - 1);
    if (activeWalls === 0 && typeof document !== "undefined") document.body.removeAttribute(GUEST_WALL_BODY_ATTR);
  };
}

export function useGuestWallChrome(active = true): void {
  useEffect(() => {
    if (!active) return;
    return acquireGuestWallChrome();
  }, [active]);
}
