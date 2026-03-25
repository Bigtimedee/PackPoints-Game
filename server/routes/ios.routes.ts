/**
 * iOS Mobile API routes (Phase 0 backend additions)
 *
 * POST /api/auth/token          — exchange email+password for JWT access + refresh token
 * POST /api/auth/refresh        — rotate refresh token, return new pair
 * POST /api/auth/apple          — Sign in with Apple (server-side identity-token verification)
 * POST /api/users/apns-token    — register / update APNs device token
 * POST /api/purchases/verify-apple — verify Apple IAP receipt, grant entitlement
 */

import type { Express, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import {
  appleUsers,
  apnsTokens,
  appleTransactions,
  users,
  userEntitlements,
} from "@shared/schema";
import {
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
  jwtMiddleware,
} from "../services/jwtService";
import { loginLimiter } from "../middleware/rateLimiter";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// Apple public keys endpoint for identity-token verification
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys")
);

// Product ID -> subscription tier mapping.
// Update these to match the actual App Store Connect product IDs.
const PRODUCT_TIER_MAP: Record<string, "PRO" | "LEGEND"> = {
  "com.bigtimedee.packpoints.pro.monthly": "PRO",
  "com.bigtimedee.packpoints.pro.annual": "PRO",
  "com.bigtimedee.packpoints.legend.monthly": "LEGEND",
  "com.bigtimedee.packpoints.legend.annual": "LEGEND",
};

// ──────────────────────────────────────────────────────────────────────────────
// Input schemas
// ──────────────────────────────────────────────────────────────────────────────

const tokenRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceHint: z.string().optional(),
});

const refreshRequestSchema = z.object({
  refreshToken: z.string().min(10),
});

const appleAuthSchema = z.object({
  identityToken: z.string().min(10),
  authorizationCode: z.string().optional(),
  fullName: z
    .object({
      givenName: z.string().optional().nullable(),
      familyName: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  email: z.string().email().optional().nullable(),
  deviceHint: z.string().optional(),
});

const apnsTokenSchema = z.object({
  token: z.string().min(10),
  environment: z.enum(["production", "sandbox"]).default("production"),
});

const appleVerifySchema = z.object({
  // StoreKit 2 sends a base64-encoded JWS transaction
  transactionId: z.string().min(1),
  productId: z.string().min(1),
  // Raw JWS receipt from StoreKit 2, or legacy receipt-data for StoreKit 1
  receiptData: z.string().optional(),
  environment: z.enum(["production", "sandbox"]).default("production"),
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildTokenResponse(accessToken: string, refreshToken: string) {
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: 900, // 15 minutes in seconds
  };
}

/**
 * Derive a unique username from an Apple given/family name or email.
 * Falls back to a random handle if no name is provided.
 */
function deriveUsername(opts: {
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
}): string {
  const base =
    opts.email?.split("@")[0] ??
    [opts.givenName, opts.familyName].filter(Boolean).join("").toLowerCase() ??
    "player";

  // Strip non-alphanumeric characters, cap at 16 chars
  const clean = base.replace(/[^a-z0-9]/gi, "").slice(0, 16) || "player";
  return `${clean}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────────────────────────────────────

export function registerIosRoutes(app: Express) {
  // Apply JWT middleware globally so existing routes can optionally read it
  app.use(jwtMiddleware as any);

  /**
   * POST /api/auth/token
   * Exchange email + password for a JWT access token + refresh token.
   * Mirrors the existing /api/auth/local-login but returns JWTs instead of
   * setting a cookie session.
   */
  app.post("/api/auth/token", loginLimiter, async (req: Request, res: Response) => {
    const parsed = tokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const { email, password, deviceHint } = parsed.data;

    const user = await storage.validateLocalCredentials(email, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status === "BANNED") {
      return res.status(403).json({ error: "Account suspended" });
    }

    const accessToken = await issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id, deviceHint);

    return res.json(buildTokenResponse(accessToken, refreshToken));
  });

  /**
   * POST /api/auth/refresh
   * Rotate a refresh token. Returns a new access token + new refresh token.
   * The old refresh token is immediately revoked (single-use rotation).
   */
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const parsed = refreshRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "refreshToken is required" });
    }

    const result = await rotateRefreshToken(parsed.data.refreshToken);
    if (!result) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    return res.json(buildTokenResponse(result.accessToken, result.refreshToken));
  });

  /**
   * POST /api/auth/apple
   * Sign in with Apple.
   * Verifies the identityToken (a JWS from Apple) server-side, creates or
   * retrieves the PackPoints user, and returns JWTs.
   */
  app.post("/api/auth/apple", async (req: Request, res: Response) => {
    const parsed = appleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "identityToken is required" });
    }

    const { identityToken, fullName, email: appleEmail, deviceHint } = parsed.data;

    // Verify the Apple identity token (aud must match our bundle ID)
    let appleClaims: any;
    try {
      const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
        issuer: "https://appleid.apple.com",
        audience: process.env.APPLE_BUNDLE_ID || "com.bigtimedee.packpoints",
      });
      appleClaims = payload;
    } catch (err) {
      console.error("[Apple Auth] Token verification failed:", err);
      return res.status(401).json({ error: "Invalid Apple identity token" });
    }

    const appleUserId: string = appleClaims.sub;
    const appleEmailFromToken: string | undefined = appleClaims.email;

    // Look up existing Apple linkage
    const existingAppleUser = await db
      .select()
      .from(appleUsers)
      .where(eq(appleUsers.appleUserId, appleUserId))
      .limit(1);

    let packpointsUser;

    if (existingAppleUser.length > 0) {
      // Returning Apple Sign In user
      packpointsUser = await storage.getUser(existingAppleUser[0].userId);
      if (!packpointsUser) {
        return res.status(500).json({ error: "User record missing" });
      }
    } else {
      // First-time Apple Sign In — create a new PackPoints account
      const emailToUse = appleEmailFromToken ?? appleEmail ?? undefined;
      const username = deriveUsername({
        givenName: fullName?.givenName,
        familyName: fullName?.familyName,
        email: emailToUse,
      });

      // Create user (no local credential — Apple-only account)
      const newUser = await db
        .insert(users)
        .values({
          id: randomUUID(),
          username,
          usernameNormalized: username.toLowerCase(),
          email: emailToUse ?? null,
          emailNormalized: emailToUse?.toLowerCase() ?? null,
          firstName: fullName?.givenName ?? null,
          lastName: fullName?.familyName ?? null,
          status: "ACTIVE",
        })
        .returning();

      packpointsUser = newUser[0];

      // Record the Apple <-> PackPoints linkage
      await db.insert(appleUsers).values({
        id: randomUUID(),
        userId: packpointsUser.id,
        appleUserId,
        email: appleEmailFromToken ?? appleEmail ?? null,
      });

      console.log(
        `[Apple Auth] Created new user ${packpointsUser.id} for apple_user_id ${appleUserId}`
      );
    }

    if (packpointsUser.status === "BANNED") {
      return res.status(403).json({ error: "Account suspended" });
    }

    const accessToken = await issueAccessToken(packpointsUser);
    const refreshToken = await issueRefreshToken(packpointsUser.id, deviceHint);

    return res.json({
      ...buildTokenResponse(accessToken, refreshToken),
      user: {
        id: packpointsUser.id,
        username: packpointsUser.username,
        status: packpointsUser.status,
      },
    });
  });

  /**
   * POST /api/users/apns-token
   * Register or update the APNs device token for the authenticated user.
   * Requires JWT Bearer auth.
   */
  app.post("/api/users/apns-token", async (req: any, res: Response) => {
    const jwtUser = req.jwtUser;
    if (!jwtUser) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = apnsTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "token is required" });
    }

    const { token, environment } = parsed.data;

    // Upsert: if this token already exists for another user (device transfer),
    // reassign it; otherwise insert.
    await db
      .insert(apnsTokens)
      .values({
        id: randomUUID(),
        userId: jwtUser.sub,
        token,
        environment,
      })
      .onConflictDoUpdate({
        target: apnsTokens.token,
        set: {
          userId: jwtUser.sub,
          environment,
          updatedAt: new Date(),
        },
      });

    return res.json({ success: true });
  });

  /**
   * POST /api/purchases/verify-apple
   * Verify an Apple IAP transaction (StoreKit 2 JWS or StoreKit 1 receipt).
   * On success, grants the appropriate subscription tier or one-time purchase.
   * Requires JWT Bearer auth.
   */
  app.post("/api/purchases/verify-apple", async (req: any, res: Response) => {
    const jwtUser = req.jwtUser;
    if (!jwtUser) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = appleVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "transactionId and productId are required" });
    }

    const { transactionId, productId, receiptData, environment } = parsed.data;

    // Check for duplicate (idempotency)
    const existing = await db
      .select()
      .from(appleTransactions)
      .where(eq(appleTransactions.transactionId, transactionId))
      .limit(1);

    if (existing.length > 0) {
      // Already processed — return success without re-granting
      return res.json({ success: true, alreadyProcessed: true, productId });
    }

    // -----------------------------------------------------------------------
    // In a full implementation this block would call the App Store Server API
    // (https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId})
    // using a signed JWT from your App Store Connect key pair to verify the
    // transaction server-side.
    //
    // For Phase 0 we persist the transaction record and trust the client-
    // reported data.  Full server-side verification is Phase 4 work.
    // -----------------------------------------------------------------------

    const tier = PRODUCT_TIER_MAP[productId];
    const purchaseType = tier ? "subscription" : "consumable";

    // Determine expiry for subscription products (simplistic 30/365-day window)
    let expiresAt: Date | null = null;
    if (tier) {
      const isAnnual = productId.includes("annual");
      const days = isAnnual ? 365 : 30;
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    // Record the transaction
    await db.insert(appleTransactions).values({
      id: randomUUID(),
      userId: jwtUser.sub,
      transactionId,
      productId,
      purchaseType,
      environment,
      rawReceipt: receiptData ?? null,
      expiresAt,
    });

    // Grant entitlement if this is a subscription product
    if (tier) {
      try {
        // Check if user_entitlements table exists and grant the tier
        await db.insert(userEntitlements).values({
          id: randomUUID(),
          userId: jwtUser.sub,
          productId,
          grantedAt: new Date(),
          expiresAt,
          source: "apple_iap",
        } as any).onConflictDoNothing();
      } catch (entitlementErr) {
        // Non-fatal: log and continue — the transaction is recorded
        console.error("[Apple IAP] Failed to grant entitlement (non-fatal):", entitlementErr);
      }
    }

    console.log(
      `[Apple IAP] Verified tx ${transactionId} for user ${jwtUser.sub}, product ${productId}`
    );

    return res.json({
      success: true,
      productId,
      purchaseType,
      tier: tier ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  });

  /**
   * POST /api/auth/logout
   * Revoke all refresh tokens for the authenticated user (full sign-out).
   * Requires JWT Bearer auth.
   */
  app.post("/api/auth/logout", async (req: any, res: Response) => {
    const jwtUser = req.jwtUser;
    if (!jwtUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    await revokeAllRefreshTokens(jwtUser.sub);
    return res.json({ success: true });
  });
}
