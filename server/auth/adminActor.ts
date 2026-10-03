import type { Request } from "express";

// Same resolution requireAdmin uses: OAuth claim first, then PackPTS local-login session.
export function resolveAdminActorId(req: Request): string | undefined {
  const user = (req as any).user as { claims?: { sub?: string } } | undefined;
  const session = (req as any).session as { localUserId?: string } | undefined;
  return user?.claims?.sub || session?.localUserId || undefined;
}
