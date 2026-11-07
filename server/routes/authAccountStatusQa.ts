/**
 * One-account auth diagnosis. COVER_QA_TOKEN plus header X-QA-Token.
 * Off unless the token is configured. A query param is ignored.
 * Missing, blank, or wrong token is 401. Read-only: no writes and no email send.
 * Do not reference /api/qa/auth/account-status from client code.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { normalizeAccountStatusEmail, presentAccountStatus, type AccountStatusReport } from "../auth/accountStatus";

export type AccountStatusFinder = (rawEmail: string, normalizedEmail: string) => Promise<AccountStatusReport>;

let finder: AccountStatusFinder | null = null;

export function setAccountStatusFinderForTests(next: AccountStatusFinder | null): void {
  finder = next;
}

function qaJson(req: Request, res: Response, status: number, payload: unknown): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function authorized(req: Request): boolean {
  return coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));
}

async function loadMatches(rawEmail: string, normalizedEmail: string): Promise<AccountStatusReport> {
  if (finder) return finder(rawEmail, normalizedEmail);
  const { findAuthAccountStatus } = await import("../auth/accountStatusQuery");
  return findAuthAccountStatus(normalizedEmail, rawEmail);
}

export function registerAuthAccountStatusQaRoute(app: Express): void {
  app.post("/api/qa/auth/account-status", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }

    const normalized = normalizeAccountStatusEmail(req.body?.email);
    if (!normalized) {
      qaJson(req, res, 400, { error: "A valid email is required" });
      return;
    }
    const raw = typeof req.body?.email === "string" ? req.body.email.trim() : "";

    void loadMatches(raw, normalized)
      .then((report) => {
        if (!res.headersSent) qaJson(req, res, 200, presentAccountStatus(report.matched, report.accounts, report.loginSelection));
      })
      .catch((err: unknown) => {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
        console.error("[qa/auth/account-status] failed", code);
        if (!res.headersSent) qaJson(req, res, 500, { error: "Failed to read account status" });
      });
  });
}
