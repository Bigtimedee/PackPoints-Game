/**
 * Live 5faca06 selects users.oauth_provider. If the boot schema push did not
 * add the column, every email lookup 500s. This statement is idempotent and
 * matches shared/schema.ts.
 */
export const ENSURE_OAUTH_PROVIDER_SQL =
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider varchar(20)";

export async function ensureOauthProviderColumn(
  query: (sql: string) => Promise<unknown> = async (sql) => {
    const { pool } = await import("../db");
    return pool.query(sql);
  },
): Promise<void> {
  await query(ENSURE_OAUTH_PROVIDER_SQL);
}
