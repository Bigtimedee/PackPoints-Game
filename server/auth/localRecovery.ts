import { createHash, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { users, localCredentials, passwordResetTokens, sessions } from "@shared/schema";

// Never choose the first of multiple case-variant accounts, or link by email.
export async function uniqueRecoveryAccount(email: string) {
  const matches = await db.select().from(users).where(sql`lower(trim(${users.email})) = lower(trim(${email}))`).limit(2);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Proof is the existing emailed, hashed, expiring token; preserve the same account id. */
export async function redeemLocalPassword(token: string, password: string): Promise<boolean> {
  const digest = createHash("sha256").update(token).digest("hex");
  const [hint] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, digest)).limit(1);
  if (!hint) return false;
  const passwordHash = await bcrypt.hash(password, 10);
  return db.transaction(async tx => {
    // Account-first order serializes different tokens for the same identity.
    const [account] = await tx.select().from(users).where(eq(users.id, hint.userId)).for("no key update").limit(1);
    if (!account) return false;
    const [accepted] = await tx.update(passwordResetTokens).set({usedAt: new Date()})
      .where(and(eq(passwordResetTokens.token, digest), sql`${passwordResetTokens.usedAt} IS NULL`, sql`${passwordResetTokens.expiresAt} > CURRENT_TIMESTAMP`)).returning();
    if (!accepted) return false;
    const existing = await tx.select().from(localCredentials).where(eq(localCredentials.userId, account.id));
    if (existing.length > 1) throw new Error("Credential records require review");
    if (existing.length === 1) {
      await tx.update(localCredentials).set({passwordHash}).where(eq(localCredentials.userId, account.id));
    } else {
      await tx.insert(localCredentials).values({id: randomUUID(), userId: account.id, passwordHash});
    }
    // Invalidate other outstanding reset links after this successful reset.
    await tx.update(passwordResetTokens).set({usedAt: new Date()}).where(and(eq(passwordResetTokens.userId, account.id), sql`${passwordResetTokens.usedAt} IS NULL`));
    // All supported historical session shapes. Failure rolls back credential+token.
    await tx.delete(sessions).where(sql`sess->>'localUserId' = ${account.id} OR sess->'passport'->'user'->'claims'->>'sub' = ${account.id} OR (${account.workosUserId}::text IS NOT NULL AND sess->>'workosUserId' = ${account.workosUserId})`);
    return true;
  });
}
