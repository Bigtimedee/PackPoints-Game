/**
 * Public covers are the pinned ids that still pass every cover check.
 * A failed pin drops. Nothing else fills the slot.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { PINNED_SET_COVERS, setPinnedCoversForTests } from "../config/pinnedCovers";
import { setMaskReadySidecarDirForTests, writeMaskFailureSidecar } from "../masking/maskReadySidecar";
import { clearMaskBandCacheForTests, MASK_BAND_OVERSIZED } from "../masking/maskBandLimit";
import {
  clearReadyCoverIndexForTests,
  formatPinnedCoverBootLine,
  handlePublicSetCover,
  listCoverCandidates,
  readyMaskedCoverUrls,
  resolvePinnedCoverReports,
} from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const stamp = randomUUID().slice(0, 8);
const setId = randomUUID();
const otherSetId = randomUUID();
const alphaId = randomUUID();
const bravoId = randomUUID();
const blockedId = randomUUID();
const ineligibleId = randomUUID();
const unbakedId = randomUUID();
const dupId = randomUUID();
const foreignId = randomUUID();
const spareId = randomUUID();
const bandId = randomUUID();
const jpeg = Buffer.from(`masked-pin-${stamp}`);

const pins = [bravoId, blockedId, ineligibleId, unbakedId, alphaId, dupId, foreignId];

let dir = "";
let base = "";
const previousCovers = process.env.SETS_COVERS_DISABLED;
const previousBand = process.env.MASK_BAND_GUARD;

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.SETS_COVERS_DISABLED;
  else process.env.SETS_COVERS_DISABLED = value;
}

async function bake(cardId: string) {
  await writeFile(path.join(dir, warmOkMarkerFilename(cardId)), "ok\n");
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
}

describe("pinned set covers", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  const server = createServer(app);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-pinned-"));
    setMaskReadySidecarDirForTests(dir);
    for (const id of [alphaId, bravoId, blockedId, ineligibleId, dupId, foreignId, spareId, bandId]) {
      await bake(id);
    }
    writeMaskFailureSidecar(bandId, MASK_BAND_OVERSIZED, dir);
    clearReadyCoverIndexForTests();
    clearMaskBandCacheForTests();
    setPinnedCoversForTests(setId, pins);
    setFlag(undefined);

    await db.insert(gameSets).values([
      {
        id: setId,
        sport: "basketball",
        brand: "Topps",
        year: 1991,
        setName: `Pinned ${stamp}`,
        isUserCreated: false,
        isActive: true,
      },
      {
        id: otherSetId,
        sport: "basketball",
        brand: "Topps",
        year: 1992,
        setName: `Other ${stamp}`,
        isUserCreated: false,
        isActive: true,
      },
    ]);

    const rows = [
      { id: alphaId, gameSetId: setId, player: "Alpha One", isPlayable: true },
      { id: bravoId, gameSetId: setId, player: "Bravo Two", isPlayable: true },
      { id: blockedId, gameSetId: setId, player: "Chris Paul / Kevin Durant", isPlayable: true },
      { id: ineligibleId, gameSetId: setId, player: "Delta Four", isPlayable: false },
      { id: unbakedId, gameSetId: setId, player: "Echo Five", isPlayable: true },
      { id: dupId, gameSetId: setId, player: "Alpha One Jr", isPlayable: true },
      { id: spareId, gameSetId: setId, player: "Foxtrot Six", isPlayable: true },
      { id: bandId, gameSetId: setId, player: "Golf Seven", isPlayable: true },
      { id: foreignId, gameSetId: otherSetId, player: "Hotel Eight", isPlayable: true },
    ];
    await db.insert(playableCards).values(rows.map((row, index) => ({
      id: row.id,
      gameSetId: row.gameSetId,
      cardhedgeCardId: `pinned:${row.id}`,
      player: row.player,
      set: `Pinned ${stamp}`,
      description: row.player,
      imageUrl: `https://packpts.com/cards/${row.id}.jpg`,
      category: "basketball",
      isPlayable: row.isPlayable,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      lastImageCheck: new Date(),
      createdAt: new Date(Date.UTC(2020, 0, index + 1)),
    })));

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setFlag(previousCovers);
    if (previousBand === undefined) delete process.env.MASK_BAND_GUARD;
    else process.env.MASK_BAND_GUARD = previousBand;
    clearMaskBandCacheForTests();
    setPinnedCoversForTests(setId, null);
    setMaskReadySidecarDirForTests(null);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const ids = [alphaId, bravoId, blockedId, ineligibleId, unbakedId, dupId, foreignId, spareId, bandId];
    await db.delete(playableCards).where(inArray(playableCards.id, ids)).catch(() => null);
    await db.delete(gameSets).where(inArray(gameSets.id, [setId, otherSetId])).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("stores Design picks and alternates for each reviewed set", () => {
    const football = PINNED_SET_COVERS["91cfdf3f-a620-4e73-adc8-22b8df221716"];
    expect(football.set).toBe("1987 Topps Football");
    expect(football.picks[0]).toBe("704c2dab-140a-4276-b57e-b9febfa1ff20");
    expect(football.picks).toHaveLength(8);
    expect(football.alternates).toHaveLength(4);
    expect(PINNED_SET_COVERS["aea515e2-24bc-42bd-a602-1514b89e8cd1"].alternates).toEqual([]);
    expect(PINNED_SET_COVERS["229f0379-aa56-40a8-abe3-1af217a397e8"].set).toBe("2024 Basketball");
    for (const list of Object.values(PINNED_SET_COVERS)) {
      expect(list.picks.length).toBeGreaterThan(0);
      expect(list.picks.length).toBeLessThanOrEqual(8);
    }
  });

  it("serves valid pins in order and drops the rest with no auto-fill", async () => {
    setFlag(undefined);
    clearReadyCoverIndexForTests();
    const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
    expect(report.validIds).toEqual([bravoId, alphaId]);
    expect(report.validIds).not.toContain(spareId);
    const reasons = new Map(report.dropped.map((drop) => [drop.cardId, drop.reason]));
    expect(reasons.get(blockedId)).toBe("blocked");
    expect(reasons.get(ineligibleId)).toBe("ineligible");
    expect(reasons.get(unbakedId)).toBe("unbaked");
    expect(reasons.get(dupId)).toBe("duplicate");
    expect(reasons.get(foreignId)).toBe("missing");

    const urls = await readyMaskedCoverUrls([setId]);
    expect(urls.get(setId)).toEqual([
      `/api/sets/${setId}/covers/0`,
      `/api/sets/${setId}/covers/1`,
    ]);

    const first = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-card-id")).toBe(bravoId);
    expect(first.headers.get("content-type")).toContain("image/jpeg");
    expect(Buffer.from(await first.arrayBuffer()).equals(jpeg)).toBe(true);

    const second = await fetch(`${base}/api/sets/${setId}/covers/1`);
    expect(second.headers.get("x-card-id")).toBe(alphaId);
    const gap = await fetch(`${base}/api/sets/${setId}/covers/2`);
    expect(gap.status).toBe(404);

    const qa = await listCoverCandidates(setId, 12);
    expect(qa.validCount).toBe(2);
    expect(qa.pinnedCount).toBe(pins.length);
    expect(qa.candidates.map((row) => row.cardId)).toEqual([bravoId, alphaId]);
    expect(qa.candidates.every((row) => row.source === "pick" && row.served)).toBe(true);
    expect(qa.picker.some((row) => row.cardId === spareId && row.source === "picker")).toBe(true);
    expect(qa.picker.some((row) => row.cardId === spareId && row.served)).toBe(false);
    const blockedPin = qa.pins.find((pin) => pin.cardId === blockedId);
    expect(blockedPin).toMatchObject({ role: "pick", status: "skipped", reason: "blocked", served: false, slot: null });
  });

  it("shows no covers when the pin list is empty", async () => {
    setPinnedCoversForTests(setId, []);
    clearReadyCoverIndexForTests();
    try {
      const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
      expect(report.pinnedIds).toEqual([]);
      expect(report.validIds).toEqual([]);
      expect((await readyMaskedCoverUrls([setId])).get(setId)).toEqual([]);
      const res = await fetch(`${base}/api/sets/${setId}/covers/0`);
      expect(res.status).toBe(404);
    } finally {
      setPinnedCoversForTests(setId, pins);
    }
  });

  it("lets the master switch override valid pins", async () => {
    setFlag("1");
    clearReadyCoverIndexForTests();
    try {
      expect((await readyMaskedCoverUrls([setId])).get(setId)).toEqual([]);
      const hidden = await fetch(`${base}/api/sets/${setId}/covers/0`);
      expect(hidden.status).toBe(404);
      expect(hidden.headers.get("x-card-id")).toBeNull();
      const qa = await listCoverCandidates(setId, 8);
      expect(qa.coversDisabled).toBe(true);
      expect(qa.validCount).toBe(2);
      expect(qa.candidates.map((row) => row.cardId)).toEqual([bravoId, alphaId]);
    } finally {
      setFlag(undefined);
    }
  });

  it("drops a band pin and does not fill from the picker", async () => {
    const previous = process.env.MASK_BAND_GUARD;
    process.env.MASK_BAND_GUARD = "enforce";
    clearMaskBandCacheForTests();
    clearReadyCoverIndexForTests();
    setPinnedCoversForTests(setId, [bandId, bravoId]);
    try {
      const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
      expect(report.validIds).toEqual([bravoId]);
      expect(report.dropped).toEqual([{ cardId: bandId, reason: "band" }]);
      expect(report.validIds).not.toContain(spareId);
    } finally {
      if (previous === undefined) delete process.env.MASK_BAND_GUARD;
      else process.env.MASK_BAND_GUARD = previous;
      clearMaskBandCacheForTests();
      setPinnedCoversForTests(setId, pins);
      clearReadyCoverIndexForTests();
    }
  });

  it("fills from alternates after a failed pick and stops at eight", async () => {
    setPinnedCoversForTests(setId, {
      picks: [blockedId, bravoId],
      alternates: [spareId, alphaId],
    });
    clearReadyCoverIndexForTests();
    try {
      const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
      expect(report.validIds).toEqual([bravoId, spareId, alphaId]);
      expect(report.dropped).toEqual([{ cardId: blockedId, reason: "blocked" }]);
      const qa = await listCoverCandidates(setId, 12);
      expect(qa.pins.find((pin) => pin.cardId === bravoId)).toMatchObject({ status: "pick", role: "pick" });
      expect(qa.pins.find((pin) => pin.cardId === spareId)).toMatchObject({ status: "alternate", role: "alternate" });
      expect(qa.pins.find((pin) => pin.cardId === blockedId)).toMatchObject({ status: "skipped", reason: "blocked" });
    } finally {
      setPinnedCoversForTests(setId, pins);
    }
  });

  it("formats the boot line with pick and alternate counts", async () => {
    const shown = [bravoId, alphaId, spareId];
    setPinnedCoversForTests(setId, { picks: shown, alternates: [blockedId] });
    clearReadyCoverIndexForTests();
    try {
      const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
      expect(report.validIds).toEqual(shown);
      expect(report.dropped).toEqual([{ cardId: blockedId, reason: "blocked" }]);
      const line = formatPinnedCoverBootLine(report);
      expect(line).toBe(
        `[PinnedCovers] set=${setId} picks=3 alternates=1 valid=3 skipped=${blockedId}:blocked`,
      );
      expect(line).not.toMatch(/[\u2013\u2014]/);
    } finally {
      setPinnedCoversForTests(setId, pins);
    }
  });

  it("skips a ninth valid card and does not pull an unlisted one", async () => {
    const extras = Array.from({ length: 6 }, () => randomUUID());
    await db.insert(playableCards).values(extras.map((id, index) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `pinned:${id}`,
      player: `India ${index}`,
      set: `Pinned ${stamp}`,
      description: `India ${index}`,
      imageUrl: `https://packpts.com/cards/${id}.jpg`,
      category: "basketball",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      lastImageCheck: new Date(),
      createdAt: new Date(Date.UTC(2021, 0, index + 1)),
    })));
    for (const id of extras) await bake(id);
    clearReadyCoverIndexForTests();
    const eight = [bravoId, alphaId, spareId, ...extras.slice(0, 5)];
    const ninth = extras[5];
    setPinnedCoversForTests(setId, { picks: eight, alternates: [ninth] });
    try {
      const report = (await resolvePinnedCoverReports([setId])).get(setId)!;
      expect(report.validIds).toEqual(eight);
      expect(report.validIds).not.toContain(ninth);
      expect(report.validIds).not.toContain(blockedId);
      expect(report.dropped).toEqual([{ cardId: ninth, reason: "over-cap" }]);
      const line = formatPinnedCoverBootLine(report);
      expect(line).toBe(
        `[PinnedCovers] set=${setId} picks=8 alternates=1 valid=8 skipped=${ninth}:over-cap`,
      );
    } finally {
      setPinnedCoversForTests(setId, pins);
      clearReadyCoverIndexForTests();
      await db.delete(playableCards).where(inArray(playableCards.id, extras)).catch(() => null);
    }
  });
});
