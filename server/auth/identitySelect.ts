/**
 * Login and password-reset identity choice.
 *
 * Case-insensitive exact stored email only. Plus-aliases and other
 * normalized siblings are different accounts and are never chosen implicitly.
 * A single stored casing still matches any casing of that same address.
 * Several stored casings match the typed casing when it is unique, and
 * otherwise refuse. Username is login-only and wins over email.
 */

export type IdentityCandidate = {
  id: string;
  username: string | null;
  email: string | null;
};

export type IdentitySelection =
  | { status: "selected"; id: string }
  | { status: "none" }
  | { status: "ambiguous" };

function fold(value: string): string {
  return value.trim().toLowerCase();
}

export function exactEmailMatch(stored: string | null | undefined, input: string): boolean {
  if (typeof stored !== "string") return false;
  return fold(stored) === fold(input);
}

function pickField(
  input: string,
  rows: IdentityCandidate[],
  field: "username" | "email",
): IdentitySelection {
  const wanted = fold(input);
  if (!wanted) return { status: "none" };
  const typed = input.trim();
  const matches = rows.filter((row) => {
    const stored = row[field];
    return typeof stored === "string" && fold(stored) === wanted;
  });
  if (matches.length === 0) return { status: "none" };
  const byteExact = matches.filter((row) => (row[field] ?? "").trim() === typed);
  if (byteExact.length === 1) return { status: "selected", id: byteExact[0].id };
  if (byteExact.length > 1) return { status: "ambiguous" };
  if (matches.length === 1) return { status: "selected", id: matches[0].id };
  return { status: "ambiguous" };
}

/** Username first, then email. Ambiguous username does not fall through. */
export function selectLoginIdentity(input: string, rows: IdentityCandidate[]): IdentitySelection {
  const byUsername = pickField(input, rows, "username");
  if (byUsername.status !== "none") return byUsername;
  return pickField(input, rows, "email");
}

/** Email only. A username is not a reset identifier. */
export function selectResetIdentity(email: string, rows: IdentityCandidate[]): IdentitySelection {
  return pickField(email, rows, "email");
}
