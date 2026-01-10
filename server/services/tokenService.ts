import crypto from "crypto";
import { db } from "../db";
import { matchTokens, type MatchToken, type MatchTokenStatus, TIER_CONFIG } from "@shared/schema";
import { eq, and, sql, gte } from "drizzle-orm";

const TOKEN_SECRET = process.env.SESSION_SECRET;

function getTokenSecret(): string {
  if (!TOKEN_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required for token signing");
  }
  return TOKEN_SECRET;
}
const TOKEN_EXPIRY_MINUTES = 15;

export interface TokenGenerationResult {
  success: boolean;
  token?: string;
  signature?: string;
  expiresAt?: Date;
  error?: string;
}

export interface TokenValidationResult {
  success: boolean;
  matchToken?: MatchToken;
  error?: string;
}

function generateHmacSignature(data: string): string {
  return crypto.createHmac("sha256", getTokenSecret()).update(data).digest("hex");
}

function generateRandomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

class TokenService {
  async issueMatchToken(
    userId: string,
    mode: string,
    sessionId: string | null,
    maxPoints: number,
    multiplier: number = 1.0
  ): Promise<TokenGenerationResult> {
    const token = generateRandomToken();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TOKEN_EXPIRY_MINUTES * 60 * 1000);
    
    const signatureData = `${token}|${userId}|${issuedAt.toISOString()}|${mode}`;
    const signature = generateHmacSignature(signatureData);

    try {
      await db.insert(matchTokens).values({
        token,
        userId,
        mode,
        sessionId,
        signature,
        status: "active" as MatchTokenStatus,
        maxPoints,
        multiplier,
        expiresAt,
      });

      return {
        success: true,
        token,
        signature,
        expiresAt,
      };
    } catch (error) {
      console.error("Error issuing match token:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to issue token",
      };
    }
  }

  async validateToken(
    token: string,
    signature: string,
    userId: string
  ): Promise<TokenValidationResult> {
    const result = await db
      .select()
      .from(matchTokens)
      .where(eq(matchTokens.token, token))
      .limit(1);

    if (result.length === 0) {
      return { success: false, error: "Token not found" };
    }

    const matchToken = result[0];

    if (matchToken.userId !== userId) {
      return { success: false, error: "Token does not belong to this user" };
    }

    if (matchToken.signature !== signature) {
      return { success: false, error: "Invalid token signature" };
    }

    if (matchToken.status !== "active") {
      return { success: false, error: `Token is ${matchToken.status}` };
    }

    if (new Date() > new Date(matchToken.expiresAt)) {
      await this.expireToken(matchToken.id);
      return { success: false, error: "Token has expired" };
    }

    return { success: true, matchToken };
  }

  async consumeToken(
    tokenId: string,
    pointsAwarded: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await db
        .update(matchTokens)
        .set({
          status: "consumed" as MatchTokenStatus,
          pointsAwarded,
          consumedAt: new Date(),
        })
        .where(eq(matchTokens.id, tokenId));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to consume token",
      };
    }
  }

  async expireToken(tokenId: string): Promise<void> {
    await db
      .update(matchTokens)
      .set({ status: "expired" as MatchTokenStatus })
      .where(eq(matchTokens.id, tokenId));
  }

  async revokeToken(token: string): Promise<void> {
    await db
      .update(matchTokens)
      .set({ status: "revoked" as MatchTokenStatus })
      .where(eq(matchTokens.token, token));
  }

  async completeToken(token: string): Promise<{ success: boolean; error?: string }> {
    try {
      await db
        .update(matchTokens)
        .set({
          status: "consumed" as MatchTokenStatus,
          consumedAt: new Date(),
        })
        .where(eq(matchTokens.token, token));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to complete token",
      };
    }
  }

  async countTokensInLastHour(userId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(matchTokens)
      .where(
        and(
          eq(matchTokens.userId, userId),
          gte(matchTokens.issuedAt, oneHourAgo)
        )
      );

    return Number(result[0]?.count || 0);
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await db
      .update(matchTokens)
      .set({ status: "expired" as MatchTokenStatus })
      .where(
        and(
          eq(matchTokens.status, "active"),
          sql`${matchTokens.expiresAt} < NOW()`
        )
      )
      .returning({ id: matchTokens.id });

    return result.length;
  }

  getMultiplierForTier(tier: "FREE" | "PRO" | "LEGEND"): number {
    return TIER_CONFIG[tier].multiplier;
  }

  getHourlyLimitForTier(tier: "FREE" | "PRO" | "LEGEND"): number {
    return TIER_CONFIG[tier].hourlyMatchLimit;
  }
}

export const tokenService = new TokenService();
