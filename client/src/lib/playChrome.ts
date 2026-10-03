import { useEffect, useSyncExternalStore } from "react";

/**
 * Play screens that live on normal routes (Daily 5 on /daily) mark play as
 * active so the app shell drops the bottom nav and its 5rem clearance, the
 * same as /game and /match. That gives the card, the 4 answers and Submit the
 * height they need on a 667px phone. Counted, so overlapping mounts release
 * only when the last one goes.
 */
let activePlay = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function playChromeActive(): boolean {
  return activePlay > 0;
}

export function acquirePlayChrome(): () => void {
  activePlay += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePlay = Math.max(0, activePlay - 1);
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlayChromeActive(): boolean {
  return useSyncExternalStore(subscribe, playChromeActive, () => false);
}

export function usePlayChrome(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquirePlayChrome();
  }, [active]);
}
