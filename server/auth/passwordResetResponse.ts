import type { Request, Response } from "express";
import { endBrowserSession } from "./endBrowserSession";
import type { completePasswordReset } from "./passwordResetApply";
import { sessionAuthenticatedUserId } from "./sessionIdentity";

type ResetResult = Awaited<ReturnType<typeof completePasswordReset>>;

/**
 * The browser that submitted the reset is logged out only when it is the
 * account whose password just changed. Resetting account A from a browser
 * signed in as B must leave B's session and connect.sid alone. A's other
 * sessions are removed by the localUserId sweep, not by this cookie.
 */
export function browserSessionIsResetUser(req: Request, resetUserId: string): boolean {
  if (resetUserId.length === 0) return false;
  return sessionAuthenticatedUserId(req) === resetUserId;
}

export async function replyToPasswordReset(req: Request, res: Response, result: ResetResult): Promise<void> {
  if (result.status === 200 && browserSessionIsResetUser(req, result.userId)) {
    await endBrowserSession(req, res);
  }
  res.status(result.status).json(result.body);
}
