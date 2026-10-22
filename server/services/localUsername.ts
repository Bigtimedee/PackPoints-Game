const MAX = 20;

/** Letters, numbers, and underscores from the email, or "player" when that is too short. */
export function usernameBaseFromEmail(email: string): string {
  const local = (email.split("@")[0] || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (local.length >= 3) return local.slice(0, 16);
  return "player";
}

export function usernameCandidate(base: string, n: number): string {
  const suffix = n === 0 ? "" : String(n);
  const stem = base.slice(0, Math.max(1, MAX - suffix.length));
  return `${stem}${suffix}`.slice(0, MAX);
}

/** First free username derived from the email. Caller checks the database. */
export async function allocateLocalUsername(
  email: string,
  isTaken: (username: string) => Promise<boolean>,
): Promise<string> {
  const base = usernameBaseFromEmail(email);
  for (let n = 0; n < 1000; n++) {
    const name = usernameCandidate(base, n);
    if (!(await isTaken(name))) return name;
  }
  return `p${Date.now().toString(36)}`.slice(0, MAX);
}

export function isUsernameConflict(error: unknown): boolean {
  const err = error as { code?: string; constraint?: string; detail?: string };
  if (err?.code !== "23505") return false;
  return /username/i.test(`${err.constraint || ""} ${err.detail || ""}`);
}
