const STATE = {
  failures: [] as number[],
  openUntil: 0,
  tripped: false,
};

const WINDOW_MS = 30 * 60 * 1000;
const MAX_FAILURES = 5;
const COOLDOWN_MS = 30 * 60 * 1000;

export function recordFailure(): void {
  const now = Date.now();
  STATE.failures.push(now);
  STATE.failures = STATE.failures.filter(t => now - t < WINDOW_MS);
  if (STATE.failures.length >= MAX_FAILURES) {
    STATE.openUntil = now + COOLDOWN_MS;
    STATE.tripped = true;
    console.error(`[GrowthCircuitBreaker] OPEN – ${MAX_FAILURES} failures in ${WINDOW_MS / 60000}m. Auto-posting paused until ${new Date(STATE.openUntil).toISOString()}`);
  }
}

export function recordSuccess(): void {
  STATE.failures = [];
  if (STATE.tripped) {
    STATE.tripped = false;
    STATE.openUntil = 0;
    console.log("[GrowthCircuitBreaker] CLOSED – resumed after success");
  }
}

export function isOpen(): boolean {
  if (!STATE.tripped) return false;
  if (Date.now() > STATE.openUntil) {
    STATE.tripped = false;
    STATE.openUntil = 0;
    STATE.failures = [];
    console.log("[GrowthCircuitBreaker] CLOSED – cooldown expired");
    return false;
  }
  return true;
}

export function getStatus(): { state: "CLOSED" | "OPEN"; failureCount: number; openUntil: number } {
  const now = Date.now();
  STATE.failures = STATE.failures.filter(t => now - t < WINDOW_MS);
  return {
    state: isOpen() ? "OPEN" : "CLOSED",
    failureCount: STATE.failures.length,
    openUntil: STATE.openUntil,
  };
}

export function reset(): void {
  STATE.failures = [];
  STATE.openUntil = 0;
  STATE.tripped = false;
  console.log("[GrowthCircuitBreaker] Manually reset");
}
