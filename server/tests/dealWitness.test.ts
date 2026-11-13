/**
 * A null band and no bake is not dealable and not counted.
 * A baked card stays dealable. An expansion release member stays dealable
 * without a sidecar, so the baseball expansion counts do not move:
 * Fleer 1986 stays 35, Fleer 1989 stays 48, Topps 1990 stays 36 or 38,
 * Donruss 1989 stays 37. 1987 Topps drops the two unwitnessed cards, 503 to 501.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import {
  discoveryCohortMembers,
  discoveryCohorts,
  expansionReleaseManifests,
  expansionReleaseMembers,
  gameSets,
  playableCards,
} from "@shared/schema";
import { db } from "../db";
import { releaseSetsForTests } from "../config/heldSets";
import { isBlockedCard } from "../lib/cardBlocklist";
import { recordedBandPlacement, resetDealWitnessCacheForTests, successfulBake } from "../masking/dealWitness";
import { setMaskReadySidecarDirForTests, writeMaskFailureSidecar, clearMaskFailureSidecar } from "../masking/maskReadySidecar";
import { handleMaskedToken } from "../services/playImageHttp";
import { maskTokenMatches, maskedPlayPath } from "../services/playImageToken";
import { sendMaskedCard } from "../services/playImageSend";
import { publicMaskDenyReason, resetPublicMaskSetCacheForTests } from "../services/publicMaskGate";
import { eligibleCountsForSetIds } from "../services/playableSetEligibility";
import { storage } from "../storage";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const JELTZ = "14b0bd34-fd99-4899-85c2-64d03a82f9af";
const MOTLEY = "4b6f8f60-aaad-43f0-a364-09efd085e6a4";
const stamp = randomUUID().slice(0, 8);
const coreId = randomUUID();
const expansionId = randomUUID();
const bakedId = randomUUID();
const planId = randomUUID();
const bareId = randomUUID();
const clearedFailId = randomUUID();
const releasedId = randomUUID();
const unreleasedId = randomUUID();
const sha = "ab".repeat(32);
const memberKey = `deal-witness-${stamp}`;

let dir = "";
let restoreClearance: (() => Promise<void>) | undefined;

function card(id: string, setId: string, player: string, number: string) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `deal-witness:${stamp}:${id}`,
    player,
    set: `Deal witness ${stamp}`,
    description: player,
    number,
    variant: "base",
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "baseball",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "approved",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    blockedReason: null as string | null,
  };
}

async function bake(id: string) {
  await writeFile(path.join(dir, warmOkMarkerFilename(id)), "ok\n");
  await writeFile(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.jpg`), Buffer.from(`masked-${id}`));
}

async function plan(id: string) {
  await writeFile(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.json`), JSON.stringify({
    layoutClass: "BOTTOM_PLAQUE",
    regions: [{ xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "solid" }],
    maskVersion: CURRENT_MASK_VERSION,
  }));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "deal-witness-"));
  setMaskReadySidecarDirForTests(dir);
  await db.delete(playableCards).where(inArray(playableCards.id, [JELTZ, MOTLEY]));
  await db.insert(gameSets).values([
    { id: coreId, sport: "baseball", brand: "Topps", year: 1987, setName: `1987 Topps witness ${stamp}`, isUserCreated: false, isActive: true },
    { id: expansionId, sport: "baseball", brand: "Fleer", year: 1986, setName: `1986 Fleer witness ${stamp}`, isUserCreated: false, isActive: true },
  ]);
  await db.insert(playableCards).values([
    card(bakedId, coreId, "Baked Player", "1"),
    card(planId, coreId, "Plan Player", "2"),
    card(bareId, coreId, "Bare Player", "3"),
    card(clearedFailId, coreId, "Cleared Fail", "4"),
    card(JELTZ, coreId, "Steve Jeltz", "294"),
    card(MOTLEY, coreId, "Darryl Motley", "99"),
    card(releasedId, expansionId, "Released Player", "10"),
    card(unreleasedId, expansionId, "Unreleased Player", "11"),
  ]);
  await db.insert(discoveryCohorts).values({
    setId: expansionId,
    artifactSha256: sha,
    membershipSha256: sha,
    originalCount: 35,
    checklistCount: 660,
  });
  await db.insert(discoveryCohortMembers).values([
    {
      memberKey,
      setId: expansionId,
      ordinal: 1,
      cardNumber: "10",
      supplierId: `supplier-${stamp}`,
      originalSha256: sha,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: 100,
      disposition: "pass-candidate",
      routing: "ordinary-canonical-candidate",
      playableCardId: releasedId,
    },
    {
      memberKey: `${memberKey}-held`,
      setId: expansionId,
      ordinal: 2,
      cardNumber: "11",
      supplierId: `supplier-held-${stamp}`,
      originalSha256: sha,
      originalWidth: 40,
      originalHeight: 60,
      originalBytes: 100,
      disposition: "pass-candidate",
      routing: "ordinary-canonical-candidate",
      playableCardId: unreleasedId,
    },
  ]);
  const [manifest] = await db.insert(expansionReleaseManifests).values({
    setId: expansionId,
    version: 1,
    evidenceRef: "deal-witness",
    clearedBy: "reviewer",
    memberCount: 35,
    releasedMembershipSha256: sha,
    discoveryMembershipSha256: sha,
  }).returning({ id: expansionReleaseManifests.id });
  await db.insert(expansionReleaseMembers).values({
    manifestId: manifest.id,
    memberKey,
    setId: expansionId,
    sourceSha256: sha,
    nativeSha256: sha,
    preview300Sha256: sha,
    polygonSha256: sha,
    rendererId: "plate-polygon-v1",
    proposalId: randomUUID(),
  });
  await bake(bakedId);
  await bake(JELTZ);
  await bake(MOTLEY);
  await plan(planId);
  writeMaskFailureSidecar(clearedFailId, "name_plate_unresolved", dir);
  clearMaskFailureSidecar(clearedFailId, dir);
  resetDealWitnessCacheForTests();
  restoreClearance = await releaseSetsForTests([coreId]);
});

afterAll(async () => {
  if (restoreClearance) await restoreClearance();
  setMaskReadySidecarDirForTests(null);
  resetDealWitnessCacheForTests();
  await db.delete(expansionReleaseMembers).where(eq(expansionReleaseMembers.setId, expansionId)).catch(() => null);
  await db.delete(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, expansionId)).catch(() => null);
  await db.delete(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, expansionId)).catch(() => null);
  await db.delete(discoveryCohorts).where(eq(discoveryCohorts.setId, expansionId)).catch(() => null);
  await db.delete(playableCards).where(inArray(playableCards.gameSetId, [coreId, expansionId])).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, [coreId, expansionId])).catch(() => null);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

describe("deal witness", () => {
  it("drops a null band with no bake from the count and the solo deal, and keeps a bake or a plan", async () => {
    expect(successfulBake(bakedId, dir)).toBe(true);
    expect(recordedBandPlacement(planId, dir)).toBe("BOTTOM_PLAQUE");
    expect(successfulBake(bareId, dir)).toBe(false);
    expect(recordedBandPlacement(bareId, dir)).toBeNull();
    expect(successfulBake(clearedFailId, dir)).toBe(false);
    expect(recordedBandPlacement(clearedFailId, dir)).toBeNull();

    const counts = await eligibleCountsForSetIds([coreId, expansionId]);
    expect(counts.get(coreId)).toBe(2);
    expect(503 - 2).toBe(501);

    const dealt = (await storage.getRandomCardsFromSet(coreId, 20)).map((row) => row.id).sort();
    expect(dealt).toEqual([bakedId, planId].sort());

    expect(isBlockedCard(coreId, "Steve Jeltz", { id: JELTZ, number: "294", variant: "base" })).toBe(true);
    expect(isBlockedCard(coreId, "Darryl Motley", { id: MOTLEY, number: "99", variant: "base" })).toBe(true);
    expect(dealt).not.toContain(JELTZ);
    expect(dealt).not.toContain(MOTLEY);
  });

  it("counts an expansion release member that has no sidecar and leaves an unreleased card out", async () => {
    expect(successfulBake(releasedId, dir)).toBe(false);
    expect(recordedBandPlacement(releasedId, dir)).toBeNull();
    const counts = await eligibleCountsForSetIds([expansionId]);
    expect(counts.get(expansionId)).toBe(1);
    const dealt = (await storage.getRandomCardsFromSet(expansionId, 20)).map((row) => row.id);
    expect(dealt).toEqual([releasedId]);
    expect(dealt).not.toContain(unreleasedId);
  });

  it("404s the public mask for the two ids and for any card that fails the same eligibility", async () => {
    resetPublicMaskSetCacheForTests();
    expect(await publicMaskDenyReason(bakedId)).toBeNull();
    expect(await publicMaskDenyReason(planId)).toBeNull();
    expect(await publicMaskDenyReason(releasedId)).toBeNull();
    expect(await publicMaskDenyReason(bareId)).toBe("refused");
    expect(await publicMaskDenyReason(clearedFailId)).toBe("refused");
    expect(await publicMaskDenyReason(JELTZ)).toBe("refused");
    expect(await publicMaskDenyReason(MOTLEY)).toBe("refused");

    const ids = [bakedId, planId, bareId, clearedFailId, JELTZ, MOTLEY, releasedId];
    const app = express();
    app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
      void handleMaskedToken(req, res, {
        authorizeCardId: async () => "denied",
        resolveReveal: async () => ({ ok: false, reason: "bad" }),
        resolveMask: async (scope, sessionId, index, token) => {
          for (const id of ids) {
            if (maskTokenMatches(scope, sessionId, index, id, token)) return id;
          }
          return null;
        },
        sendUnmasked: async (response) => { response.status(500).end(); },
        sendMasked: sendMaskedCard,
      });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const id of [bareId, clearedFailId, JELTZ, MOTLEY]) {
        const res = await fetch(`${base}${maskedPlayPath({ scope: "solo", sessionId: "deal-witness", index: 0, cardId: id })}`);
        expect(res.status, id).toBe(404);
        expect(res.headers.get("content-type") || "").toContain("json");
        const body = Buffer.from(await res.arrayBuffer());
        expect(body[0]).not.toBe(0xff);
        expect(body.toString()).toContain("Masked image not found");
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("uses the same eligibility on the shelf, solo, covers, and the public mask", () => {
    const eligibility = readFileSync(new URL("../services/playableSetEligibility.ts", import.meta.url), "utf8");
    const covers = readFileSync(new URL("../services/setCovers.ts", import.meta.url), "utf8");
    const solo = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");
    const gate = readFileSync(new URL("../services/publicMaskGate.ts", import.meta.url), "utf8");
    expect(eligibility).toContain("dealWitnessSql(alias)");
    expect(covers).toContain('eligibleDealFilter("playable_cards")');
    expect(solo).toContain('eligibleDealFilter("playable_cards")');
    expect(gate).toContain('eligibleDealFilter("playable_cards"');
  });
});
