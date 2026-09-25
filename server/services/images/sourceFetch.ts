/** Hard cap for an outbound card-image GET/HEAD. Covers headers and body. */
export const SOURCE_IMAGE_FETCH_TIMEOUT_MS = 9_000;

export function isSourceFetchTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "SourceImageFetchTimeoutError";
}

/**
 * Abort the request, and settle even when `fetch` ignores the signal.
 * The caller's `run` must perform the body read before it returns so the
 * deadline covers a stalled download, not only the response headers.
 */
export async function withSourceFetchTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = SOURCE_IMAGE_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  const job = run(controller.signal);
  job.catch(() => {});
  timeout.catch(() => {});
  try {
    return await Promise.race([job, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
