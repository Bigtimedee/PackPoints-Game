import type { QueryClient, QueryFunction } from "@tanstack/react-query";
import type { User } from "@shared/schema";

export const AUTH_USER_QUERY_KEY = ["/api/auth/user"] as const;

/**
 * Reads of /api/auth/user that started before a reset or a dashboard 401 must
 * not write that admin back into the cache. Resume can start a second read
 * while the first is still in flight, so each read remembers the epoch it
 * started in and ignores itself once the epoch moves.
 */
let authReadEpoch = 0;

export function currentAuthReadEpoch(): number {
  return authReadEpoch;
}

export function bumpAuthReadEpoch(): number {
  authReadEpoch += 1;
  return authReadEpoch;
}

export function resetAuthReadEpochForTests(): void {
  authReadEpoch = 0;
}

export async function fetchAuthUser(signal?: AbortSignal): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
    signal,
  });
  if (signal?.aborted) {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    throw aborted;
  }
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export function authUserQueryFn(queryClient: QueryClient): QueryFunction<User | null> {
  return async ({ signal }) => {
    const epoch = currentAuthReadEpoch();
    const cached = () => queryClient.getQueryData<User | null>(AUTH_USER_QUERY_KEY) ?? null;
    try {
      const user = await fetchAuthUser(signal);
      if (epoch !== currentAuthReadEpoch() || signal.aborted) return cached();
      return user;
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) return cached();
      throw err;
    }
  };
}

/** Drop the signed-in cache and dashboard payload. In-flight auth reads keep the cache. */
export async function clearAuthSession(queryClient: QueryClient): Promise<void> {
  bumpAuthReadEpoch();
  queryClient.setQueryData(AUTH_USER_QUERY_KEY, null);
  await queryClient.cancelQueries({ queryKey: AUTH_USER_QUERY_KEY });
  queryClient.setQueryData(AUTH_USER_QUERY_KEY, null);
  queryClient.removeQueries({ queryKey: ["/api/admin/dashboard"] });
}

let resumeInflight: Promise<unknown> | null = null;

/** One resume read at a time. A second hidden->visible event joins the read already running. */
export function scheduleAuthResume(refetch: () => Promise<unknown>): Promise<unknown> {
  if (resumeInflight) return resumeInflight;
  resumeInflight = Promise.resolve()
    .then(refetch)
    .finally(() => {
      resumeInflight = null;
    });
  return resumeInflight;
}
