/**
 * Morning signup counts for marketing. Signed-out safe: this handler does not
 * read the session. A caller with no login still needs the QA token.
 * COVER_QA_TOKEN plus header X-QA-Token, same comparison as the other /api/qa
 * routes. A query param is ignored. Missing, blank, or wrong token is 401.
 * Do not reference /api/qa/signups from client code. It must stay out of the bundle.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders, stripConditionalValidators } from "../lib/noStoreResponse";
import { buildSignupReport, type SignupSourceRow } from "../services/signupSources";

export type SignupSourceLoader = () => Promise<SignupSourceRow[]>;

async function defaultLoader(): Promise<SignupSourceRow[]> {
  const { loadSignupSourceRows } = await import("../services/signupSourceQuery");
  return loadSignupSourceRows();
}

let loader: SignupSourceLoader = defaultLoader;

export function setSignupSourceLoaderForTests(next: SignupSourceLoader | null): void {
  loader = next ?? defaultLoader;
}

function qaHeaders(req: Request, res: Response): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
}

function qaJson(req: Request, res: Response, status: number, payload: unknown): void {
  qaHeaders(req, res);
  const body = JSON.stringify(payload);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function authorized(req: Request): boolean {
  return coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token"));
}

export function registerSignupQaRoutes(app: Express): void {
  app.get("/api/qa/signups", (req, res) => {
    if (!authorized(req)) {
      qaJson(req, res, 401, { error: "Unauthorized" });
      return;
    }
    const now = new Date();
    void loader()
      .then((rows) => {
        if (!res.headersSent) qaJson(req, res, 200, buildSignupReport(rows, now));
      })
      .catch((err: unknown) => {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
        console.error("[qa/signups] failed", code);
        if (!res.headersSent) qaJson(req, res, 500, { error: "Failed to load signup counts" });
      });
  });
}
