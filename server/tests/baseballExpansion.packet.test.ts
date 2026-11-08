/**
 * The box executable, not the service, must write the full review packet.
 */
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { spawn } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { canonicalMembership, membershipMatches, sourceWitness } from "../services/baseballExpansion/identity";
import { assertContained, cardJpegName } from "../services/baseballExpansion/exportSet";
import { missingExpansionTargets } from "../services/baseballExpansion/registry";

const target = missingExpansionTargets().find((row) => row.slug === "1990-topps-baseball")!;
const cardA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const cardB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const cardC = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const token = "packet-token";
let base = "";
let server: ReturnType<typeof createServer> | null = null;
let jpeg = Buffer.alloc(0);
let failMasked = false;
let unprofiled = false;
let activeIds = [cardA, cardB];
let urlRev = "1";
let posts = 0;
let stored: { ids: string[]; hash: string; witness: string; maskVersion: string } | null = null;

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
  const app = express();
  app.use(express.json());
  app.get("/api/qa/baseball-expansion/:id/profile", (req, res) => {
    if (req.get("x-qa-token") !== token) return res.status(404).end();
    res.json({
      explicit: !unprofiled,
      profileId: unprofiled ? null : "measured",
      side: unprofiled ? null : "bottom",
      regions: unprofiled ? null : [{ x: 0, y: 0.86, w: 1, h: 0.14 }],
      releaseApproval: false,
    });
  });
  app.get("/api/qa/sets/:id/cards", (req, res) => {
    if (req.get("x-qa-token") !== token) return res.status(404).end();
    const offset = Number(req.query.offset || 0);
    if (offset > 0) return res.json({ cards: [] });
    res.json({
      cards: activeIds.map((cardId) => ({
        cardId,
        player: "Packet Player",
        number: cardId === cardA ? "1" : "2",
        imageUrl: `https://img.example/${cardId}.jpg?rev=${urlRev}`,
        sourcePath: `/file/${cardId}/source`,
        maskedPath: `/file/${cardId}/masked`,
        variant: "Base",
        isPlayable: true,
        blockedReason: null,
        nameCheck: "unknown",
      })),
    });
  });
  app.get("/api/qa/baseball-expansion/:id/original-pool", (req, res) => {
    if (req.get("x-qa-token") !== token) return res.status(404).end();
    if (!stored) return res.status(404).json({ error: "Not found" });
    res.json({
      cardIds: stored.ids,
      manifestSha256: stored.hash,
      originalCount: stored.ids.length + 50,
      sourceWitness: stored.witness,
      maskVersion: stored.maskVersion,
      releaseApproval: false,
    });
  });
  app.post("/api/qa/baseball-expansion/:id/original-pool", (req, res) => {
    if (req.get("x-qa-token") !== token) return res.status(404).end();
    posts += 1;
    const rows = (req.body?.cards ?? []) as { id: string; sourceUrl: string }[];
    const membership = canonicalMembership(rows.map((row) => row.id));
    const witness = sourceWitness(rows, CURRENT_MASK_VERSION);
    if (!stored) {
      stored = { ids: membership.ids, hash: membership.hash, witness, maskVersion: CURRENT_MASK_VERSION };
      return res.json({ unchanged: false, releaseApproval: false });
    }
    if (!membershipMatches(stored, membership)) return res.status(409).json({ code: "membership_mismatch" });
    if (stored.witness !== witness || stored.maskVersion !== CURRENT_MASK_VERSION) return res.status(409).json({ code: "witness_changed" });
    return res.json({ unchanged: true, releaseApproval: false });
  });
  app.get("/file/:id/source", (_req, res) => { res.type("image/jpeg").send(jpeg); });
  app.get("/file/:id/masked", (req, res) => {
    if (failMasked && req.params.id === cardB) return res.status(500).end();
    res.type("image/jpeg").send(jpeg);
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

function runExport(out: string, review: boolean, resubmit = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "scripts/export-design-inbox.ts", "--set", target.id, "--out", out, ...(review ? ["--review"] : []), ...(resubmit ? ["--resubmit"] : [])], {
      cwd: path.join(__dirname, "../.."),
      env: { ...process.env, PACKPTS_BASE_URL: base, COVER_QA_TOKEN: token },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("box export executable", () => {
  it("source-only discovery succeeds without a mask or a review marker", async () => {
    unprofiled = true;
    failMasked = true;
    const out = mkdtempSync(path.join(tmpdir(), "packpts-box-"));
    const result = await runExport(out, false);
    unprofiled = false;
    failMasked = false;
    expect(result.code, result.stdout).toBe(0);
    const dir = path.join(out, target.slug);
    expect(existsSync(path.join(dir, "source", `${cardA}.jpg`))).toBe(true);
    expect(existsSync(path.join(dir, "masked", `${cardA}.jpg`))).toBe(false);
    expect(existsSync(path.join(dir, "REVIEW_READY"))).toBe(false);
    expect(existsSync(path.join(dir, "pool.csv"))).toBe(true);
    expect(existsSync(path.join(dir, "original-submitted.csv"))).toBe(false);
    rmSync(out, { recursive: true, force: true });
  });

  it("refuses a symlink nested under source, masked, or covers", () => {
    const root = mkdtempSync(path.join(tmpdir(), "packpts-link-"));
    mkdirSync(path.join(root, "source"));
    symlinkSync("/tmp", path.join(root, "source", "outside"));
    expect(() => assertContained(root, "source/outside/x.jpg")).toThrow(/symlink/);
    mkdirSync(path.join(root, "covers"));
    symlinkSync("/tmp", path.join(root, "covers", "pick.jpg"));
    expect(() => assertContained(root, "covers/pick.jpg")).toThrow(/symlink/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a card id that is not a single path segment", () => {
    expect(cardJpegName("../etc/passwd")).toBeNull();
    expect(cardJpegName(`${cardA}/x`)).toBeNull();
    expect(cardJpegName(cardA)).toBe(`${cardA}.jpg`);
  });

  it("writes the full packet and a review marker only after validation", async () => {
    failMasked = false;
    const out = mkdtempSync(path.join(tmpdir(), "packpts-box-"));
    const dir = path.join(out, target.slug);
    mkdirReady(dir);
    const result = await runExport(out, true);
    expect(result.code, result.stdout).toBe(0);
    expect(readFileSync(path.join(dir, "pool.csv"), "utf8").split("\n")[0]).toBe("heldId,player,cardNo,sourceUrl,width,height");
    expect(existsSync(path.join(dir, "profile.json"))).toBe(true);
    expect(existsSync(path.join(dir, "original-submitted.csv"))).toBe(true);
    expect(existsSync(path.join(dir, "reconciliation.json"))).toBe(true);
    expect(existsSync(path.join(dir, "covers", "NOT_DAILY5.json"))).toBe(true);
    expect(existsSync(path.join(dir, "source", `${cardA}.jpg`))).toBe(true);
    expect(existsSync(path.join(dir, "masked", `${cardB}.jpg`))).toBe(true);
    const marker = JSON.parse(readFileSync(path.join(dir, "REVIEW_READY"), "utf8"));
    expect(marker.reviewReady).toBe(true);
    expect(marker.releaseApproval).toBe(false);
    const reconciliation = JSON.parse(readFileSync(path.join(dir, "reconciliation.json"), "utf8"));
    expect(reconciliation.verdict).toBe("findings_incomplete");
    expect(reconciliation.thresholdClaimed).toBe(false);
    expect(JSON.parse(readFileSync(path.join(dir, "covers", "NOT_DAILY5.json"), "utf8")).approved).toBe(false);
    rmSync(out, { recursive: true, force: true });
  });

  it("removes a stale marker and a partial pair when a download fails", async () => {
    failMasked = true;
    const out = mkdtempSync(path.join(tmpdir(), "packpts-box-"));
    const dir = path.join(out, target.slug);
    mkdirReady(dir);
    writeFileSync(path.join(dir, "REVIEW_READY"), "{\"stale\":true}\n");
    const result = await runExport(out, true);
    expect(result.code).not.toBe(0);
    expect(existsSync(path.join(dir, "REVIEW_READY"))).toBe(false);
    expect(existsSync(path.join(dir, "source", `${cardB}.jpg`))).toBe(false);
    expect(existsSync(path.join(dir, "source", `${cardB}.jpg.partial`))).toBe(false);
    rmSync(out, { recursive: true, force: true });
  });

  it("keeps the first submission when a later pool has the same count and a different witness", async () => {
    failMasked = false;
    unprofiled = false;
    activeIds = [cardA, cardB];
    urlRev = "1";
    posts = 0;
    stored = null;
    const out = mkdtempSync(path.join(tmpdir(), "packpts-box-"));
    const dir = path.join(out, target.slug);
    const first = await runExport(out, true);
    expect(first.code, first.stderr + first.stdout).toBe(0);
    const original = readFileSync(path.join(dir, "original-submitted.csv"), "utf8");
    expect(original).toContain(cardB);
    expect(posts).toBe(1);
    const remembered = stored!.ids.slice();
    rmSync(path.join(dir, "original-submitted.csv"));
    activeIds = [cardA, cardC];
    urlRev = "2";
    stored!.maskVersion = "v-old";
    const second = await runExport(out, true);
    expect(second.code, second.stderr + second.stdout).toBe(2);
    const kept = readFileSync(path.join(dir, "original-submitted.csv"), "utf8");
    expect(kept).toContain(cardB);
    expect(kept).not.toContain(cardC);
    expect(activeIds).toHaveLength(remembered.length);
    expect(kept.includes(cardC)).toBe(false);
    expect(stored!.ids).toEqual(remembered);
    expect(posts).toBe(1);
    const report = JSON.parse(second.stdout);
    expect(report.membershipMismatch).toBe(true);
    expect(report.witnessStatus).toBe("changed");
    expect(report.maskRevision).toBe("changed");
    expect(report.replacesOriginal).toBe(false);
    expect(existsSync(path.join(dir, "resubmissions.json"))).toBe(false);
    const revised = await runExport(out, true, true);
    expect(revised.code, revised.stderr).toBe(2);
    const audit = JSON.parse(readFileSync(path.join(dir, "resubmissions.json"), "utf8"));
    expect(audit.replacesOriginal).toBe(false);
    expect(audit.entries[0].kinds).toEqual(expect.arrayContaining(["membership", "witness", "mask_revision"]));
    expect(audit.entries[0].replacesOriginal).toBe(false);
    expect(audit.entries[0].storedCardIds).toEqual(remembered);
    expect(readFileSync(path.join(dir, "original-submitted.csv"), "utf8")).toContain(cardB);
    expect(stored!.maskVersion).toBe("v-old");
    expect(posts).toBe(1);
    failMasked = true;
    writeFileSync(path.join(dir, "REVIEW_READY"), "{\"stale\":true}\n");
    const failed = await runExport(out, true);
    expect(failed.code).not.toBe(0);
    expect(existsSync(path.join(dir, "REVIEW_READY"))).toBe(false);
    expect(existsSync(path.join(dir, "source", `${cardC}.jpg.partial`))).toBe(false);
    expect(readFileSync(path.join(dir, "original-submitted.csv"), "utf8")).toContain(cardB);
    expect(existsSync(path.join(dir, "resubmissions.json"))).toBe(true);
    failMasked = false;
    rmSync(out, { recursive: true, force: true });
  });
});

function mkdirReady(dir: string) {
  mkdirSync(dir, { recursive: true });
}
