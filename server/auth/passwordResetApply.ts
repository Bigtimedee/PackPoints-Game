/**
 * Apply a password only after a valid reset token, and only report success
 * once every stored hash for that user matches the new password.
 * An account with no local credential gets one created. This does not link
 * a second identity and does not trust a client-supplied user id.
 */

export class UnverifiedPasswordReset extends Error {
  constructor() {
    super("Unverified password reset");
    this.name = "UnverifiedPasswordReset";
  }
}

export type StoredCredential = {
  id: string;
  passwordHash: string;
};

const SUCCESS = {
  success: true as const,
  message: "Password has been reset successfully",
};

export async function applyVerifiedPasswordReset(input: {
  userId: string;
  password: string;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, passwordHash: string) => Promise<boolean>;
  listCredentials: (userId: string) => Promise<StoredCredential[]>;
  updateAll: (userId: string, passwordHash: string) => Promise<number>;
  insertCredential: (userId: string, passwordHash: string) => Promise<void>;
}): Promise<void> {
  const passwordHash = await input.hashPassword(input.password);
  const existing = await input.listCredentials(input.userId);
  if (existing.length === 0) {
    await input.insertCredential(input.userId, passwordHash);
  } else {
    const updated = await input.updateAll(input.userId, passwordHash);
    if (updated < 1) throw new UnverifiedPasswordReset();
  }

  const stored = await input.listCredentials(input.userId);
  if (stored.length === 0) throw new UnverifiedPasswordReset();
  for (const row of stored) {
    if (!(await input.verifyPassword(input.password, row.passwordHash))) {
      throw new UnverifiedPasswordReset();
    }
  }
}

export async function completePasswordReset(input: {
  token: unknown;
  password: unknown;
  getPasswordResetToken: (token: string) => Promise<{ id: string; userId: string } | null>;
  applyPassword: (userId: string, password: string) => Promise<boolean>;
  markPasswordResetTokenUsed: (tokenId: string) => Promise<void>;
  revokeSessions?: (userId: string) => Promise<void>;
}): Promise<
  | { status: 200; body: typeof SUCCESS; userId: string }
  | { status: 400 | 500; body: { error: string } }
> {
  const { token, password } = input;
  if (typeof token !== "string" || typeof password !== "string" || token.length === 0 || password.length === 0) {
    return { status: 400, body: { error: "Token and password are required" } };
  }
  if (password.length < 8) {
    return { status: 400, body: { error: "Password must be at least 8 characters" } };
  }

  const resetToken = await input.getPasswordResetToken(token);
  if (!resetToken) {
    return { status: 400, body: { error: "Invalid or expired reset link" } };
  }

  const stored = await input.applyPassword(resetToken.userId, password);
  if (!stored) {
    return { status: 500, body: { error: "Failed to reset password" } };
  }

  await input.markPasswordResetTokenUsed(resetToken.id);
  if (input.revokeSessions) {
    try {
      await input.revokeSessions(resetToken.userId);
    } catch (err) {
      console.error("[ResetPassword] Session sweep failed:", err);
    }
  }

  return { status: 200, body: SUCCESS, userId: resetToken.userId };
}
