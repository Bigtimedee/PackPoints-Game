import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOSE_GRACE_MS, DRAIN_TIMEOUT_MS, installGracefulShutdown } from "../startup/gracefulShutdown";
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

  it("caps the drain at 5s with the close grace inside that cap", () => {
    expect(DRAIN_TIMEOUT_MS).toBe(5_000);
    expect(CLOSE_GRACE_MS).toBe(2_000);
    expect(CLOSE_GRACE_MS).toBeLessThan(DRAIN_TIMEOUT_MS);
  });

  it("stops accepting and closes idle keep-alives immediately, then exits when in-flight work finishes", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    let done: (() => void) | undefined;
    const close = vi.fn((callback: () => void) => {
      done = callback;
    });
    const closeIdleConnections = vi.fn();
    const closeAllConnections = vi.fn();
    const hook = vi.fn();
    addShutdownHook(hook);
    const stop = installGracefulShutdown({
      server: { close, closeIdleConnections, closeAllConnections },
      closePool,
      exit,
      drainMs: 5_000,
      closeGraceMs: 2_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    expect(hook).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    done!();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(0);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(closePool.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("closes every connection and exits at the hard cap when in-flight work stays open", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const closePool = vi.fn(async () => {});
    const close = vi.fn();
    const closeIdleConnections = vi.fn();
    const closeAllConnections = vi.fn();
    const stop = installGracefulShutdown({
      server: { close, closeIdleConnections, closeAllConnections },
      closePool,
      exit,
      drainMs: 5_000,
      closeGraceMs: 2_000,
      signals: ["SIGUSR2"],
    });
    stops.push(stop);
    process.emit("SIGUSR2");
    expect(close).toHaveBeenCalledTimes(1);
    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(closeAllConnections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(closeAllConnections).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(closePool.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });
});
