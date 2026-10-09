import type { Request, Response } from "express";
import { claimAnonForUser } from "../services/anonIdentity";

export async function establishLocalSession(req: any, userId: string): Promise<void> {
  const guest = req.session?.pendingPoints;
  const guestId = req.session?.guestId;
  await new Promise<void>((resolve, reject) => req.session.regenerate((err: unknown) => err ? reject(err) : resolve()));
  if (guest) req.session.pendingPoints = guest;
  if (guestId) req.session.guestId = guestId;
  req.session.localUserId = userId;
  // No serialized legacy Passport identity can override this account.
  delete req.user;
}

export async function claimGuestAfterSignIn(req: Request, res: Response, userId: string) {
  try {
    const { credited } = await claimAnonForUser(req as any, res, userId);
    delete (req.session as any).guestClaimNotice;
    return { status: "claimed" as const, credited };
  } catch (err) {
    console.error("[Auth] Guest claim deferred; escrow retained", err instanceof Error ? err.message : "unknown error");
    const notice = { status: "pending" as const, code: "GUEST_CLAIM_REVIEW", message: "You're signed in. Your guest points are still saved, but couldn't be transferred yet. An unfinished Daily5 entry or reward record needs review. You can retry after finishing the entry; no existing balance was deducted." };
    (req.session as any).guestClaimNotice = notice;
    return notice;
  }
}

declare module "express-session" {
  interface SessionData {
    localUserId?: string;
    workosUserId?: string; // Historical server session only, not a login input.
    pendingLinkChallengeId?: string;
    linkIntent?: boolean;
  }
}
