/**
 * The approved Supabase project host can be stored as a pointer.
 * The import does not download it, and another project host stays closed.
 * The cumulative267 object keys are not in this checkout, so the paths below
 * are host fixtures, not reconstructed card objects.
 */
import { createHash } from "crypto";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const { db } = await import("../db");
const {
  designPoolSubmissions,
  discoveryCohortMembers,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceStaging,
  expansionOutputApprovals,
  expansionReleaseManifests,
  expansionReleaseMembers,
  expansionServeClearances,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const {
  createDiscoveryCohort,
  importBoundStagedSource,
  stageExactSource,
  supplierImagePointer,
  UD_1991_DISCOVERY,
} = await import("../services/baseballExpansion/discoveryCohort");
const { fetchImportImage, isApprovedSupplierImageHost, isExactSupplierPointerHost } = await import("../services/images/approvedImageFetch");
const { registerDiscoveryCohortRoutes } = await import("../routes/discoveryCohortQa");
const { rejectPublicMask } = await import("../services/publicMaskGate");
const { sendMaskedCard } = await import("../services/playImageSend");

const FLEER = "855e8125-4169-5d0b-b04c-3513feae9637";
const HOST = "nkzgyskcdwthqgdvrnak.supabase.co";
const TOKEN = "proposal-preview-token";
const GWYNN = {
  ordinal: 31,
  cardNumber: "59",
  supplierId: "1685421387197x101004591100329980",
  sha256: "63f344ea4cac76e59571ace2a8faacc7c45d9e1de268aa10fec79ac46bbe3184",
  width: 700,
  height: 1050,
  bytes: 260751,
};
const VIOLA = {
  ordinal: 72,
  cardNumber: "127",
  supplierId: "1667925138142x952688031108227300",
  sha256: "8ab9ead7064e264971e982b49a585fd8552bf3ed272ec2b97b0e79e4c950be67",
  width: 700,
  height: 1050,
  bytes: 294891,
};

function pointer(label: string): string {
  return `https://${HOST}/${label}`;
}

async function reset(setId: string): Promise<void> {
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, setId));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, setId));
  await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, setId));
  await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, setId));
  await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, setId));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, setId));
  const provenance = await db.select({ id: discoveryImportProvenance.playableCardId }).from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  for (const row of provenance) await db.delete(playableCards).where(eq(playableCards.id, row.id));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, setId));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
  await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, setId));
}

describe("exact supplier pointer host", () => {
  const previous = process.env.COVER_QA_TOKEN;

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    await reset(FLEER);
  });

  it("stores only the exact project host and still refuses every other gate", async () => {
    expect(isExactSupplierPointerHost(HOST)).toBe(true);
    expect(isExactSupplierPointerHost(`cdn.${HOST}`)).toBe(false);
    expect(isApprovedSupplierImageHost(HOST)).toBe(false);
    expect(isApprovedSupplierImageHost("942284f33c575895b4be9de571ca6e40.cdn.bubble.io")).toBe(true);
    const stored = pointer("candidate-0031");
    expect(supplierImagePointer(stored)).toBe(stored);
    expect(supplierImagePointer(`https://cdn.${HOST}/candidate-0031`)).toBeNull();
    expect(supplierImagePointer("https://otherproject.supabase.co/candidate-0031")).toBeNull();
    expect(supplierImagePointer("https://supabase.co/candidate-0031")).toBeNull();
    expect(supplierImagePointer(`http://${HOST}/candidate-0031`)).toBeNull();
    expect(supplierImagePointer(`https://user:pass@${HOST}/candidate-0031`)).toBeNull();
    expect(supplierImagePointer(`https://${HOST}/candidate 0031`)).toBeNull();
    expect(supplierImagePointer(`https://${HOST}/${"a".repeat(480)}`)).toBeNull();
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      throw new Error("url fetch");
    }) as typeof fetch;
    expect(await fetchImportImage(stored, { lookup: async () => [{ address: "1.1.1.1" }], fetchImpl })).toBeNull();
    expect(await fetchImportImage("https://otherproject.supabase.co/candidate-0072", { lookup: async () => [{ address: "1.1.1.1" }], fetchImpl })).toBeNull();
    expect(fetches).toBe(0);

    process.env.COVER_QA_TOKEN = TOKEN;
    await reset(FLEER);
    await insertIntegratedGameSet({
      id: FLEER, sport: "baseball", brand: "Fleer", year: 1989, setName: "1989 Fleer Baseball",
      isActive: true, cardhedgeSetQuery: "1989 Fleer Baseball", cardhedgeCategory: "Baseball",
    });
    const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 8, g: 8, b: 8 } } }).jpeg().toBuffer();
    const matchSha = createHash("sha256").update(jpeg).digest("hex");
    const match = {
      memberKey: `candidate-0003|${matchSha}`,
      ordinal: 3,
      cardNumber: "3",
      supplierId: "exact-host-match",
      originalSha256: matchSha,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: jpeg.length,
      disposition: "pass-candidate" as const,
      routing: "ordinary-canonical-candidate",
    };
    const frozen = [GWYNN, VIOLA].map((card) => ({
      memberKey: `candidate-${String(card.ordinal).padStart(4, "0")}|${card.sha256}`,
      ordinal: card.ordinal,
      cardNumber: card.cardNumber,
      supplierId: card.supplierId,
      originalSha256: card.sha256,
      originalWidth: card.width,
      originalHeight: card.height,
      originalBytes: card.bytes,
      disposition: "pass-candidate" as const,
      routing: "ordinary-canonical-candidate",
    }));
    expect((await createDiscoveryCohort({ setId: FLEER, artifactSha256: "ab".repeat(32), members: [match, ...frozen] })).ok).toBe(true);
    expect((await stageExactSource(FLEER, match.supplierId, jpeg)).ok).toBe(true);
    for (const card of [GWYNN, VIOLA]) {
      await db.insert(discoverySourceStaging).values({
        setId: FLEER, supplierId: card.supplierId, sha256: matchSha, width: 40, height: 60, bytes: jpeg.length, imageBytes: jpeg,
      });
    }
    const savedFetch = global.fetch;
    global.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return savedFetch(input, init);
      fetches += 1;
      throw new Error("url fetch");
    }) as typeof fetch;
    const app = express();
    app.use(express.json());
    registerDiscoveryCohortRoutes(app);
    app.get("/api/cards/:cardId/masked-image", async (req, res) => {
      if (await rejectPublicMask(req, res, req.params.cardId)) return;
      await sendMaskedCard(req, res, req.params.cardId);
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${base}/api/qa/baseball-expansion/${FLEER}/discovery-cohort/import-staged`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-token": TOKEN },
        body: JSON.stringify({ supplierId: match.supplierId, imageUrl: stored, player: "Synthetic Player" }),
      });
      const body = await response.json() as { ok: boolean; id: string; fetched: boolean; releaseAuthorized: boolean; sha256: string };
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ok: true, fetched: false, releaseAuthorized: false, sha256: matchSha });
      const [card] = await db.select({ imageUrl: playableCards.imageUrl }).from(playableCards).where(eq(playableCards.id, body.id));
      expect(card?.imageUrl).toBe(stored);
      const mask = await fetch(`${base}/api/cards/${body.id}/masked-image`, { headers: { "if-none-match": "\"warm\"" } });
      expect(mask.status).toBe(404);
      for (const card of [GWYNN, VIOLA]) {
        const drifted = await importBoundStagedSource({
          setId: FLEER,
          supplierId: card.supplierId,
          imageUrl: pointer(`candidate-${String(card.ordinal).padStart(4, "0")}`),
          player: "Synthetic Player",
        });
        expect(drifted).toMatchObject({ ok: false, code: "source_drift" });
      }
      expect(await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, frozen[0]!.memberKey))).toEqual([{ id: null }]);
      expect(await db.select({ id: expansionSourceAcceptances.id }).from(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, FLEER))).toEqual([]);
      expect(await db.select({ id: expansionOutputApprovals.id }).from(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, FLEER))).toEqual([]);
      expect(await db.select({ id: expansionServeClearances.id }).from(expansionServeClearances).where(eq(expansionServeClearances.setId, FLEER))).toEqual([]);
      expect(await db.select({ id: expansionReleaseManifests.id }).from(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, FLEER))).toEqual([]);
      expect(await db.select({ id: geometryProposals.id }).from(geometryProposals).where(eq(geometryProposals.setId, FLEER))).toEqual([]);
      expect(await importBoundStagedSource({
        setId: UD_1991_DISCOVERY.setId,
        supplierId: "ud-supplier",
        imageUrl: pointer("ud"),
        player: "Synthetic Player",
      })).toMatchObject({ ok: false, code: "ud_stopped" });
      expect(fetches).toBe(0);
    } finally {
      global.fetch = savedFetch;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
