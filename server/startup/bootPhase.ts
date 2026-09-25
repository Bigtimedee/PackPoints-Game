/** One line per boot phase so the next deploy log can be timed. */
export function logBootPhase(phase: string, fields?: Record<string, string | number | boolean>): void {
  const ts = new Date().toISOString();
  const extra = fields
    ? ` ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")}`
    : "";
  console.log(`[Startup] phase=${phase} ts=${ts}${extra}`);
}
