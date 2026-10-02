/**
 * Reads signup rows for the QA counts route.
 * Selects flags and attribution fields only. No email, username, or user id.
 */

import { pool } from "../db";
import { mapSignupSourceRow, SIGNUP_SOURCE_SQL, type SignupSourceRow } from "./signupSources";

export async function loadSignupSourceRows(): Promise<SignupSourceRow[]> {
  const result = await pool.query<Record<string, unknown>>(SIGNUP_SOURCE_SQL);
  return result.rows.map((row) => mapSignupSourceRow(row));
}
