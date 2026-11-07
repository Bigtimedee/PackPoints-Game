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

export function presentAccountStatus(
  matched: number,
  accounts: AccountStatusMatch[],
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
    rows.map((row) => ({
      username: row.username,
      hasLocalCredential: row.hasLocalCredential,
      workosLinked: row.workosLinked,
      provider: row.provider,
      exactEmailMatch: exactEmailMatch(row.email, rawEmail),
      loginSelected: pick.status === "selected" && pick.id === row.id,
    })),
    pick.status,
  );
}
