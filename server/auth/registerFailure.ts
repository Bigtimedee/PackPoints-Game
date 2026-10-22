/**
 * Client-facing register errors. Duplicate email is email_taken so the form
 * can offer Log in. Other failures keep a short real reason, never the
 * generic "Failed to register" and never a SQL statement.
 */

type DbErr = {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
  cause?: unknown;
};

export type RegisterFailure = {
  status: number;
  body: { error: string; code?: string };
};

function chain(error: unknown): DbErr[] {
  const out: DbErr[] = [];
  let cur: unknown = error;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    out.push(cur as DbErr);
    cur = (cur as DbErr).cause;
  }
  return out;
}

function isUnique(err: DbErr, kind: "email" | "username"): boolean {
  if (err.code !== "23505") return false;
  const blob = `${err.constraint || ""} ${err.detail || ""} ${err.message || ""}`;
  return new RegExp(kind, "i").test(blob);
}

function safeLine(message: string | undefined): string | null {
  const line = (message || "").split("\n")[0].trim();
  if (!line || line.startsWith("Failed query:")) return null;
  if (/password|secret|DATABASE_URL|select |insert |update |delete /i.test(line)) return null;
  if (line.length > 200) return null;
  return line;
}

export function registerFailure(error: unknown): RegisterFailure {
  const errs = chain(error);
  for (const err of errs) {
    if (isUnique(err, "email")) {
      return { status: 409, body: { error: "This email already has an account.", code: "email_taken" } };
    }
  }
  for (const err of errs) {
    if (isUnique(err, "username")) {
      return { status: 409, body: { error: "Username already taken.", code: "username_taken" } };
    }
  }
  for (const err of errs) {
    const line = safeLine(err.message);
    if (line) return { status: 500, body: { error: line } };
  }
  return { status: 500, body: { error: "Could not create the account. Please try again." } };
}
