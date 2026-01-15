import { db } from "../db";
import { foundersPass, foundersPassEvents, users, appConfig, activeUserCounter } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

const PEPPER = process.env.FOUNDERS_PASS_PEPPER || "default-pepper-change-in-production";

export function generatePassToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token + PEPPER).digest("hex");
}

export interface PassWithToken {
  id: string;
  rawToken: string;
  tokenHash: string;
  issuedToUserId: string;
  status: string;
  createdAt: Date | null;
}

async function logPassEvent(
  passId: string,
  eventType: "ISSUED" | "LINK_VIEWED" | "REDEEM_ATTEMPT" | "REDEEM_SUCCESS" | "REDEEM_FAIL" | "DEACTIVATED_GLOBAL" | "DEACTIVATED_INDIVIDUAL",
  ip?: string | null,
  userAgent?: string | null,
  deviceFingerprint?: string | null,
  metadata?: Record<string, any>
) {
  await db.insert(foundersPassEvents).values({
    passId,
    eventType,
    ip: ip || null,
    userAgent: userAgent || null,
    deviceFingerprint: deviceFingerprint || null,
    metadata: metadata || null,
  });
}

export async function issuePassToUser(userId: string): Promise<PassWithToken | null> {
  const existingPass = await db.query.foundersPass.findFirst({
    where: and(
      eq(foundersPass.issuedToUserId, userId),
      eq(foundersPass.status, "ACTIVE")
    ),
  });

  if (existingPass) {
    return null;
  }

  const rawToken = generatePassToken();
  const tokenHash = hashToken(rawToken);

  const [pass] = await db.insert(foundersPass).values({
    tokenHash,
    issuedToUserId: userId,
    status: "ACTIVE",
  }).returning();

  await logPassEvent(pass.id, "ISSUED", null, null, null, { userId });

  return {
    id: pass.id,
    rawToken,
    tokenHash: pass.tokenHash,
    issuedToUserId: pass.issuedToUserId,
    status: pass.status,
    createdAt: pass.createdAt,
  };
}

export async function getActivePassForUser(userId: string): Promise<{ id: string; tokenHash: string; createdAt: Date | null } | null> {
  const pass = await db.query.foundersPass.findFirst({
    where: and(
      eq(foundersPass.issuedToUserId, userId),
      eq(foundersPass.status, "ACTIVE")
    ),
  });
  return pass ? { id: pass.id, tokenHash: pass.tokenHash, createdAt: pass.createdAt } : null;
}

export async function validatePassToken(tokenHash: string): Promise<{
  valid: boolean;
  passId?: string;
  reason?: string;
}> {
  const pass = await db.query.foundersPass.findFirst({
    where: eq(foundersPass.tokenHash, tokenHash),
  });

  if (!pass) {
    return { valid: false, reason: "Pass not found" };
  }

  if (pass.status !== "ACTIVE") {
    return { valid: false, reason: `Pass is ${pass.status.toLowerCase()}` };
  }

  const config = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "founders_gate"),
  });

  const gateConfig = config?.value as { enabled?: boolean; maxActiveUsers?: number } | null;
  if (!gateConfig?.enabled) {
    return { valid: false, reason: "Founders gate is closed" };
  }

  const counter = await db.query.activeUserCounter.findFirst();
  if (counter && gateConfig.maxActiveUsers && counter.count >= gateConfig.maxActiveUsers) {
    return { valid: false, reason: "Founders cap reached" };
  }

  return { valid: true, passId: pass.id };
}

export async function recordLinkViewed(
  tokenHash: string,
  ip?: string,
  userAgent?: string,
  deviceFingerprint?: string
): Promise<void> {
  const pass = await db.query.foundersPass.findFirst({
    where: eq(foundersPass.tokenHash, tokenHash),
  });

  if (pass) {
    await logPassEvent(pass.id, "LINK_VIEWED", ip, userAgent, deviceFingerprint);
  }
}

export async function consumePassAtomic(
  tokenHash: string,
  consumedByUserId: string,
  consumedByIp?: string,
  consumedByDeviceFingerprint?: string
): Promise<{ success: boolean; error?: string }> {
  return await db.transaction(async (tx) => {
    const [pass] = await tx
      .select()
      .from(foundersPass)
      .where(eq(foundersPass.tokenHash, tokenHash))
      .for("update");

    if (!pass) {
      return { success: false, error: "Pass not found" };
    }

    if (pass.status !== "ACTIVE") {
      await tx.insert(foundersPassEvents).values({
        passId: pass.id,
        eventType: "REDEEM_FAIL",
        ip: consumedByIp || null,
        deviceFingerprint: consumedByDeviceFingerprint || null,
        metadata: { reason: `Pass status is ${pass.status}` },
      });
      return { success: false, error: `Pass is ${pass.status.toLowerCase()}` };
    }

    const config = await tx.query.appConfig.findFirst({
      where: eq(appConfig.key, "founders_gate"),
    });
    const gateConfig = config?.value as { enabled?: boolean; maxActiveUsers?: number } | null;
    
    if (!gateConfig?.enabled) {
      return { success: false, error: "Founders gate is closed" };
    }

    const [counter] = await tx
      .select()
      .from(activeUserCounter)
      .for("update");

    if (counter && gateConfig.maxActiveUsers && counter.count >= gateConfig.maxActiveUsers) {
      await deactivateAllPassesInTx(tx);
      return { success: false, error: "Founders cap reached" };
    }

    await tx.update(foundersPass)
      .set({
        status: "CONSUMED",
        consumedAt: new Date(),
        consumedByUserId,
        consumedByIp: consumedByIp || null,
        consumedByDeviceFingerprint: consumedByDeviceFingerprint || null,
      })
      .where(eq(foundersPass.id, pass.id));

    await tx.insert(foundersPassEvents).values({
      passId: pass.id,
      eventType: "REDEEM_SUCCESS",
      ip: consumedByIp || null,
      deviceFingerprint: consumedByDeviceFingerprint || null,
      metadata: { consumedByUserId },
    });

    return { success: true };
  });
}

async function deactivateAllPassesInTx(tx: any): Promise<number> {
  const activePasses = await tx
    .select({ id: foundersPass.id })
    .from(foundersPass)
    .where(eq(foundersPass.status, "ACTIVE"));

  if (activePasses.length === 0) return 0;

  await tx.update(foundersPass)
    .set({
      status: "DEACTIVATED",
      deactivatedAt: new Date(),
    })
    .where(eq(foundersPass.status, "ACTIVE"));

  for (const pass of activePasses) {
    await tx.insert(foundersPassEvents).values({
      passId: pass.id,
      eventType: "DEACTIVATED_GLOBAL",
      metadata: { reason: "Founders cap reached" },
    });
  }

  return activePasses.length;
}

export async function deactivateAllPasses(): Promise<number> {
  return await db.transaction(async (tx) => {
    return await deactivateAllPassesInTx(tx);
  });
}

export async function deactivatePass(passId: string, reason?: string): Promise<boolean> {
  const [pass] = await db
    .update(foundersPass)
    .set({
      status: "DEACTIVATED",
      deactivatedAt: new Date(),
    })
    .where(and(
      eq(foundersPass.id, passId),
      eq(foundersPass.status, "ACTIVE")
    ))
    .returning();

  if (pass) {
    await logPassEvent(pass.id, "DEACTIVATED_INDIVIDUAL", null, null, null, { reason });
    return true;
  }
  return false;
}

export async function getPassesByStatus(status: "ACTIVE" | "CONSUMED" | "DEACTIVATED" | "EXPIRED"): Promise<Array<{
  id: string;
  issuedToUserId: string;
  status: string;
  createdAt: Date | null;
  consumedAt: Date | null;
  consumedByUserId: string | null;
}>> {
  return await db.query.foundersPass.findMany({
    where: eq(foundersPass.status, status),
    orderBy: (pass, { desc }) => [desc(pass.createdAt)],
  });
}

export async function getAllPasses(): Promise<Array<{
  id: string;
  issuedToUserId: string;
  status: string;
  createdAt: Date | null;
  consumedAt: Date | null;
  consumedByUserId: string | null;
}>> {
  return await db.query.foundersPass.findMany({
    orderBy: (pass, { desc }) => [desc(pass.createdAt)],
  });
}

export async function isFoundersGateClosed(): Promise<boolean> {
  const config = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "founders_gate"),
  });
  const gateConfig = config?.value as { enabled?: boolean; maxActiveUsers?: number } | null;
  
  if (!gateConfig?.enabled) {
    return true;
  }

  const counter = await db.query.activeUserCounter.findFirst();
  if (counter && gateConfig.maxActiveUsers && counter.count >= gateConfig.maxActiveUsers) {
    return true;
  }

  return false;
}

export async function checkDeviceFingerprintAbuse(deviceFingerprint: string): Promise<boolean> {
  const existingActiveUser = await db.query.users.findFirst({
    where: and(
      eq(users.deviceFingerprint, deviceFingerprint),
      eq(users.status, "ACTIVE")
    ),
  });
  return !!existingActiveUser;
}
