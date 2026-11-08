import { inArray, or, sql } from "drizzle-orm";
import { appleUsers, localCredentials, users } from "@shared/schema";
import { db } from "../db";
import {
  ACCOUNT_STATUS_CAP,
  annotateAccountStatus,
  sanitizeProvider,
  type AccountStatusReport,
} from "./accountStatus";
import type { IdentityCandidate } from "./identitySelect";

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

/**
 * Read-only status for one normalized mailbox.
 * The stored address is used only to set exactEmailMatch and is not returned.
 * No password hash, token, or session is selected.
 */
function candidateWhere(trimmed: string) {
  return or(
    sql`lower(btrim(${users.username})) = lower(${trimmed})`,
    sql`lower(btrim(${users.email})) = lower(${trimmed})`,
  );
}

export async function findAuthAccountStatus(normalizedEmail: string, rawEmail: string): Promise<AccountStatusReport> {
  const trimmed = rawEmail.trim();
  const lowered = trimmed.toLowerCase();
  const where = or(
    sql`${users.emailNormalized} = ${normalizedEmail}`,
    sql`lower(btrim(${users.email})) = ${lowered}`,
    sql`lower(btrim(${users.email})) = ${normalizedEmail}`,
  );

  const loginCandidates: IdentityCandidate[] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(candidateWhere(trimmed));

  const [countRow] = await db
    .select({ matched: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  const matched = Number(countRow?.matched) || 0;
  if (matched === 0 || matched > ACCOUNT_STATUS_CAP) {
    return annotateAccountStatus(trimmed, matched, [], loginCandidates);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
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
      .select({ userId: localCredentials.userId, passwordHash: localCredentials.passwordHash })
      .from(localCredentials)
      .where(inArray(localCredentials.userId, ids));
  const hashesByUser = new Map<string, string[]>();
  for (const credential of credentialRows) {
    const list = hashesByUser.get(credential.userId) ?? [];
    list.push(credential.passwordHash);
    hashesByUser.set(credential.userId, list);
  }
  const appleRows = ids.length === 0
    ? []
    : await db
      .select({ userId: appleUsers.userId })
      .from(appleUsers)
      .where(inArray(appleUsers.userId, ids));
  const withApple = new Set(appleRows.map((row) => row.userId));

  return annotateAccountStatus(
    trimmed,
    matched,
    rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      hasLocalCredential: (hashesByUser.get(row.id) ?? []).length > 0,
      passwordHashes: hashesByUser.get(row.id) ?? [],
      workosLinked: asBool(row.workosLinked),
      provider: sanitizeProvider(row.oauthProvider, withApple.has(row.id)),
    })),
    loginCandidates,
  );
}
