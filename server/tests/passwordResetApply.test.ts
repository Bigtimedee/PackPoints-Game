import { readFileSync } from "fs";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  UnverifiedPasswordReset,
  applyVerifiedPasswordReset,
  completePasswordReset,
  type StoredCredential,
} from "../auth/passwordResetApply";

const PASSWORD = "new-password-1";
const OLD_PASSWORD = "old-password";

async function hash(password: string): Promise<string> {
  return bcrypt.hash(password, 4);
}

describe("applyVerifiedPasswordReset", () => {
  it("creates a credential for an account that has none and proves the new password", async () => {
    const rows: StoredCredential[] = [];
    await applyVerifiedPasswordReset({
      userId: "user-oauth",
      password: PASSWORD,
      hashPassword: hash,
      verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
      listCredentials: async () => rows.map((row) => ({ ...row })),
      updateAll: async () => {
        throw new Error("update should not run when no credential exists");
      },
      insertCredential: async (_userId, passwordHash) => {
        rows.push({ id: "cred-1", passwordHash });
      },
    });

    expect(rows).toHaveLength(1);
    expect(await bcrypt.compare(PASSWORD, rows[0].passwordHash)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, rows[0].passwordHash)).toBe(false);
  });

  it("replaces every existing hash and rejects success when one row still fails", async () => {
    const original = await hash(OLD_PASSWORD);
    let rows: StoredCredential[] = [
      { id: "a", passwordHash: original },
      { id: "b", passwordHash: original },
    ];

    await expect(applyVerifiedPasswordReset({
      userId: "user-local",
      password: PASSWORD,
      hashPassword: hash,
      verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
      listCredentials: async () => rows.map((row) => ({ ...row })),
      updateAll: async (_userId, passwordHash) => {
        rows = rows.map((row, index) => (index === 0 ? { ...row, passwordHash } : row));
        return rows.length;
      },
      insertCredential: async () => {
        throw new Error("insert should not run when a credential exists");
      },
    })).rejects.toBeInstanceOf(UnverifiedPasswordReset);

    expect(await bcrypt.compare(OLD_PASSWORD, rows[1].passwordHash)).toBe(true);
  });

  it("accepts the reset only when every stored hash matches", async () => {
    let rows: StoredCredential[] = [
      { id: "a", passwordHash: await hash(OLD_PASSWORD) },
      { id: "b", passwordHash: await hash(OLD_PASSWORD) },
    ];

    await applyVerifiedPasswordReset({
      userId: "user-local",
      password: PASSWORD,
      hashPassword: hash,
      verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
      listCredentials: async () => rows.map((row) => ({ ...row })),
      updateAll: async (_userId, passwordHash) => {
        rows = rows.map((row) => ({ ...row, passwordHash }));
        return rows.length;
      },
      insertCredential: async () => {
        throw new Error("insert should not run when a credential exists");
      },
    });

    expect(await bcrypt.compare(PASSWORD, rows[0].passwordHash)).toBe(true);
    expect(await bcrypt.compare(PASSWORD, rows[1].passwordHash)).toBe(true);
  });

  it("does not report a stored password when the update writes nothing", async () => {
    const insert = vi.fn();
    await expect(applyVerifiedPasswordReset({
      userId: "user-local",
      password: PASSWORD,
      hashPassword: hash,
      verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
      listCredentials: async () => [{ id: "a", passwordHash: await hash(OLD_PASSWORD) }],
      updateAll: async () => 0,
      insertCredential: insert,
    })).rejects.toBeInstanceOf(UnverifiedPasswordReset);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not report success when the insert is not visible afterward", async () => {
    await expect(applyVerifiedPasswordReset({
      userId: "user-oauth",
      password: PASSWORD,
      hashPassword: hash,
      verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
      listCredentials: async () => [],
      updateAll: async () => 0,
      insertCredential: async () => {},
    })).rejects.toBeInstanceOf(UnverifiedPasswordReset);
  });
});

describe("completePasswordReset", () => {
  function harness(apply: (userId: string, password: string) => Promise<boolean>) {
    const marks: string[] = [];
    const revokes: string[] = [];
    const lookups: string[] = [];
    return {
      marks,
      revokes,
      lookups,
      run: (token: unknown, password: unknown, revoke?: (userId: string) => Promise<void>) => completePasswordReset({
        token,
        password,
        getPasswordResetToken: async (value) => {
          lookups.push(value);
          return value === "reset-token-test" ? { id: "token-row", userId: "user-1" } : null;
        },
        applyPassword: apply,
        markPasswordResetTokenUsed: async (id) => {
          marks.push(id);
        },
        revokeSessions: revoke ?? (async (userId) => {
          revokes.push(userId);
        }),
      }),
    };
  }

  it("does not look up or consume a token when the password is missing or short", async () => {
    const used = harness(async () => true);
    const missing = await used.run("", PASSWORD);
    const short = await used.run("reset-token-test", "short");
    expect(missing.status).toBe(400);
    expect(short.status).toBe(400);
    expect(used.lookups).toEqual([]);
    expect(used.marks).toEqual([]);
    expect(used.revokes).toEqual([]);
  });

  it("does not apply a password for an invalid token", async () => {
    const apply = vi.fn(async () => true);
    const used = harness(apply);
    const result = await used.run("other-token", PASSWORD);
    expect(result.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
    expect(used.marks).toEqual([]);
  });

  it("leaves the token unused when the password was not stored", async () => {
    const used = harness(async () => false);
    const result = await used.run("reset-token-test", PASSWORD);
    expect(result).toEqual({ status: 500, body: { error: "Failed to reset password" } });
    expect(used.marks).toEqual([]);
    expect(used.revokes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain("reset-token-test");
  });

  it("marks the token used only after a verified store, then revokes sessions", async () => {
    const order: string[] = [];
    const used = harness(async () => {
      order.push("apply");
      return true;
    });
    const result = await used.run("reset-token-test", PASSWORD, async (userId) => {
      order.push(`revoke:${userId}`);
      used.revokes.push(userId);
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, message: "Password has been reset successfully" });
    expect(used.marks).toEqual(["token-row"]);
    expect(order).toEqual(["apply", "revoke:user-1"]);
    expect(order.indexOf("apply")).toBeLessThan(1);
    expect(used.marks).toHaveLength(1);
  });

  it("keeps success when session revoke fails after the token is consumed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const used = harness(async () => true);
    const result = await used.run("reset-token-test", PASSWORD, async () => {
      throw new Error("sweep failed");
    });
    expect(result.status).toBe(200);
    expect(used.marks).toEqual(["token-row"]);
    const logged = error.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toContain("[ResetPassword] Session sweep failed");
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain("reset-token-test");
    error.mockRestore();
  });
});

describe("reset wiring on current main", () => {
  const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");

  it("login and reset use the shared selector instead of an arbitrary row", () => {
    const validate = storage.slice(storage.indexOf("async validateLocalCredentials"), storage.indexOf("async findUserForPasswordReset"));
    const reset = storage.slice(storage.indexOf("async findUserForPasswordReset"), storage.indexOf("async updateUserPassword"));
    const forgot = routes.slice(routes.indexOf('app.post("/api/auth/forgot-password"'), routes.indexOf('app.get("/api/auth/validate-reset-token"'));
    expect(validate).toContain("selectLoginIdentity");
    expect(validate).toContain('branch: "ambiguous_identity"');
    expect(validate).toContain("verifyStoredPasswords");
    expect(reset).toContain("selectResetIdentity");
    expect(forgot).toContain("findUserForPasswordReset");
    expect(forgot).not.toContain("storage.getUserByEmail");
  });

  it("stores a reset through the verified helper inside a transaction", () => {
    const fn = storage.slice(storage.indexOf("async updateUserPassword"), storage.indexOf("async updateUserPoints"));
    expect(fn).toContain("applyVerifiedPasswordReset");
    expect(fn).toContain("db.transaction");
    expect(fn).toContain("insertCredential");
    expect(fn).toContain("UnverifiedPasswordReset");
    expect(fn).toContain("return false");
  });

  it("does not mark the reset token from the route before proof", () => {
    const start = routes.indexOf('app.post("/api/auth/reset-password"');
    const end = routes.indexOf("// ========================================\n  // IDENTITY LINKING");
    const handler = routes.slice(start, end);
    expect(handler).toContain("completePasswordReset");
    expect(handler).not.toContain("Password has been reset successfully");
    expect(handler).not.toContain("markPasswordResetTokenUsed(resetToken");
  });
});
