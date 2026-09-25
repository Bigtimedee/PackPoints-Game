import { runShutdownHooks } from "./shutdownHooks";

/** In-flight requests get this long, then the pool closes and the process exits. */
export const DRAIN_TIMEOUT_MS = 25_000;

export interface GracefulShutdownServer {
  close: (callback: (err?: Error) => void) => void;
}

export function installGracefulShutdown(opts: {
  server: GracefulShutdownServer;
  closePool: () => Promise<void>;
  exit?: (code: number) => void;
  drainMs?: number;
  /** Test hook. Production uses SIGTERM and SIGINT. */
  signals?: NodeJS.Signals[];
}): () => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const drainMs = opts.drainMs ?? DRAIN_TIMEOUT_MS;
  const signals = opts.signals ?? ["SIGTERM", "SIGINT"];
  let started = false;

  const finish = async (code: number) => {
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
    const timer = setTimeout(() => {
      console.error(`[Shutdown] drain exceeded ${drainMs}ms, closing the pool`);
      void finish(0);
    }, drainMs);
    if (typeof timer.unref === "function") timer.unref();
    void runShutdownHooks();
    opts.server.close(() => {
      clearTimeout(timer);
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
