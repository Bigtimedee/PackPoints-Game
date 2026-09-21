/**
 * Honest registered-user counts for admin (not marketing).
 *
 * Staff (`users.is_admin`) and bots (`users.is_bot`) are not product users.
 * Cite `registeredUsersNonStaff` only. Do not invent a public figure.
 */

export type UserCountRow = {
  isAdmin: boolean;
  isBot: boolean;
  /** Guest identities are not users. A true value is excluded even if it lands in this list. */
  isAnonymous?: boolean;
  createdAt?: Date | null;
};

export type UserCountSummary = {
  /** Honest registered users — cite this. */
  registeredUsersNonStaff: number;
  staffUsers: number;
  botUsers: number;
  allUserRows: number;
  newSignupsNonStaff: number;
  newSignupsAllRows: number;
};

export const USER_COUNT_DEFINITION = {
  registeredUsersNonStaff:
    "COUNT of users rows where is_admin is false AND is_bot is false. Honest registered-user number (beyond staff). Read live — do not invent.",
  staff: "users.is_admin = true (same staff flag as Maker Rate / retention).",
  bots: "users.is_bot = true (AI fallback opponents, not product users).",
  cite: "overview.registeredUsersNonStaff from GET /api/admin/dashboard",
  doNotCite: [
    "all-rows users COUNT(*)",
    "staff or bot rows",
    "anon_players guest identities",
    "anonymous plays before register/claim",
    "social/marketing FOMO copy",
  ],
} as const;

/**
 * Authoritative SQL for Railway Postgres (the app DATABASE_URL).
 * Guest identities live in anon_players and are not users. Do not join that table.
 */
export const REGISTERED_USERS_NON_STAFF_SQL = `
SELECT
  COUNT(*) FILTER (
    WHERE COALESCE(is_admin, false) = false
      AND COALESCE(is_bot, false) = false
  ) AS registered_users_non_staff,
  COUNT(*) FILTER (WHERE COALESCE(is_admin, false) = true) AS staff_users,
  COUNT(*) FILTER (WHERE COALESCE(is_bot, false) = true) AS bot_users,
  COUNT(*) AS all_user_rows
FROM users
`.trim();

export const NEW_SIGNUPS_NON_STAFF_SQL = `
SELECT COUNT(*) AS new_signups_non_staff
FROM users
WHERE COALESCE(is_admin, false) = false
  AND COALESCE(is_bot, false) = false
  AND created_at >= $1
`.trim();

export function isHonestRegisteredUser(row: UserCountRow): boolean {
  return row.isAdmin !== true && row.isBot !== true && row.isAnonymous !== true;
}

export function summarizeUserCounts(
  rows: UserCountRow[],
  now = new Date(),
  signupWindowMs = 7 * 24 * 60 * 60 * 1000,
): UserCountSummary {
  const cutoff = new Date(now.getTime() - signupWindowMs);
  let registeredUsersNonStaff = 0;
  let staffUsers = 0;
  let botUsers = 0;
  let newSignupsNonStaff = 0;
  let newSignupsAllRows = 0;

  for (const row of rows) {
    if (row.isAdmin === true) staffUsers += 1;
    if (row.isBot === true) botUsers += 1;
    const honest = isHonestRegisteredUser(row);
    if (honest) registeredUsersNonStaff += 1;
    if (row.createdAt && row.createdAt >= cutoff) {
      newSignupsAllRows += 1;
      if (honest) newSignupsNonStaff += 1;
    }
  }

  return {
    registeredUsersNonStaff,
    staffUsers,
    botUsers,
    allUserRows: rows.length,
    newSignupsNonStaff,
    newSignupsAllRows,
  };
}
