import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { anonRequestHeaders } from "./anonFingerprint";
import { captureFirstTouch, getSignupAttributionPayload } from "./attribution";

export class ApiError extends Error {
  status: number;
  code?: string;
  phase?: string;
  reason?: string;
  escrowPoints?: number;
  gamesCompleted?: number;
  detail?: string;

  constructor(message: string, status: number, extra?: Partial<ApiError>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (extra?.code) this.code = extra.code;
    if (extra?.phase) this.phase = extra.phase;
    if (extra?.reason) this.reason = extra.reason;
    if (typeof extra?.escrowPoints === "number") this.escrowPoints = extra.escrowPoints;
    if (typeof extra?.gamesCompleted === "number") this.gamesCompleted = extra.gamesCompleted;
    if (extra?.detail) this.detail = extra.detail;
  }
}

/**
 * Capture first-touch attribution (utm_*, ref, landing path, referrer host)
 * into localStorage (30 days, first touch wins) and the legacy sessionStorage
 * packpts_utm key. Called once on app load.
 */
export function captureUtmParams(): void {
  captureFirstTouch();
}

/**
 * Attribution fields for POST /api/auth/register, camelCase
 * (utmSource, utmMedium, utmCampaign, utmTerm, utmContent, referredByCode,
 * landingPage, referrerHost). Empty object when nothing was stored.
 */
export function getStoredUtmParams(): Record<string, string> {
  return getSignupAttributionPayload() as Record<string, string>;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    let extra: Partial<ApiError> | undefined;
    try {
      const json = JSON.parse(text);
      if (json.error && typeof json.error === "string") {
        message = json.error;
      }
      extra = {
        code: typeof json.code === "string" ? json.code : undefined,
        phase: typeof json.phase === "string" ? json.phase : undefined,
        reason: typeof json.reason === "string" ? json.reason : undefined,
        escrowPoints: typeof json.escrowPoints === "number" ? json.escrowPoints : undefined,
        gamesCompleted: typeof json.gamesCompleted === "number" ? json.gamesCompleted : undefined,
        detail: typeof json.message === "string" ? json.message : undefined,
      };
    } catch {
    }
    throw new ApiError(message, res.status, extra);
  }
}

const REQUEST_TIMEOUT_MS = 15000;

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...anonRequestHeaders(),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    await throwIfResNotOk(res);
    return res;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        headers: anonRequestHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.');
      }
      throw err;
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
