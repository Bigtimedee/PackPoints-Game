/**
 * Reliable mobile/touch device detection for select components.
 * Uses multiple detection methods since user-agent sniffing is unreliable on modern iOS.
 */

export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  
  // Check for touch points (works on modern iOS/Android)
  if (navigator.maxTouchPoints > 0) return true;
  
  // Legacy check for touch events
  if ("ontouchstart" in window) return true;
  
  // Check for coarse pointer (touch screen)
  if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  
  return false;
}

export function isIOS(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  
  // Modern detection using platform + touch
  const platform = (navigator as any).userAgentData?.platform || navigator.platform || "";
  
  // Check platform directly
  if (/iPad|iPhone|iPod/.test(platform)) return true;
  
  // iPad with desktop mode reports as MacIntel but has touch
  if (platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  
  // Fallback to user agent (may not work on all devices)
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  
  return false;
}

export function isMobileSafari(): boolean {
  if (!isIOS()) return false;
  
  const ua = navigator.userAgent;
  
  // Check it's Safari (not Chrome/Firefox on iOS)
  // All iOS browsers use WebKit, but we can detect embedded browsers
  const isNotChrome = !/CriOS/.test(ua);
  const isNotFirefox = !/FxiOS/.test(ua);
  
  return isNotChrome && isNotFirefox;
}

/**
 * Returns true if we should use native <select> elements instead of custom dropdowns.
 * This is the recommended check for select components.
 */
export function shouldUseNativeSelect(): boolean {
  // Use native selects on all iOS devices for best touch experience
  // iOS Safari has known issues with custom select popovers
  return isIOS();
}
