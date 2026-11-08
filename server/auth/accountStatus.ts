import { summarizeStoredHashes, type CredentialAlgorithm, type CredentialSource, type CredentialSummary, type CredentialVerifier } from "./credentialCheck";
import { exactEmailMatch, selectLoginIdentity, type IdentityCandidate, type IdentitySelection } from "./identitySelect";
import { normalizeEmail } from "./normalizeEmail";

/** One email can match a handful of case or alias rows. Above this, return the count only. */
export const ACCOUNT_STATUS_CAP = 10;

const PROVIDERS = {
  google: "google",
  googleoauth: "google",
  apple: "apple",
  appleoauth: "apple",
  workos: "workos",
  authkit: "workos",
} as const;

export type AccountProvider = "google" | "apple" | "workos";

export type AccountStatusMatch = {
  username: string | null;
  hasLocalCredential: boolean;
  workosLinked: boolean;
  provider: AccountProvider | null;
  /** Case-insensitive equality with the stored address. Not alias folding. */
  exactEmailMatch: boolean;
  /** True only for the one account the login selector would use. */
  loginSelected: boolean;
  credentialCount: number;
  formatValid: boolean;
  algorithm: CredentialAlgorithm;
  credentialSource: CredentialSource;
  verifier: CredentialVerifier;
};

export type AccountStatusReport = {
  matched: number;
  accounts: AccountStatusMatch[];
  loginSelection: IdentitySelection["status"];
};

export type AccountStatusRow = {
  id: string;
  email: string | null;
  username: string | null;
  hasLocalCredential: boolean;
  workosLinked: boolean;
  provider: AccountProvider | null;
  /** Used only to classify. Never copied into the public report. */
  passwordHashes?: readonly unknown[];
};

const EMAIL_MAX = 320;

/** One mailbox. Returns the normalized form, or null when the input is not a single email. */
export function normalizeAccountStatusEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > EMAIL_MAX) return null;
  if (/\s/.test(trimmed)) return null;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at >= trimmed.length - 1) return null;
  const normalized = normalizeEmail(trimmed);
  if (!normalized.includes("@")) return null;
  return normalized;
}

/** Usernames that contain an address must not leave this route. */
export function safeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@") || /\s/.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeProvider(value: unknown, appleLinked: boolean): AccountProvider | null {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token in PROVIDERS) return PROVIDERS[token as keyof typeof PROVIDERS];
  if (appleLinked) return "apple";
  return null;
}

const ALGORITHMS = new Set<CredentialAlgorithm>(["bcrypt", "unrecognized", "absent", "mixed"]);

function publicCredential(account: Partial<CredentialSummary>): CredentialSummary {
  const rawCount = account.credentialCount;
  const credentialCount = typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount > 0 ? rawCount : 0;
  const algorithm: CredentialAlgorithm = credentialCount === 0
    ? "absent"
    : account.algorithm && ALGORITHMS.has(account.algorithm) ? account.algorithm : "unrecognized";
  const credentialSource: CredentialSource = credentialCount === 0 || account.credentialSource !== "local_credentials"
    ? "absent"
    : "local_credentials";
  const verifier: CredentialVerifier = account.verifier === "bcrypt.compare" ? "bcrypt.compare" : "rejected_before_compare";
  return {
    credentialCount,
    formatValid: account.formatValid === true && credentialCount > 0 && algorithm === "bcrypt",
    algorithm,
    credentialSource,
    verifier,
  };
}

export type AccountStatusInput = Omit<AccountStatusMatch, keyof CredentialSummary> & Partial<CredentialSummary>;

export function presentAccountStatus(
  matched: number,
  accounts: AccountStatusInput[],
  loginSelection: IdentitySelection["status"] = "none",
): AccountStatusReport {
  const count = Number.isInteger(matched) && matched >= 0 ? matched : 0;
  const selection = loginSelection === "selected" || loginSelection === "ambiguous" ? loginSelection : "none";
  if (count > ACCOUNT_STATUS_CAP) return { matched: count, accounts: [], loginSelection: selection };
  return {
    matched: count,
    loginSelection: selection,
    accounts: accounts.slice(0, ACCOUNT_STATUS_CAP).map((account) => ({
      username: safeUsername(account.username),
      hasLocalCredential: account.hasLocalCredential === true,
      workosLinked: account.workosLinked === true,
      provider: sanitizeProvider(account.provider, false),
      exactEmailMatch: account.exactEmailMatch === true,
      loginSelected: account.loginSelected === true,
      ...publicCredential(account),
    })),
  };
}

/** Flags each normalized-group row. Does not copy the stored address out. */
export function annotateAccountStatus(
  rawEmail: string,
  matched: number,
  rows: AccountStatusRow[],
  loginCandidates: IdentityCandidate[],
): AccountStatusReport {
  const pick = selectLoginIdentity(rawEmail, loginCandidates);
  return presentAccountStatus(
    matched,
    rows.map((row) => {
      const summary = summarizeStoredHashes(row.passwordHashes ?? []);
      return {
        username: row.username,
        hasLocalCredential: summary.credentialCount > 0,
        workosLinked: row.workosLinked,
        provider: row.provider,
        exactEmailMatch: exactEmailMatch(row.email, rawEmail),
        loginSelected: pick.status === "selected" && pick.id === row.id,
        ...summary,
      };
    }),
    pick.status,
  );
}
