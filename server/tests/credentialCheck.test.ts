import { readFileSync } from "fs";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { annotateAccountStatus } from "../auth/accountStatus";
import {
  isBcryptHash,
  summarizeStoredHashes,
  verifyStoredPasswords,
} from "../auth/credentialCheck";

const SECRET = "alpha-pass-1";
const OTHER = "beta-pass-1";

describe("stored local credential classification", () => {
  it("recognizes a bcrypt hash and rejects a truncated or plaintext value before compare", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    expect(isBcryptHash(hash)).toBe(true);
    expect(summarizeStoredHashes([hash])).toMatchObject({
      credentialCount: 1,
      formatValid: true,
      algorithm: "bcrypt",
      credentialSource: "local_credentials",
      verifier: "bcrypt.compare",
    });

    const compared: string[] = [];
    const broken = await verifyStoredPasswords({
      hashes: ["not-a-hash", hash.slice(0, 59)],
      password: SECRET,
      compare: async (_password, stored) => {
        compared.push(stored);
        return true;
      },
    });
    expect(broken).toBe("hash_unrecognized");
    expect(compared).toEqual([]);
    expect(summarizeStoredHashes(["not-a-hash"])).toMatchObject({
      formatValid: false,
      algorithm: "unrecognized",
      verifier: "rejected_before_compare",
    });
  });

  it("reports compare_false only after a well-formed hash does not match", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    const calls: string[] = [];
    const branch = await verifyStoredPasswords({
      hashes: [hash],
      password: OTHER,
      compare: async (password, stored) => {
        calls.push(stored);
        return bcrypt.compare(password, stored);
      },
    });
    expect(branch).toBe("compare_false");
    expect(calls).toEqual([hash]);
    expect(await verifyStoredPasswords({
      hashes: [hash],
      password: SECRET,
      compare: (password, stored) => bcrypt.compare(password, stored),
    })).toBe("ok");
  });

  it("accepts the account when a later well-formed row matches and skips a malformed row", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    const seen: string[] = [];
    const branch = await verifyStoredPasswords({
      hashes: ["placeholder", hash],
      password: SECRET,
      compare: async (password, stored) => {
        seen.push(stored);
        return bcrypt.compare(password, stored);
      },
    });
    expect(branch).toBe("ok");
    expect(seen).toEqual([hash]);
    expect(summarizeStoredHashes(["placeholder", hash]).algorithm).toBe("mixed");
  });

  it("does not copy a hash or its salt into the account-status report", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    const salt = hash.slice(0, 29);
    const report = annotateAccountStatus("player@example.com", 1, [{
      id: "local-user",
      email: "player@example.com",
      username: "localplayer",
      hasLocalCredential: true,
      workosLinked: true,
      provider: "google",
      passwordHashes: [hash],
    }], [{
      id: "local-user",
      username: "localplayer",
      email: "player@example.com",
    }]);
    const encoded = JSON.stringify(report);
    expect(report.accounts[0]).toMatchObject({
      credentialCount: 1,
      formatValid: true,
      algorithm: "bcrypt",
      credentialSource: "local_credentials",
      verifier: "bcrypt.compare",
      hasLocalCredential: true,
    });
    expect(encoded).not.toContain(hash);
    expect(encoded).not.toContain(salt);
    expect(encoded).not.toContain(SECRET);
  });

  it("login failure log names the branch and not the typed identifier", () => {
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    const login = routes.slice(
      routes.indexOf('app.post("/api/auth/local-login"'),
      routes.indexOf('app.get("/api/guest/pending-points"'),
    );
    expect(login).toContain("[Login] Validating credentials");
    expect(login).toContain("[Login] Invalid credentials branch=");
    expect(login).not.toContain("Validating credentials for:");
    expect(login).not.toContain("Invalid credentials for:");
    expect(login).not.toContain("branch=${usernameOrEmail}");
    const denied = login.indexOf('return res.status(401)');
    const claim = login.indexOf("claimAnonForUser");
    expect(denied).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(denied);
  });
});
