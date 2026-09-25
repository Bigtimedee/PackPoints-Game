import type { Express } from "express";
import { getServedBuildId } from "./servedBuildId";
import { sendNoStoreBody } from "./noStoreResponse";

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
    deployed: "2026-06-15",
    build: "prompt-26-auto-risk-scoring",
  };
}

/** Deploy canary. Never cached and never a 304. */
export function registerVersionRoute(app: Express): void {
  app.get("/api/version", (req, res) => {
    sendNoStoreBody(req, res, JSON.stringify(versionPayload()), "application/json; charset=utf-8");
  });
}
