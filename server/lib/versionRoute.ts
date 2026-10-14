import type { Express } from "express";
import { getServedBuildId } from "./servedBuildId";
import { sendNoStoreBody } from "./noStoreResponse";

// Real deploy metadata (GTM audit W9): when this process started and which commit it runs.
const STARTED_AT = new Date().toISOString();

export function versionPayload(): {
  buildId: string;
  v: number;
  sha: string;
  deployed: string;
  build: string;
} {
  return {
    buildId: getServedBuildId(),
    v: 34,
    sha: process.env.BUILD_COMMIT_SHA || "dev",
    deployed: process.env.RAILWAY_DEPLOYMENT_CREATED_AT || STARTED_AT,
    build: process.env.RAILWAY_DEPLOYMENT_ID || process.env.BUILD_COMMIT_SHA || "dev",
  };
}

/** Deploy canary. Never cached and never a 304. */
export function registerVersionRoute(app: Express): void {
  app.get("/api/version", (req, res) => {
    sendNoStoreBody(req, res, JSON.stringify(versionPayload()), "application/json; charset=utf-8");
  });
}
