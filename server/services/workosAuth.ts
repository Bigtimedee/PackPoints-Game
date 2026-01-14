import { WorkOS } from "@workos-inc/node";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";

let workos: WorkOS | null = null;

function getWorkOS(): WorkOS | null {
  if (!process.env.WORKOS_API_KEY) {
    return null;
  }
  if (!workos) {
    workos = new WorkOS(process.env.WORKOS_API_KEY);
  }
  return workos;
}

function getClientId(): string {
  return process.env.WORKOS_CLIENT_ID || "";
}

interface WorkosSession {
  workosState?: string;
  workosUserId?: string;
  localUserId?: string;
}

declare module "express-session" {
  interface SessionData extends WorkosSession {}
}

export function registerWorkosRoutes(app: Express): void {
  app.get("/api/auth/workos/start", (req: Request, res: Response) => {
    try {
      const workosInstance = getWorkOS();
      const clientId = getClientId();
      
      if (!workosInstance || !clientId) {
        return res.status(503).json({ error: "WorkOS is not configured" });
      }

      const state = crypto.randomBytes(32).toString("hex");
      (req.session as any).workosState = state;

      const redirectUri = process.env.WORKOS_REDIRECT_URI || 
        `${req.protocol}://${req.hostname}/api/auth/workos/callback`;

      const authorizationUrl = workosInstance.userManagement.getAuthorizationUrl({
        clientId,
        redirectUri,
        state,
        provider: "authkit",
      });

      res.redirect(authorizationUrl);
    } catch (error) {
      console.error("[WorkOS] Error starting auth flow:", error);
      res.redirect("/auth-error?reason=workos_start_failed");
    }
  });

  app.get("/api/auth/workos/callback", async (req: Request, res: Response) => {
    const cleanupState = () => {
      delete (req.session as any).workosState;
    };

    try {
      const workosInstance = getWorkOS();
      const clientId = getClientId();
      
      if (!workosInstance || !clientId) {
        cleanupState();
        return res.redirect("/auth-error?reason=workos_not_configured");
      }

      const { code, state, error } = req.query;

      if (error) {
        console.error("[WorkOS] Auth error from provider:", error);
        cleanupState();
        return res.redirect(`/auth-error?reason=${error}`);
      }

      if (!code || typeof code !== "string") {
        console.error("[WorkOS] No authorization code received");
        cleanupState();
        return res.redirect("/auth-error?reason=no_code");
      }

      const expectedState = (req.session as any).workosState;
      if (!expectedState || state !== expectedState) {
        console.error("[WorkOS] State mismatch - potential CSRF");
        cleanupState();
        return res.redirect("/auth-error?reason=state_mismatch");
      }

      cleanupState();

      const redirectUri = process.env.WORKOS_REDIRECT_URI || 
        `${req.protocol}://${req.hostname}/api/auth/workos/callback`;

      const { user: workosUser } = await workosInstance.userManagement.authenticateWithCode({
        clientId,
        code,
        codeVerifier: undefined,
      });

      let localUser = await storage.getUserByWorkosId(workosUser.id);

      if (!localUser && workosUser.email) {
        const existingByEmail = await storage.getUserByEmail(workosUser.email);
        if (existingByEmail) {
          if (existingByEmail.workosUserId && existingByEmail.workosUserId !== workosUser.id) {
            console.error("[WorkOS] Email already linked to different WorkOS account");
            return res.redirect("/auth-error?reason=email_conflict");
          }
          await storage.linkWorkosUser(existingByEmail.id, workosUser.id);
          localUser = await storage.getUser(existingByEmail.id);
        }
      }

      if (!localUser) {
        const username = workosUser.email?.split("@")[0] || `user_${workosUser.id.slice(0, 8)}`;
        let uniqueUsername = username;
        let counter = 1;
        while (await storage.getUserByUsername(uniqueUsername)) {
          uniqueUsername = `${username}${counter}`;
          counter++;
        }

        const newUser = await storage.createWorkosUser({
          workosUserId: workosUser.id,
          email: workosUser.email || undefined,
          firstName: workosUser.firstName || undefined,
          lastName: workosUser.lastName || undefined,
          profileImageUrl: workosUser.profilePictureUrl || undefined,
          username: uniqueUsername,
        });
        localUser = newUser;
      }

      if (!localUser) {
        console.error("[WorkOS] Failed to create or find local user");
        return res.redirect("/auth-error?reason=user_creation_failed");
      }

      (req.session as any).workosUserId = workosUser.id;
      (req.session as any).localUserId = localUser.id;

      req.session.save((err) => {
        if (err) {
          console.error("[WorkOS] Session save error:", err);
          return res.redirect("/auth-error?reason=session_error");
        }
        res.redirect("/auth/success");
      });

    } catch (error) {
      console.error("[WorkOS] Callback error:", error);
      res.redirect("/auth-error?reason=callback_failed");
    }
  });

  app.post("/api/auth/workos/logout", (req: Request, res: Response) => {
    const destroySession = () => {
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("[WorkOS] Session destroy error:", destroyErr);
        }
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    };

    if (typeof req.logout === "function") {
      req.logout((err) => {
        if (err) {
          console.error("[WorkOS] Logout error:", err);
        }
        destroySession();
      });
    } else {
      destroySession();
    }
  });
}
