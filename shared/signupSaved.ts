/** Confirmation after a new account. No dash. */
export function signupSavedLine(points: number, streakDays: number): string {
  const pts = Math.max(0, Math.floor(Number.isFinite(points) ? points : 0));
  const days = Math.max(0, Math.floor(Number.isFinite(streakDays) ? streakDays : 0));
  return `Points saved: ${pts}. Streak ${days}. New five at midnight CT.`;
}
