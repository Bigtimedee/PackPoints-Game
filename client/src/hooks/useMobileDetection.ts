import { useState, useEffect } from "react";

/**
 * Detects if the current device is a touch/mobile device.
 * Uses multiple detection methods for reliability.
 */
function detectTouchDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  // Check for touch points (works on modern iOS/Android)
  if (navigator.maxTouchPoints > 0) return true;

  // Legacy check for touch events
  if ("ontouchstart" in window) return true;

  // Check for coarse pointer (touch screen)
  if (window.matchMedia?.("(pointer: coarse)").matches) return true;

  return false;
}

/**
 * Hook that detects if native select elements should be used.
 * Returns true on touch devices where custom dropdowns often have issues.
 * 
 * IMPORTANT: Defaults to true (native select) on initial render to avoid
 * hydration mismatches and ensure mobile devices always get native selects.
 */
export function useNativeSelect(): boolean {
  // Default to true (use native select) - this is the safe default
  // Native selects work everywhere, but Radix may fail on touch devices
  const [useNative, setUseNative] = useState(true);

  useEffect(() => {
    // After mount, check if we're on a non-touch device
    // If so, we can safely use the custom Radix select
    const isTouchDevice = detectTouchDevice();
    setUseNative(isTouchDevice);
  }, []);

  return useNative;
}
