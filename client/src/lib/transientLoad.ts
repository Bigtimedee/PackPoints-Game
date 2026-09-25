/** One retry after a deploy 502/503 or a dropped connection. */
export const TRANSIENT_RETRY_MS = 2_000;

export function isTransientHttpStatus(status: number): boolean {
  return status === 502 || status === 503;
}

function requestPath(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/** Guessing image. Safe to retry on a deploy blip. */
export function isMaskedPlayImageUrl(url: string): boolean {
  return requestPath(url).includes("/api/play/m/");
}

/** Unmasked card bytes. Never prefetch or retry these before a successful submit. */
export function isUnmaskedCardUrl(url: string): boolean {
  const path = requestPath(url);
  return path.includes("/api/images/card") || path.includes("/api/play/r/");
}

export function shouldRetryMaskedImageLoad(input: {
  url: string;
  /** null is a network error. */
  status: number | null;
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyRetried) return false;
  if (!input.url || isUnmaskedCardUrl(input.url)) return false;
  if (!isMaskedPlayImageUrl(input.url)) return false;
  if (input.status == null) return true;
  return isTransientHttpStatus(input.status);
}

export async function probeMaskedImageStatus(url: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(url, { cache: "no-store", credentials: "same-origin" });
    return res.status;
  } catch {
    return null;
  }
}

export function maskedImageRetrySrc(url: string, attempt: number): string {
  if (!url || attempt <= 0) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}boot=${attempt}`;
}
