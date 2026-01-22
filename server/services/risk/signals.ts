import { db } from "../../db";
import { sql, and, eq, gte, lt, desc } from "drizzle-orm";
import {
  authEvents,
  deviceEvents,
  paymentEvents,
  redemptionEvents,
  userRollup24h,
  deviceRollup24h,
  ipRollup24h,
  fraudSignals,
  riskSnapshots,
  riskSuppressions,
  InsertFraudSignal,
} from "@shared/schema";
import { getTodayWindowStart } from "./rollups24h";

export interface ComputedSignal {
  signalType: string;
  severity: number;
  evidence: Record<string, unknown>;
}

const SIGNAL_WEIGHTS: Record<string, number> = {
  DISPUTE_PRESENT: 80,
  DEVICE_MULTI_ACCOUNT: 50,
  PURCHASE_VELOCITY_HIGH: 30,
  REDEEM_SOON_AFTER_BUY: 30,
  IP_VELOCITY: 25,
  NEW_COUNTRY: 20,
  DEVICE_CHURN: 20,
  REFUND_SPIKE: 20,
  BOT_FAST_RESPONSES: 20,
  NEW_DEVICE: 10,
  LOGIN_FAIL_SPIKE: 15,
  PURCHASE_VELOCITY_MED: 15,
  EXTERNAL_REDEEM_PRESSURE: 15,
};

export function getSignalWeight(signalType: string): number {
  return SIGNAL_WEIGHTS[signalType] || 0;
}

export function getSignalHumanReason(signalType: string): string {
  const reasons: Record<string, string> = {
    DISPUTE_PRESENT: "Dispute present in last 30d",
    DEVICE_MULTI_ACCOUNT: "Multiple accounts on same device",
    PURCHASE_VELOCITY_HIGH: "High purchase velocity",
    REDEEM_SOON_AFTER_BUY: "Redemption attempt shortly after purchase",
    IP_VELOCITY: "Multiple accounts from same IP",
    NEW_COUNTRY: "Login from new country",
    DEVICE_CHURN: "Using multiple devices",
    REFUND_SPIKE: "Multiple recent refunds",
    BOT_FAST_RESPONSES: "Unusually fast gameplay responses",
    NEW_DEVICE: "New device detected",
    LOGIN_FAIL_SPIKE: "Many failed login attempts",
    PURCHASE_VELOCITY_MED: "Moderate purchase activity",
    EXTERNAL_REDEEM_PRESSURE: "High redemption activity",
  };
  return reasons[signalType] || signalType;
}

async function getActiveSuppressions(userId: string): Promise<Set<string>> {
  const now = new Date();
  const suppressions = await db
    .select({ signalType: riskSuppressions.signalType })
    .from(riskSuppressions)
    .where(
      and(
        eq(riskSuppressions.userId, userId),
        gte(riskSuppressions.expiresAt, now)
      )
    );
  return new Set(suppressions.map((s) => s.signalType));
}

async function getUserRollup(userId: string): Promise<typeof userRollup24h.$inferSelect | null> {
  const windowStart = getTodayWindowStart();
  const result = await db
    .select()
    .from(userRollup24h)
    .where(
      and(
        eq(userRollup24h.userId, userId),
        eq(userRollup24h.windowStart, windowStart)
      )
    )
    .limit(1);
  return result[0] || null;
}

async function getDeviceRollup(deviceId: string): Promise<typeof deviceRollup24h.$inferSelect | null> {
  const windowStart = getTodayWindowStart();
  const result = await db
    .select()
    .from(deviceRollup24h)
    .where(
      and(
        eq(deviceRollup24h.deviceId, deviceId),
        eq(deviceRollup24h.windowStart, windowStart)
      )
    )
    .limit(1);
  return result[0] || null;
}

async function getIpRollup(ipHash: string): Promise<typeof ipRollup24h.$inferSelect | null> {
  const windowStart = getTodayWindowStart();
  const result = await db
    .select()
    .from(ipRollup24h)
    .where(
      and(
        eq(ipRollup24h.ipHash, ipHash),
        eq(ipRollup24h.windowStart, windowStart)
      )
    )
    .limit(1);
  return result[0] || null;
}

async function getRiskSnapshot(userId: string): Promise<typeof riskSnapshots.$inferSelect | null> {
  const result = await db
    .select()
    .from(riskSnapshots)
    .where(eq(riskSnapshots.userId, userId))
    .limit(1);
  return result[0] || null;
}

async function getLatestDeviceForUser(userId: string): Promise<{ deviceId: string; ipCountry: string | null } | null> {
  const result = await db
    .select({ deviceId: authEvents.deviceId, ipCountry: authEvents.ipCountry })
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(desc(authEvents.createdAt))
    .limit(1);
  
  if (result[0]?.deviceId) {
    return { deviceId: result[0].deviceId, ipCountry: result[0].ipCountry };
  }
  return null;
}

async function checkDisputePresent(userId: string): Promise<ComputedSignal | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const disputes = await db
    .select({ createdAt: paymentEvents.createdAt })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.userId, userId),
        eq(paymentEvents.eventType, "DISPUTE_OPENED"),
        gte(paymentEvents.createdAt, thirtyDaysAgo)
      )
    )
    .orderBy(desc(paymentEvents.createdAt))
    .limit(1);

  if (disputes.length > 0) {
    return {
      signalType: "DISPUTE_PRESENT",
      severity: 3,
      evidence: { most_recent_dispute_at: disputes[0].createdAt?.toISOString() },
    };
  }
  return null;
}

async function checkRefundSpike(userId: string): Promise<ComputedSignal | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const refunds = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.userId, userId),
        eq(paymentEvents.eventType, "REFUNDED"),
        gte(paymentEvents.createdAt, thirtyDaysAgo)
      )
    );

  const refundCount = Number(refunds[0]?.count || 0);
  if (refundCount >= 2) {
    return {
      signalType: "REFUND_SPIKE",
      severity: 2,
      evidence: { refund_count_30d: refundCount },
    };
  }
  return null;
}

async function checkRedeemSoonAfterBuy(userId: string): Promise<ComputedSignal | null> {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const recentPaid = await db
    .select({ createdAt: paymentEvents.createdAt })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.userId, userId),
        eq(paymentEvents.eventType, "PAID"),
        gte(paymentEvents.createdAt, oneDayAgo)
      )
    )
    .orderBy(desc(paymentEvents.createdAt));

  for (const paid of recentPaid) {
    if (!paid.createdAt) continue;
    const tenMinutesAfter = new Date(paid.createdAt.getTime() + 10 * 60 * 1000);

    const redeemApply = await db
      .select({ createdAt: redemptionEvents.createdAt })
      .from(redemptionEvents)
      .where(
        and(
          eq(redemptionEvents.userId, userId),
          eq(redemptionEvents.eventType, "APPLY"),
          gte(redemptionEvents.createdAt, paid.createdAt),
          lt(redemptionEvents.createdAt, tenMinutesAfter)
        )
      )
      .limit(1);

    if (redeemApply.length > 0 && redeemApply[0].createdAt) {
      const minutesDiff = Math.round(
        (redeemApply[0].createdAt.getTime() - paid.createdAt.getTime()) / 60000
      );
      return {
        signalType: "REDEEM_SOON_AFTER_BUY",
        severity: 3,
        evidence: {
          paid_at: paid.createdAt.toISOString(),
          redeem_apply_at: redeemApply[0].createdAt.toISOString(),
          minutes_diff: minutesDiff,
        },
      };
    }
  }
  return null;
}

export async function computeSignalsForUser24h(userId: string): Promise<ComputedSignal[]> {
  const signals: ComputedSignal[] = [];
  const suppressedTypes = await getActiveSuppressions(userId);

  const userRollup = await getUserRollup(userId);
  const snapshot = await getRiskSnapshot(userId);
  const latestDevice = await getLatestDeviceForUser(userId);

  const disputeSignal = await checkDisputePresent(userId);
  if (disputeSignal && !suppressedTypes.has("DISPUTE_PRESENT")) {
    signals.push(disputeSignal);
  }

  const refundSignal = await checkRefundSpike(userId);
  if (refundSignal && !suppressedTypes.has("REFUND_SPIKE")) {
    signals.push(refundSignal);
  }

  const redeemSoonSignal = await checkRedeemSoonAfterBuy(userId);
  if (redeemSoonSignal && !suppressedTypes.has("REDEEM_SOON_AFTER_BUY")) {
    signals.push(redeemSoonSignal);
  }

  if (latestDevice && snapshot?.lastDeviceId && latestDevice.deviceId !== snapshot.lastDeviceId) {
    if (!suppressedTypes.has("NEW_DEVICE")) {
      signals.push({
        signalType: "NEW_DEVICE",
        severity: 1,
        evidence: {
          current_device_id: latestDevice.deviceId.substring(0, 8) + "...",
          prior_device_id: snapshot.lastDeviceId.substring(0, 8) + "...",
        },
      });
    }
  }

  if (latestDevice?.ipCountry && snapshot?.lastCountry && latestDevice.ipCountry !== snapshot.lastCountry) {
    if (!suppressedTypes.has("NEW_COUNTRY")) {
      signals.push({
        signalType: "NEW_COUNTRY",
        severity: 2,
        evidence: {
          last_country: snapshot.lastCountry,
          current_country: latestDevice.ipCountry,
        },
      });
    }
  }

  if (userRollup) {
    const deviceCount = userRollup.distinctDeviceCount || 0;
    if (deviceCount >= 2 && !suppressedTypes.has("DEVICE_CHURN")) {
      const severity = deviceCount >= 4 ? 3 : deviceCount >= 3 ? 2 : 1;
      signals.push({
        signalType: "DEVICE_CHURN",
        severity,
        evidence: { distinct_device_count: deviceCount },
      });
    }

    const purchaseCount = userRollup.purchaseCount || 0;
    const purchaseAmountCents = userRollup.purchaseAmountCents || 0;

    if ((purchaseCount >= 3 || purchaseAmountCents >= 3000) && !suppressedTypes.has("PURCHASE_VELOCITY_HIGH")) {
      signals.push({
        signalType: "PURCHASE_VELOCITY_HIGH",
        severity: 3,
        evidence: { purchase_count: purchaseCount, purchase_amount_cents: purchaseAmountCents },
      });
    } else if ((purchaseCount === 2 || (purchaseAmountCents >= 1500 && purchaseAmountCents < 3000)) && !suppressedTypes.has("PURCHASE_VELOCITY_MED")) {
      signals.push({
        signalType: "PURCHASE_VELOCITY_MED",
        severity: 1,
        evidence: { purchase_count: purchaseCount, purchase_amount_cents: purchaseAmountCents },
      });
    }

    const redeemApplyCount = userRollup.redemptionApplyCount || 0;
    const redeemPtsApproved = userRollup.redemptionPtsApproved || 0;
    if ((redeemApplyCount >= 3 || redeemPtsApproved >= 3000) && !suppressedTypes.has("EXTERNAL_REDEEM_PRESSURE")) {
      signals.push({
        signalType: "EXTERNAL_REDEEM_PRESSURE",
        severity: 2,
        evidence: { redemption_apply_count: redeemApplyCount, redemption_pts_approved: redeemPtsApproved },
      });
    }

    const gameplayAnswers = userRollup.gameplayAnswers || 0;
    const medianResponseMs = userRollup.gameplayMedianResponseMs;
    if (gameplayAnswers >= 20 && medianResponseMs !== null && medianResponseMs < 350 && !suppressedTypes.has("BOT_FAST_RESPONSES")) {
      const severity = medianResponseMs < 250 ? 3 : medianResponseMs < 300 ? 2 : 1;
      signals.push({
        signalType: "BOT_FAST_RESPONSES",
        severity,
        evidence: { gameplay_answers: gameplayAnswers, gameplay_median_response_ms: medianResponseMs },
      });
    }

    const loginFailCount = userRollup.loginFailCount || 0;
    if (loginFailCount >= 10 && !suppressedTypes.has("LOGIN_FAIL_SPIKE")) {
      const severity = loginFailCount >= 20 ? 3 : 2;
      signals.push({
        signalType: "LOGIN_FAIL_SPIKE",
        severity,
        evidence: { login_fail_count: loginFailCount },
      });
    }
  }

  if (latestDevice?.deviceId) {
    const deviceRollup = await getDeviceRollup(latestDevice.deviceId);
    if (deviceRollup) {
      const distinctUserCount = deviceRollup.distinctUserCount || 0;
      if (distinctUserCount >= 3 && !suppressedTypes.has("DEVICE_MULTI_ACCOUNT")) {
        signals.push({
          signalType: "DEVICE_MULTI_ACCOUNT",
          severity: 3,
          evidence: { device_id: latestDevice.deviceId.substring(0, 8) + "...", distinct_user_count: distinctUserCount },
        });
      }
    }
  }

  const latestIp = await db
    .select({ ipHash: authEvents.ipHash })
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(desc(authEvents.createdAt))
    .limit(1);

  if (latestIp[0]?.ipHash) {
    const ipRollup = await getIpRollup(latestIp[0].ipHash);
    if (ipRollup) {
      const distinctUserCount = ipRollup.distinctUserCount || 0;
      if (distinctUserCount >= 3 && !suppressedTypes.has("IP_VELOCITY")) {
        const severity = distinctUserCount >= 5 ? 3 : 2;
        signals.push({
          signalType: "IP_VELOCITY",
          severity,
          evidence: { ip_hash: latestIp[0].ipHash.substring(0, 8) + "...", distinct_user_count: distinctUserCount },
        });
      }
    }
  }

  return signals;
}

export async function writeSignals(userId: string, signals: ComputedSignal[]): Promise<void> {
  const today = getTodayWindowStart().toISOString().split("T")[0];

  for (const signal of signals) {
    const evidenceKey = `${userId}:${signal.signalType}:${today}`;
    const evidenceWithKey = { ...signal.evidence, _dedup_key: evidenceKey };

    const existing = await db
      .select({ id: fraudSignals.id })
      .from(fraudSignals)
      .where(
        sql`${fraudSignals.evidence}->>'_dedup_key' = ${evidenceKey}`
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(fraudSignals).values({
        userId,
        signalType: signal.signalType,
        severity: signal.severity,
        window: "24h",
        evidence: evidenceWithKey,
      });
    }
  }
}
