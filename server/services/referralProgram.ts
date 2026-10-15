/**
 * Referral program rules (REFERRAL_SPEC.md, Oct 14 2026).
 *
 * The inviter earns only when the invitee registers AND completes a real first
 * game, detected on the server (never a client call). Before any points move,
 * evaluateReferralReward applies the fraud limits:
 *   - no self-referral: same user, same normalized email, shared device, or a
 *     shared hashed IP in the last 30 days
 *   - at most 3 rewarded invitees per hashed IP per 24h, 1 per device ever
 *   - at most 10 rewarded referrals per inviter per rolling 7 days
 *   - test accounts (is_test_account) on either side earn nothing
 *   - RiskScan: a FROZEN or HIGH risk account on either side goes to manual review
 * Every decision is one row in referral_rewards. Granted rewards sit under the
 * PAYOUT_HOLD_DAYS hold; sweepReferralClawbacks (run by the RiskScan worker)
 * reverses them if either account is frozen, banned or flagged inside the hold.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { referralAttributions, referralLinks, referralRewards, referralWelcomeRewards, users } from "@shared/schema";
import { PAYOUT_HOLD_DAYS, normalizePayoutDestination } from "./guardrailPolicy";

export const REFERRAL_WEEKLY_CAP = 10;
export const REFERRAL_IP_CAP_24H = 3;
export const REFERRAL_DEVICE_CAP = 1;
export const REFERRAL_MIN_ANSWERED = 3;
const SELF_LOOKBACK_DAYS = 30;

export type ReferralDecision =
  | { status: "granted"; inviterPoints: number; invitedPoints: number }
  | { status: "blocked" | "review"; reason: string }
  | { status: "skipped"; reason: string };

type Ctx = { ipHash?: string | null; deviceId?: string | null };

async function userSignals(userId: string): Promise<{ email: string | null; isTest: boolean; device: string | null; ips: Set<string>; devices: Set<string> }> {
  const [u] = await db.select({ email: users.email, isTest: users.isTestAccount, device: users.deviceFingerprint })
    .from(users).where(eq(users.id, userId)).limit(1);
  const ev = await pool.query(
    `SELECT ip_hash, device_id FROM auth_events WHERE user_id = $1 AND created_at > now() - make_interval(days => ${SELF_LOOKBACK_DAYS})
     UNION SELECT ip_hash, device_id FROM device_events WHERE user_id = $1 AND created_at > now() - make_interval(days => ${SELF_LOOKBACK_DAYS})`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const ips = new Set<string>(); const devices = new Set<string>();
  for (const r of ev.rows as any[]) { if (r.ip_hash) ips.add(r.ip_hash); if (r.device_id) devices.add(r.device_id); }
  return { email: u?.email ?? null, isTest: !!u?.isTest, device: u?.device ?? null, ips, devices };
}

async function riskState(userId: string): Promise<"frozen" | "high" | null> {
  const r = await pool.query(
    `SELECT (SELECT status::text FROM user_risk_state WHERE user_id = $1) AS state,
            (SELECT tier_suggestion::text FROM risk_snapshots WHERE user_id = $1) AS tier,
            (SELECT status FROM wallets WHERE user_id = $1 LIMIT 1) AS wallet`,
    [userId],
  ).catch(() => ({ rows: [{}] as any[] }));
  const row = (r.rows as any[])[0] ?? {};
  if (row.state === "FROZEN" || (row.wallet && row.wallet !== "active")) return "frozen";
  if (row.tier === "HIGH") return "high";
  return null;
}

/** Pure rule check, exported for tests. */
export function selfReferralReason(
  inviterId: string, invitedId: string,
  a: { email: string | null; device: string | null; ips: Set<string>; devices: Set<string> },
  b: { email: string | null; device: string | null; ips: Set<string>; devices: Set<string> },
  ctx: Ctx = {},
): string | null {
  if (inviterId === invitedId) return "self_same_user";
  if (a.email && b.email && normalizePayoutDestination(a.email) === normalizePayoutDestination(b.email)) return "self_same_email";
  const bDevices = new Set([...b.devices, ...(b.device ? [b.device] : []), ...(ctx.deviceId ? [ctx.deviceId] : [])]);
  for (const d of [...a.devices, ...(a.device ? [a.device] : [])]) if (bDevices.has(d)) return "self_shared_device";
  const bIps = new Set([...b.ips, ...(ctx.ipHash ? [ctx.ipHash] : [])]);
  for (const ip of a.ips) if (bIps.has(ip)) return "self_shared_ip";
  return null;
}

async function record(invitedUserId: string, inviterUserId: string, linkId: string, d: ReferralDecision, ctx: Ctx): Promise<void> {
  if (d.status === "skipped") return;
  const holdUntil = d.status === "granted" ? new Date(Date.now() + PAYOUT_HOLD_DAYS * 86_400_000) : null;
  await db.insert(referralRewards).values({
    invitedUserId, inviterUserId, referralLinkId: linkId, status: d.status,
    reason: d.status === "granted" ? null : d.reason,
    inviterPoints: d.status === "granted" ? d.inviterPoints : 0,
    invitedPoints: d.status === "granted" ? d.invitedPoints : 0,
    ipHash: ctx.ipHash ?? null, deviceId: ctx.deviceId ?? null, holdUntil, decidedAt: new Date(),
  }).onConflictDoNothing();
}

type Granter = (invitedUserId: string) => Promise<{ granted: boolean; reason?: string; inviterPoints?: number; invitedPoints?: number }>;
let granterOverride: Granter | null = null;
export function setReferralGranterForTests(g: Granter | null): void { granterOverride = g; }

async function defaultGranter(invitedUserId: string) {
  const { grantReferralBonus } = await import("./referralRewards");
  const r = await grantReferralBonus(invitedUserId, "FIRST_MATCH");
  const pts = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE idempotency_key LIKE 'referral_first_match_referrer:%'),0)::int AS inviter,
            COALESCE(SUM(amount) FILTER (WHERE idempotency_key LIKE 'referral_first_match_referred:%'),0)::int AS invited
       FROM ledger_entries
      WHERE idempotency_key LIKE 'referral_first_match_referrer:%:' || $1
         OR idempotency_key LIKE 'referral_first_match_referred:' || $1 || ':%'`, [invitedUserId]);
  const row = (pts.rows as any[])[0] ?? {};
  return { ...r, inviterPoints: Number(row.inviter ?? 0), invitedPoints: Number(row.invited ?? 0) };
}

type RewardTable = "referral_rewards" | "referral_welcome_rewards";

/**
 * The shared fraud rules. Returns a blocked/review decision, or null when clean.
 * table picks which reward history the IP, device and weekly caps count against.
 */
async function runFraudChecks(table: RewardTable, inviterId: string, invitedUserId: string, ctx: Ctx):
  Promise<{ decision: (ReferralDecision & { status: "blocked" | "review" }) | null; device: string | null }> {
  const [a, b] = await Promise.all([userSignals(inviterId), userSignals(invitedUserId)]);
  const device = ctx.deviceId || b.device || null;
  const self = selfReferralReason(inviterId, invitedUserId, a, b, ctx);
  if (self) return { decision: { status: "blocked", reason: self }, device };
  if (a.isTest || b.isTest) return { decision: { status: "blocked", reason: "test_account" }, device };
  if (ctx.ipHash) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ip_hash = $1 AND invited_user_id <> $2 AND status IN ('granted','review') AND created_at > now() - interval '24 hours'`, [ctx.ipHash, invitedUserId]);
    if (Number((r.rows as any[])[0]?.n) >= REFERRAL_IP_CAP_24H) return { decision: { status: "review", reason: "ip_cap_24h" }, device };
  }
  if (device) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE device_id = $1 AND invited_user_id <> $2 AND status IN ('granted','review')`, [device, invitedUserId]);
    if (Number((r.rows as any[])[0]?.n) >= REFERRAL_DEVICE_CAP) return { decision: { status: "review", reason: "device_cap" }, device };
  }
  const w = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE inviter_user_id = $1 AND status = 'granted' AND created_at > now() - interval '7 days'`, [inviterId]);
  if (Number((w.rows as any[])[0]?.n) >= REFERRAL_WEEKLY_CAP) return { decision: { status: "blocked", reason: "weekly_cap" }, device };
  const [ra, rb] = await Promise.all([riskState(inviterId), riskState(invitedUserId)]);
  if (ra || rb) return { decision: { status: "review", reason: ra === "frozen" || rb === "frozen" ? "risk_frozen" : "risk_high" }, device };
  return { decision: null, device };
}

type WelcomeGranter = (invitedUserId: string, linkId: string) => Promise<{ granted: boolean; reason?: string; points?: number }>;
let welcomeGranterOverride: WelcomeGranter | null = null;
export function setWelcomeGranterForTests(g: WelcomeGranter | null): void { welcomeGranterOverride = g; }
async function defaultWelcomeGranter(invitedUserId: string, linkId: string) {
  const { grantReferralWelcomeBonus, getReferralBonusValues } = await import("./referralRewards");
  const r = await grantReferralWelcomeBonus(invitedUserId, linkId);
  return { ...r, points: r.granted ? (await getReferralBonusValues()).welcomeBonus : 0 };
}

/**
 * Invitee welcome bonus at signup, through the same fraud rules as the
 * first-game reward. Granted bonuses get the same hold and clawback. Idempotent.
 */
export async function evaluateWelcomeBonus(invitedUserId: string, linkId: string, ctx: Ctx = {}): Promise<ReferralDecision> {
  try {
    const [existing] = await db.select({ status: referralWelcomeRewards.status }).from(referralWelcomeRewards).where(eq(referralWelcomeRewards.invitedUserId, invitedUserId)).limit(1);
    if (existing) return { status: "skipped", reason: `already_${existing.status}` };
    const [link] = await db.select({ id: referralLinks.id, inviter: referralLinks.createdByUserId }).from(referralLinks).where(eq(referralLinks.id, linkId)).limit(1);
    if (!link?.inviter) return { status: "skipped", reason: "no_link" };
    const { decision: flagged, device } = await runFraudChecks("referral_welcome_rewards", link.inviter, invitedUserId, ctx);
    let decision: ReferralDecision;
    let points = 0;
    if (flagged) decision = flagged;
    else {
      const g = await (welcomeGranterOverride ?? defaultWelcomeGranter)(invitedUserId, link.id);
      points = g.granted ? (g.points ?? 0) : 0;
      decision = g.granted ? { status: "granted", inviterPoints: 0, invitedPoints: points } : { status: "blocked", reason: g.reason || "grant_failed" };
    }
    await db.insert(referralWelcomeRewards).values({
      invitedUserId, inviterUserId: link.inviter, referralLinkId: link.id, status: decision.status as string,
      reason: decision.status === "granted" ? null : (decision as any).reason, points,
      ipHash: ctx.ipHash ?? null, deviceId: device,
      holdUntil: decision.status === "granted" ? new Date(Date.now() + PAYOUT_HOLD_DAYS * 86_400_000) : null, decidedAt: new Date(),
    }).onConflictDoNothing();
    if (decision.status !== "granted") {
      const { recordFunnelEventRaw } = await import("./funnel");
      void recordFunnelEventRaw("invite_reward_blocked", { userId: invitedUserId, mode: `w_${(decision as any).reason}`.slice(0, 20) });
      if (decision.status === "review") console.warn(`[Referral] welcome manual review: invited=${invitedUserId} reason=${(decision as any).reason}`);
    }
    return decision;
  } catch (err: any) {
    console.error(`[Referral] welcome bonus failed: ${String(err?.message || err)}`);
    return { status: "skipped", reason: "error" };
  }
}

/** Decide and (when clean) grant the FIRST_MATCH referral reward for one invitee. Idempotent. */
export async function evaluateReferralReward(invitedUserId: string, ctx: Ctx = {}): Promise<ReferralDecision> {
  const [existing] = await db.select({ status: referralRewards.status }).from(referralRewards).where(eq(referralRewards.invitedUserId, invitedUserId)).limit(1);
  if (existing) return { status: "skipped", reason: `already_${existing.status}` };
  const [attr] = await db.select({ linkId: referralAttributions.referralLinkId }).from(referralAttributions)
    .where(and(eq(referralAttributions.invitedUserId, invitedUserId), eq(referralAttributions.eventType, "SIGNUP"))).limit(1);
  if (!attr) return { status: "skipped", reason: "no_signup_attribution" };
  const [link] = await db.select({ id: referralLinks.id, inviter: referralLinks.createdByUserId }).from(referralLinks).where(eq(referralLinks.id, attr.linkId)).limit(1);
  if (!link?.inviter) return { status: "skipped", reason: "no_link" };
  const inviterId = link.inviter;

  const { decision: blocked, device } = await runFraudChecks("referral_rewards", inviterId, invitedUserId, ctx);
  let decision: ReferralDecision | null = blocked;
  if (!decision) {
    const g = await (granterOverride ?? defaultGranter)(invitedUserId);
    decision = g.granted
      ? { status: "granted", inviterPoints: g.inviterPoints ?? 0, invitedPoints: g.invitedPoints ?? 0 }
      : { status: "blocked", reason: g.reason || "grant_failed" };
  }
  await record(invitedUserId, inviterId, link.id, decision, { ipHash: ctx.ipHash ?? null, deviceId: device });
  const { recordFunnelEventRaw } = await import("./funnel");
  void recordFunnelEventRaw(decision.status === "granted" ? "invite_reward" : "invite_reward_blocked", { userId: invitedUserId, mode: decision.status === "granted" ? "granted" : decision.reason });
  if (decision.status === "review") console.warn(`[Referral] manual review: invited=${invitedUserId} reason=${decision.reason}`);
  return decision;
}

/**
 * Server-side FIRST_MATCH: call when a registered user completes a game.
 * Only a real game counts (at least REFERRAL_MIN_ANSWERED answered cards).
 */
export async function onRegisteredGameComplete(userId: string, answered: number, ctx: Ctx = {}): Promise<void> {
  try {
    if (!userId || answered < REFERRAL_MIN_ANSWERED) return;
    const [signup] = await db.select({ linkId: referralAttributions.referralLinkId }).from(referralAttributions)
      .where(and(eq(referralAttributions.invitedUserId, userId), eq(referralAttributions.eventType, "SIGNUP"))).limit(1);
    if (!signup) return;
    const ins = await db.insert(referralAttributions).values({ referralLinkId: signup.linkId, invitedUserId: userId, eventType: "FIRST_MATCH" }).onConflictDoNothing().returning();
    if (ins.length > 0) {
      const { recordFunnelEventRaw } = await import("./funnel");
      void recordFunnelEventRaw("invite_first_game", { userId });
    }
    await evaluateReferralReward(userId, ctx);
  } catch (err: any) {
    console.error(`[Referral] first game hook failed: ${String(err?.message || err)}`);
  }
}

/** Reverse granted rewards still inside the hold when either account is frozen, banned or flagged. */
export async function sweepReferralClawbacks(): Promise<number> {
  const rows = (await pool.query(
    `SELECT r.invited_user_id, r.inviter_user_id, r.inviter_points, r.invited_points
       FROM referral_rewards r
      WHERE r.status = 'granted' AND r.hold_until > now()
        AND EXISTS (
          SELECT 1 FROM users u WHERE u.id IN (r.invited_user_id, r.inviter_user_id) AND (u.is_test_account
            OR EXISTS (SELECT 1 FROM user_risk_state s WHERE s.user_id = u.id AND s.status = 'FROZEN')
            OR EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.status <> 'active')))`,
  ).catch(() => ({ rows: [] as any[] }))).rows as any[];
  const welcome = (await pool.query(
    `SELECT r.invited_user_id, r.points FROM referral_welcome_rewards r
      WHERE r.status = 'granted' AND r.hold_until > now()
        AND EXISTS (
          SELECT 1 FROM users u WHERE u.id IN (r.invited_user_id, r.inviter_user_id) AND (u.is_test_account
            OR EXISTS (SELECT 1 FROM user_risk_state s WHERE s.user_id = u.id AND s.status = 'FROZEN')
            OR EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.status <> 'active')))`,
  ).catch(() => ({ rows: [] as any[] }))).rows as any[];
  if (rows.length === 0 && welcome.length === 0) return 0;
  const { walletService } = await import("./walletService");
  let n = 0;
  for (const r of welcome) {
    const w = await walletService.getWallet(r.invited_user_id).catch(() => null);
    const take = Math.min(Number(r.points), Math.max(0, w?.balance ?? 0));
    if (take > 0) {
      await walletService.adjust(r.invited_user_id, -take, "Referral welcome bonus reversed during hold", `referral_clawback:welcome:${r.invited_user_id}`,
        { invitedUserId: r.invited_user_id }, { source: "referral", eventType: "referral_clawback", refType: "referral", refId: r.invited_user_id } as any);
    }
    await db.update(referralWelcomeRewards).set({ status: "clawed_back", reason: "flagged_in_hold", decidedAt: new Date() }).where(eq(referralWelcomeRewards.invitedUserId, r.invited_user_id));
    console.warn(`[Referral] welcome clawed back invited=${r.invited_user_id}`);
    n++;
  }
  for (const r of rows) {
    for (const [uid, pts, who] of [[r.inviter_user_id, r.inviter_points, "inviter"], [r.invited_user_id, r.invited_points, "invited"]] as const) {
      if (!pts) continue;
      const w = await walletService.getWallet(uid).catch(() => null);
      const take = Math.min(Number(pts), Math.max(0, w?.balance ?? 0));
      if (take > 0) {
        await walletService.adjust(uid, -take, "Referral reward reversed during hold", `referral_clawback:${who}:${r.invited_user_id}`,
          { invitedUserId: r.invited_user_id }, { source: "referral", eventType: "referral_clawback", refType: "referral", refId: r.invited_user_id } as any);
      }
    }
    await db.update(referralRewards).set({ status: "clawed_back", reason: "flagged_in_hold", decidedAt: new Date() }).where(eq(referralRewards.invitedUserId, r.invited_user_id));
    console.warn(`[Referral] clawed back invited=${r.invited_user_id}`);
    n++;
  }
  return n;
}

/** Admin decision on a review row. approve grants through the normal path; reject blocks. */
export async function decideReferralReview(invitedUserId: string, approve: boolean): Promise<ReferralDecision | { status: "not_found" }> {
  const [row] = await db.select().from(referralRewards).where(eq(referralRewards.invitedUserId, invitedUserId)).limit(1);
  if (!row || row.status !== "review") return { status: "not_found" };
  if (!approve) {
    await db.update(referralRewards).set({ status: "blocked", reason: `review_rejected:${row.reason}`, decidedAt: new Date() }).where(eq(referralRewards.invitedUserId, invitedUserId));
    return { status: "blocked", reason: "review_rejected" };
  }
  const g = await (granterOverride ?? defaultGranter)(invitedUserId);
  const status = g.granted ? "granted" : "blocked";
  await db.update(referralRewards).set({
    status, reason: g.granted ? `approved:${row.reason}` : (g.reason || "grant_failed"),
    inviterPoints: g.inviterPoints ?? 0, invitedPoints: g.invitedPoints ?? 0,
    holdUntil: g.granted ? new Date(Date.now() + PAYOUT_HOLD_DAYS * 86_400_000) : null, decidedAt: new Date(),
  }).where(eq(referralRewards.invitedUserId, invitedUserId));
  return g.granted ? { status: "granted", inviterPoints: g.inviterPoints ?? 0, invitedPoints: g.invitedPoints ?? 0 } : { status: "blocked", reason: g.reason || "grant_failed" };
}

/** Values and counts for the invite offer UI. */
export async function referralOfferFor(userId: string | null) {
  const { getReferralBonusValues } = await import("./referralRewards");
  const values = await getReferralBonusValues();
  const base = { ...values, weeklyCap: REFERRAL_WEEKLY_CAP, holdDays: PAYOUT_HOLD_DAYS };
  if (!userId) return { ...base, signedIn: false as const };
  const r = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM referral_attributions a JOIN referral_links l ON l.id = a.referral_link_id
         WHERE l.created_by_user_id = $1 AND a.event_type = 'SIGNUP'
           AND NOT EXISTS (SELECT 1 FROM referral_rewards r WHERE r.invited_user_id = a.invited_user_id)) AS pending,
       (SELECT count(*)::int FROM referral_rewards WHERE inviter_user_id = $1 AND status = 'granted') AS earned`,
    [userId],
  );
  const row = (r.rows as any[])[0] ?? {};
  return { ...base, signedIn: true as const, pending: Number(row.pending ?? 0), earned: Number(row.earned ?? 0) };
}

/** Admin decision on a welcome bonus review row. */
export async function decideWelcomeReview(invitedUserId: string, approve: boolean): Promise<ReferralDecision | { status: "not_found" }> {
  const [row] = await db.select().from(referralWelcomeRewards).where(eq(referralWelcomeRewards.invitedUserId, invitedUserId)).limit(1);
  if (!row || row.status !== "review") return { status: "not_found" };
  if (!approve) {
    await db.update(referralWelcomeRewards).set({ status: "blocked", reason: `review_rejected:${row.reason}`.slice(0, 60), decidedAt: new Date() }).where(eq(referralWelcomeRewards.invitedUserId, invitedUserId));
    return { status: "blocked", reason: "review_rejected" };
  }
  const g = await (welcomeGranterOverride ?? defaultWelcomeGranter)(invitedUserId, row.referralLinkId);
  await db.update(referralWelcomeRewards).set({
    status: g.granted ? "granted" : "blocked", reason: g.granted ? `approved:${row.reason}`.slice(0, 60) : (g.reason || "grant_failed"),
    points: g.granted ? (g.points ?? 0) : 0,
    holdUntil: g.granted ? new Date(Date.now() + PAYOUT_HOLD_DAYS * 86_400_000) : null, decidedAt: new Date(),
  }).where(eq(referralWelcomeRewards.invitedUserId, invitedUserId));
  return g.granted ? { status: "granted", inviterPoints: 0, invitedPoints: g.points ?? 0 } : { status: "blocked", reason: g.reason || "grant_failed" };
}
