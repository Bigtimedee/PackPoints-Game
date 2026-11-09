/**
 * The production JSON parser, then the real cohort routes.
 * A synthetic 486-member body is larger than 100KB. It is not the private cohort file.
 */
import { createHash } from "crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createServer } from "http";
import net, { type AddressInfo } from "net";
import { afterAll, describe, expect, it } from "vitest";
import {
  COHORT_JSON_LIMIT,
  DEFAULT_JSON_LIMIT,
  STAGE_JSON_LIMIT,
  installApiJsonParser,
  stageBase64CharCap,
  takeUploadReadForTests,
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

function withinOrdinaryCeiling(read: { stream: number; socket: number }, sent: number): void {
  const ceiling = DEFAULT_JSON_LIMIT + 64 * 1024;
  expect(read.stream).toBeLessThanOrEqual(ceiling);
  expect(read.socket).toBeLessThanOrEqual(ceiling);
  expect(read.stream).toBeLessThan(sent);
  expect(read.socket).toBeLessThan(sent);
}

async function readAfterClose(): Promise<{ stream: number; socket: number }> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return takeUploadReadForTests();
}

function blastUpload(port: number, path: string, bytes: number, chunked: boolean, tokenHeader?: string): Promise<{ status: number | null; text: string }> {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    let received = Buffer.alloc(0);
    const payload = Buffer.alloc(bytes, 0x61);
    const finish = () => {
      const text = received.toString("utf8");
      const status = Number((text.match(/HTTP\/1\.1 (\d+)/) || [])[1] || 0) || null;
      resolve({ status, text });
    };
    sock.on("data", (chunk) => { received = Buffer.concat([received, chunk]); });
    sock.on("error", () => {});
    sock.on("close", finish);
    sock.on("connect", () => {
      let head = `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n`;
      if (tokenHeader) head += `X-QA-Token: ${tokenHeader}\r\n`;
      let packet: Buffer;
      if (chunked) {
        const frames = [Buffer.from(`${head}Transfer-Encoding: chunked\r\n\r\n`)];
        const size = 16 * 1024;
        for (let offset = 0; offset < payload.length; offset += size) {
          const n = Math.min(size, payload.length - offset);
          frames.push(Buffer.from(n.toString(16) + "\r\n"), payload.subarray(offset, offset + n), Buffer.from("\r\n"));
        }
        frames.push(Buffer.from("0\r\n\r\n"));
        packet = Buffer.concat(frames);
      } else {
        packet = Buffer.concat([Buffer.from(`${head}Content-Length: ${payload.length}\r\n\r\n`), payload]);
      }
      sock.write(packet);
    });
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
    withinOrdinaryCeiling(await readAfterClose(), Buffer.byteLength(body));

    const wrongSet = await fetch(`${base}/api/qa/baseball-expansion/${LIVE}/discovery-cohort`, { method: "POST", headers, body });
    expect(wrongSet.status).toBe(404);
    withinOrdinaryCeiling(await readAfterClose(), Buffer.byteLength(body));

    const wrongToken = await fetch(cohortUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-QA-Token": "wrong-token" },
      body,
    });
    expect(wrongToken.status).toBe(404);
    expect(await wrongToken.text()).not.toContain("wrong-token");
    withinOrdinaryCeiling(await readAfterClose(), Buffer.byteLength(body));

    delete process.env.COVER_QA_TOKEN;
    const disabled = await fetch(cohortUrl, { method: "POST", headers, body });
    expect(disabled.status).toBe(404);
    withinOrdinaryCeiling(await readAfterClose(), Buffer.byteLength(body));
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

    const port = Number(new URL(base).port);
    const cohortPath = `/api/qa/baseball-expansion/${UD}/discovery-cohort`;
    const stagePath = `/api/qa/baseball-expansion/${UD}/discovery-cohort/stage`;
    const chunked = await blastUpload(port, cohortPath, COHORT_JSON_LIMIT + 64 * 1024, true);
    expect(chunked.status).toBe(404);
    expect(chunked.text).toContain("Not found");
    expect(chunked.text).not.toContain(token);
    const chunkedRead = await readAfterClose();
    expect(chunkedRead.stream).toBeGreaterThan(0);
    withinOrdinaryCeiling(chunkedRead, COHORT_JSON_LIMIT + 64 * 1024);

    const declared = await blastUpload(port, stagePath, STAGE_JSON_LIMIT + 64 * 1024, false);
    expect(declared.status).toBe(404);
    const declaredRead = await readAfterClose();
    expect(declaredRead.stream).toBe(0);
    withinOrdinaryCeiling(declaredRead, STAGE_JSON_LIMIT + 64 * 1024);

    const healthy = await fetch(`${base}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "ok" }),
    });
    expect(healthy.status).toBe(200);
    const stillClosed = await fetch(cohortUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(stillClosed.status).toBe(404);
  });
});
