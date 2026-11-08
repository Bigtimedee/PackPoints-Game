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

/** bcryptjs compares $2a$, $2b$, and $2y$. Costs outside 4-12 are not compared: below 4 throws, above 12 is a CPU sink up to 2^31. */
export const BCRYPT_COMPARE_COST_MIN = 4;
export const BCRYPT_COMPARE_COST_MAX = 12;

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(hash: unknown): hash is string {
  if (typeof hash !== "string" || !BCRYPT_HASH.test(hash)) return false;
  const cost = Number(hash.slice(4, 6));
  return Number.isInteger(cost) && cost >= BCRYPT_COMPARE_COST_MIN && cost <= BCRYPT_COMPARE_COST_MAX;
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
    formatValid: valid === hashes.length && valid > 0,
    algorithm,
    credentialSource: "local_credentials",
    verifier: valid > 0 ? "bcrypt.compare" : "rejected_before_compare",
  };
}

/**
 * Check the one credential row login already selected.
 * Other rows are not accepted, so an older hash cannot be reused.
 * A malformed or hostile cost returns before compare and does not throw.
 */
export async function verifySelectedCredential(input: {
  hash: unknown | undefined;
  password: string;
  compare: (password: string, hash: string) => Promise<boolean>;
}): Promise<PasswordVerifyBranch> {
  if (input.hash === undefined) return "no_credential";
  if (!isBcryptHash(input.hash)) return "hash_unrecognized";
  return (await input.compare(input.password, input.hash)) ? "ok" : "compare_false";
}
