const FP_KEY = "packpts_fp";

/** Stable per-browser id plus a coarse device hint. Cookie remains the server identity. */
export function getAnonFingerprint(): string {
  try {
    let id = localStorage.getItem(FP_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(FP_KEY, id);
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const lang = typeof navigator !== "undefined" ? navigator.language || "" : "";
    const w = typeof screen !== "undefined" ? screen.width : 0;
    const h = typeof screen !== "undefined" ? screen.height : 0;
    return `${id}|${tz}|${lang}|${w}x${h}`;
  } catch {
    return "";
  }
}

export function anonRequestHeaders(): Record<string, string> {
  const fp = getAnonFingerprint();
  return fp ? { "x-packpts-fp": fp } : {};
}
