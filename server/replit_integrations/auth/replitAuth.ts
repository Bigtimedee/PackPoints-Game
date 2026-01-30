import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { identityService } from "../../services/identityService";
import type { IdentityProvider } from "@shared/schema";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

let sessionMiddlewareInstance: ReturnType<typeof session> | null = null;

export function getSession() {
  if (sessionMiddlewareInstance) {
    return sessionMiddlewareInstance;
  }
  
  console.log("[Session] Initializing session store...");
  console.log("[Session] DATABASE_URL configured:", !!process.env.DATABASE_URL);
  console.log("[Session] SESSION_SECRET configured:", !!process.env.SESSION_SECRET);
  
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
    errorLog: (error: Error) => {
      console.error("[Session] PostgreSQL session store error:", error.message);
      console.error("[Session] Error stack:", error.stack);
    },
  });
  
  // Listen for session store errors
  sessionStore.on('error', (error: Error) => {
    console.error("[Session] Session store connection error:", error.message);
  });
  
  sessionMiddlewareInstance = session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
  
  console.log("[Session] Session middleware initialized successfully");
  return sessionMiddlewareInstance;
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

function getClientInfo(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
  };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();
  const provider: IdentityProvider = "replit";

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user: any = {};
    updateUserSession(user, tokens);
    user.pendingLinkCheck = true;
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    if (req.query.linkIntent === "true" && (req.session as any)?.localUserId) {
      (req.session as any).linkIntent = true;
    }
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req: Request, res: Response, next: NextFunction) => {
    ensureStrategy(req.hostname);
    
    passport.authenticate(`replitauth:${req.hostname}`, async (err: any, user: any, info: any) => {
      if (err || !user) {
        console.error("[Replit Auth] Authentication failed:", err || info);
        return res.redirect("/auth-error?reason=auth_failed");
      }

      const clientInfo = getClientInfo(req);
      const claims = user.claims;
      const providerUserId = claims?.sub;
      const providerEmail = claims?.email || null;
      
      if (!providerUserId) {
        console.error("[Replit Auth] No sub claim in token");
        return res.redirect("/auth-error?reason=no_sub_claim");
      }

      const isLinkIntent = (req.session as any).linkIntent === true;
      delete (req.session as any).linkIntent;

      if (isLinkIntent && (req.session as any)?.localUserId) {
        const existingIdentity = await identityService.findIdentity(provider, providerUserId);
        
        if (existingIdentity && existingIdentity.userId !== (req.session as any).localUserId) {
          await identityService.logAudit(
            "LINK_BLOCKED",
            provider,
            providerUserId,
            "Identity already linked to another user",
            { ...clientInfo, actorUserId: (req.session as any).localUserId, targetUserId: existingIdentity.userId }
          );
          return res.redirect("/auth/error?code=IDENTITY_IN_USE");
        }

        if (!existingIdentity) {
          await identityService.createIdentity(
            (req.session as any).localUserId,
            provider,
            providerUserId,
            providerEmail,
            true
          );
          
          await identityService.logAudit(
            "LINK_COMPLETED",
            provider,
            providerUserId,
            "User-initiated link while logged in",
            { ...clientInfo, actorUserId: (req.session as any).localUserId, targetUserId: (req.session as any).localUserId }
          );
        }

        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[Replit Auth] Login error:", loginErr);
            return res.redirect("/auth-error?reason=login_failed");
          }
          res.redirect("/settings/accounts?linked=1");
        });
        return;
      }

      const existingIdentity = await identityService.findIdentity(provider, providerUserId);
      
      if (existingIdentity) {
        const localUser = await authStorage.getUser(existingIdentity.userId);
        if (!localUser) {
          console.error("[Replit Auth] Identity exists but user not found:", existingIdentity.userId);
          return res.redirect("/auth-error?reason=user_not_found");
        }

        (req.session as any).localUserId = localUser.id;

        await identityService.logAudit(
          "LINK_COMPLETED",
          provider,
          providerUserId,
          "Logged in via existing identity",
          { ...clientInfo, targetUserId: localUser.id }
        );

        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[Replit Auth] Login error:", loginErr);
            return res.redirect("/auth-error?reason=login_failed");
          }
          res.redirect("/");
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

          (req.session as any).pendingLinkChallengeId = challenge.id;

          await identityService.logAudit(
            "LINK_BLOCKED",
            provider,
            providerUserId,
            "Email collision - requires proof of ownership",
            { ...clientInfo, targetUserId: targetUser.id, metadata: { email: providerEmail } }
          );

          req.login(user, (loginErr) => {
            if (loginErr) {
              console.error("[Replit Auth] Login error:", loginErr);
              return res.redirect("/auth-error?reason=login_failed");
            }
            const maskedEmail = identityService.maskEmail(providerEmail);
            res.redirect(`/auth/link-required?provider=replit&email=${encodeURIComponent(maskedEmail)}`);
          });
          return;
        }
      }

      await authStorage.upsertUser({
        id: providerUserId,
        email: providerEmail,
        firstName: claims?.first_name,
        lastName: claims?.last_name,
        profileImageUrl: claims?.profile_image_url,
      });

      await identityService.createIdentity(
        providerUserId,
        provider,
        providerUserId,
        providerEmail,
        true
      );

      await identityService.logAudit(
        "LINK_COMPLETED",
        provider,
        providerUserId,
        "New user created",
        { ...clientInfo, targetUserId: providerUserId }
      );

      (req.session as any).localUserId = providerUserId;

      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[Replit Auth] Login error:", loginErr);
          return res.redirect("/auth-error?reason=login_failed");
        }
        res.redirect("/");
      });

    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Check for local auth session first
  const session = req.session as any;
  
  // Debug logging for auth issues
  console.log("[Auth Debug] isAuthenticated middleware", {
    path: req.path,
    hasSession: !!session,
    localUserId: session?.localUserId ? "set" : "not set",
    isAuthenticated: req.isAuthenticated?.() ?? false,
    hasUser: !!req.user,
    expiresAt: (req.user as any)?.expires_at ? "set" : "not set",
  });
  
  if (session?.localUserId) {
    return next();
  }

  // Check for Replit Auth
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    console.log("[Auth Debug] Returning 401 - isAuthenticated:", req.isAuthenticated?.(), "expires_at:", user?.expires_at);
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
