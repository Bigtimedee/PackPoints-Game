import { inArray, or, sql } from "drizzle-orm";
import { appleUsers, localCredentials, users } from "@shared/schema";
import { db } from "../db";
import {
  ACCOUNT_STATUS_CAP,
  presentAccountStatus,
  safeUsername,
  sanitizeProvider,
  type AccountStatusReport,
} from "./accountStatus";

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

/**
 * Read-only status for one normalized mailbox.
 * Selects no email, password hash, token, or session.
 */
export async function findAuthAccountStatus(normalizedEmail: string, rawEmail: string): Promise<AccountStatusReport> {
  const lowered = rawEmail.trim().toLowerCase();
  const where = or(
    sql`${users.emailNormalized} = ${normalizedEmail}`,
    sql`lower(${users.email}) = ${lowered}`,
    sql`lower(${users.email}) = ${normalizedEmail}`,
  );

  const [countRow] = await db
    .select({ matched: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  const matched = Number(countRow?.matched) || 0;
  if (matched === 0 || matched > ACCOUNT_STATUS_CAP) {
    return presentAccountStatus(matched, []);
  }

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      oauthProvider: users.oauthProvider,
      workosLinked: sql<boolean>`(${users.workosUserId} is not null)`,
    })
    .from(users)
    .where(where)
    .limit(ACCOUNT_STATUS_CAP);

  const ids = rows.map((row) => row.id);
  const credentialRows = ids.length === 0
    ? []
    : await db
      .select({ userId: localCredentials.userId })
      .from(localCredentials)
      .where(inArray(localCredentials.userId, ids));
  const appleRows = ids.length === 0
    ? []
    : await db
      .select({ userId: appleUsers.userId })
      .from(appleUsers)
      .where(inArray(appleUsers.userId, ids));
  const withCredential = new Set(credentialRows.map((row) => row.userId));
  const withApple = new Set(appleRows.map((row) => row.userId));

  return presentAccountStatus(
    matched,
    rows.map((row) => ({
      username: safeUsername(row.username),
      hasLocalCredential: withCredential.has(row.id),
      workosLinked: asBool(row.workosLinked),
      provider: sanitizeProvider(row.oauthProvider, withApple.has(row.id)),
    })),
  );
}
