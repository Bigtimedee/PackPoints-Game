/**
 * Boot release of current-version refusals on `trustProfileBand` sets (1990 Hoops).
 * Releases mask_band_oversized, name_plate_unresolved, and name_text_visible
 * once per card. Leaves other reasons, blocked cards, and every other set alone.
 */
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, maskBakeRefusals, playableCards } from "@shared/schema";
import { db } from "../db";
import {
  maskFailureSidecarFilename,
  readMaskFailureReason,
  setMaskReadySidecarDirForTests,
  writeMaskFailureSidecar,
} from "../masking/maskReadySidecar";
import {
  releaseTrustedBandRefusals,
  trustedBandReleaseMarkerFilename,
  trustedBandSetIds,
} from "../masking/trustedBandRelease";

const stamp = randomUUID().slice(0, 8);
const hoopsSetId = `d226801a${randomUUID().slice(8)}`;
const fleerSetId = randomUUID();
const ids = {
  oversized: randomUUID(),
  unresolved: randomUUID(),
  textVisible: randomUUID(),
  outsideMask: randomUUID(),
  served: randomUUID(),
  fleerOversized: randomUUID(),
};
/** Don Nelson #345 is on BLOCKED_CARD_ID_RULES by id. */
const NELSON_ID = "0a468fe3-721d-4e83-a580-cf3df5fc321b";
let dir = "";

function row(id: string, gameSetId: string, player: string, number: string, blockedReason: string | null, lastValidationReason: string | null) {
  return {
    id,
    gameSetId,
    cardhedgeCardId: `tpb:${stamp}:${id}`,
    player,
    set: `test ${stamp}`,
    description: player,
    number,
    variant: "Base",
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    isPlayable: blockedReason == null,
    blockedReason,
    lastValidationReason,
    contentVerified: true as boolean | null,
    imageReviewStatus: blockedReason ? "flagged" : "approved",
    quarantineStatus: blockedReason ? "QUARANTINED_ADMIN_REVIEW" : "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tpb-"));
  setMaskReadySidecarDirForTests(dir);
  await db.delete(playableCards).where(eq(playableCards.id, NELSON_ID));
  await db.insert(gameSets).values([
    { id: hoopsSetId, sport: "basketball", brand: "Hoops", year: 1990, setName: "1990 Hoops Basketball", isUserCreated: true, isActive: true },
    { id: fleerSetId, sport: "basketball", brand: "Fleer", year: 1989, setName: "1989 Fleer Basketball", isUserCreated: true, isActive: true },
  ]);
  await db.insert(playableCards).values([
    row(ids.oversized, hoopsSetId, "Byron Scott", "159", "mask_band_oversized", "mask_band_oversized"),
    row(ids.unresolved, hoopsSetId, "Kevin Gamble", "40", "mask_name_uncovered", "name_plate_unresolved"),
    row(ids.textVisible, hoopsSetId, "Manute Bol", "112", "mask_name_uncovered", "name_text_visible"),
    row(ids.outsideMask, hoopsSetId, "Some Player", "200", "name_visible_outside_mask", "name_visible_outside_mask"),
    row(ids.served, hoopsSetId, "Larry Bird", "39", null, null),
    row(NELSON_ID, hoopsSetId, "Don Nelson", "345", "mask_band_oversized", "mask_band_oversized"),
    row(ids.fleerOversized, fleerSetId, "Fleer Player", "10", "mask_band_oversized", "mask_band_oversized"),
  ]);
  writeMaskFailureSidecar(ids.oversized, "mask_band_oversized", dir);
  writeMaskFailureSidecar(ids.unresolved, "name_plate_unresolved", dir);
  writeMaskFailureSidecar(ids.textVisible, "name_text_visible", dir);
  writeMaskFailureSidecar(ids.outsideMask, "name_visible_outside_mask", dir);
  writeMaskFailureSidecar(NELSON_ID, "mask_band_oversized", dir);
  writeMaskFailureSidecar(ids.fleerOversized, "mask_band_oversized", dir);
  await db.insert(maskBakeRefusals).values([
    { cardId: ids.oversized, gameSetId: hoopsSetId, reason: "mask_band_oversized", maskVersion: CURRENT_MASK_VERSION },
    { cardId: ids.fleerOversized, gameSetId: fleerSetId, reason: "mask_band_oversized", maskVersion: CURRENT_MASK_VERSION },
  ]);
});

afterAll(async () => {
  const all = [...Object.values(ids), NELSON_ID];
  await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, all)).catch(() => null);
  await db.delete(playableCards).where(inArray(playableCards.id, all)).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, [hoopsSetId, fleerSetId])).catch(() => null);
  setMaskReadySidecarDirForTests(null);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

describe("trusted band refusal release", () => {
  it("finds the Hoops set and not the Fleer set", async () => {
    const setIds = await trustedBandSetIds();
    expect(setIds).toContain(hoopsSetId);
    expect(setIds).not.toContain(fleerSetId);
  });

  it("releases the three fallback reasons once, on the Hoops set only", async () => {
    const first = await releaseTrustedBandRefusals({ dir, setIds: [hoopsSetId, fleerSetId] });
    expect(first.released).toBe(3);
    expect(first.byReason).toEqual({ mask_band_oversized: 1, name_plate_unresolved: 1, name_text_visible: 1 });

    for (const id of [ids.oversized, ids.unresolved, ids.textVisible]) {
      expect(readMaskFailureReason(id, dir)).toBeNull();
      expect(existsSync(path.join(dir, trustedBandReleaseMarkerFilename(id)))).toBe(true);
    }
    const rows = await db.select().from(playableCards).where(inArray(playableCards.id, [ids.oversized, ids.unresolved, ids.textVisible]));
    for (const r of rows) {
      expect(r.isPlayable).toBe(true);
      expect(r.blockedReason).toBeNull();
      expect(r.quarantineStatus).toBe("OK");
    }
    expect(await db.select().from(maskBakeRefusals).where(eq(maskBakeRefusals.cardId, ids.oversized))).toHaveLength(0);

    // Untouched: another reason, a blocked card, and a set without the flag.
    expect(readMaskFailureReason(ids.outsideMask, dir)).toBe("name_visible_outside_mask");
    expect(readMaskFailureReason(NELSON_ID, dir)).toBe("mask_band_oversized");
    expect(readMaskFailureReason(ids.fleerOversized, dir)).toBe("mask_band_oversized");
    expect(existsSync(path.join(dir, maskFailureSidecarFilename(ids.fleerOversized)))).toBe(true);
    const fleer = await db.select().from(playableCards).where(eq(playableCards.id, ids.fleerOversized));
    expect(fleer[0].isPlayable).toBe(false);
    expect(fleer[0].blockedReason).toBe("mask_band_oversized");
    expect(await db.select().from(maskBakeRefusals).where(eq(maskBakeRefusals.cardId, ids.fleerOversized))).toHaveLength(1);
    const nelson = await db.select().from(playableCards).where(eq(playableCards.id, NELSON_ID));
    expect(nelson[0].isPlayable).toBe(false);
  });

  it("does not release a card again after the new path refuses it", async () => {
    writeMaskFailureSidecar(ids.oversized, "name_text_visible", dir);
    const second = await releaseTrustedBandRefusals({ dir, setIds: [hoopsSetId] });
    expect(second.released).toBe(0);
    expect(readMaskFailureReason(ids.oversized, dir)).toBe("name_text_visible");
  });
});
