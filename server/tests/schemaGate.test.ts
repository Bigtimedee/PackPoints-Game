import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import express from "express";
import http from "http";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { maskToken, maskTokenMatches } from "../services/playImageToken";
import { registerVersionRoute } from "../lib/versionRoute";
import { markSchemaReady, resetSchemaGateForTests, schemaGateMiddleware, schemaGateServesWarmMask } from "../startup/schemaGate";
import { setWarmMaskDirForTests } from "../startup/warmMaskGate";
import { handleMaskedToken } from "../services/playImageHttp";
import { sendMaskedCard } from "../services/playImageSend";

let bootCardId = "";

describe("schema gate", () => {
  const app = express();
  registerVersionRoute(app);
  app.use(schemaGateMiddleware);
  app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
    void handleMaskedToken(req, res, {
      authorizeCardId: async () => "denied",
      resolveReveal: async () => ({ ok: false, reason: "bad" }),
      resolveMask: async (scope, sessionId, index, token) => (
        bootCardId && maskTokenMatches(scope, sessionId, index, bootCardId, token) ? bootCardId : null
      ),
      sendUnmasked: async (response) => { response.status(500).end(); },
      sendMasked: sendMaskedCard,
    });
  });
  app.get("/api/game/start", (_req, res) => {
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    resetSchemaGateForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("refuses a warm JPEG for an unknown card during the schema window and keeps reveal closed", async () => {
    resetSchemaGateForTests();
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-warm-"));
    const cardId = "card-warm-1";
    await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
    setWarmMaskDirForTests(dir);
    const token = maskToken("solo", "session-1", 0, cardId);
    const warm = await fetch(`${base}/api/play/m/solo/session-1/0/${token}`);
    expect(warm.status).toBe(404);
    expect(warm.headers.get("cache-control") || "").toContain("no-store");
    expect(warm.headers.get("content-type") || "").not.toContain("image/jpeg");
    expect(warm.headers.get("x-mask-cache")).toBeNull();
    const unmarkedDir = await mkdtemp(path.join(tmpdir(), "packpts-warm-unmarked-"));
    await writeFile(path.join(unmarkedDir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    setWarmMaskDirForTests(unmarkedDir);
    const unmarked = await fetch(`${base}/api/play/m/solo/session-1/0/${token}`);
    expect(unmarked.status).toBe(503);
    expect(unmarked.headers.get("content-type") || "").not.toContain("text/html");
    setWarmMaskDirForTests(dir);
    const miss = await fetch(`${base}/api/play/m/solo/session-1/0/not-the-token`);
    expect(miss.status).toBe(503);
    expect(miss.headers.get("retry-after")).toBe("2");
    const reveal = await fetch(`${base}/api/play/r/solo/session-1/0/1/token`);
    expect(reveal.status).toBe(503);
    const raw = await fetch(`${base}/api/images/card/${cardId}`);
    expect(raw.status).toBe(503);
    expect(schemaGateServesWarmMask("GET", `/api/play/m/solo/session-1/0/${token}`)).toBe(true);
    expect(schemaGateServesWarmMask("GET", `/api/play/r/solo/session-1/0/1/token`)).toBe(false);
    setWarmMaskDirForTests(null);
  });

  it("serves /api/version and 503s DB routes until the schema step finishes", async () => {
    const version = await fetch(`${base}/api/version`);
    expect(version.status).toBe(200);
    const blocked = await fetch(`${base}/api/game/start`);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toBe("2");
    markSchemaReady();
    const open = await fetch(`${base}/api/game/start`);
    expect(open.status).toBe(200);
  });

  it("keeps expansion bytes off the schema window and serves them only after a ready binding", async () => {
    const { db } = await import("../db");
    const {
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
    const { createDiscoveryCohort, renderMeasuredProposal } = await import("../services/baseballExpansion/discoveryCohort");
    const { PER_CARD_RENDERER_IDS, publicExpansionImage, recordOutputApproval, recordServeClearance, recordSourceAcceptance } = await import("../services/baseballExpansion/perCardRelease");
    const { resetPublicMaskSetCacheForTests } = await import("../services/publicMaskGate");
    const setId = "7bb0e667-46ce-5cfe-a76c-a51044756725";
    const cardId = "a10a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
    const pixels = [[1, 1], [30, 1], [30, 20], [1, 20]];
    const normalized = pixels.map(([x, y]) => [x / 40, y / 30]);
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 9, g: 20, b: 40 } } }).jpeg().toBuffer();
    const sourceSha = sha(jpeg);
    const memberKey = `candidate-0001|${sourceSha}`;
    const wipe = async () => {
      await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, setId));
      await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, setId));
      await db.delete(expansionServeClearances).where(eq(expansionServeClearances.setId, setId));
      await db.delete(expansionOutputApprovals).where(eq(expansionOutputApprovals.setId, setId));
      await db.delete(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.setId, setId));
      await db.delete(expansionSetClearanceAttempts).where(eq(expansionSetClearanceAttempts.setId, setId));
      await db.delete(geometryProposals).where(eq(geometryProposals.setId, setId));
      await db.delete(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
      await db.update(discoveryCohortMembers).set({ playableCardId: null }).where(eq(discoveryCohortMembers.setId, setId));
      await db.delete(playableCards).where(eq(playableCards.id, cardId));
      await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
      await db.delete(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
      await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
    };
    resetSchemaGateForTests();
    bootCardId = "";
    setWarmMaskDirForTests(null);
    await wipe();
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-schema-expan-"));
    try {
      await insertIntegratedGameSet({
        id: setId, sport: "baseball", brand: "Fleer", year: 1990, setName: "1990 Fleer Baseball",
        isActive: true, cardhedgeSetQuery: "1990 Fleer Baseball", cardhedgeCategory: "Baseball",
      });
      const created = await createDiscoveryCohort({
        setId,
        artifactSha256: sha(Buffer.from(memberKey)),
        members: [{
          memberKey, ordinal: 1, cardNumber: "1", supplierId: "schema-boot-1",
          originalSha256: sourceSha, originalWidth: 40, originalHeight: 30, originalBytes: jpeg.length,
          disposition: "pass-candidate", routing: "synthetic",
        }],
      });
      expect(created).toMatchObject({ ok: true });
      await db.insert(discoverySourceStaging).values({
        setId, supplierId: "schema-boot-1", sha256: sourceSha, width: 40, height: 30, bytes: jpeg.length, imageBytes: jpeg,
      });
      const accepted = await recordSourceAcceptance({
        setId, memberKey, sourceSha256: sourceSha, evidenceRef: "evidence-schema-boot", acceptedBy: "reviewer",
      });
      expect(accepted.ok).toBe(true);
      const rendered = await renderMeasuredProposal({
        jpeg,
        proposal: {
          setId, memberKey, supplierId: "schema-boot-1", sourceSha256: sourceSha, width: 40, height: 30,
          geometryVersion: "plate-polygon-v1", polygonPixels: pixels, polygonNormalized: normalized,
        },
        member: { originalSha256: sourceSha, originalWidth: 40, originalHeight: 30, supplierId: "schema-boot-1", setId },
      });
      expect(rendered.ok).toBe(true);
      if (!rendered.ok || !accepted.ok) return;
      const [proposal] = await db.insert(geometryProposals).values({
        setId, memberKey, supplierId: "schema-boot-1", sourceSha256: sourceSha, width: 40, height: 30,
        geometryVersion: "plate-polygon-v1", polygonPixels: pixels, polygonNormalized: normalized, approval: false,
      }).returning({ id: geometryProposals.id });
      const approved = await recordOutputApproval({
        setId, memberKey, acceptanceId: accepted.id, proposalId: proposal!.id,
        polygonPixels: pixels, polygonNormalized: normalized, rendererId: PER_CARD_RENDERER_IDS[1]!,
        nativeBytes: rendered.native, preview300Bytes: rendered.maskedPreview,
        nativeSha256: sha(rendered.native), preview300Sha256: sha(rendered.maskedPreview),
        evidenceRef: "evidence-schema-boot", approvedBy: "reviewer",
      });
      expect(approved.ok).toBe(true);
      await db.insert(playableCards).values({
        id: cardId, gameSetId: setId, cardhedgeCardId: "schema-boot-expan", player: "Schema Boot",
        set: "1990 Fleer Baseball", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/schema-boot.jpg",
        category: "Baseball", isPlayable: true,
      });
      await db.update(discoveryCohortMembers).set({ playableCardId: cardId }).where(eq(discoveryCohortMembers.memberKey, memberKey));
      await db.insert(discoveryImportProvenance).values({
        playableCardId: cardId, setId, memberKey, supplierId: "schema-boot-1", sha256: sourceSha, byteLength: jpeg.length,
      });
      if (!approved.ok) return;
      expect(await recordServeClearance({
        setId, memberKey, outputApprovalId: approved.id, evidenceRef: "evidence-schema-boot", clearedBy: "reviewer",
      })).toMatchObject({ ok: true });
      const [output] = await db.select().from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, memberKey));
      const [cohort] = await db.select().from(discoveryCohorts).where(eq(discoveryCohorts.setId, setId));
      const [manifest] = await db.insert(expansionReleaseManifests).values({
        setId, version: 1, evidenceRef: "evidence-schema-boot", clearedBy: "reviewer", memberCount: 35,
        releasedMembershipSha256: sha(Buffer.from(memberKey)), discoveryMembershipSha256: cohort!.membershipSha256,
      }).returning({ id: expansionReleaseManifests.id });
      await db.insert(expansionReleaseMembers).values({
        manifestId: manifest!.id, memberKey, setId, sourceSha256: output!.sourceSha256,
        nativeSha256: output!.nativeSha256, preview300Sha256: output!.preview300Sha256,
        polygonSha256: output!.polygonSha256, rendererId: output!.rendererId, proposalId: output!.proposalId,
      });
      const stale = Buffer.from("schema-window-stale-warm-not-approved");
      await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), stale);
      await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
      setWarmMaskDirForTests(dir);
      bootCardId = cardId;
      resetPublicMaskSetCacheForTests();
      const token = maskToken("solo", "schema-boot", 0, cardId);
      const url = `${base}/api/play/m/solo/schema-boot/0/${token}`;
      const closedWhileUnready = async (label: string) => {
        resetSchemaGateForTests();
        resetPublicMaskSetCacheForTests();
        const open = await fetch(url);
        const openBody = Buffer.from(await open.arrayBuffer());
        expect(open.status, label).toBe(503);
        expect(open.status, label).not.toBe(304);
        expect(open.headers.get("content-type") || "", label).not.toContain("image/jpeg");
        expect(openBody.equals(stale), label).toBe(false);
        expect(openBody.equals(rendered.native), label).toBe(false);
        const conditional = await fetch(url, { headers: { "if-none-match": `"${CURRENT_MASK_VERSION}"` } });
        const conditionalBody = Buffer.from(await conditional.arrayBuffer());
        expect(conditional.status, label).toBe(503);
        expect(conditionalBody.equals(stale), label).toBe(false);
        expect(conditionalBody.equals(rendered.native), label).toBe(false);
      };
      await db.update(expansionOutputApprovals).set({ nativeSha256: "aa".repeat(32) }).where(eq(expansionOutputApprovals.id, output!.id));
      expect((await publicExpansionImage(cardId)).kind).toBe("closed");
      await closedWhileUnready("invalid binding");
      await db.update(expansionOutputApprovals).set({ nativeSha256: output!.nativeSha256 }).where(eq(expansionOutputApprovals.id, output!.id));
      expect((await publicExpansionImage(cardId)).kind).toBe("serve");
      await closedWhileUnready("valid binding still unready");
      markSchemaReady();
      resetPublicMaskSetCacheForTests();
      const served = await fetch(url);
      const servedBody = Buffer.from(await served.arrayBuffer());
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type") || "").toContain("image/jpeg");
      expect(servedBody).toEqual(rendered.native);
      expect(servedBody.equals(stale)).toBe(false);
      await db.update(expansionOutputApprovals).set({ nativeSha256: "aa".repeat(32) }).where(eq(expansionOutputApprovals.id, output!.id));
      resetPublicMaskSetCacheForTests();
      const refused = await fetch(url, { headers: { "if-none-match": served.headers.get("etag") || `"${CURRENT_MASK_VERSION}"` } });
      const refusedBody = Buffer.from(await refused.arrayBuffer());
      expect(refused.status).toBe(404);
      expect(refusedBody.equals(rendered.native)).toBe(false);
      expect(refusedBody.equals(stale)).toBe(false);
    } finally {
      bootCardId = "";
      setWarmMaskDirForTests(null);
      resetSchemaGateForTests();
      resetPublicMaskSetCacheForTests();
      await wipe();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("serves a provably legacy warm file during the schema window", async () => {
    const { db } = await import("../db");
    const { playableCards } = await import("@shared/schema");
    const { insertIntegratedGameSet } = await import("../services/baseballExpansion/createIntegratedSet");
    const { resetPublicMaskSetCacheForTests } = await import("../services/publicMaskGate");
    const setId = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
    const cardId = "b20b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
    resetSchemaGateForTests();
    resetPublicMaskSetCacheForTests();
    const created = await insertIntegratedGameSet({
      id: setId, sport: "baseball", brand: "Topps", year: 1987, setName: "1987 Topps",
      isActive: true, cardhedgeSetQuery: "1987 Topps", cardhedgeCategory: "Baseball",
    });
    await db.delete(playableCards).where(eq(playableCards.id, cardId));
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-schema-legacy-"));
    const legacy = Buffer.from("legacy-warm-boot-jpeg");
    try {
      await db.insert(playableCards).values({
        id: cardId, gameSetId: setId, cardhedgeCardId: "schema-boot-legacy", player: "Legacy Boot",
        set: "1987 Topps", number: "1", variant: "Base", imageUrl: "https://cdn.bubble.io/legacy-boot.jpg",
        category: "Baseball", isPlayable: true,
      });
      await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), legacy);
      await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
      setWarmMaskDirForTests(dir);
      const token = maskToken("solo", "legacy-boot", 0, cardId);
      const warm = await fetch(`${base}/api/play/m/solo/legacy-boot/0/${token}`);
      expect(warm.status).toBe(200);
      expect(warm.headers.get("content-type") || "").toContain("image/jpeg");
      expect(Buffer.from(await warm.arrayBuffer())).toEqual(legacy);
      expect(created.created === true || created.code === "exists" || created.code === "existing_identity").toBe(true);
    } finally {
      setWarmMaskDirForTests(null);
      resetSchemaGateForTests();
      resetPublicMaskSetCacheForTests();
      await db.delete(playableCards).where(eq(playableCards.id, cardId));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names every startup byte emitter and leaves expansion off the warm shortcut", () => {
    const root = path.join(__dirname, "..");
    const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
    const schema = read("startup/schemaGate.ts");
    const warm = read("startup/warmMaskGate.ts");
    const entry = read("entry.ts");
    const spa = read("static.ts");
    const shutdown = read("startup/gracefulShutdown.ts");
    expect(schema).toContain("tryServeWarmMasked");
    expect(schema.match(/createReadStream|pipe\(res\)|image\/jpeg/g)).toBeNull();
    expect(entry).not.toContain("masked-cards");
    expect(entry).not.toContain("createReadStream");
    expect(spa).not.toContain("masked-cards");
    expect(spa).not.toContain("createReadStream");
    expect(shutdown).not.toContain("tryServeWarmMasked");
    expect(shutdown).not.toContain("createReadStream");
    const gate = warm.slice(warm.indexOf("export async function tryServeWarmMasked"));
    const classify = gate.indexOf("bootWarmServeClass");
    const etag = gate.indexOf("if-none-match");
    const pipe = gate.indexOf("createReadStream");
    expect(classify).toBeGreaterThan(0);
    expect(etag).toBeGreaterThan(classify);
    expect(pipe).toBeGreaterThan(classify);
    const startupDir = path.join(root, "startup");
    const piped = readdirSync(startupDir).filter((name) => name.endsWith(".ts") && readFileSync(path.join(startupDir, name), "utf8").includes("createReadStream"));
    expect(piped).toEqual(["warmMaskGate.ts"]);
  });
});
