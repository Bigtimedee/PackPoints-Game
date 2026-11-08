/**
 * Real Postgres proof that admin startup cannot rewrite an existing credential.
 * Skips when DATABASE_URL is unset. CI provides Postgres 16 and has already pushed schema.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL);
const pool = hasDb ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

type Stored = { hash: string; isAdmin: boolean; points: number; workos: string | null };

async function seed(input: {
  id: string;
  username: string;
  email: string;
  password: string;
  isAdmin?: boolean;
  points?: number;
  workos?: string | null;
}): Promise<void> {
  const hash = await bcrypt.hash(input.password, 4);
  await pool!.query(
    `INSERT INTO users (id, username, email, email_normalized, points, is_admin, status, workos_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
    [input.id, input.username, input.email, input.email.toLowerCase(), input.points ?? 17, input.isAdmin ?? false, input.workos ?? null],
  );
  await pool!.query(
    `INSERT INTO local_credentials (id, user_id, password_hash) VALUES ($1, $2, $3)`,
    [randomUUID(), input.id, hash],
  );
}

async function readStored(id: string): Promise<Stored> {
  const user = await pool!.query(
    `SELECT is_admin, points, workos_user_id FROM users WHERE id = $1`,
    [id],
  );
  const cred = await pool!.query(
    `SELECT password_hash FROM local_credentials WHERE user_id = $1`,
    [id],
  );
  return {
    hash: String(cred.rows[0].password_hash),
    isAdmin: user.rows[0].is_admin === true,
    points: Number(user.rows[0].points),
    workos: user.rows[0].workos_user_id,
  };
}

async function cleanup(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await pool!.query(
    `DELETE FROM local_credentials WHERE user_id IN (
      SELECT id FROM users WHERE id LIKE $1 OR email LIKE $1 OR username LIKE $1
    )`,
    [like],
  );
  await pool!.query(`DELETE FROM users WHERE id LIKE $1 OR email LIKE $1 OR username LIKE $1`, [like]);
}

describe.skipIf(!hasDb)("admin bootstrap does not rewrite stored credentials", () => {
  const prefix = `admboot_${randomUUID().slice(0, 8)}_`;

  afterAll(async () => {
    await cleanup(prefix);
    await pool!.end();
  });

  it("keeps an existing hash, admin flag, points, and link across repeated boots", async () => {
    const { bootstrapAdminAccount } = await import("../auth/adminBootstrap");
    const id = `${prefix}existing`;
    await seed({
      id,
      username: "playerlower",
      email: "Player@example.com",
      password: "alpha-pass-1",
      points: 17,
      workos: `${id}-link`,
    });
    const before = await readStored(id);
    const first = await bootstrapAdminAccount({
      email: "player@example.com",
      username: "playerlower",
      password: "beta-pass-1",
    });
    const second = await bootstrapAdminAccount({
      email: "PLAYER@example.com",
      username: "PlayerLower",
      password: "beta-pass-1",
    });
    const after = await readStored(id);
    expect(first).toEqual({ action: "leave_existing" });
    expect(second).toEqual({ action: "leave_existing" });
    expect(after).toEqual(before);
    expect(await bcrypt.compare("alpha-pass-1", after.hash)).toBe(true);
    expect(await bcrypt.compare("beta-pass-1", after.hash)).toBe(false);
    const rows = await pool!.query(`SELECT count(*)::int AS n FROM local_credentials WHERE user_id = $1`, [id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("does not touch either account when the email collides only by case", async () => {
    const { bootstrapAdminAccount } = await import("../auth/adminBootstrap");
    const lowerId = `${prefix}case-lower`;
    const upperId = `${prefix}case-upper`;
    await seed({ id: lowerId, username: "caselower", email: "player.case@example.com", password: "alpha-pass-1" });
    await seed({ id: upperId, username: "caseupper", email: "Player.Case@example.com", password: "beta-pass-1", isAdmin: true });
    const beforeLower = await readStored(lowerId);
    const beforeUpper = await readStored(upperId);
    const plan = await bootstrapAdminAccount({
      email: "player.case@example.com",
      username: "freshadmin",
      password: "gamma-pass-1",
    });
    expect(plan).toEqual({ action: "refuse", reason: "ambiguous_email" });
    expect(await readStored(lowerId)).toEqual(beforeLower);
    expect(await readStored(upperId)).toEqual(beforeUpper);
    const created = await pool!.query(`SELECT id FROM users WHERE username = 'freshadmin'`);
    expect(created.rows).toHaveLength(0);
  });

  it("creates once, keeps a later password reset across restart, and stays idempotent", async () => {
    const { bootstrapAdminAccount } = await import("../auth/adminBootstrap");
    const { storage } = await import("../storage");
    const email = `${prefix}fresh@example.com`;
    const username = `${prefix}freshname`.slice(0, 20);
    const created = await bootstrapAdminAccount({ email, username, password: "alpha-pass-1" });
    expect(created).toEqual({ action: "create" });
    const found = await pool!.query(`SELECT id, is_admin FROM users WHERE email = $1`, [email]);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].is_admin).toBe(true);
    const id = String(found.rows[0].id);
    const original = await readStored(id);
    expect(await bcrypt.compare("alpha-pass-1", original.hash)).toBe(true);

    await storage.updateUserPassword(id, "beta-pass-1");
    const reset = await readStored(id);
    expect(reset.hash).not.toBe(original.hash);
    expect(await bcrypt.compare("beta-pass-1", reset.hash)).toBe(true);
    expect(await bcrypt.compare("alpha-pass-1", reset.hash)).toBe(false);

    const again = await bootstrapAdminAccount({ email, username, password: "alpha-pass-1" });
    expect(again).toEqual({ action: "leave_existing" });
    const afterBoot = await readStored(id);
    expect(afterBoot.hash).toBe(reset.hash);
    expect(await bcrypt.compare("beta-pass-1", afterBoot.hash)).toBe(true);
    const count = await pool!.query(`SELECT count(*)::int AS n FROM local_credentials WHERE user_id = $1`, [id]);
    expect(count.rows[0].n).toBe(1);
    const login = await storage.validateLocalCredentials(email, "beta-pass-1");
    expect(login.branch).toBe("ok");
    const wrong = await storage.validateLocalCredentials(username, "alpha-pass-1");
    expect(wrong.branch).toBe("compare_false");
    expect(wrong.user).toBeNull();
  });

  it("creates one account when two bootstraps race, and does not take a conflicting username", async () => {
    const { bootstrapAdminAccount } = await import("../auth/adminBootstrap");
    const email = `${prefix}race@example.com`;
    const username = `${prefix}racename`.slice(0, 20);
    const [a, b] = await Promise.all([
      bootstrapAdminAccount({ email, username, password: "alpha-pass-1" }),
      bootstrapAdminAccount({ email, username, password: "alpha-pass-1" }),
    ]);
    expect([a.action, b.action].sort()).toEqual(["create", "leave_existing"]);
    const found = await pool!.query(`SELECT id FROM users WHERE email = $1`, [email]);
    expect(found.rows).toHaveLength(1);
    const creds = await pool!.query(`SELECT password_hash FROM local_credentials WHERE user_id = $1`, [found.rows[0].id]);
    expect(creds.rows).toHaveLength(1);
    expect(await bcrypt.compare("alpha-pass-1", String(creds.rows[0].password_hash))).toBe(true);

    const owner = `${prefix}name-owner`;
    await seed({ id: owner, username: "takenname", email: "owner@example.org", password: "alpha-pass-1" });
    const before = await readStored(owner);
    const refused = await bootstrapAdminAccount({
      email: "unused@example.org",
      username: "TakenName",
      password: "beta-pass-1",
    });
    expect(refused).toEqual({ action: "leave_existing" });
    expect(await readStored(owner)).toEqual(before);
    const unused = await pool!.query(`SELECT id FROM users WHERE email = 'unused@example.org'`);
    expect(unused.rows).toHaveLength(0);
  });
});
