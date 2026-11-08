/**
 * Startup admin bootstrap. Creates an account only when both the email and the
 * username are unused. Never updates a password, admin flag, link, or points.
 */
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { localCredentials, users } from "@shared/schema";
import { db } from "../db";
import { normalizeEmail } from "./normalizeEmail";
import { planAdminBootstrap, type AdminBootstrapPlan } from "./adminBootstrapPlan";

type IdentityRow = { id: string; email: string | null; username: string | null };

function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function listByEmail(email: string): Promise<IdentityRow[]> {
  const trimmed = email.trim();
  return db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(sql`lower(btrim(${users.email})) = lower(${trimmed})`);
}

async function listByUsername(username: string): Promise<IdentityRow[]> {
  const trimmed = username.trim();
  return db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(sql`lower(btrim(${users.username})) = lower(${trimmed})`);
}

async function insertFreshAdmin(input: { email: string; username: string; password: string }): Promise<void> {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      username: input.username.trim(),
      email: input.email.trim(),
      emailNormalized: normalizeEmail(input.email.trim()),
      firstName: input.username.trim(),
      isAdmin: true,
      status: "ACTIVE",
    });
    await tx.insert(localCredentials).values({
      id: randomUUID(),
      userId: id,
      passwordHash,
    });
  });
}

export async function bootstrapAdminAccount(input: {
  email: string;
  username: string;
  password: string;
}): Promise<AdminBootstrapPlan> {
  const email = input.email.trim();
  const username = input.username.trim();
  if (!email || !username || !input.password) return { action: "skip" };
  const plan = planAdminBootstrap({
    emailMatches: await listByEmail(email),
    usernameMatches: await listByUsername(username),
  });
  if (plan.action !== "create") return plan;
  try {
    await insertFreshAdmin({ email, username, password: input.password });
    return { action: "create" };
  } catch (err) {
    if (isUniqueViolation(err)) return { action: "leave_existing" };
    throw err;
  }
}
