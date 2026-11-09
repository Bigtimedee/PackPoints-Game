/**
 * Proposal ids and stored opaque bytes are readable by the QA token.
 * Public mask and set routes stay closed until an explicit release.
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
  expansionSetClearanceAttempts,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} = await import("@shared/schema");
const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
const { registerDiscoveryCohortRoutes } = await import("../routes/discoveryCohortQa");
const { PER_CARD_RENDERER_IDS } = await import("../services/baseballExpansion/perCardRelease");
const { isHeldSet } = await import("../config/heldSets");
const { getMaskedImagePath, resetMaskBakeForTests } = await import("../masking/maskingService");
const { handlePublicSetDetail } = await import("../services/publicSets");
const { isDaily5ExpansionBlocked } = await import("../services/baseballExpansion/registry");
const { UD_1991_DISCOVERY } = await import("../services/baseballExpansion/discoveryCohort");

const SET = "49e656e0-3762-5113-82b5-1480f1c77541";
const TOKEN = "proposal-preview-token";
const PIXELS = [[1, 1], [30, 1], [30, 30], [1, 30]];
const NORMALIZED = PIXELS.map(([x, y]) => [x / 40, y / 60]);
const RENDERER = PER_CARD_RENDERER_IDS[1];

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function resetSet(): Promise<void> {
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, SET));
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, SET));
  await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, SET));
  await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, SET));
  await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, SET));
  await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, SET));
  await db.delete(designPoolSubmissions).where(eq(designPoolSubmissions.setId, SET));
  await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, SET));
  const provenance = await db.select({ id: discoveryImportProvenance.playableCardId }).from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, SET));
  for (const row of provenance) await db.delete(playableCards).where(eq(playableCards.id, row.id));
  await db.delete(geometryProposals).where(eq(geometryProposals.setId, SET));
  await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, SET));
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, SET));
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, SET));
}

describe("proposal id and opaque preview", () => {
  const previous = process.env.COVER_QA_TOKEN;
  let base = "";
  let server: ReturnType<typeof createServer> | null = null;

  afterAll(async () => {
    if (previous === undefined) delete process.env.COVER_QA_TOKEN;
    else process.env.COVER_QA_TOKEN = previous;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await resetSet();
  });

  it("walks acceptance, proposal id, output approval, held preview, then explicit release", async () => {
    process.env.COVER_QA_TOKEN = TOKEN;
    resetMaskBakeForTests();
    await resetSet();
    await insertIntegratedGameSet({
      id: SET, sport: "baseball", brand: "Fleer", year: 1991, setName: "1991 Fleer Baseball",
      isActive: true, cardhedgeSetQuery: "1991 Fleer Baseball", cardhedgeCategory: "Baseball",
    });
    const cards = [];
    for (let n = 1; n <= 36; n += 1) {
      const jpeg = await sharp({ create: { width: 40, height: 60, channels: 3, background: { r: n, g: 40, b: 80 } } }).jpeg().toBuffer();
      const digest = sha(jpeg);
      cards.push({
        n,
        jpeg,
        digest,
        memberKey: `candidate-${String(n).padStart(4, "0")}|${digest}`,
        supplierId: `preview-gate-${n}`,
        native: Buffer.from(`native-${n}-${digest.slice(0, 8)}`),
        preview: Buffer.from(`preview-${n}-${digest.slice(0, 8)}`),
      });
    }
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerDiscoveryCohortRoutes(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "content-type": "application/json", "x-qa-token": TOKEN };
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const closed = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals`);
    expect(closed.status).toBe(404);

    const cohort = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort`, {
      artifactSha256: "ab".repeat(32),
      members: cards.map((card) => ({
        memberKey: card.memberKey,
        ordinal: card.n,
        cardNumber: String(card.n),
        supplierId: card.supplierId,
        originalSha256: card.digest,
        originalWidth: 40,
        originalHeight: 60,
        originalBytes: card.jpeg.length,
        disposition: "pass-candidate",
        routing: "ordinary-canonical-candidate",
      })),
    });
    expect(cohort.status).toBe(200);
    const membershipSha256 = String(cohort.body.membershipSha256);
    const proposalIds: string[] = [];
    const acceptanceIds: string[] = [];
    for (const card of cards) {
      const staged = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/stage`, {
        supplierId: card.supplierId,
        imageBase64: card.jpeg.toString("base64"),
      });
      expect(staged.status).toBe(200);
      const imported = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/import-staged`, {
        supplierId: card.supplierId,
        imageUrl: `https://cdn.bubble.io/preview-gate/${card.n}.jpg`,
        player: "Synthetic Player",
      });
      expect(imported.status).toBe(200);
      const proposal = await post(`/api/qa/baseball-expansion/${SET}/geometry-proposals`, {
        memberKey: card.memberKey,
        supplierId: card.supplierId,
        sourceSha256: card.digest,
        width: 40,
        height: 60,
        geometryVersion: "plate-polygon-v1",
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
      });
      expect(proposal.status).toBe(200);
      expect(proposal.body).toMatchObject({ ok: true, approval: false, usable: true, releaseAuthorized: false, profileApproved: false });
      expect(typeof proposal.body.id).toBe("string");
      proposalIds.push(String(proposal.body.id));
      const accepted = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/source-acceptance`, {
        memberKey: card.memberKey,
        sourceSha256: card.digest,
        evidenceRef: "evidence-preview-gate",
        acceptedBy: "reviewer",
      });
      expect(accepted.status).toBe(200);
      acceptanceIds.push(String(accepted.body.id));
      const approved = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/output-approval`, {
        memberKey: card.memberKey,
        acceptanceId: accepted.body.id,
        proposalId: proposal.body.id,
        polygonPixels: PIXELS,
        polygonNormalized: NORMALIZED,
        rendererId: RENDERER,
        nativeBase64: card.native.toString("base64"),
        preview300Base64: card.preview.toString("base64"),
        nativeSha256: sha(card.native),
        preview300Sha256: sha(card.preview),
        evidenceRef: "evidence-preview-gate",
        approvedBy: "reviewer",
      });
      expect(approved.status).toBe(200);
      expect(approved.body.releaseAuthorized).toBe(false);
    }
    const listed = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals`, { headers });
    const listBody = await listed.json() as { releaseAuthorized: boolean; approval: boolean; proposals: Array<{ id: string; memberKey: string }> };
    expect(listed.status).toBe(200);
    expect(listBody.releaseAuthorized).toBe(false);
    expect(listBody.approval).toBe(false);
    expect(listBody.proposals.map((row) => row.id)).toEqual(proposalIds);
    const one = await fetch(`${base}/api/qa/baseball-expansion/${SET}/geometry-proposals?memberKey=${encodeURIComponent(cards[0]!.memberKey)}`, { headers });
    const oneBody = await one.json() as { proposals: Array<{ id: string }> };
    expect(oneBody.proposals).toHaveLength(1);
    expect(oneBody.proposals[0]).toMatchObject({ id: proposalIds[0], memberKey: cards[0]!.memberKey, usable: true, approval: false });

    const native = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(native.status).toBe(200);
    expect(native.headers.get("x-release-authorized")).toBe("false");
    expect(native.headers.get("x-serve-cleared")).toBe("false");
    expect(native.headers.get("x-content-sha256")).toBe(sha(cards[0]!.native));
    expect(Buffer.from(await native.arrayBuffer())).toEqual(cards[0]!.native);
    const preview = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/preview300`, { headers });
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(cards[0]!.preview);
    const [playable] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[0]!.memberKey));
    expect(await getMaskedImagePath(playable!.id!)).toBeNull();
    const heldDetail = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, heldDetail.res as never);
    expect(heldDetail.status).toBe(404);
    expect(isHeldSet(SET)).toBe(true);
    expect(isDaily5ExpansionBlocked(SET)).toBe(true);

    for (const card of cards) {
      const cleared = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/serve-clearance`, {
        memberKey: card.memberKey,
        outputApprovalId: (await db.select({ id: expansionOutputApprovals.id }).from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, card.memberKey)))[0]!.id,
        evidenceRef: "evidence-preview-gate",
        clearedBy: "reviewer",
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.releaseAuthorized).toBe(false);
    }
    expect(await getMaskedImagePath(playable!.id!)).toBeNull();
    const stillHeld = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, stillHeld.res as never);
    expect(stillHeld.status).toBe(404);

    const released = await post(`/api/qa/baseball-expansion/${SET}/discovery-cohort/set-clearance`, {
      memberKeys: cards.slice(0, 35).map((card) => card.memberKey),
      version: 1,
      evidenceRef: "evidence-preview-gate",
      clearedBy: "reviewer",
      discoveryMembershipSha256: membershipSha256,
    });
    expect(released.status).toBe(200);
    expect(released.body.releaseAuthorized).toBe(true);
    expect(released.body.memberCount).toBe(35);
    const opened = capture();
    await handlePublicSetDetail({ params: { id: SET }, headers: {} } as never, opened.res as never);
    expect(opened.status).not.toBe(404);
    expect(isHeldSet(SET)).toBe(false);
    const servedName = await getMaskedImagePath(playable!.id!);
    expect(servedName).toBeTruthy();
    const [heldOut] = await db.select({ id: discoveryCohortMembers.playableCardId }).from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, cards[35]!.memberKey));
    expect(await getMaskedImagePath(heldOut!.id!)).toBeNull();
    const after = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(after.headers.get("x-release-authorized")).toBe("false");
    expect(after.headers.get("x-serve-cleared")).toBe("false");
    await db.update(expansionOutputApprovals).set({ nativeSha256: "aa".repeat(32) }).where(eq(expansionOutputApprovals.memberKey, cards[35]!.memberKey));
    const drifted = await fetch(`${base}/api/qa/baseball-expansion/${SET}/discovery-cohort/output-preview/${encodeURIComponent(cards[35]!.memberKey)}/native`, { headers });
    expect(drifted.status).toBe(409);
    const driftedBody = await drifted.json() as { code: string; releaseAuthorized: boolean };
    expect(driftedBody).toMatchObject({ ok: false, code: "output_hash_mismatch", releaseAuthorized: false });
    expect(acceptanceIds).toHaveLength(36);
    const stopped = await fetch(`${base}/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/geometry-proposals`, { headers });
    expect(stopped.status).toBe(409);
    expect(await stopped.json()).toMatchObject({ ok: false, code: "ud_stopped" });
    const stoppedPreview = await fetch(`${base}/api/qa/baseball-expansion/${UD_1991_DISCOVERY.setId}/discovery-cohort/output-preview/${encodeURIComponent(cards[0]!.memberKey)}/native`, { headers });
    expect(stoppedPreview.status).toBe(409);
    expect(await stoppedPreview.json()).toMatchObject({ ok: false, code: "ud_stopped", releaseAuthorized: false });
  }, 120000);
});

function capture(): { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } {
  const box: { status?: number; res: { status: (code: number) => unknown; json: (body: unknown) => unknown; setHeader: () => unknown; removeHeader: () => unknown; end: () => unknown; headersSent: boolean } } = {
    res: {
      headersSent: false,
      status(code: number) { box.status = code; return box.res; },
      json() { box.res.headersSent = true; return box.res; },
      setHeader() { return box.res; },
      removeHeader() { return box.res; },
      end() { box.res.headersSent = true; return box.res; },
    },
  };
  return box;
}
