import { anonRequestHeaders } from "./anonFingerprint";

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

/** Wait from Retry-After, once, before a second POST /api/game/answer. */
export function answerRetryDelayMs(input: {
  status: number;
  retryAfter: string | null;
  alreadyRetried: boolean;
}): number | null {
  if (input.alreadyRetried || !isTransientHttpStatus(input.status)) return null;
  const header = input.retryAfter?.trim() ?? "";
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30, seconds) * 1000;
  }
  return TRANSIENT_RETRY_MS;
}

export interface GameAnswerResponse {
  correct?: boolean;
  correctAnswer?: string | null;
  cardId?: string;
  session?: unknown;
  pointsEarned?: number;
  idempotent?: boolean;
}

export async function postGameAnswer(
  body: { sessionId: string; questionIndex: number; selectedAnswer: string },
  deps?: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<GameAnswerResponse> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const sleep = deps?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const send = () => fetchImpl("/api/game/answer", {
    method: "POST",
    headers: {
      ...anonRequestHeaders(),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  let res = await send();
  const delay = answerRetryDelayMs({
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    alreadyRetried: false,
  });
  if (delay != null) {
    await sleep(delay);
    res = await send();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Answer failed (${res.status})`);
  }
  return await res.json() as GameAnswerResponse;
}

export function maskedImageRetrySrc(url: string, attempt: number): string {
  if (!url || attempt <= 0) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}boot=${attempt}`;
}
