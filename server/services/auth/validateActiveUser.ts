import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ValidateUserResult {
  valid: boolean;
  reason?: "NOT_FOUND" | "BANNED" | "PENDING" | "WAITLISTED" | "INACTIVE";
  user?: {
    id: string;
    username: string | null;
    status: string;
  };
}

export async function validateActiveUser(userId: string): Promise<ValidateUserResult> {
  if (!userId) {
    return { valid: false, reason: "NOT_FOUND" };
  }

  const [user] = await db.select({
    id: users.id,
    username: users.username,
    status: users.status,
  }).from(users).where(eq(users.id, userId));

  if (!user) {
    return { valid: false, reason: "NOT_FOUND" };
  }

  if (user.status === "BANNED") {
    return { valid: false, reason: "BANNED", user };
  }

  if (user.status === "PENDING") {
    return { valid: false, reason: "PENDING", user };
  }

  if (user.status === "WAITLISTED") {
    return { valid: false, reason: "WAITLISTED", user };
  }

  if (user.status !== "ACTIVE") {
    return { valid: false, reason: "INACTIVE", user };
  }

  return { valid: true, user };
}

export async function assertActiveUser(userId: string): Promise<{ id: string; username: string | null; status: string }> {
  const result = await validateActiveUser(userId);
  if (!result.valid) {
    throw new Error(`User validation failed: ${result.reason}`);
  }
  return result.user!;
}
