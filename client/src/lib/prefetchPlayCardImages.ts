import { maskedPlayUrl, revealPlayUrl } from "@shared/playCardImage";

const inFlight = new Set<string>();
const readyUrls = new Set<string>();

export function markPlayCardImageReady(url: string): void {
  if (url) readyUrls.add(url);
}

export function isPlayCardImageReady(url: string): boolean {
  return !!url && readyUrls.has(url);
}

export function remainingPlayCardIds(
  cardIds: Array<string | null | undefined>,
  currentIndex: number,
): string[] {
  const start = Math.max(0, currentIndex);
  return cardIds.slice(start).filter((id): id is string => typeof id === "string" && id.length > 0);
}

function uniqueCardIds(cardIds: Array<string | null | undefined>): string[] {
  return [...new Set(cardIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
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

/** Prefetch baked (masked) JPEGs only. Never prefetch the unmasked reveal URL. */
export function prefetchMaskedPlayCards(cardIds: Array<string | null | undefined>): string[] {
  const ids = uniqueCardIds(cardIds);
  const urls = ids.map((id) => maskedPlayUrl(id));
  if (urls[0]) ensurePreloadLink(urls[0]);
  if (urls[1]) ensurePreloadLink(urls[1]);
  for (let i = 0; i < ids.length; i++) {
    prefetchUrl(urls[i], `masked ${ids[i]}`);
  }
  return urls;
}

/** Call only after a successful answer submit so the printed name is allowed. */
export function prefetchRevealPlayCard(cardId: string | null | undefined): string | null {
  if (!cardId) return null;
  const url = revealPlayUrl(cardId);
  prefetchUrl(url, `reveal ${cardId}`);
  return url;
}
