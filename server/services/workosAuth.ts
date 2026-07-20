import { WorkOS } from "@workos-inc/node";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { identityService } from "./identityService";
import type { IdentityProvider } from "@shared/schema";

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
  linkIntent?: boolean;
  pendingLinkChallengeId?: string;
}

declare module "express-session" {
  interface SessionData extends WorkosSession {}
}

function getClientInfo(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
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

      if (req.query.linkIntent === "true" && req.session?.localUserId) {
        (req.session as any).linkIntent = true;
      }

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

    const clientInfo = getClientInfo(req);
    const provider: IdentityProvider = "workos";

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
      const isLinkIntent = (req.session as any).linkIntent === true;
      delete (req.session as any).linkIntent;

      const { user: workosUser } = await workosInstance.userManagement.authenticateWithCode({
        clientId,
        code,
        codeVerifier: undefined,
      });

      const providerUserId = workosUser.id;
      const providerEmail = workosUser.email || null;
      const providerEmailVerified = workosUser.emailVerified || false;

      if (isLinkIntent && req.session?.localUserId) {
        const existingIdentity = await identityService.findIdentity(provider, providerUserId);
        
        if (existingIdentity && existingIdentity.userId !== req.session.localUserId) {
          await identityService.logAudit(
            "LINK_BLOCKED",
            provider,
            providerUserId,
            "Identity already linked to another user",
            { ...clientInfo, actorUserId: req.session.localUserId, targetUserId: existingIdentity.userId }
          );
          return res.redirect("/auth/error?code=IDENTITY_IN_USE");
        }

        if (!existingIdentity) {
          await identityService.createIdentity(
            req.session.localUserId,
            provider,
            providerUserId,
            providerEmail,
            providerEmailVerified
          );
          
          await identityService.logAudit(
            "LINK_COMPLETED",
            provider,
            providerUserId,
            "User-initiated link while logged in",
            { ...clientInfo, actorUserId: req.session.localUserId, targetUserId: req.session.localUserId }
          );
        }

        req.session.save((err) => {
          if (err) {
            console.error("[WorkOS] Session save error:", err);
            return res.redirect("/auth-error?reason=session_error");
          }
          res.redirect("/profile?linked=1");
        });
        return;
      }

      const existingIdentity = await identityService.findIdentity(provider, providerUserId);
      
      if (existingIdentity) {
        const localUser = await storage.getUser(existingIdentity.userId);
        if (!localUser) {
          console.error("[WorkOS] Identity exists but user not found:", existingIdentity.userId);
          return res.redirect("/auth-error?reason=user_not_found");
        }

        (req.session as any).workosUserId = workosUser.id;
        (req.session as any).localUserId = localUser.id;

        await identityService.logAudit(
          "LINK_COMPLETED",
          provider,
          providerUserId,
          "Logged in via existing identity",
          { ...clientInfo, targetUserId: localUser.id }
        );

        req.session.save((err) => {
          if (err) {
            console.error("[WorkOS] Session save error:", err);
            return res.redirect("/auth-error?reason=session_error");
          }
          res.redirect("/auth/success");
        });
        return;
      }

      if (providerEmail) {
        const existingUsers = await identityService.findUsersByEmail(providerEmail);
        
        if (existingUsers.length > 0) {
          const targetUser = existingUsers[0];

          const challenge = await identityService.createPendingLinkChallenge(
            req.sessionID,
            provider,
            providerUserId,
            providerEmail,
            targetUser.id
          );

          // SECURITY: deliberately NOT setting session.localUserId here.
          // The email collides with an existing account and ownership is
          // unproven — workosUserId is challenge context only, and
          // isAuthenticated/requireAdmin correctly reject this session shape
          // until the link challenge completes. Do not "fix" this.
          (req.session as any).pendingLinkChallengeId = challenge.id;
          (req.session as any).workosUserId = workosUser.id;

          await identityService.logAudit(
            "LINK_BLOCKED",
            provider,
            providerUserId,
            "Email collision - requires proof of ownership",
            { ...clientInfo, targetUserId: targetUser.id, metadata: { email: providerEmail } }
          );

          req.session.save((err) => {
            if (err) {
              console.error("[WorkOS] Session save error:", err);
              return res.redirect("/auth-error?reason=session_error");
            }
            const maskedEmail = identityService.maskEmail(providerEmail);
            res.redirect(`/auth/link-required?provider=workos&email=${encodeURIComponent(maskedEmail)}`);
          });
          return;
        }
      }

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

      if (!newUser) {
        console.error("[WorkOS] Failed to create local user");
        return res.redirect("/auth-error?reason=user_creation_failed");
      }

      await identityService.createIdentity(
        newUser.id,
        provider,
        providerUserId,
        providerEmail,
        providerEmailVerified
      );

      await identityService.logAudit(
        "LINK_COMPLETED",
        provider,
        providerUserId,
        "New user created",
        { ...clientInfo, targetUserId: newUser.id }
      );

      (req.session as any).workosUserId = workosUser.id;
      (req.session as any).localUserId = newUser.id;

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
