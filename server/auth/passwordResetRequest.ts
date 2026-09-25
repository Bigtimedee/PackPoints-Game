import { maskEmailAddress } from "../services/emailService";

const SUCCESS = {
  success: true as const,
  message: "If an account exists, a reset link has been sent",
};

export function logPasswordResetEmailFailure(email: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err == null || err === "" ? "send failed" : String(err);
  console.error(`[Auth] Password reset email failed to=${maskEmailAddress(email)} error=${detail}`);
}

export async function requestPasswordReset(input: {
  email: unknown;
  getUserByEmail: (email: string) => Promise<{ id: string } | undefined>;
  createPasswordResetToken: (userId: string) => Promise<{ token: string }>;
  sendPasswordResetEmail: (email: string, token: string, baseUrl: string) => Promise<boolean>;
  baseUrl: string;
}): Promise<{ status: 200; body: typeof SUCCESS } | { status: 400; body: { error: string } }> {
  const { email } = input;
  if (!email || typeof email !== "string") {
    return { status: 400, body: { error: "Email is required" } };
  }

  const user = await input.getUserByEmail(email);
  if (!user) {
    console.log(`Password reset requested for non-existent email: ${email}`);
    return { status: 200, body: SUCCESS };
  }

  const resetToken = await input.createPasswordResetToken(user.id);
  const emailSent = await input.sendPasswordResetEmail(email, resetToken.token, input.baseUrl);
  if (!emailSent) {
    logPasswordResetEmailFailure(email, "send failed");
  }

  return { status: 200, body: SUCCESS };
}
