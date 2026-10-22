import { signupSavedLine } from "@shared/signupSaved";

/** Points from the register response when we have them, plus the live streak. */
export async function readSignupSavedLine(knownPoints?: number): Promise<string> {
  let points = knownPoints ?? 0;
  let streak = 0;
  if (knownPoints == null) {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (res.ok) {
        const body = await res.json();
        const raw = body?.points ?? body?.user?.points;
        points = Number(raw ?? 0);
      }
    } catch {
      points = 0;
    }
  }
  try {
    const res = await fetch("/api/streak", { credentials: "include" });
    if (res.ok) {
      const body = await res.json();
      streak = Number(body?.currentDays ?? 0);
    }
  } catch {
    streak = 0;
  }
  return signupSavedLine(points, streak);
}
