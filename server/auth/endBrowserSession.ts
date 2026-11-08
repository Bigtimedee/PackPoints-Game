import type { Request, Response } from "express";
import { getSessionCookieOptions } from "./session";

/** express-session's default cookie name. Logout already clears this name. */
export const SESSION_COOKIE_NAME = "connect.sid";

export function sessionCookieClearOptions(): {
  path: "/";
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
} {
  const cookie = getSessionCookieOptions();
  return {
    path: "/",
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}

/**
 * Drop the browser session after a successful password reset.
 * Deleting the row is not enough: the cookie still names that sid, express-session
 * will not replace it when the new session is unmodified, and the next guarded
 * request is 401 while the page still shows the cached account.
 * Destroy runs before the response so the loaded session cannot be saved back.
 * The anon guest cookie is a different name and is left alone.
 */
export function endBrowserSession(req: Request, res: Response): Promise<void> {
  const clear = () => {
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieClearOptions());
  };
  const session = req.session as { destroy?: (cb: (err?: unknown) => void) => void } | null | undefined;
  const destroy = session?.destroy?.bind(session);
  if (typeof destroy !== "function") {
    clear();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    destroy((err) => {
      if (err) console.error("[Session] Could not destroy the browser session after password reset");
      clear();
      resolve();
    });
  });
}
