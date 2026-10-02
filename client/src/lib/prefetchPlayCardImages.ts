const inFlight = new Set<string>();
const readyUrls = new Set<string>();
const refusedUrls = new Set<string>();
const prefetchFailed = new Set<string>();
const retainedImages = new Set<HTMLImageElement>();

function prefetchKey(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
}

export function markMaskedUrlRefused(url: string): void {
  if (url) refusedUrls.add(prefetchKey(url));
}

export function isMaskedUrlRefused(url: string): boolean {
  return !!url && refusedUrls.has(prefetchKey(url));
}

export function retainedPrefetchCount(): number {
  return retainedImages.size;
}

export function resetPrefetchForTests(): void {
  inFlight.clear();
  readyUrls.clear();
  refusedUrls.clear();
  prefetchFailed.clear();
  retainedImages.clear();
}

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
  if (!url || inFlight.has(url) || readyUrls.has(url) || prefetchFailed.has(url) || isMaskedUrlRefused(url)) return;
  if (typeof Image === "undefined") return;
  inFlight.add(url);
  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const img = new Image();
  retainedImages.add(img);
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.onload = () => {
    markPlayCardImageReady(url);
    inFlight.delete(url);
    if (typeof performance !== "undefined") {
      const ms = Math.round(performance.now() - started);
      console.debug(`[Prefetch] ${label} ready in ${ms}ms`);
    }
  };
  img.onerror = () => {
    inFlight.delete(url);
    prefetchFailed.add(url);
    retainedImages.delete(img);
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
  link.crossOrigin = "anonymous";
  link.href = href;
  document.head.appendChild(link);
}

function isMaskedPlayUrl(url: string): boolean {
  return url.includes("/masked-image") || url.includes("/api/play/m/");
}

/** Prefetch baked (masked) JPEGs only. Never prefetch an unmasked reveal URL. */
export function prefetchMaskedPlayCards(urls: Array<string | null | undefined>): string[] {
  const masked = uniqueUrls(urls).filter((url) => isMaskedPlayUrl(url) && !url.includes("/api/images/card/") && !url.includes("/api/play/r/") && !isMaskedUrlRefused(url));
  const upcoming = masked.slice(1, 3);
  for (const url of upcoming) ensurePreloadLink(url);
  if (upcoming.length === 0 && masked[0]) ensurePreloadLink(masked[0]);
  const ordered = [...upcoming, ...masked.filter((url) => !upcoming.includes(url))];
  for (const url of ordered) prefetchUrl(url, "masked");
  return masked;
}

/** Call only after a successful answer submit, with the ACK reveal URL. */
export function prefetchRevealPlayCard(url: string | null | undefined): string | null {
  if (!url || !url.includes("/api/play/r/")) return null;
  prefetchUrl(url, "reveal");
  return url;
}
