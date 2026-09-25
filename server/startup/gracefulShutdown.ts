import { runShutdownHooks } from "./shutdownHooks";

/**
 * Railway starts the next container only after this process exits while the
 * masked-card volume is attached. Stop accepting at SIGTERM. In-flight
 * requests may finish until this cap, which includes the close grace.
 */
export const DRAIN_TIMEOUT_MS = 5_000;

/** Inside DRAIN_TIMEOUT_MS. After closeAllConnections, wait this long for close() before exiting. */
export const CLOSE_GRACE_MS = 2_000;

export interface GracefulShutdownServer {
  close: (callback: (err?: Error) => void) => void;
  /** Drop idle keep-alive sockets so close() can finish. Active requests stay. */
  closeIdleConnections?: () => void;
  /** Drop every socket, including in-flight requests, once the cap is reached. */
  closeAllConnections?: () => void;
}

export function installGracefulShutdown(opts: {
  server: GracefulShutdownServer;
  closePool: () => Promise<void>;
  exit?: (code: number) => void;
  drainMs?: number;
  closeGraceMs?: number;
  /** Test hook. Production uses SIGTERM and SIGINT. */
  signals?: NodeJS.Signals[];
}): () => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const drainMs = opts.drainMs ?? DRAIN_TIMEOUT_MS;
  const closeGraceMs = Math.min(opts.closeGraceMs ?? CLOSE_GRACE_MS, drainMs);
  const signals = opts.signals ?? ["SIGTERM", "SIGINT"];
  let started = false;
  let finished = false;

  const finish = async (code: number) => {
    if (finished) return;
    finished = true;
    try {
      await opts.closePool();
    } catch (err) {
      console.error("[Shutdown] pool close failed:", err instanceof Error ? err.message : err);
    }
    exit(code);
  };

  const handler = (signal: string) => {
    if (started) return;
    started = true;
    console.log(`[Shutdown] ${signal} — stopping new connections`);
    void runShutdownHooks();

    const dropAt = drainMs - closeGraceMs;
    let dropTimer: ReturnType<typeof setTimeout> | undefined;
    const forceTimer = setTimeout(() => {
      console.error(`[Shutdown] drain exceeded ${drainMs}ms, closing all connections`);
      try {
        opts.server.closeAllConnections?.();
      } catch (err) {
        console.error("[Shutdown] closeAllConnections failed:", err instanceof Error ? err.message : err);
      }
      void finish(0);
    }, drainMs);
    if (typeof forceTimer.unref === "function") forceTimer.unref();

    if (dropAt < drainMs) {
      dropTimer = setTimeout(() => {
        console.error(`[Shutdown] in-flight cap elapsed, closing all connections`);
        try {
          opts.server.closeAllConnections?.();
        } catch (err) {
          console.error("[Shutdown] closeAllConnections failed:", err instanceof Error ? err.message : err);
        }
      }, dropAt);
      if (typeof dropTimer.unref === "function") dropTimer.unref();
    }

    try {
      opts.server.closeIdleConnections?.();
    } catch (err) {
      console.error("[Shutdown] closeIdleConnections failed:", err instanceof Error ? err.message : err);
    }

    opts.server.close(() => {
      clearTimeout(forceTimer);
      if (dropTimer) clearTimeout(dropTimer);
      void finish(0);
    });
  };

  const listeners: Array<{ signal: NodeJS.Signals; fn: NodeJS.SignalsListener }> = [];
  for (const signal of signals) {
    const fn: NodeJS.SignalsListener = () => handler(signal);
    listeners.push({ signal, fn });
    process.on(signal, fn);
  }

  return () => {
    for (const { signal, fn } of listeners) {
      process.removeListener(signal, fn);
    }
  };
}
