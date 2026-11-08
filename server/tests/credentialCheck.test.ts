import { readFileSync } from "fs";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { annotateAccountStatus } from "../auth/accountStatus";
import {
  BCRYPT_COMPARE_COST_MAX,
  BCRYPT_COMPARE_COST_MIN,
  isBcryptHash,
  summarizeStoredHashes,
  verifySelectedCredential,
} from "../auth/credentialCheck";

const SECRET = "alpha-pass-1";
const OTHER = "beta-pass-1";

function withRevision(hash: string, revision: "a" | "b" | "y"): string {
  return `$2${revision}$${hash.slice(4)}`;
}

function craft(cost: string): string {
  return `$2b$${cost}$${"a".repeat(53)}`;
}

describe("stored local credential classification", () => {
  it("accepts bcryptjs $2a$, $2b$, and $2y$ hashes inside the compare cost range", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    expect(hash.startsWith("$2")).toBe(true);
    for (const revision of ["a", "b", "y"] as const) {
      const stored = withRevision(hash, revision);
      expect(isBcryptHash(stored), revision).toBe(true);
      expect(await bcrypt.compare(SECRET, stored)).toBe(true);
      expect(await verifySelectedCredential({
        hash: stored,
        password: SECRET,
        compare: (password, candidate) => bcrypt.compare(password, candidate),
      })).toBe("ok");
    }
    expect(BCRYPT_COMPARE_COST_MIN).toBe(4);
    expect(BCRYPT_COMPARE_COST_MAX).toBe(12);
  });

  it("rejects malformed shapes and hostile costs before compare and without throwing", async () => {
    const compared: string[] = [];
    const compare = async (_password: string, stored: string) => {
      compared.push(stored);
      return true;
    };
    const hostile = [
      "not-a-hash",
      `$2b$10$${ "a".repeat(52)}`,
      "$2x$10$" + "a".repeat(53),
      craft("03"),
      craft("00"),
      craft("31"),
      craft("99"),
      "$2b$ab$" + "a".repeat(53),
    ];
    for (const hash of hostile) {
      expect(isBcryptHash(hash), hash.slice(0, 7)).toBe(false);
      await expect(verifySelectedCredential({ hash, password: SECRET, compare })).resolves.toBe("hash_unrecognized");
    }
    expect(compared).toEqual([]);
    expect(summarizeStoredHashes([craft("99")])).toMatchObject({
      credentialCount: 1,
      formatValid: false,
      algorithm: "unrecognized",
      verifier: "rejected_before_compare",
    });
  });

  it("reports compare_false only after the one selected hash does not match", async () => {
    const hash = await bcrypt.hash(SECRET, 4);
    const calls: string[] = [];
    const branch = await verifySelectedCredential({
      hash,
      password: OTHER,
      compare: async (password, stored) => {
        calls.push(stored);
        return bcrypt.compare(password, stored);
      },
    });
    expect(branch).toBe("compare_false");
    expect(calls).toEqual([hash]);
    expect(await verifySelectedCredential({ hash: undefined, password: SECRET, compare: async () => true })).toBe("no_credential");
  });

  it("does not accept a second, older hash", async () => {
    const current = await bcrypt.hash(OTHER, 4);
    const older = await bcrypt.hash(SECRET, 4);
    const seen: string[] = [];
    const branch = await verifySelectedCredential({
      hash: current,
      password: SECRET,
      compare: async (password, stored) => {
        seen.push(stored);
        return bcrypt.compare(password, stored);
      },
    });
    expect(branch).toBe("compare_false");
    expect(seen).toEqual([current]);
    expect(seen).not.toContain(older);
    expect(summarizeStoredHashes([older, current])).toMatchObject({
      credentialCount: 2,
      formatValid: true,
      algorithm: "bcrypt",
    });
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
      passwordHashes: [hash, craft("31")],
    }], [{
      id: "local-user",
      username: "localplayer",
      email: "player@example.com",
    }]);
    const encoded = JSON.stringify(report);
    expect(report.accounts[0]).toMatchObject({
      credentialCount: 2,
      formatValid: false,
      algorithm: "mixed",
      credentialSource: "local_credentials",
      verifier: "bcrypt.compare",
      hasLocalCredential: true,
    });
    expect(encoded).not.toContain(hash);
    expect(encoded).not.toContain(salt);
    expect(encoded).not.toContain(SECRET);
    expect(encoded).not.toContain(craft("31"));
  });

  it("login still reads one credential row and logs only the branch", () => {
    const storage = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");
    const validate = storage.slice(storage.indexOf("async validateLocalCredentials"), storage.indexOf("async findUserForPasswordReset"));
    expect(validate).toContain("const [credential]");
    expect(validate).toContain("verifySelectedCredential");
    expect(validate).not.toContain("rows.map");
    const routes = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
    const login = routes.slice(
      routes.indexOf('app.post("/api/auth/local-login"'),
      routes.indexOf('app.get("/api/guest/pending-points"'),
    );
    expect(login).toContain("[Login] Validating credentials");
    expect(login).toContain("[Login] Invalid credentials branch=");
    expect(login).not.toContain("Validating credentials for:");
    expect(login).not.toContain("Invalid credentials for:");
    const denied = login.indexOf('return res.status(401)');
    const claim = login.indexOf("claimAnonForUser");
    expect(denied).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(denied);
  });
});
