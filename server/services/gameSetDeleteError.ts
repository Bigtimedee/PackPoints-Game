export type GameSetDeleteFailure = {
  status: number;
  error: string;
  code?: string;
  constraint?: string;
};

type PgErrorLike = {
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
  message?: string;
};

/**
 * Turn a Postgres failure into the string the admin toast shows.
 * 23503 names the blocking table and constraint. Other errors keep the
 * server message instead of a generic "Failed to delete game set".
 */
export function describeGameSetDeleteError(error: unknown): GameSetDeleteFailure {
  const pg = (error ?? {}) as PgErrorLike;
  if (pg.code === "23503") {
    const constraint = pg.constraint || "foreign_key";
    const table = pg.table || "a related table";
    const detail = pg.detail ? ` ${pg.detail}` : "";
    const cardsStillReferenced =
      table === "playable_cards" || constraint.includes("playable_cards");
    const message = cardsStillReferenced
      ? `Cannot delete this set while playable cards still reference it (${constraint}). An import may still be writing cards. Wait for that import to finish, then delete again.${detail}`
      : `Cannot delete this set because ${table} still references it (${constraint}).${detail}`;
    return { status: 409, error: message, code: "23503", constraint };
  }

  const message = typeof pg.message === "string" ? pg.message.trim() : "";
  if (message && message !== "Failed to delete game set") {
    return { status: 500, error: message, code: pg.code };
  }
  return { status: 500, error: "Failed to delete game set" };
}
