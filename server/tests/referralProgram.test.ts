import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import {
  evaluateReferralReward, onRegisteredGameComplete, selfReferralReason, setReferralGranterForTests,
  sweepReferralClawbacks, decideReferralReview, REFERRAL_WEEKLY_CAP,
} from "../services/referralProgram";
import { inviteSurface } from "../routes/referrals";

const tag = randomUUID().slice(0, 8);
const inviter = `ref-inviter-${tag}`;
const created: string[] = [inviter];
let linkId = "";
let n = 0;
let grants = 0;

async function newInvitee(opts: { email?: string; test?: boolean; device?: string } = {}): Promise<string> {
  const id = `ref-inv-${tag}-${++n}`;
  created.push(id);
  await pool.query(`INSERT INTO users (id, username, email, is_test_account, device_fingerprint) VALUES ($1, $2, $3, $4, $5)`,
    [id, `inv_${tag}_${n}`, opts.email ?? `inv${n}.${tag}@example.com`, !!opts.test, opts.device ?? null]);
  await pool.query(`INSERT INTO referral_attributions (referral_link_id, invited_user_id, event_type) VALUES ($1, $2, 'SIGNUP')`, [linkId, id]);
  return id;
}

beforeAll(async () => {
  await pool.query(`INSERT INTO users (id, username, email) VALUES ($1, $2, $3)`, [inviter, `inviter_${tag}`, `Inviter.${tag}@gmail.com`]);
  await pool.query(`INSERT INTO auth_events (user_id, event_type, device_id, ip_hash) VALUES ($1, 'LOGIN_SUCCESS', $2, $3)`, [inviter, `dev-inviter-${tag}`, `ip-inviter-${tag}`]);
  const r = await pool.query(`INSERT INTO referral_links (code, created_by_user_id, purpose, destination_path) VALUES ($1, $2, 'INVITE', '/') RETURNING id`, [`T${tag}`, inviter]);
  linkId = r.rows[0].id;
});

beforeEach(() => {
  setReferralGranterForTests(async () => { grants++; return { granted: true, inviterPoints: 500, invitedPoints: 250 }; });
});

afterAll(async () => {
  setReferralGranterForTests(null);
  await pool.query(`DELETE FROM referral_rewards WHERE inviter_user_id = $1`, [inviter]);
  await pool.query(`DELETE FROM funnel_events WHERE user_id = ANY($1)`, [created]);
  await pool.query(`DELETE FROM referral_attributions WHERE referral_link_id = $1`, [linkId]);
  await pool.query(`DELETE FROM referral_links WHERE id = $1`, [linkId]);
  await pool.query(`DELETE FROM user_risk_state WHERE user_id = ANY($1)`, [created]);
  await pool.query(`DELETE FROM auth_events WHERE user_id = ANY($1)`, [created]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [created]);
});

const status = async (id: string) => (await pool.query(`SELECT status, reason FROM referral_rewards WHERE invited_user_id = $1`, [id])).rows[0];

describe("referral program", () => {
  it("self referral rules: same user, alias email, shared device, shared ip", () => {
    const e = { email: null, device: null, ips: new Set<string>(), devices: new Set<string>() };
    expect(selfReferralReason("a", "a", e, e)).toBe("self_same_user");
    expect(selfReferralReason("a", "b", { ...e, email: "Joe.Smith+x@gmail.com" }, { ...e, email: "joesmith@gmail.com" })).toBe("self_same_email");
    expect(selfReferralReason("a", "b", { ...e, devices: new Set(["d1"]) }, e, { deviceId: "d1" })).toBe("self_shared_device");
    expect(selfReferralReason("a", "b", { ...e, ips: new Set(["i1"]) }, e, { ipHash: "i1" })).toBe("self_shared_ip");
    expect(selfReferralReason("a", "b", e, e)).toBeNull();
  });

  it("only a real game (3+ answered) triggers FIRST_MATCH, server side, once", async () => {
    const id = await newInvitee();
    await onRegisteredGameComplete(id, 2, { ipHash: `ip-${id}`, deviceId: `dev-${id}` });
    expect(await status(id)).toBeUndefined();
    await onRegisteredGameComplete(id, 10, { ipHash: `ip-${id}`, deviceId: `dev-${id}` });
    expect((await status(id)).status).toBe("granted");
    const fm = await pool.query(`SELECT count(*)::int AS n FROM referral_attributions WHERE invited_user_id = $1 AND event_type = 'FIRST_MATCH'`, [id]);
    expect(fm.rows[0].n).toBe(1);
    const before = grants;
    await onRegisteredGameComplete(id, 10, { ipHash: `ip-${id}`, deviceId: `dev-${id}` });
    expect(grants).toBe(before);
    const hold = await pool.query(`SELECT hold_until > now() + interval '59 days' AS ok FROM referral_rewards WHERE invited_user_id = $1`, [id]);
    expect(hold.rows[0].ok).toBe(true);
  });

  it("blocks self referral by alias email and by shared IP", async () => {
    const a = await newInvitee({ email: `inviter.${tag}+alt@gmail.com` });
    expect((await evaluateReferralReward(a, { ipHash: `x-${a}` })).status).toBe("blocked");
    expect((await status(a)).reason).toBe("self_same_email");
    const b = await newInvitee();
    await evaluateReferralReward(b, { ipHash: `ip-inviter-${tag}` });
    expect((await status(b)).reason).toBe("self_shared_ip");
  });

  it("excludes test accounts", async () => {
    const id = await newInvitee({ test: true });
    await evaluateReferralReward(id, { ipHash: `ip-${id}` });
    expect((await status(id)).reason).toBe("test_account");
  });

  it("IP cap: 4th invitee on one IP in 24h goes to review with 0 points", async () => {
    const ip = `shared-ip-${tag}`;
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await newInvitee());
    for (const id of ids) await evaluateReferralReward(id, { ipHash: ip, deviceId: `d-${id}` });
    expect((await status(ids[2])).status).toBe("granted");
    const s = await status(ids[3]);
    expect(s).toMatchObject({ status: "review", reason: "ip_cap_24h" });
    const pts = await pool.query(`SELECT inviter_points FROM referral_rewards WHERE invited_user_id = $1`, [ids[3]]);
    expect(pts.rows[0].inviter_points).toBe(0);
  });

  it("device cap: second invitee on one device is flagged", async () => {
    const dev = `one-device-${tag}`;
    const a = await newInvitee(); const b = await newInvitee();
    await evaluateReferralReward(a, { ipHash: `ia-${a}`, deviceId: dev });
    await evaluateReferralReward(b, { ipHash: `ib-${b}`, deviceId: dev });
    expect((await status(b))).toMatchObject({ status: "review", reason: "device_cap" });
  });

  it("frozen invitee goes to review; approve grants", async () => {
    const id = await newInvitee();
    await pool.query(`INSERT INTO user_risk_state (user_id, status) VALUES ($1, 'FROZEN')`, [id]);
    await evaluateReferralReward(id, { ipHash: `ip-${id}`, deviceId: `dev-${id}` });
    expect((await status(id))).toMatchObject({ status: "review", reason: "risk_frozen" });
    expect((await decideReferralReview(id, true)).status).toBe("granted");
  });

  it("clawback during hold when the invitee is frozen", async () => {
    const id = await newInvitee();
    await evaluateReferralReward(id, { ipHash: `ipc-${id}`, deviceId: `devc-${id}` });
    expect((await status(id)).status).toBe("granted");
    await pool.query(`INSERT INTO user_risk_state (user_id, status) VALUES ($1, 'FROZEN') ON CONFLICT (user_id) DO UPDATE SET status = 'FROZEN'`, [id]);
    await sweepReferralClawbacks();
    expect((await status(id)).status).toBe("clawed_back");
  });

  it(`weekly cap of ${REFERRAL_WEEKLY_CAP} rewarded referrals`, async () => {
    const have = (await pool.query(`SELECT count(*)::int AS n FROM referral_rewards WHERE inviter_user_id = $1 AND status = 'granted'`, [inviter])).rows[0].n;
    let last = "";
    for (let i = have; i <= REFERRAL_WEEKLY_CAP; i++) {
      last = await newInvitee();
      await evaluateReferralReward(last, { ipHash: `ipw-${last}`, deviceId: `devw-${last}` });
    }
    expect((await status(last))).toMatchObject({ status: "blocked", reason: "weekly_cap" });
  });

  it("invite surfaces are whitelisted", () => {
    expect(inviteSurface("wallet")).toBe("wallet");
    expect(inviteSurface("<x>")).toBe("link");
  });
});
