import { db } from "../../db";
import {
  authEvents,
  deviceEvents,
  paymentEvents,
  redemptionEvents,
  gameplayEvents,
  InsertAuthEvent,
  InsertDeviceEvent,
  InsertPaymentEvent,
  InsertRedemptionEvent,
  InsertGameplayEvent,
} from "@shared/schema";
import { hashIp, deriveDeviceIdFromRequest, extractClientIp, extractDeviceIdFromRequest, extractIpCountry } from "../../utils/hash";

const RISK_PIPELINE_ENABLED = process.env.RISK_PIPELINE_ENABLED !== "false";

interface RequestContext {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function extractRequestContext(req?: RequestContext) {
  if (!req) {
    return { ipHash: null, ipCountry: null, deviceId: null, userAgent: null };
  }

  const clientIp = extractClientIp(req);
  const ipHash = clientIp ? hashIp(clientIp) : null;
  const ipCountry = extractIpCountry(req);
  const clientDeviceId = extractDeviceIdFromRequest(req);
  const userAgent = req.headers?.["user-agent"];
  const userAgentStr = Array.isArray(userAgent) ? userAgent[0] : userAgent;

  const { deviceId } = deriveDeviceIdFromRequest(clientDeviceId, userAgentStr, ipHash || undefined);

  return { ipHash, ipCountry, deviceId, userAgent: userAgentStr || null };
}

export async function logAuthEvent(
  eventType: InsertAuthEvent["eventType"],
  options: {
    userId?: string;
    sessionId?: string;
    req?: RequestContext;
    deviceId?: string;
    ipHash?: string;
    ipCountry?: string;
    userAgent?: string;
  }
): Promise<void> {
  if (!RISK_PIPELINE_ENABLED) return;

  try {
    const ctx = extractRequestContext(options.req);

    await db.insert(authEvents).values({
      userId: options.userId || null,
      eventType,
      sessionId: options.sessionId || null,
      deviceId: options.deviceId || ctx.deviceId,
      ipHash: options.ipHash || ctx.ipHash,
      ipCountry: options.ipCountry || ctx.ipCountry,
      userAgent: options.userAgent || ctx.userAgent,
    });
  } catch (error) {
    console.error("[RiskPipeline] Failed to log auth event:", error);
  }
}

export async function logDeviceSeen(
  options: {
    userId?: string;
    deviceId: string;
    fingerprintVersion?: string;
    eventType?: InsertDeviceEvent["eventType"];
    req?: RequestContext;
    ipHash?: string;
    ipCountry?: string;
  }
): Promise<void> {
  if (!RISK_PIPELINE_ENABLED) return;

  try {
    const ctx = extractRequestContext(options.req);

    await db.insert(deviceEvents).values({
      userId: options.userId || null,
      deviceId: options.deviceId,
      fingerprintVersion: options.fingerprintVersion || null,
      eventType: options.eventType || "DEVICE_SEEN",
      ipHash: options.ipHash || ctx.ipHash,
      ipCountry: options.ipCountry || ctx.ipCountry,
    });
  } catch (error) {
    console.error("[RiskPipeline] Failed to log device event:", error);
  }
}

export async function logPaymentEvent(
  eventType: InsertPaymentEvent["eventType"],
  options: {
    userId: string;
    purchaseId?: string;
    stripeEventId?: string;
    amountCents: number;
    currency?: string;
    paymentMethodFingerprint?: string;
    req?: RequestContext;
    deviceId?: string;
    ipHash?: string;
    ipCountry?: string;
  }
): Promise<void> {
  if (!RISK_PIPELINE_ENABLED) return;

  try {
    const ctx = extractRequestContext(options.req);

    await db.insert(paymentEvents).values({
      userId: options.userId,
      purchaseId: options.purchaseId || null,
      stripeEventId: options.stripeEventId || null,
      eventType,
      amountCents: options.amountCents,
      currency: options.currency || "usd",
      paymentMethodFingerprint: options.paymentMethodFingerprint || null,
      deviceId: options.deviceId || ctx.deviceId,
      ipHash: options.ipHash || ctx.ipHash,
      ipCountry: options.ipCountry || ctx.ipCountry,
    });
  } catch (error) {
    console.error("[RiskPipeline] Failed to log payment event:", error);
  }
}

export async function logRedemptionEvent(
  eventType: InsertRedemptionEvent["eventType"],
  options: {
    userId: string;
    purchaseIntentId?: string;
    source?: InsertRedemptionEvent["source"];
    priceCents?: number;
    ptsRequested?: number;
    ptsApproved?: number;
  }
): Promise<void> {
  if (!RISK_PIPELINE_ENABLED) return;

  try {
    await db.insert(redemptionEvents).values({
      userId: options.userId,
      purchaseIntentId: options.purchaseIntentId || null,
      source: options.source || null,
      eventType,
      priceCents: options.priceCents || null,
      ptsRequested: options.ptsRequested || null,
      ptsApproved: options.ptsApproved || null,
    });
  } catch (error) {
    console.error("[RiskPipeline] Failed to log redemption event:", error);
  }
}

export async function logGameplayEvent(
  eventType: InsertGameplayEvent["eventType"],
  options: {
    userId: string;
    matchId: string;
    opponentId?: string;
    cardId?: string;
    answerCorrect?: boolean;
    responseTimeMs?: number;
  }
): Promise<void> {
  if (!RISK_PIPELINE_ENABLED) return;

  try {
    await db.insert(gameplayEvents).values({
      userId: options.userId,
      matchId: options.matchId,
      opponentId: options.opponentId || null,
      eventType,
      cardId: options.cardId || null,
      answerCorrect: options.answerCorrect ?? null,
      responseTimeMs: options.responseTimeMs ?? null,
    });
  } catch (error) {
    console.error("[RiskPipeline] Failed to log gameplay event:", error);
  }
}

export function getRiskContext(req?: RequestContext) {
  return extractRequestContext(req);
}
