import { afterEach, describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "../startup/gracefulShutdown";
import { addShutdownHook, resetShutdownHooksForTests } from "../startup/shutdownHooks";

describe("graceful shutdown", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops) stop();
    stops.length = 0;
    resetShutdownHooksForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the listener open during the drain, then closes idle keep-alives and exits", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    const close = vi.fn((callback: () => void) => callback());
    const closeIdleConnections = vi.fn();
    const hook = vi.fn();
    addShutdownHook(hook);
    const stop = installGracefulShutdown({
      server: { close, closeIdleConnections },
      closePool,
      exit,
      drainMs: 25_000,
      closeGraceMs: 1_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    await Promise.resolve();
    expect(hook).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(closePool.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });

  it("exits after the close grace when connections stay open past the drain", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    const close = vi.fn();
    const stop = installGracefulShutdown({
      server: { close },
      closePool,
      exit,
      drainMs: 25_000,
      closeGraceMs: 1_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(closePool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});
