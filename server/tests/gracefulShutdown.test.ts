import { afterEach, describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "../startup/gracefulShutdown";
import { addShutdownHook, resetShutdownHooksForTests } from "../startup/shutdownHooks";

describe("graceful shutdown", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops) stop();
    stops.length = 0;
    resetShutdownHooksForTests();
    vi.restoreAllMocks();
  });

  it("stops accepting, finishes in-flight work, closes the pool, then exits", async () => {
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    let closed = false;
    const hook = vi.fn();
    addShutdownHook(hook);
    const stop = installGracefulShutdown({
      server: {
        close(callback) {
          closed = true;
          callback();
        },
      },
      closePool,
      exit,
      drainMs: 25_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(closed).toBe(true);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalled();
    expect(closePool.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });

  it("closes the pool when in-flight work exceeds the drain", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    const stop = installGracefulShutdown({
      server: { close() {} },
      closePool,
      exit,
      drainMs: 25_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });
});
