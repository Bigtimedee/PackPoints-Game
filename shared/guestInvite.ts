/** Guest invite codes. 30 days unused, then they stop working. */
export const GUEST_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function guestInviteExpiry(fromMs: number): Date {
  return new Date(fromMs + GUEST_INVITE_TTL_MS);
}

export function clampDailyScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.floor(n)));
}

/** Public name on the Daily 5 banner. Anything else is "a player". */
export function guestInviteDisplayName(username: string | null | undefined): string {
  const name = (username || "").trim();
  if (!/^[A-Za-z0-9_]{1,20}$/.test(name)) return "a player";
  return name;
}

/** "Beat Casey's 3/5". No dash. */
export function guestInviteBanner(username: string | null | undefined, correctCount: number): string {
  return `Beat ${guestInviteDisplayName(username)}'s ${clampDailyScore(correctCount)}/5`;
}
