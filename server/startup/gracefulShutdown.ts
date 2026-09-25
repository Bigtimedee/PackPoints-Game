import { runShutdownHooks } from "./shutdownHooks";

/**
 * Railway's drainingSeconds is 30. Keep the listener open for this long so
 * in-flight and new requests during the drain get a response. Closing the
 * listener at SIGTERM makes the proxy's next connection a 502.
 */
export const DRAIN_TIMEOUT_MS = 25_000;

/** After the drain, how long to wait for server.close() before exiting anyway. */
export const CLOSE_GRACE_MS = 2_000;

export interface GracefulShutdownServer {
  close: (callback: (err?: Error) => void) => void;
  /** Drop idle keep-alive sockets so close() can finish. Active requests stay. */
  closeIdleConnections?: () => void;
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
  const closeGraceMs = opts.closeGraceMs ?? CLOSE_GRACE_MS;
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
    console.log(`[Shutdown] ${signal} — draining for ${drainMs}ms`);
    void runShutdownHooks();
    const timer = setTimeout(() => {
      console.log("[Shutdown] drain window elapsed, closing idle keep-alives");
      try {
        opts.server.closeIdleConnections?.();
      } catch (err) {
        console.error("[Shutdown] closeIdleConnections failed:", err instanceof Error ? err.message : err);
      }
      const force = setTimeout(() => {
        console.error(`[Shutdown] close did not finish within ${closeGraceMs}ms, exiting`);
        void finish(0);
      }, closeGraceMs);
      if (typeof force.unref === "function") force.unref();
      opts.server.close(() => {
        clearTimeout(force);
        void finish(0);
      });
    }, drainMs);
    if (typeof timer.unref === "function") timer.unref();
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
