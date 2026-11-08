/**
 * Who this request is signed in as.
 *
 * A local login sets session.localUserId. A finished WorkOS login sets that
 * same field (and also workosUserId). Passport sessions are accepted only when
 * Passport itself says the request is authenticated.
 *
 * session.workosUserId by itself is the unproven email-collision challenge.
 * It must not count as a login: /api/auth/user used to return that user while
 * isAuthenticated returned 401, so the shell looked signed in and the admin
 * dashboard failed.
 */

type SessionAuthRequest = {
  session?: { localUserId?: string | null } | null;
  user?: { claims?: { sub?: string | null } } | null;
  isAuthenticated?: () => boolean;
};

export function sessionAuthenticatedUserId(req: SessionAuthRequest): string | null {
  const localId = req.session?.localUserId;
  if (typeof localId === "string" && localId.length > 0) return localId;
  const claim = req.user?.claims?.sub;
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() && typeof claim === "string" && claim.length > 0) {
    return claim;
  }
  return null;
}

export async function authenticatedAccount<T>(
  req: SessionAuthRequest,
  getUser: (id: string) => Promise<T | null | undefined>,
): Promise<T | null> {
  const userId = sessionAuthenticatedUserId(req);
  if (!userId) return null;
  return (await getUser(userId)) ?? null;
}
