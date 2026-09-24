const inFlight = new Set<string>();
const readyUrls = new Set<string>();

export function markPlayCardImageReady(url: string): void {
  if (url) readyUrls.add(url);
}

export function isPlayCardImageReady(url: string): boolean {
  return !!url && readyUrls.has(url);
}

export function remainingPlayCardUrls(
  urls: Array<string | null | undefined>,
  currentIndex: number,
): string[] {
  const start = Math.max(0, currentIndex);
  return urls.slice(start).filter((url): url is string => typeof url === "string" && url.length > 0);
}

/** @deprecated Use remainingPlayCardUrls. Kept so older call sites still slice the deal. */
export const remainingPlayCardIds = remainingPlayCardUrls;

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => typeof url === "string" && url.length > 0))];
}

function prefetchUrl(url: string, label: string): void {
  if (!url || inFlight.has(url)) return;
  inFlight.add(url);
  if (typeof Image === "undefined") return;
  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    markPlayCardImageReady(url);
    if (typeof performance !== "undefined") {
      const ms = Math.round(performance.now() - started);
      console.debug(`[Prefetch] ${label} ready in ${ms}ms`);
    }
  };
  img.onerror = () => {
    inFlight.delete(url);
  };
  img.src = url;
}

function ensurePreloadLink(href: string): void {
  if (typeof document === "undefined") return;
  const selector = `link[rel="preload"][as="image"][href="${href}"]`;
  if (document.querySelector(selector)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = href;
  document.head.appendChild(link);
}

function isMaskedPlayUrl(url: string): boolean {
  return url.includes("/masked-image") || url.includes("/api/play/m/");
}

/** Prefetch baked (masked) JPEGs only. Never prefetch an unmasked reveal URL. */
export function prefetchMaskedPlayCards(urls: Array<string | null | undefined>): string[] {
  const masked = uniqueUrls(urls).filter((url) => isMaskedPlayUrl(url) && !url.includes("/api/images/card/") && !url.includes("/api/play/r/"));
  if (masked[0]) ensurePreloadLink(masked[0]);
  if (masked[1]) ensurePreloadLink(masked[1]);
  for (const url of masked) prefetchUrl(url, "masked");
  return masked;
}

/** Call only after a successful answer submit, with the ACK reveal URL. */
export function prefetchRevealPlayCard(url: string | null | undefined): string | null {
  if (!url || !url.includes("/api/play/r/")) return null;
  prefetchUrl(url, "reveal");
  return url;
}
