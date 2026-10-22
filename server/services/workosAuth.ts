import { WorkOS } from "@workos-inc/node";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { identityService } from "./identityService";
import type { IdentityProvider } from "@shared/schema";
import {
  applySignupAttribution, riskCtxFrom,
  clearAttributionCookie,
  isSameOriginRequest,
  readAttributionCookie,
  sanitizeAttribution,
  setAttributionCookie,
} from "../lib/signupAttribution";
import { recordFunnelEvent } from "./funnel";
import { funnelToken, signupFunnelPath } from "./signupFunnel";
import { signupMethodFromAuth, workosAuthorizeProvider } from "./oauthProvider";

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
  signupSurface?: string;
  signupMethod?: string;
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
  /**
   * POST /api/auth/attribution
   * The client posts its stored first-touch attribution right before it
   * navigates to an OAuth start (WorkOS). We keep it in a short-lived, signed,
   * size-capped, httpOnly SameSite=Lax cookie scoped to /api/auth so the
   * callback can attribute a newly created user. Analytics only.
   */
  app.post("/api/auth/attribution", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const attribution = sanitizeAttribution(req.body);
    if (!attribution) {
      clearAttributionCookie(res);
      return res.status(204).end();
    }
    setAttributionCookie(res, attribution);
    return res.status(204).end();
  });

  app.get("/api/auth/workos/start", (req: Request, res: Response) => {
    try {
      const workosInstance = getWorkOS();
      const clientId = getClientId();
      
      if (!workosInstance || !clientId) {
        recordFunnelEvent(req, "signup_error", {
          mode: "workos_unconfigured",
          path: funnelToken(req.query.signupSurface) || "workos",
        });
        return res.status(503).json({ error: "WorkOS is not configured" });
      }

      // Session cookies are host-only. Keep start + callback on apex so www
      // cannot mint a www callback / split session.
      const host = (req.hostname || "").toLowerCase();
      if (host === "www.packpts.com" || (host.endsWith(".packpts.com") && host !== "packpts.com")) {
        const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        return res.redirect(302, `https://packpts.com/api/auth/workos/start${qs}`);
      }

      const state = crypto.randomBytes(32).toString("hex");
      const authorizeProvider = workosAuthorizeProvider(req.query.provider);
      (req.session as any).workosState = state;
      (req.session as any).signupSurface = funnelToken(req.query.signupSurface) || "workos";
      (req.session as any).signupMethod = signupMethodFromAuth(authorizeProvider);

      if (req.query.linkIntent === "true" && req.session?.localUserId) {
        (req.session as any).linkIntent = true;
      }

      // Pin OAuth redirect to apex when configured; never derive from www hostname.
      const apexCallback = "https://packpts.com/api/auth/workos/callback";
      const redirectUri =
        process.env.WORKOS_REDIRECT_URI ||
        (host === "packpts.com" ? apexCallback : `${req.protocol}://${req.hostname}/api/auth/workos/callback`);

      const authorizationUrl = workosInstance.userManagement.getAuthorizationUrl({
        clientId,
        redirectUri,
        state,
        provider: authorizeProvider,
      });

      // Persist CSRF state before leaving this origin for WorkOS.
      req.session.save((err) => {
        if (err) {
          console.error("[WorkOS] Session save error before start redirect:", err);
          return res.redirect("/auth-error?reason=session_error");
        }
        res.redirect(authorizationUrl);
      });
    } catch (error) {
      console.error("[WorkOS] Error starting auth flow:", error);
      recordFunnelEvent(req, "signup_error", {
        mode: "workos_start_failed",
        path: funnelToken(req.query.signupSurface) || "workos",
      });
      res.redirect("/auth-error?reason=workos_start_failed");
    }
  });

  app.get("/api/auth/workos/callback", async (req: Request, res: Response) => {
    const cleanupState = () => {
      delete (req.session as any).workosState;
    };

    const clientInfo = getClientInfo(req);
    const provider: IdentityProvider = "workos";
    // Read once and always clear: only a user created below may use it.
    const stashedAttribution = readAttributionCookie(req);
    clearAttributionCookie(res);
    const signupSurface = funnelToken((req.session as any)?.signupSurface) || "workos";
    const sessionMethod = typeof (req.session as any)?.signupMethod === "string"
      ? (req.session as any).signupMethod as string
      : undefined;
    delete (req.session as any).signupSurface;
    delete (req.session as any).signupMethod;

    const noteSignupError = (reason: string) => {
      recordFunnelEvent(req, "signup_error", {
        mode: funnelToken(reason) || "workos_error",
        path: signupSurface,
      });
    };

    try {
      const workosInstance = getWorkOS();
      const clientId = getClientId();
      
      if (!workosInstance || !clientId) {
        cleanupState();
        noteSignupError("workos_unconfigured");
        return res.redirect("/auth-error?reason=workos_not_configured");
      }

      const { code, state, error } = req.query;

      if (error) {
        console.error("[WorkOS] Auth error from provider:", error);
        cleanupState();
        noteSignupError(typeof error === "string" ? error : "workos_error");
        return res.redirect(`/auth-error?reason=${error}`);
      }

      if (!code || typeof code !== "string") {
        console.error("[WorkOS] No authorization code received");
        cleanupState();
        noteSignupError("no_code");
        return res.redirect("/auth-error?reason=no_code");
      }

      const expectedState = (req.session as any).workosState;
      if (!expectedState || state !== expectedState) {
        console.error("[WorkOS] State mismatch - potential CSRF");
        cleanupState();
        noteSignupError("state_mismatch");
        return res.redirect("/auth-error?reason=state_mismatch");
      }

      cleanupState();
      const isLinkIntent = (req.session as any).linkIntent === true;
      delete (req.session as any).linkIntent;

      const { user: workosUser, authenticationMethod } = await workosInstance.userManagement.authenticateWithCode({
        clientId,
        code,
        codeVerifier: undefined,
      });
      const signupMethod = signupMethodFromAuth(authenticationMethod, sessionMethod);

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

        if (!localUser.oauthProvider) {
          try {
            await storage.setOauthProviderIfEmpty(localUser.id, signupMethod);
          } catch (providerErr) {
            console.error("[WorkOS] Provider store failed (non-fatal):", providerErr);
          }
        }

        try {
          const { claimAnonForUser } = await import("./anonIdentity");
          await claimAnonForUser(req, res, localUser.id);
        } catch (claimErr) {
          console.error("[WorkOS] Guest escrow claim failed (non-fatal):", claimErr);
        }

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

          noteSignupError("email_collision");
          req.session.save((err) => {
            if (err) {
              console.error("[WorkOS] Session save error:", err);
              return res.redirect("/auth-error?reason=session_error");
            }
            const maskedEmail = identityService.maskEmail(providerEmail);
            res.redirect(`/auth/link-required?provider=${signupMethod}&email=${encodeURIComponent(maskedEmail)}`);
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
        oauthProvider: signupMethod,
      });

      if (!newUser) {
        console.error("[WorkOS] Failed to create local user");
        noteSignupError("user_creation_failed");
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

      await applySignupAttribution(newUser.id, stashedAttribution, "WorkOS", await riskCtxFrom(req));
      recordFunnelEvent(req, "signup_complete", {
        userId: newUser.id,
        mode: signupMethod,
        path: signupFunnelPath(signupSurface, stashedAttribution?.refCode),
        utmSource: stashedAttribution?.utmSource,
        utmMedium: stashedAttribution?.utmMedium,
        utmCampaign: stashedAttribution?.utmCampaign,
        utmContent: stashedAttribution?.utmContent,
        referrerHost: stashedAttribution?.referrerHost,
      });

      try {
        const { claimAnonForUser } = await import("./anonIdentity");
        await claimAnonForUser(req, res, newUser.id);
      } catch (claimErr) {
        console.error("[WorkOS] Guest escrow claim failed (non-fatal):", claimErr);
      }

      req.session.save((err) => {
        if (err) {
          console.error("[WorkOS] Session save error:", err);
          return res.redirect("/auth-error?reason=session_error");
        }
        res.redirect("/auth/success?welcome=1");
      });

    } catch (error) {
      console.error("[WorkOS] Callback error:", error);
      noteSignupError("callback_failed");
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
