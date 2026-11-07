import { readFileSync } from "fs";
import { describe, expect, it, vi } from "vitest";
import { annotateAccountStatus } from "../auth/accountStatus";
import { normalizeEmail } from "../auth/normalizeEmail";
import {
  exactEmailMatch,
  selectLoginIdentity,
  selectResetIdentity,
  type IdentityCandidate,
} from "../auth/identitySelect";
import { requestPasswordReset } from "../auth/passwordResetRequest";

const base: IdentityCandidate = {
  id: "local-user",
  username: "localplayer",
  email: "player@example.com",
};
const alias: IdentityCandidate = {
  id: "alias-user",
  username: "aliasplayer",
  email: "player+news@example.com",
};
const otherCase: IdentityCandidate = {
  id: "case-user",
  username: "caseplayer",
  email: "Player@example.com",
};
const named: IdentityCandidate = {
  id: "named-user",
  username: "deskplayer",
  email: "other@example.org",
};

describe("login and reset choose the same email identity", () => {
  it("matches one stored address regardless of casing", () => {
    const rows = [base];
    expect(selectLoginIdentity("Player@Example.com", rows)).toEqual({ status: "selected", id: "local-user" });
    expect(selectResetIdentity("Player@Example.com", rows)).toEqual(selectLoginIdentity("Player@Example.com", rows));
  });

  it("prefers the typed casing when several stored casings exist", () => {
    const rows = [base, otherCase];
    expect(selectLoginIdentity("Player@example.com", rows)).toEqual({ status: "selected", id: "case-user" });
    expect(selectResetIdentity("player@example.com", rows)).toEqual({ status: "selected", id: "local-user" });
  });

  it("refuses when several casings match and none is the typed value", () => {
    const rows = [base, otherCase];
    const pick = selectLoginIdentity("PLAYER@example.com", rows);
    expect(pick).toEqual({ status: "ambiguous" });
    expect(selectResetIdentity("PLAYER@example.com", rows)).toEqual(pick);
  });

  it("does not treat a plus alias as the same account", () => {
    expect(normalizeEmail("player+news@example.com")).toBe("player@example.com");
    const rows = [base, alias];
    expect(selectLoginIdentity("player+news@example.com", rows)).toEqual({ status: "selected", id: "alias-user" });
    expect(selectResetIdentity("player@example.com", rows)).toEqual({ status: "selected", id: "local-user" });
    expect(selectLoginIdentity("player@example.com", rows)).toEqual(selectResetIdentity("player@example.com", rows));
  });

  it("does not fold dots on a fictional domain", () => {
    const dotted: IdentityCandidate = { id: "dotted", username: "dottedplayer", email: "player.one@example.com" };
    const plain: IdentityCandidate = { id: "plain", username: "plainplayer", email: "playerone@example.com" };
    expect(normalizeEmail(dotted.email!)).not.toBe(normalizeEmail(plain.email!));
    expect(selectResetIdentity("player.one@example.com", [dotted, plain])).toEqual({ status: "selected", id: "dotted" });
    const plainPick = selectLoginIdentity("playerone@example.com", [dotted, plain]);
    expect(plainPick).toEqual({ status: "selected", id: "plain" });
  });

  it("reset ignores a username that login would select", () => {
    const rows = [base, named];
    expect(selectLoginIdentity("deskplayer", rows)).toEqual({ status: "selected", id: "named-user" });
    expect(selectResetIdentity("deskplayer", rows)).toEqual({ status: "none" });
    expect(selectResetIdentity("player@example.com", rows)).toEqual({ status: "selected", id: "local-user" });
    expect(selectLoginIdentity("player@example.com", rows)).toEqual({ status: "selected", id: "local-user" });
  });

  it("does not fall through to email when usernames collide", () => {
    const rows: IdentityCandidate[] = [
      { id: "first", username: "LocalPlayer", email: "first@example.com" },
      { id: "second", username: "localplayer", email: "second@example.com" },
      base,
    ];
    expect(selectLoginIdentity("LOCALPLAYER", rows)).toEqual({ status: "ambiguous" });
  });
});

describe("account status flags", () => {
  it("marks the exact stored address and the login choice, not the alias sibling", () => {
    const report = annotateAccountStatus("player+news@example.com", 2, [
      { ...base, hasLocalCredential: true, workosLinked: false, provider: null },
      { ...alias, hasLocalCredential: true, workosLinked: true, provider: "google" },
    ], [base, alias]);
    expect(report.loginSelection).toBe("selected");
    const byName = Object.fromEntries(report.accounts.map((account) => [account.username, account]));
    expect(byName.localplayer.exactEmailMatch).toBe(false);
    expect(byName.localplayer.loginSelected).toBe(false);
    expect(byName.aliasplayer.exactEmailMatch).toBe(true);
    expect(byName.aliasplayer.loginSelected).toBe(true);
    expect(JSON.stringify(report)).not.toContain("@");
    expect(JSON.stringify(report)).not.toContain("example.com");
  });

  it("sets no loginSelected when exact casings are ambiguous", () => {
    const report = annotateAccountStatus("PLAYER@example.com", 2, [
      { ...base, hasLocalCredential: true, workosLinked: false, provider: null },
      { ...otherCase, hasLocalCredential: true, workosLinked: true, provider: "google" },
    ], [base, otherCase]);
    expect(report.loginSelection).toBe("ambiguous");
    expect(report.accounts.every((account) => account.exactEmailMatch)).toBe(true);
    expect(report.accounts.every((account) => account.loginSelected)).toBe(false);
    expect(exactEmailMatch(base.email, "PLAYER@example.com")).toBe(true);
  });
});

describe("ambiguous reset stays generic", () => {
  it("does not create a token or log the address when no single identity is selected", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const create = vi.fn(async () => ({ token: "reset-token-test" }));
    const send = vi.fn(async () => true);
    const result = await requestPasswordReset({
      email: "player@example.com",
      getUserByEmail: async () => undefined,
      createPasswordResetToken: create,
      sendPasswordResetEmail: send,
      baseUrl: "https://example.com",
    });
    expect(result.status).toBe(200);
    expect(result.body.message).toBe("If an account exists, a reset link has been sent");
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const logged = log.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("@");
    expect(logged).not.toContain("player");
    log.mockRestore();
  });
});

describe("guest escrow survives a reset in another tab", () => {
  const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  const anon = readFileSync(new URL("../services/anonIdentity.ts", import.meta.url), "utf8");

  it("reset deletes only logged-in sessions and login still claims the anon cookie", () => {
    const reset = routes.slice(
      routes.indexOf('app.post("/api/auth/reset-password"'),
      routes.indexOf("// ========================================\n  // IDENTITY LINKING"),
    );
    const login = routes.slice(
      routes.indexOf('app.post("/api/auth/local-login"'),
      routes.indexOf('app.get("/api/guest/pending-points"'),
    );
    expect(reset).toContain("sess->>'localUserId'");
    expect(reset).not.toContain("packpts_anon");
    expect(reset).not.toContain("pendingPoints");
    expect(reset).not.toContain("claimAnonForUser");
    expect(login).toContain("claimAnonForUser(req, res, user.id)");
    expect(anon).toContain("readCookie(req, ANON_COOKIE_NAME)");
    expect(anon).toContain("anon_escrow:${player.id}");
    expect(anon).not.toContain("req.body");
  });
});
