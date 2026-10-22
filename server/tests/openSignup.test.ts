/**
 * Signup stays open when the founders cap is full or the counter is missing.
 * Register errors name the real reason. Referral attribution still runs.
 */
import { readFile } from "fs/promises";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFailure } from "../auth/registerFailure";
import { ENSURE_OAUTH_PROVIDER_SQL } from "../startup/ensureOauthProviderColumn";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; status: string },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db", () => {
  const selectChain = () => {
    const c: {
      from: () => typeof c;
      where: () => typeof c;
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise<void>;
    } = {
      from() { return c; },
      where() { return c; },
      then(resolve, reject) {
        return Promise.resolve(state.user ? [state.user] : []).then(resolve, reject);
      },
    };
    return c;
  };
  const updateChain = () => {
    const c: {
      set: (vals: Record<string, unknown>) => typeof c;
      where: () => typeof c;
      then: (resolve: (v: unknown) => void) => Promise<void>;
    } = {
      set(vals) { state.updates.push(vals); return c; },
      where() { return c; },
      then(resolve) { return Promise.resolve(undefined).then(resolve); },
    };
    return c;
  };
  const insertChain = () => {
    const c: {
      values: () => typeof c;
      then: (resolve: (v: unknown) => void) => Promise<void>;
    } = {
      values() { return c; },
      then(resolve) { return Promise.resolve(undefined).then(resolve); },
    };
    return c;
  };
  return {
    db: {
      select: () => selectChain(),
      update: () => updateChain(),
      insert: () => insertChain(),
      transaction: async (fn: (tx: { update: () => ReturnType<typeof updateChain> }) => Promise<unknown>) =>
        fn({ update: () => updateChain() }),
    },
  };
});

import { tryActivateUser } from "../services/accessService";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFile(path.join(root, rel), "utf8");

describe("tryActivateUser ignores the founders cap", () => {
  beforeEach(() => {
    state.user = null;
    state.updates = [];
  });

  it("activates a pending account without a counter row", async () => {
    state.user = { id: "user-1", status: "PENDING" };
    const result = await tryActivateUser("user-1");
    expect(result).toEqual({ activated: true, reason: "SUCCESS" });
    expect(state.updates[0]?.status).toBe("ACTIVE");
  });

  it("does not waitlist an already active account", async () => {
    state.user = { id: "user-2", status: "ACTIVE" };
    const result = await tryActivateUser("user-2");
    expect(result).toEqual({ activated: true, reason: "ALREADY_ACTIVE" });
    expect(state.updates).toEqual([]);
  });

  it("leaves a banned account blocked", async () => {
    state.user = { id: "user-3", status: "BANNED" };
    const result = await tryActivateUser("user-3");
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("BANNED");
    expect(state.updates).toEqual([]);
  });
});

describe("register failure messages", () => {
  it("maps a duplicate email to email_taken", () => {
    const failure = registerFailure({
      code: "23505",
      constraint: "users_email_unique",
      message: "duplicate key value violates unique constraint",
    });
    expect(failure.status).toBe(409);
    expect(failure.body).toEqual({
      error: "This email already has an account.",
      code: "email_taken",
    });
    expect(failure.body.error).not.toBe("Failed to register");
  });

  it("surfaces a database cause instead of Failed to register", () => {
    const failure = registerFailure({
      message: "Failed query: select \"oauth_provider\" from \"users\"",
      cause: { message: 'column "oauth_provider" of relation "users" does not exist' },
    });
    expect(failure.status).toBe(500);
    expect(failure.body.error).toBe('column "oauth_provider" of relation "users" does not exist');
    expect(failure.body.error).not.toBe("Failed to register");
  });
});

describe("signup surfaces stay open", () => {
  it("email, WorkOS, and Apple accounts are created active and referrals still attribute", async () => {
    const routes = await read("server/routes.ts");
    const registerStart = routes.indexOf('app.post("/api/auth/register"');
    const registerEnd = routes.indexOf('app.get("/api/health/auth"', registerStart);
    const handler = routes.slice(registerStart, registerEnd);
    expect(handler).toContain("attributeNewUserFromRequest(");
    expect(handler).toContain("registerFailure(");
    expect(handler).not.toContain('error: "Failed to register"');
    expect(handler.indexOf("createLocalUser(")).toBeLessThan(handler.indexOf("attributeNewUserFromRequest("));

    const storage = await read("server/storage.ts");
    expect(storage).toContain('status: "ACTIVE"');
    expect(storage).not.toMatch(/createLocalUser[\s\S]{0,400}status: "PENDING"/);
    expect(storage).not.toMatch(/createWorkosUser[\s\S]{0,500}status: "PENDING"/);

    const workos = await read("server/services/workosAuth.ts");
    expect(workos).toContain("tryActivateUser(");
    const apple = await read("server/routes/ios.routes.ts");
    expect(apple).toContain('status: "ACTIVE"');
    expect(apple).toContain("tryActivateUser(");

    const auth = await read("client/src/pages/auth.tsx");
    expect(auth).not.toContain("Founders Cap");
    expect(auth).not.toContain("Cap reached");
    expect(auth).not.toContain("Join Waitlist");
    expect(auth).not.toContain("currentUsers");
    expect(auth).toContain('code === "email_taken"');
    expect(auth).toContain("Log in");
    expect(auth).toContain("...utmParams");

    const modal = await read("client/src/components/signup-modal.tsx");
    expect(modal).toContain('code === "email_taken"');
    expect(modal).toContain("Log in");
    expect(modal).toContain('title: "Signup failed"');
    expect(modal).toContain("...getStoredUtmParams()");

    expect(ENSURE_OAUTH_PROVIDER_SQL).toContain("ADD COLUMN IF NOT EXISTS oauth_provider");
  });
});
