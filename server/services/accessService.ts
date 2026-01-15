import { db } from "../db";
import { 
  users, 
  appConfig, 
  waitlistEntries, 
  inviteCodes, 
  accessAuditLog,
  activeUserCounter,
  FOUNDERS_CAP_DEFAULT,
  type UserStatus,
  type WaitlistStatus,
  type AccessAuditAction,
  type InviteCode,
  type WaitlistEntry,
} from "@shared/schema";
import { eq, sql, and, gt } from "drizzle-orm";
import crypto from "crypto";

// Types for config values
interface FoundersCapConfig {
  maxActiveUsers: number;
  enabled: boolean;
  inviteBypass: boolean;
  reservedSeatsForInvites: number;
}

interface ActivationResult {
  activated: boolean;
  reason?: "CAP_REACHED" | "ALREADY_ACTIVE" | "BANNED" | "SUCCESS";
  waitlistPosition?: number;
}

interface InviteValidationResult {
  valid: boolean;
  reason?: "NOT_FOUND" | "EXPIRED" | "EXHAUSTED";
  invite?: InviteCode;
}

interface ActivationContext {
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  inviteCode?: string;
}

// Email normalization (removes dots from gmail, lowercases, etc.)
export function normalizeEmail(email: string): string {
  const [localPart, domain] = email.toLowerCase().split("@");
  if (!localPart || !domain) return email.toLowerCase();
  
  // For Gmail, remove dots and anything after + 
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleanLocal = localPart.split("+")[0]?.replace(/\./g, "") || localPart;
    return `${cleanLocal}@${domain}`;
  }
  
  // For other providers, just lowercase and remove +alias
  const cleanLocal = localPart.split("+")[0] || localPart;
  return `${cleanLocal}@${domain}`;
}

// Generate a short referral code
export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Generate an invite code
export function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// Get founders cap config from database
export async function getFoundersCapConfig(): Promise<FoundersCapConfig> {
  const [config] = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, "founders_cap"));
  
  if (!config) {
    return FOUNDERS_CAP_DEFAULT;
  }
  
  return {
    ...FOUNDERS_CAP_DEFAULT,
    ...(config.value as Partial<FoundersCapConfig>),
  };
}

// Update founders cap config
export async function updateFoundersCapConfig(
  updates: Partial<FoundersCapConfig>,
  updatedBy?: string
): Promise<FoundersCapConfig> {
  const current = await getFoundersCapConfig();
  const newConfig = { ...current, ...updates };
  
  await db
    .insert(appConfig)
    .values({
      key: "founders_cap",
      value: newConfig,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: newConfig,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  
  return newConfig;
}

// Log access audit event
export async function logAccessAudit(
  action: AccessAuditAction,
  context: {
    userId?: string;
    email?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.insert(accessAuditLog).values({
    action,
    userId: context.userId,
    email: context.email,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    deviceFingerprint: context.deviceFingerprint,
    metadata: context.metadata,
  });
}

// Get current access summary (active count, cap, etc.)
export async function getAccessSummary(): Promise<{
  activeCount: number;
  maxActiveUsers: number;
  enabled: boolean;
  remainingSeats: number;
  reservedSeatsUsed: number;
  reservedSeatsTotal: number;
  waitlistSize: number;
}> {
  const config = await getFoundersCapConfig();
  
  const [counter] = await db.select().from(activeUserCounter).where(eq(activeUserCounter.id, 1));
  const activeCount = counter?.count || 0;
  const reservedSeatsUsed = counter?.reservedSeatsUsed || 0;
  
  const [waitlistCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.status, "WAITING"));
  
  const remainingSeats = Math.max(0, config.maxActiveUsers - activeCount);
  
  return {
    activeCount,
    maxActiveUsers: config.maxActiveUsers,
    enabled: config.enabled,
    remainingSeats,
    reservedSeatsUsed,
    reservedSeatsTotal: config.reservedSeatsForInvites,
    waitlistSize: waitlistCount?.count || 0,
  };
}

// Atomic user activation with PostgreSQL row-level locking
export async function tryActivateUser(
  userId: string,
  context: ActivationContext = {}
): Promise<ActivationResult> {
  const config = await getFoundersCapConfig();
  
  // If cap is disabled, always activate
  if (!config.enabled) {
    await db.update(users).set({
      status: "ACTIVE" as UserStatus,
      activatedAt: new Date(),
      lastSignupIp: context.ipAddress,
      deviceFingerprint: context.deviceFingerprint,
    }).where(eq(users.id, userId));
    
    await logAccessAudit("ACTIVATION_SUCCESS", {
      userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      metadata: { reason: "cap_disabled" },
    });
    
    return { activated: true, reason: "SUCCESS" };
  }
  
  // Check if user already has a status
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return { activated: false, reason: "CAP_REACHED" };
  }
  
  if (user.status === "ACTIVE") {
    return { activated: true, reason: "ALREADY_ACTIVE" };
  }
  
  if (user.status === "BANNED") {
    return { activated: false, reason: "BANNED" };
  }
  
  // Check for invite code bypass
  let useReservedSeat = false;
  if (context.inviteCode && config.inviteBypass) {
    const inviteResult = await validateInviteCode(context.inviteCode);
    if (inviteResult.valid && inviteResult.invite) {
      useReservedSeat = inviteResult.invite.reservedSeat;
    }
  }
  
  // Atomic activation using SELECT FOR UPDATE on the counter row
  return await db.transaction(async (tx) => {
    // Lock the counter row to prevent race conditions
    const [counter] = await tx
      .select()
      .from(activeUserCounter)
      .where(eq(activeUserCounter.id, 1))
      .for("update");
    
    if (!counter) {
      throw new Error("Active user counter not found");
    }
    
    const currentActive = counter.count;
    const currentReservedUsed = counter.reservedSeatsUsed;
    
    // Check if we can activate
    let canActivate = false;
    let shouldUseReservedSeat = false;
    
    if (currentActive < config.maxActiveUsers) {
      // Under cap, can activate normally
      canActivate = true;
    } else if (useReservedSeat && config.inviteBypass) {
      // Cap reached but have invite code with reserved seat
      if (currentReservedUsed < config.reservedSeatsForInvites) {
        canActivate = true;
        shouldUseReservedSeat = true;
      }
    }
    
    if (!canActivate) {
      // Cap reached, add to waitlist
      const maxPosition = await tx
        .select({ maxPos: sql<number>`COALESCE(MAX(position), 0)::int` })
        .from(waitlistEntries);
      
      const position = (maxPosition[0]?.maxPos || 0) + 1;
      
      // Update user status to waitlisted
      await tx.update(users).set({
        status: "WAITLISTED" as UserStatus,
        waitlistJoinedAt: new Date(),
        lastSignupIp: context.ipAddress,
        deviceFingerprint: context.deviceFingerprint,
      }).where(eq(users.id, userId));
      
      await logAccessAudit("ACTIVATION_WAITLISTED", {
        userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        deviceFingerprint: context.deviceFingerprint,
        metadata: { position, activeCount: currentActive, cap: config.maxActiveUsers },
      });
      
      return { activated: false, reason: "CAP_REACHED" as const, waitlistPosition: position };
    }
    
    // Activate the user
    await tx.update(users).set({
      status: "ACTIVE" as UserStatus,
      activatedAt: new Date(),
      lastSignupIp: context.ipAddress,
      deviceFingerprint: context.deviceFingerprint,
    }).where(eq(users.id, userId));
    
    // Increment the counter
    await tx
      .update(activeUserCounter)
      .set({
        count: sql`${activeUserCounter.count} + 1`,
        reservedSeatsUsed: shouldUseReservedSeat 
          ? sql`${activeUserCounter.reservedSeatsUsed} + 1`
          : activeUserCounter.reservedSeatsUsed,
        updatedAt: new Date(),
      })
      .where(eq(activeUserCounter.id, 1));
    
    // Consume invite code if used
    if (context.inviteCode) {
      await consumeInviteCodeInternal(tx, context.inviteCode);
    }
    
    await logAccessAudit("ACTIVATION_SUCCESS", {
      userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      metadata: { 
        usedReservedSeat: shouldUseReservedSeat,
        inviteCode: context.inviteCode,
      },
    });
    
    return { activated: true, reason: "SUCCESS" as const };
  });
}

// Validate an invite code
export async function validateInviteCode(code: string): Promise<InviteValidationResult> {
  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code.toUpperCase()));
  
  if (!invite) {
    return { valid: false, reason: "NOT_FOUND" };
  }
  
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return { valid: false, reason: "EXPIRED" };
  }
  
  if (invite.uses >= invite.maxUses) {
    return { valid: false, reason: "EXHAUSTED" };
  }
  
  return { valid: true, invite };
}

// Internal function to consume invite code (within transaction)
async function consumeInviteCodeInternal(tx: any, code: string): Promise<void> {
  await tx
    .update(inviteCodes)
    .set({
      uses: sql`${inviteCodes.uses} + 1`,
    })
    .where(eq(inviteCodes.code, code.toUpperCase()));
}

// Consume an invite code (for API use)
export async function consumeInviteCode(code: string): Promise<boolean> {
  const result = await validateInviteCode(code);
  if (!result.valid) {
    return false;
  }
  
  await db
    .update(inviteCodes)
    .set({
      uses: sql`${inviteCodes.uses} + 1`,
    })
    .where(eq(inviteCodes.code, code.toUpperCase()));
  
  return true;
}

// Create invite codes (admin function)
export async function createInviteCodes(
  count: number,
  options: {
    maxUses?: number;
    expiresAt?: Date;
    reservedSeat?: boolean;
    createdByAdminUserId?: string;
    note?: string;
  } = {}
): Promise<string[]> {
  const codes: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    codes.push(code);
    
    await db.insert(inviteCodes).values({
      code,
      maxUses: options.maxUses || 1,
      expiresAt: options.expiresAt,
      reservedSeat: options.reservedSeat ?? true,
      createdByAdminUserId: options.createdByAdminUserId,
      note: options.note,
    });
  }
  
  await logAccessAudit("ADMIN_INVITE_CREATE", {
    userId: options.createdByAdminUserId,
    metadata: { count, codes, options },
  });
  
  return codes;
}

// Join waitlist
export async function joinWaitlist(
  email: string,
  options: {
    name?: string;
    referredByCode?: string;
    deviceFingerprint?: string;
    ipAddress?: string;
  } = {}
): Promise<{ success: boolean; position?: number; referralCode?: string; error?: string }> {
  const emailNormalized = normalizeEmail(email);
  
  // Check if already on waitlist
  const [existing] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.emailNormalized, emailNormalized));
  
  if (existing) {
    return { 
      success: true, 
      position: existing.position, 
      referralCode: existing.referralCode || undefined 
    };
  }
  
  // Check if already a registered user
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized));
  
  if (existingUser) {
    return { success: false, error: "EMAIL_ALREADY_REGISTERED" };
  }
  
  // Get next position
  const [maxPos] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), 0)::int` })
    .from(waitlistEntries);
  
  const position = (maxPos?.max || 0) + 1;
  const referralCode = generateReferralCode();
  
  // Validate and credit referrer
  if (options.referredByCode) {
    const [referrer] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.referralCode, options.referredByCode.toUpperCase()));
    
    if (referrer) {
      await db
        .update(waitlistEntries)
        .set({
          referralsCount: sql`${waitlistEntries.referralsCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(waitlistEntries.id, referrer.id));
    }
  }
  
  await db.insert(waitlistEntries).values({
    email,
    emailNormalized,
    name: options.name,
    status: "WAITING",
    position,
    referralCode,
    referredByCode: options.referredByCode?.toUpperCase(),
    deviceFingerprint: options.deviceFingerprint,
    signupIp: options.ipAddress,
  });
  
  await logAccessAudit("WAITLIST_JOIN", {
    email,
    ipAddress: options.ipAddress,
    deviceFingerprint: options.deviceFingerprint,
    metadata: { position, referredByCode: options.referredByCode },
  });
  
  return { success: true, position, referralCode };
}

// Get waitlist status for an email
export async function getWaitlistStatus(email: string): Promise<{
  found: boolean;
  position?: number;
  status?: WaitlistStatus;
  referralCode?: string;
  referralsCount?: number;
  inviteCode?: string;
}> {
  const emailNormalized = normalizeEmail(email);
  
  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.emailNormalized, emailNormalized));
  
  if (!entry) {
    return { found: false };
  }
  
  return {
    found: true,
    position: entry.position,
    status: entry.status as WaitlistStatus,
    referralCode: entry.referralCode || undefined,
    referralsCount: entry.referralsCount,
    inviteCode: entry.status === "INVITED" ? entry.inviteCodeSent || undefined : undefined,
  };
}

// Admin: Invite waitlist entry
export async function inviteWaitlistEntry(
  waitlistId: string,
  adminUserId: string
): Promise<{ success: boolean; inviteCode?: string; error?: string }> {
  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, waitlistId));
  
  if (!entry) {
    return { success: false, error: "NOT_FOUND" };
  }
  
  if (entry.status !== "WAITING") {
    return { success: false, error: "ALREADY_PROCESSED" };
  }
  
  // Create invite code for this entry
  const [inviteCode] = await createInviteCodes(1, {
    maxUses: 1,
    reservedSeat: true,
    createdByAdminUserId: adminUserId,
    note: `Waitlist invite for ${entry.email}`,
  });
  
  if (!inviteCode) {
    return { success: false, error: "FAILED_TO_CREATE_CODE" };
  }
  
  await db
    .update(waitlistEntries)
    .set({
      status: "INVITED",
      inviteCodeSent: inviteCode,
      invitedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(waitlistEntries.id, waitlistId));
  
  await logAccessAudit("WAITLIST_INVITED", {
    userId: adminUserId,
    email: entry.email,
    metadata: { waitlistId, inviteCode },
  });
  
  return { success: true, inviteCode };
}

// Admin: Approve a waitlisted user to become active
export async function approveWaitlistedUser(
  userId: string,
  adminUserId: string
): Promise<{ success: boolean; error?: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  
  if (!user) {
    return { success: false, error: "USER_NOT_FOUND" };
  }
  
  if (user.status !== "WAITLISTED") {
    return { success: false, error: "NOT_WAITLISTED" };
  }
  
  // Use reserved seat to activate
  const config = await getFoundersCapConfig();
  const [counter] = await db.select().from(activeUserCounter).where(eq(activeUserCounter.id, 1));
  
  if (!counter) {
    return { success: false, error: "COUNTER_ERROR" };
  }
  
  if (counter.reservedSeatsUsed >= config.reservedSeatsForInvites) {
    return { success: false, error: "NO_RESERVED_SEATS" };
  }
  
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      status: "ACTIVE" as UserStatus,
      activatedAt: new Date(),
    }).where(eq(users.id, userId));
    
    await tx.update(activeUserCounter).set({
      count: sql`${activeUserCounter.count} + 1`,
      reservedSeatsUsed: sql`${activeUserCounter.reservedSeatsUsed} + 1`,
      updatedAt: new Date(),
    }).where(eq(activeUserCounter.id, 1));
  });
  
  await logAccessAudit("WAITLIST_ACCEPTED", {
    userId: adminUserId,
    metadata: { approvedUserId: userId },
  });
  
  return { success: true };
}

// Get waitlist entries for admin
export async function getWaitlistEntries(
  options: {
    status?: WaitlistStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: WaitlistEntry[]; total: number }> {
  const conditions = options.status 
    ? eq(waitlistEntries.status, options.status)
    : undefined;
  
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waitlistEntries)
    .where(conditions);
  
  const entries = await db
    .select()
    .from(waitlistEntries)
    .where(conditions)
    .orderBy(waitlistEntries.position)
    .limit(options.limit || 50)
    .offset(options.offset || 0);
  
  return {
    entries,
    total: countResult?.count || 0,
  };
}

// Get all invite codes for admin
export async function getInviteCodes(
  options: {
    includeExpired?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ codes: InviteCode[]; total: number }> {
  const now = new Date();
  const conditions = options.includeExpired 
    ? undefined 
    : sql`expires_at IS NULL OR expires_at > ${now}`;
  
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inviteCodes)
    .where(conditions);
  
  const codes = await db
    .select()
    .from(inviteCodes)
    .where(conditions)
    .orderBy(sql`created_at DESC`)
    .limit(options.limit || 50)
    .offset(options.offset || 0);
  
  return {
    codes,
    total: countResult?.count || 0,
  };
}
