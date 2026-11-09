/**
 * The production JSON parser, then the real cohort routes.
 * A synthetic 486-member body is larger than 100KB. It is not the private cohort file.
 */
import { createHash } from "crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { afterAll, describe, expect, it } from "vitest";
import {
  COHORT_JSON_LIMIT,
  DEFAULT_JSON_LIMIT,
  STAGE_JSON_LIMIT,
  installApiJsonParser,
  stageBase64CharCap,
} from "../middleware/apiJsonBody";
import { registerDiscoveryCohortRoutes } from "../routes/discoveryCohortQa";
import { UD_1991_DISCOVERY, readDiscoveryCohort } from "../services/baseballExpansion/discoveryCohort";

const token = "cohort-parser-token";
const UD = UD_1991_DISCOVERY.setId;
const LIVE = "37fd025d-2ae1-4c92-b8ad-133375d0c722";

function member(ordinal: number) {
  const sha = createHash("sha256").update(`synthetic-cohort-${ordinal}`).digest("hex");
  return {
    memberKey: `candidate-${String(ordinal).padStart(4, "0")}|${sha}`,
    ordinal,
    cardNumber: String(ordinal),
    supplierId: `supplier-synth-${String(ordinal).padStart(4, "0")}`,
    originalSha256: sha,
    originalWidth: 700,
    originalHeight: 1000,
    originalBytes: 120000,
    disposition: "drop",
    routing: "ordinary-canonical-candidate",
  };
}

function cohortBody(): string {
  return JSON.stringify({
    artifactSha256: UD_1991_DISCOVERY.artifactSha256,
    members: Array.from({ length: 486 }, (_, index) => member(index + 1)),
  });
}

describe("discovery cohort HTTP parser", () => {
  const body = cohortBody();
  let base = "";
  let close: (() => Promise<void>) | null = null;
  const previousToken = process.env.COVER_QA_TOKEN;

  afterAll(async () => {
    if (previousToken == null) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previousToken;
    if (close) await close();
  });

  it("accepts a synthetic 486-member body past 100KB and leaves every other route at 100KB", async () => {
    expect(Buffer.byteLength(body)).toBeGreaterThan(DEFAULT_JSON_LIMIT);
    expect(Buffer.byteLength(body)).toBeLessThan(COHORT_JSON_LIMIT);
    process.env.COVER_QA_TOKEN = token;
    const app = express();
    installApiJsonParser(app);
    app.post("/api/control", (req, res) => {
      res.status(200).json({ ok: true, keys: Object.keys(req.body ?? {}).length });
    });
    registerDiscoveryCohortRoutes(app);
    app.use((err: { status?: number; statusCode?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      if (!res.headersSent) res.status(status).json({ message: err.message || "Internal Server Error" });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));

    const headers = { "Content-Type": "application/json", "X-QA-Token": token };
    const cohortUrl = `${base}/api/qa/baseball-expansion/${UD}/discovery-cohort`;
    const before = await readDiscoveryCohort(UD);

    const unauthenticated = await fetch(cohortUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(unauthenticated.status).toBe(404);
    expect(await unauthenticated.text()).not.toContain(token);

    const wrongSet = await fetch(`${base}/api/qa/baseball-expansion/${LIVE}/discovery-cohort`, { method: "POST", headers, body });
    expect(wrongSet.status).toBe(404);

    delete process.env.COVER_QA_TOKEN;
    const disabled = await fetch(cohortUrl, { method: "POST", headers, body });
    expect(disabled.status).toBe(404);
    process.env.COVER_QA_TOKEN = token;

    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logged.push(args.map((arg) => String(arg)).join(" ")); };
    try {
      const invalid = await fetch(cohortUrl, {
        method: "POST",
        headers,
        body: `{"broken":"${token}"`,
      });
      expect(invalid.status).toBe(400);
      expect(logged.join("\n")).not.toContain(token);
    } finally {
      console.error = originalError;
    }

    const parsed = await fetch(cohortUrl, { method: "POST", headers, body });
    expect(parsed.status).toBe(409);
    const parsedBody = await parsed.json() as { code?: string; releaseAuthorized?: boolean };
    expect(parsedBody.code).toBe("membership_mismatch");
    expect(parsedBody.releaseAuthorized).toBe(false);
    expect(await readDiscoveryCohort(UD)).toEqual(before);

    const nested = member(1);
    let deep: unknown = { leaf: true };
    for (let level = 0; level < 12; level += 1) deep = { nest: deep };
    const tooDeep = await fetch(cohortUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ artifactSha256: UD_1991_DISCOVERY.artifactSha256, members: [{ ...nested, nest: deep }] }),
    });
    expect(tooDeep.status).toBe(400);

    const overCohort = await fetch(cohortUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ artifactSha256: UD_1991_DISCOVERY.artifactSha256, members: [], pad: "a".repeat(COHORT_JSON_LIMIT) }),
    });
    expect(overCohort.status).toBe(413);
    expect(await overCohort.json()).toEqual({ message: "request entity too large" });

    const ordinary = await fetch(`${base}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "a".repeat(DEFAULT_JSON_LIMIT) }),
    });
    expect(ordinary.status).toBe(413);
    const small = await fetch(`${base}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "ok" }),
    });
    expect(small.status).toBe(200);

    const stageUrl = `${base}/api/qa/baseball-expansion/${UD}/discovery-cohort/stage`;
    const acceptedStage = await fetch(stageUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ supplierId: "supplier-synth-0001", imageBase64: "A".repeat(120 * 1024) }),
    });
    expect(acceptedStage.status).toBe(409);
    expect((await acceptedStage.json() as { code?: string }).code).toBe("unregistered_source");

    const preDecode = await fetch(stageUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ supplierId: "supplier-synth-0001", imageBase64: "A".repeat(stageBase64CharCap() + 1) }),
    });
    expect(preDecode.status).toBe(400);
    const preDecodeText = await preDecode.text();
    expect(preDecodeText.length).toBeLessThan(200);
    expect(preDecodeText).not.toContain("AAAA");

    const overStage = await fetch(stageUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ supplierId: "supplier-synth-0001", imageBase64: "A".repeat(STAGE_JSON_LIMIT) }),
    });
    expect(overStage.status).toBe(413);
  });
});
