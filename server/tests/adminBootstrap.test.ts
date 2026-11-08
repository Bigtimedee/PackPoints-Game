import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { planAdminBootstrap } from "../auth/adminBootstrapPlan";

describe("admin bootstrap plan", () => {
  it("creates only when email and username are both unused", () => {
    expect(planAdminBootstrap({ emailMatches: [], usernameMatches: [] })).toEqual({ action: "create" });
  });

  it("leaves a unique existing email or username unchanged", () => {
    expect(planAdminBootstrap({ emailMatches: [{ id: "a" }], usernameMatches: [] })).toEqual({ action: "leave_existing" });
    expect(planAdminBootstrap({ emailMatches: [], usernameMatches: [{ id: "a" }] })).toEqual({ action: "leave_existing" });
    expect(planAdminBootstrap({
      emailMatches: [{ id: "a" }],
      usernameMatches: [{ id: "a" }],
    })).toEqual({ action: "leave_existing" });
  });

  it("refuses a case collision or a username owned by someone else", () => {
    expect(planAdminBootstrap({
      emailMatches: [{ id: "lower" }, { id: "upper" }],
      usernameMatches: [],
    })).toEqual({ action: "refuse", reason: "ambiguous_email" });
    expect(planAdminBootstrap({
      emailMatches: [],
      usernameMatches: [{ id: "a" }, { id: "b" }],
    })).toEqual({ action: "refuse", reason: "ambiguous_username" });
    expect(planAdminBootstrap({
      emailMatches: [{ id: "email-owner" }],
      usernameMatches: [{ id: "name-owner" }],
    })).toEqual({ action: "refuse", reason: "identity_conflict" });
  });

  it("startup helper does not rewrite a password or escalate admin", () => {
    const storage = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");
    const fn = storage.slice(storage.indexOf("private async ensureAdminUser"), storage.indexOf("private async seedMockUsers"));
    expect(fn).toContain("bootstrapAdminAccount");
    expect(fn).not.toContain("getUserByEmail");
    expect(fn).not.toContain("passwordHash");
    expect(fn).not.toContain("isAdmin");
    expect(fn).not.toContain("Reset password");
    expect(fn).not.toContain("${adminEmail}");
    expect(fn).not.toContain("${adminPassword}");
  });
});
