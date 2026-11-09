/**
 * Staged bytes that match the member hash can be imported.
 * A different download, including a recompressed twin, stays source_drift.
 */
import { createHash } from "crypto";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const { db } = await import("../db");
const { discoveryCohortMembers, discoveryCohorts, discoveryImportProvenance, discoverySourceStaging, playableCards } = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const {
  UD_1991_DISCOVERY,
  createDiscoveryCohort,
  importBoundStagedSource,
  insertGuardedPlayable,
  membershipSha256,
  parseCohortMembers,
  stageExactSource,
  storedDisposition,
  verifyImportBytes,
} = await import("../services/baseballExpansion/discoveryCohort");
const { registerDiscoveryCohortRoutes } = await import("../routes/discoveryCohortQa");

const SET = "1540603b-d6d0-5cd0-884b-9058c9830c13";
const PASS = "bound-stage-pass";
const HOLD = "bound-stage-hold";
const DROP = "bound-stage-drop";

function row(ordinal: number, supplierId: string, sha: string, bytes: number, disposition: string) {
  return {
    memberKey: `candidate-${String(ordinal).padStart(4, "0")}|${sha}`,
    ordinal,
    cardNumber: String(ordinal),
    supplierId,
    originalSha256: sha,
    originalWidth: 40,
    originalHeight: 60,
    originalBytes: bytes,
    disposition,
    routing: "ordinary-canonical-candidate",
  };
}

describe("bound staged import", () => {
  it("stores the inventory label drop-proposal as drop", () => {
    expect(storedDisposition("drop-proposal")).toBe("drop");
    expect(storedDisposition("drop")).toBe("drop");
    expect(storedDisposition("near-match")).toBeNull();
    const sha = "ab".repeat(32);
    const labeled = row(1, "supplier-label", sha, 10, "drop-proposal");
    const stored = row(1, "supplier-label", sha, 10, "drop");
    const parsedLabel = parseCohortMembers([labeled], 660);
    const parsedDrop = parseCohortMembers([stored], 660);
    expect(parsedLabel?.[0]?.disposition).toBe("drop");
    expect(parsedDrop?.[0]?.disposition).toBe("drop");
    expect(membershipSha256(parsedLabel!)).toBe(membershipSha256(parsedDrop!));
    expect(parseCohortMembers([{ ...labeled, disposition: "maybe" }], 660)).toBeNull();
  });

  it("imports the exact staged bytes and refuses a drifted body", async () => {
    const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 12, g: 34, b: 56 } } }).jpeg().toBuffer();
    const sha = createHash("sha256").update(jpeg).digest("hex");
    const holdSha = "cd".repeat(32);
    const dropSha = "ef".repeat(32);
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Fleer", year: 1987, setName: "1987 Fleer Baseball",
      isActive: true, cardhedgeSetQuery: "1987 Fleer Baseball", cardhedgeCategory: "Baseball",
    });
    await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
    await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
    await db.delete(playableCards).where(eq(playableCards.cardhedgeCardId, PASS));
    await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, SET));
    await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
    await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
    const members = parseCohortMembers([
      row(1, PASS, sha, jpeg.length, "pass-candidate"),
      row(2, HOLD, holdSha, 4, "hold"),
      row(3, DROP, dropSha, 4, "drop-proposal"),
    ], 660);
    expect(members?.[2]?.disposition).toBe("drop");
    expect(await createDiscoveryCohort({ setId: SET, artifactSha256: "a".repeat(64), members: members! })).toMatchObject({ ok: true });
    expect(await stageExactSource(SET, PASS, jpeg)).toMatchObject({ ok: true, sha256: sha, importable: false });
    expect(await stageExactSource(SET, HOLD, jpeg)).toMatchObject({ ok: false, code: "not_importable" });
    let fetches = 0;
    const saved = global.fetch;
    global.fetch = (async () => { fetches += 1; return new Response(null, { status: 500 }); }) as typeof fetch;
    try {
      const imported = await importBoundStagedSource({
        setId: SET, supplierId: PASS, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      });
      expect(imported).toMatchObject({ ok: true, unchanged: false, sha256: sha });
      expect(fetches).toBe(0);
      const again = await importBoundStagedSource({
        setId: SET, supplierId: PASS, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      });
      expect(again).toMatchObject({ ok: true, unchanged: true, sha256: sha });
      const drifted = Buffer.from(jpeg);
      drifted[drifted.length - 1] ^= 0xff;
      expect(await verifyImportBytes(SET, PASS, "1", drifted)).toMatchObject({ ok: false, code: "source_drift" });
      expect(await insertGuardedPlayable({
        setId: SET, supplierId: PASS, cardNumber: "1", downloaded: drifted,
        values: { description: null, player: "Alex Player", set: null, number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/canonical.jpg", category: "Baseball", rookie: null, isPlayable: true, blockedReason: null },
      })).toMatchObject({ ok: false, code: "source_drift" });
      await db.update(discoverySourceStaging).set({ imageBytes: drifted }).where(eq(discoverySourceStaging.supplierId, PASS));
      expect(await importBoundStagedSource({
        setId: SET, supplierId: PASS, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "source_drift" });
      const [prov] = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.supplierId, PASS));
      expect(prov?.sha256).toBe(sha);
      expect(prov?.byteLength).toBe(jpeg.length);
      expect(await importBoundStagedSource({
        setId: SET, supplierId: HOLD, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "not_importable" });
      expect(await importBoundStagedSource({
        setId: SET, supplierId: DROP, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "not_importable" });
      expect(await importBoundStagedSource({
        setId: UD_1991_DISCOVERY.setId, supplierId: PASS, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "ud_stopped" });
      expect(await importBoundStagedSource({
        setId: SET, supplierId: PASS, imageUrl: "http://cdn.bubble.io/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "evidence_required" });
      expect(await importBoundStagedSource({
        setId: SET, supplierId: PASS, imageUrl: "https://img.example/canonical.jpg", player: "Alex Player",
      })).toMatchObject({ ok: false, code: "evidence_required" });
      expect(fetches).toBe(0);
    } finally {
      global.fetch = saved;
    }
  });

  it("refuses a replacement image on the import route", async () => {
    const previous = process.env.COVER_QA_TOKEN;
    process.env.COVER_QA_TOKEN = "bound-stage-token";
    const app = express();
    app.use(express.json());
    registerDiscoveryCohortRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": "bound-stage-token" },
        body: JSON.stringify({ supplierId: PASS, imageUrl: "https://cdn.bubble.io/canonical.jpg", player: "Alex Player", imageBase64: "aaaa" }),
      });
      expect(response.status).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.COVER_QA_TOKEN;
      else process.env.COVER_QA_TOKEN = previous;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  afterAll(async () => {
    await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
    await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
    await db.delete(playableCards).where(eq(playableCards.cardhedgeCardId, PASS));
    await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, SET));
    await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
    await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
  });
});
