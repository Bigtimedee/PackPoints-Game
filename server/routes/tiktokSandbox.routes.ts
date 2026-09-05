import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  TIKTOK_CALLBACK_URI,
  TIKTOK_SANDBOX_PHOTO_URL,
  TIKTOK_SANDBOX_SCOPES,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchSandboxDisplayName,
  initSandboxPhotoPost,
  missingRequestedScopes,
  missingTiktokClientEnv,
  querySandboxPublishStatus,
  refreshSandboxToken,
  requiredScopeForPostMode,
  sandboxRedirectError,
  type TiktokPostMode,
  type TiktokSandboxTokens,
} from "../services/tiktokSandbox";

declare module "express-session" {
  interface SessionData {
    tiktokOAuthState?: string;
    tiktokSandbox?: TiktokSandboxTokens;
  }
}

function getSessionTokens(req: Request): TiktokSandboxTokens | undefined {
  return req.session.tiktokSandbox;
}

async function ensureFreshTokens(
  req: Request,
): Promise<TiktokSandboxTokens | { error: string; message: string; missingEnv?: string[] }> {
  const current = getSessionTokens(req);
  if (!current?.accessToken) {
    return {
      error: "missing_token",
      message: "No TikTok sandbox session. Continue with TikTok first.",
    };
  }

  const expiringSoon =
    typeof current.expiresAt === "number" && current.expiresAt < Date.now() + 60_000;
  if (!expiringSoon) return current;
  if (!current.refreshToken) return current;

  const refreshed = await refreshSandboxToken(current.refreshToken);
  if (!refreshed.ok) {
    return { error: refreshed.error, message: refreshed.message, missingEnv: refreshed.missingEnv };
  }

  const next: TiktokSandboxTokens = {
    ...current,
    ...refreshed.tokens,
    displayName: current.displayName ?? refreshed.tokens.displayName,
    scopes: refreshed.tokens.scopes.length > 0 ? refreshed.tokens.scopes : current.scopes,
  };
  req.session.tiktokSandbox = next;
  return next;
}

export function registerTiktokSandboxRoutes(app: Express): void {
  app.get("/api/auth/tiktok/sandbox/start", (req: Request, res: Response) => {
    const host = (req.hostname || "").toLowerCase();
    if (host === "www.packpts.com" || (host.endsWith(".packpts.com") && host !== "packpts.com")) {
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      return res.redirect(302, `https://packpts.com/api/auth/tiktok/sandbox/start${qs}`);
    }

    const missing = missingTiktokClientEnv();
    if (missing.length > 0) {
      return res.redirect(
        sandboxRedirectError(
          "missing_client_credentials",
          `TikTok sandbox OAuth is not configured. Missing: ${missing.join(", ")}.`,
        ),
      );
    }

    const state = crypto.randomBytes(24).toString("hex");
    req.session.tiktokOAuthState = state;
    req.session.save((err) => {
      if (err) {
        console.error("[TikTokSandbox] Session save error before start redirect:", err);
        return res.redirect(sandboxRedirectError("session_error", "Could not save OAuth state."));
      }
      res.redirect(buildAuthorizeUrl(state));
    });
  });

  app.get("/auth/tiktok/callback", async (req: Request, res: Response) => {
    const cleanupState = () => {
      delete req.session.tiktokOAuthState;
    };

    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      cleanupState();
      return res.redirect(
        sandboxRedirectError(
          "oauth_denied",
          typeof errorDescription === "string" ? errorDescription : String(error),
        ),
      );
    }

    if (!code || typeof code !== "string") {
      cleanupState();
      return res.redirect(sandboxRedirectError("no_code", "TikTok did not return an authorization code."));
    }

    const expectedState = req.session.tiktokOAuthState;
    if (!expectedState || state !== expectedState) {
      cleanupState();
      return res.redirect(sandboxRedirectError("state_mismatch", "OAuth state mismatch. Start Continue with TikTok again."));
    }

    cleanupState();

    const exchanged = await exchangeAuthorizationCode(code);
    if (!exchanged.ok) {
      return res.redirect(sandboxRedirectError(exchanged.error, exchanged.message));
    }

    const displayName = await fetchSandboxDisplayName(exchanged.tokens.accessToken);
    req.session.tiktokSandbox = {
      ...exchanged.tokens,
      displayName,
    };

    req.session.save((err) => {
      if (err) {
        console.error("[TikTokSandbox] Session save error after callback:", err);
        return res.redirect(sandboxRedirectError("session_error", "Authorized, but the session could not be saved."));
      }
      res.redirect("/review/tiktok-sandbox?connected=1");
    });
  });

  app.get("/api/review/tiktok-sandbox/session", (req: Request, res: Response) => {
    const missingEnv = missingTiktokClientEnv();
    const tokens = getSessionTokens(req);
    const granted = tokens?.scopes ?? [];
    res.json({
      configured: missingEnv.length === 0,
      missingEnv,
      connected: !!tokens?.accessToken,
      displayName: tokens?.displayName ?? null,
      openId: tokens?.openId ?? null,
      scopes: granted,
      missingScopes: missingRequestedScopes(granted),
      requestedScopes: [...TIKTOK_SANDBOX_SCOPES],
      redirectUri: TIKTOK_CALLBACK_URI,
      photoUrl: TIKTOK_SANDBOX_PHOTO_URL,
    });
  });

  app.post("/api/review/tiktok-sandbox/publish", async (req: Request, res: Response) => {
    const postMode = req.body?.postMode as TiktokPostMode;
    if (postMode !== "MEDIA_UPLOAD" && postMode !== "DIRECT_POST") {
      return res.status(400).json({
        ok: false,
        error: "invalid_post_mode",
        message: "postMode must be MEDIA_UPLOAD or DIRECT_POST.",
      });
    }

    const tokens = await ensureFreshTokens(req);
    if ("error" in tokens) {
      return res.status(401).json({ ok: false, ...tokens });
    }

    const requiredScope = requiredScopeForPostMode(postMode);
    if (!tokens.scopes.includes(requiredScope)) {
      return res.status(403).json({
        ok: false,
        error: "missing_scopes",
        message: `This action needs the ${requiredScope} scope. Granted: ${tokens.scopes.join(", ") || "(none)"}.`,
        requiredScope,
        missingScopes: [requiredScope],
        grantedScopes: tokens.scopes,
      });
    }

    const result = await initSandboxPhotoPost(tokens.accessToken, postMode);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    res.json({
      ok: true,
      publishId: result.publishId,
      postMode,
      photoUrl: TIKTOK_SANDBOX_PHOTO_URL,
    });
  });

  app.get("/api/review/tiktok-sandbox/status", async (req: Request, res: Response) => {
    const publishId = typeof req.query.publish_id === "string" ? req.query.publish_id : "";
    if (!publishId) {
      return res.status(400).json({
        ok: false,
        error: "missing_publish_id",
        message: "publish_id is required.",
      });
    }

    const tokens = await ensureFreshTokens(req);
    if ("error" in tokens) {
      return res.status(401).json({ ok: false, ...tokens });
    }

    const result = await querySandboxPublishStatus(tokens.accessToken, publishId);
    if (!result.ok) {
      return res.status(502).json(result);
    }

    res.json({
      ok: true,
      publishId,
      status: result.status,
      kind: result.kind,
      failReason: result.failReason ?? null,
    });
  });
}
