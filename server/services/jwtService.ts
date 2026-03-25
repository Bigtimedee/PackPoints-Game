/**
 * JWT service for iOS mobile auth.
 * Uses jose (already in the dependency tree via openid-client / workos).
 *
 * Access tokens: 15-minute lifetime, signed with HS256.
 * Refresh tokens: 30-day lifetime, stored in the `refresh_tokens` table so
 * they can be revoked.  The secret is read from JWT_SECRET env var (required
 * in production; falls back to a development-only constant so the server
 * boots in dev without extra env setup).
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { db } from "../db";
import { refreshTokens } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { randomUUID } from "crypto";

const DEV_SECRET = "packpoints-dev-secret-change-me-in-production-2026";
const rawSecret = process.env.JWT_SECRET || DEV_SECRET;
const secretBytes = new TextEncoder().encode(rawSecret);

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

export interface JwtClaims extends JWTPayload {
  sub: string;   // userId
  username: string;
  email?: string;
  status: string;
}

/**
 * Issue a signed access token for the given user.
 */
export async function issueAccessToken(user: {
  id: string;
  username: string | null;
  email: string | null;
  status: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    username: user.username ?? "",
    email: user.email ?? undefined,
    status: user.status,
  } as Omit<JwtClaims, "sub" | "iat" | "exp">)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secretBytes);
}

/**
 * Issue and persist a refresh token for the given user.
 * Returns the raw token string that should be sent to the client.
 */
export async function issueRefreshToken(
  userId: string,
  deviceHint?: string
): Promise<string> {
  const token = randomUUID() + "-" + randomUUID(); // 72 random hex chars
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(refreshTokens).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    deviceHint: deviceHint ?? null,
  });

  return token;
}

/**
 * Verify and decode an access token.  Returns the claims or null if invalid.
 */
export async function verifyAccessToken(
  jwt: string
): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(jwt, secretBytes);
    return payload as JwtClaims;
  } catch {
    return null;
  }
}

/**
 * Exchange a refresh token for a new access token + rotated refresh token.
 * The old refresh token is deleted (rotation).
 */
export async function rotateRefreshToken(rawToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  const now = new Date();

  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.token, rawToken),
        // not expired
        // drizzle doesn't have gt(timestamp, now) helper in a portable way,
        // so we compare after fetching
      )
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  if (row.revokedAt !== null) return null;
  if (row.expiresAt < now) return null;

  // Revoke old token (rotation)
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(eq(refreshTokens.id, row.id));

  // Fetch the user to build a fresh access token
  const { storage } = await import("../storage");
  const user = await storage.getUser(row.userId);
  if (!user) return null;

  const accessToken = await issueAccessToken(user);
  const newRefreshToken = await issueRefreshToken(row.userId, row.deviceHint ?? undefined);

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Revoke all refresh tokens for a user (logout from all devices).
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(refreshTokens.userId, userId))
    );
}

/**
 * Express middleware: read Bearer token from Authorization header,
 * verify it, and attach `req.jwtUser` with the claims.
 * On failure the request continues without jwtUser (unauthenticated).
 */
export async function jwtMiddleware(req: any, _res: any, next: any) {
  const header: string | undefined = req.headers["authorization"];
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    const claims = await verifyAccessToken(token);
    if (claims) {
      req.jwtUser = claims;
    }
  }
  next();
}
