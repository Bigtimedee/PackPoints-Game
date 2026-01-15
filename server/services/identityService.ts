import { db } from "../db";
import { 
  userIdentities, 
  pendingLinkChallenges, 
  identityLinkAudit, 
  users, 
  wallets, 
  stripeCustomers, 
  rewardRedemptions,
  HIGH_VALUE_PACKPTS_THRESHOLD,
  LINK_CHALLENGE_EXPIRY_MINUTES,
  MAGIC_LINK_EXPIRY_MINUTES,
  type IdentityProvider,
  type LinkChallengeStatus,
  type LinkAuditAction,
  type UserIdentity,
  type PendingLinkChallenge,
} from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import crypto from "crypto";

export interface IdentityContext {
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export class IdentityService {
  async findIdentity(provider: IdentityProvider, providerUserId: string): Promise<UserIdentity | null> {
    const [identity] = await db
      .select()
      .from(userIdentities)
      .where(and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.providerUserId, providerUserId)
      ))
      .limit(1);
    
    return identity || null;
  }

  async findUsersByEmail(email: string): Promise<{ id: string; email: string | null; username: string | null }[]> {
    const matchedUsers = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
      })
      .from(users)
      .where(eq(users.email, email));
    
    if (matchedUsers.length > 0) {
      return matchedUsers;
    }

    const identitiesWithEmail = await db
      .select({
        userId: userIdentities.userId,
      })
      .from(userIdentities)
      .where(eq(userIdentities.email, email));

    if (identitiesWithEmail.length > 0) {
      const userIds = identitiesWithEmail.map(i => i.userId);
      const usersFromIdentities = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
        })
        .from(users)
        .where(sql`${users.id} = ANY(${userIds})`);
      return usersFromIdentities;
    }

    return [];
  }

  async createIdentity(
    userId: string,
    provider: IdentityProvider,
    providerUserId: string,
    email: string | null,
    emailVerified: boolean = false
  ): Promise<UserIdentity> {
    const [identity] = await db
      .insert(userIdentities)
      .values({
        userId,
        provider,
        providerUserId,
        email,
        emailVerified,
      })
      .returning();
    
    return identity;
  }

  async getIdentitiesForUser(userId: string): Promise<UserIdentity[]> {
    return db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));
  }

  async isHighValue(userId: string): Promise<boolean> {
    const [wallet] = await db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    
    if (wallet && wallet.balance >= HIGH_VALUE_PACKPTS_THRESHOLD) {
      return true;
    }

    const [stripeCustomer] = await db
      .select({ id: stripeCustomers.id })
      .from(stripeCustomers)
      .where(eq(stripeCustomers.userId, userId))
      .limit(1);
    
    if (stripeCustomer) {
      return true;
    }

    const [redemption] = await db
      .select({ id: rewardRedemptions.id })
      .from(rewardRedemptions)
      .where(and(
        eq(rewardRedemptions.userId, userId),
        eq(rewardRedemptions.status, "completed")
      ))
      .limit(1);
    
    if (redemption) {
      return true;
    }

    return false;
  }

  async createPendingLinkChallenge(
    sessionId: string,
    provider: IdentityProvider,
    providerUserId: string,
    email: string | null,
    targetUserId?: string
  ): Promise<PendingLinkChallenge> {
    await db
      .update(pendingLinkChallenges)
      .set({ 
        status: "CANCELED" as LinkChallengeStatus,
        updatedAt: new Date()
      })
      .where(and(
        eq(pendingLinkChallenges.sessionId, sessionId),
        eq(pendingLinkChallenges.status, "PENDING")
      ));

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + LINK_CHALLENGE_EXPIRY_MINUTES);

    const [challenge] = await db
      .insert(pendingLinkChallenges)
      .values({
        sessionId,
        provider,
        providerUserId,
        email,
        targetUserId,
        status: "PENDING",
        expiresAt,
      })
      .returning();

    return challenge;
  }

  async getPendingChallenge(challengeId: string): Promise<PendingLinkChallenge | null> {
    const [challenge] = await db
      .select()
      .from(pendingLinkChallenges)
      .where(eq(pendingLinkChallenges.id, challengeId))
      .limit(1);

    return challenge || null;
  }

  async getPendingChallengeBySession(sessionId: string): Promise<PendingLinkChallenge | null> {
    const [challenge] = await db
      .select()
      .from(pendingLinkChallenges)
      .where(and(
        eq(pendingLinkChallenges.sessionId, sessionId),
        eq(pendingLinkChallenges.status, "PENDING")
      ))
      .limit(1);

    return challenge || null;
  }

  async completePendingLinkChallenge(
    challengeId: string,
    userId: string
  ): Promise<PendingLinkChallenge | null> {
    const [updated] = await db
      .update(pendingLinkChallenges)
      .set({
        status: "COMPLETED" as LinkChallengeStatus,
        targetUserId: userId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pendingLinkChallenges.id, challengeId),
        eq(pendingLinkChallenges.status, "PENDING")
      ))
      .returning();

    return updated || null;
  }

  async clearPendingLinkChallenge(sessionId: string): Promise<void> {
    await db
      .update(pendingLinkChallenges)
      .set({
        status: "CANCELED" as LinkChallengeStatus,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pendingLinkChallenges.sessionId, sessionId),
        eq(pendingLinkChallenges.status, "PENDING")
      ));
  }

  async setMagicLinkToken(challengeId: string): Promise<{ token: string; hashedToken: string }> {
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + MAGIC_LINK_EXPIRY_MINUTES);

    await db
      .update(pendingLinkChallenges)
      .set({
        magicLinkToken: hashedToken,
        magicLinkExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(pendingLinkChallenges.id, challengeId));

    return { token, hashedToken };
  }

  async findChallengeByMagicToken(token: string): Promise<PendingLinkChallenge | null> {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    
    const [challenge] = await db
      .select()
      .from(pendingLinkChallenges)
      .where(and(
        eq(pendingLinkChallenges.magicLinkToken, hashedToken),
        eq(pendingLinkChallenges.status, "PENDING")
      ))
      .limit(1);

    return challenge || null;
  }

  async logAudit(
    action: LinkAuditAction,
    provider: IdentityProvider,
    providerUserId: string,
    reason: string,
    context: IdentityContext & {
      actorUserId?: string;
      targetUserId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await db.insert(identityLinkAudit).values({
      actorUserId: context.actorUserId,
      targetUserId: context.targetUserId,
      provider,
      providerUserId,
      action,
      reason,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      metadata: context.metadata,
    });
  }

  isChallengeExpired(challenge: PendingLinkChallenge): boolean {
    return new Date(challenge.expiresAt) < new Date();
  }

  isMagicLinkExpired(challenge: PendingLinkChallenge): boolean {
    if (!challenge.magicLinkExpiresAt) return true;
    return new Date(challenge.magicLinkExpiresAt) < new Date();
  }

  maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (!domain) return "***@***";
    
    const maskedLocal = local.length <= 2 
      ? "*".repeat(local.length)
      : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
    
    return `${maskedLocal}@${domain}`;
  }
}

export const identityService = new IdentityService();
