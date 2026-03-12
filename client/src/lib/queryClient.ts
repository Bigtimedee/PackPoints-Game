import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Capture UTM parameters from the current URL and store in sessionStorage.
 * Called once on app load. Parameters are sent with registration requests.
 */
export function captureUtmParams(): void {
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  const captured: Record<string, string> = {};
  for (const key of utmKeys) {
    const value = params.get(key);
    if (value) captured[key] = value;
  }

  if (Object.keys(captured).length > 0) {
    sessionStorage.setItem('packpts_utm', JSON.stringify(captured));
  }
}

/**
 * Retrieve previously captured UTM params from sessionStorage.
 * Returns camelCase versions for API submission.
 */
export function getStoredUtmParams(): Record<string, string> {
  try {
    const stored = sessionStorage.getItem('packpts_utm');
    if (!stored) return {};

    const raw: Record<string, string> = JSON.parse(stored);
    // Convert utm_source → utmSource
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        value,
      ])
    );
  } catch {
    return {};
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const json = JSON.parse(text);
      if (json.error && typeof json.error === "string") {
        message = json.error;
      }
    } catch {
    }
    throw new Error(message);
  }
}

const REQUEST_TIMEOUT_MS = 15000;

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
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
