/**
 * Decide whether startup may create an admin account.
 * An existing email or username is left untouched. Ambiguous matches refuse.
 */

export type AdminBootstrapPlan =
  | { action: "skip" }
  | { action: "create" }
  | { action: "leave_existing" }
  | { action: "refuse"; reason: "ambiguous_email" | "ambiguous_username" | "identity_conflict" };

export function planAdminBootstrap(input: {
  emailMatches: { id: string }[];
  usernameMatches: { id: string }[];
}): AdminBootstrapPlan {
  if (input.emailMatches.length > 1) return { action: "refuse", reason: "ambiguous_email" };
  if (input.usernameMatches.length > 1) return { action: "refuse", reason: "ambiguous_username" };
  const byEmail = input.emailMatches[0];
  const byName = input.usernameMatches[0];
  if (byEmail && byName && byEmail.id !== byName.id) return { action: "refuse", reason: "identity_conflict" };
  if (byEmail || byName) return { action: "leave_existing" };
  return { action: "create" };
}
