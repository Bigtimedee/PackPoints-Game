const hooks: Array<() => void | Promise<void>> = [];

export function addShutdownHook(fn: () => void | Promise<void>): void {
  hooks.push(fn);
}

export async function runShutdownHooks(): Promise<void> {
  for (const fn of hooks) {
    try {
      await fn();
    } catch (err) {
      console.error("[Shutdown] hook failed:", err instanceof Error ? err.message : err);
    }
  }
}

export function resetShutdownHooksForTests(): void {
  hooks.length = 0;
}
