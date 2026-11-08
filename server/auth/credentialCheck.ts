/**
 * Classify a stored local password hash without revealing it.
 * Login reads local_credentials only. There is no users.password column,
 * and WorkOS is not a password verifier for this path.
 */

export type CredentialAlgorithm = "bcrypt" | "unrecognized" | "absent" | "mixed";
export type CredentialSource = "local_credentials" | "absent";
export type CredentialVerifier = "bcrypt.compare" | "rejected_before_compare";

export type CredentialSummary = {
  credentialCount: number;
  formatValid: boolean;
  algorithm: CredentialAlgorithm;
  credentialSource: CredentialSource;
  verifier: CredentialVerifier;
};

export type PasswordVerifyBranch = "ok" | "no_credential" | "hash_unrecognized" | "compare_false";

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(hash: unknown): hash is string {
  return typeof hash === "string" && BCRYPT_HASH.test(hash);
}

export function summarizeStoredHashes(hashes: readonly unknown[]): CredentialSummary {
  if (hashes.length === 0) {
    return {
      credentialCount: 0,
      formatValid: false,
      algorithm: "absent",
      credentialSource: "absent",
      verifier: "rejected_before_compare",
    };
  }
  const valid = hashes.filter(isBcryptHash).length;
  const algorithm: CredentialAlgorithm = valid === hashes.length ? "bcrypt" : valid === 0 ? "unrecognized" : "mixed";
  return {
    credentialCount: hashes.length,
    formatValid: valid === hashes.length,
    algorithm,
    credentialSource: "local_credentials",
    verifier: valid > 0 ? "bcrypt.compare" : "rejected_before_compare",
  };
}

/**
 * Check every well-formed hash for this one account.
 * A malformed row is not treated as a wrong secret.
 * Success if any well-formed hash matches. Callers must not pass another account's hashes.
 */
export async function verifyStoredPasswords(input: {
  hashes: readonly unknown[];
  password: string;
  compare: (password: string, hash: string) => Promise<boolean>;
}): Promise<PasswordVerifyBranch> {
  const summary = summarizeStoredHashes(input.hashes);
  if (summary.credentialCount === 0) return "no_credential";
  const valid = input.hashes.filter(isBcryptHash);
  if (valid.length === 0) return "hash_unrecognized";
  for (const hash of valid) {
    if (await input.compare(input.password, hash)) return "ok";
  }
  return "compare_false";
}
