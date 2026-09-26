/**
 * SETS_COVERS_DISABLED hides /sets cover URLs and the cover image route.
 * Unset, the same set still returns its baked cover.
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
import { contentAssets, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { setsCoversDisabled } from "../lib/setsCoversDisabled";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { handlePublicSetDetail, handlePublicSetsIndex } from "../services/publicSets";
import { clearReadyCoverIndexForTests, handlePublicSetCover, readyMaskedCoverUrls } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const COVER_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const stamp = randomUUID().slice(0, 8);
const setId = randomUUID();
const setName = `Cover Switch ${stamp}`;
const shareUrl = "/generated/share/cover-switch.png";
const cardIds = Array.from({ length: 5 }, () => randomUUID());
const readyId = cardIds[0];
const jpeg = Buffer.from("masked-cover-switch");

let dir = "";
let base = "";
const previous = process.env.SETS_COVERS_DISABLED;

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.SETS_COVERS_DISABLED;
  else process.env.SETS_COVERS_DISABLED = value;
}

describe("setsCoversDisabled", () => {
  it("is on only for 1 and true", () => {
    expect(setsCoversDisabled("1")).toBe(true);
    expect(setsCoversDisabled("true")).toBe(true);
    expect(setsCoversDisabled("TRUE")).toBe(true);
    expect(setsCoversDisabled(" true ")).toBe(true);
    expect(setsCoversDisabled(undefined)).toBe(false);
    expect(setsCoversDisabled("")).toBe(false);
    expect(setsCoversDisabled("0")).toBe(false);
    expect(setsCoversDisabled("false")).toBe(false);
    expect(setsCoversDisabled("yes")).toBe(false);
    expect(setsCoversDisabled("2")).toBe(false);
  });
});

describe("GET /api/sets covers switch", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  app.get("/api/sets/:id", (req, res) => {
    void handlePublicSetDetail(req, res);
  });
  app.get("/api/sets", (req, res) => {
    void handlePublicSetsIndex(req, res);
  });
  const server = createServer(app);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-covers-off-"));
    setMaskReadySidecarDirForTests(dir);
    await writeFile(path.join(dir, warmOkMarkerFilename(readyId)), "ok\n");
    await writeFile(path.join(dir, `${readyId}_${CURRENT_MASK_VERSION}.jpg`), jpeg);
    clearReadyCoverIndexForTests();

    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Fleer",
      year: 1989,
      setName,
      isUserCreated: false,
      isActive: true,
    });
    await db.insert(playableCards).values(cardIds.map((id, index) => ({
      id,
      gameSetId: setId,
      cardhedgeCardId: `cover-switch:${id}`,
      player: `Player ${stamp} ${index + 1}`,
      set: setName,
      description: `${setName} ${index + 1}`,
      imageUrl: `https://packpts.com/cards/${id}.jpg`,
      category: "basketball",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      lastImageCheck: new Date(),
      createdAt: new Date(Date.UTC(2020, 0, index + 1)),
    })));
    await db.insert(contentAssets).values({
      assetType: "MAKER_SHARE_CARD",
      sourceEventId: `maker_set_${setId}`,
      metadata: { imageUrl: shareUrl },
      imagePath: shareUrl,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setFlag(undefined);
  });

  afterAll(async () => {
    setFlag(previous);
    setMaskReadySidecarDirForTests(null);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(contentAssets).where(eq(contentAssets.sourceEventId, `maker_set_${setId}`)).catch(() => null);
    await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  it("returns cover URLs and the baked JPEG when the switch is off", async () => {
    setFlag(undefined);
    clearReadyCoverIndexForTests();

    const urls = await readyMaskedCoverUrls([setId]);
    expect(urls.get(setId)).toEqual([`/api/sets/${setId}/covers/0`]);

    const listRes = await fetch(`${base}/api/sets?limit=50`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { sets: Array<Record<string, unknown>>; coversDisabled?: boolean };
    const row = list.sets.find((set) => set.id === setId);
    expect(list.coversDisabled).toBeUndefined();
    expect(row?.coverCardUrls).toEqual([`/api/sets/${setId}/covers/0`]);
    expect(row?.shareImageUrl).toBe(shareUrl);

    const detailRes = await fetch(`${base}/api/sets/${setId}`);
    const detail = await detailRes.json() as {
      previewCards: Array<{ imageUrl: string }>;
      shareImageUrl?: string;
      coversDisabled?: boolean;
    };
    expect(detail.coversDisabled).toBeUndefined();
    expect(detail.shareImageUrl).toBe(shareUrl);
    expect(detail.previewCards).toEqual([
      { imageUrl: `/api/sets/${setId}/covers/0`, year: 1989 },
    ]);

    const image = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe(COVER_CACHE);
    expect(image.headers.get("content-type")).toContain("image/jpeg");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(jpeg);
  });

  it("returns no cover URLs and a no-store 404 when the switch is on", async () => {
    for (const value of ["1", "true", "TRUE"]) {
      setFlag(value);
      clearReadyCoverIndexForTests();

      const urls = await readyMaskedCoverUrls([setId]);
      expect(urls.get(setId)).toEqual([]);

      const listRes = await fetch(`${base}/api/sets?limit=50`);
      const list = await listRes.json() as { sets: Array<Record<string, unknown>>; coversDisabled?: boolean };
      const row = list.sets.find((set) => set.id === setId);
      expect(list.coversDisabled).toBe(true);
      expect(row?.coverCardUrls).toEqual([]);
      expect(row?.shareImageUrl).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain("/covers/");
      expect(JSON.stringify(row)).not.toContain(shareUrl);

      const detailRes = await fetch(`${base}/api/sets/${setId}`);
      const detail = await detailRes.json() as {
        previewCards: unknown[];
        shareImageUrl?: string;
        coversDisabled?: boolean;
        cardCount: number;
      };
      expect(detail.coversDisabled).toBe(true);
      expect(detail.previewCards).toEqual([]);
      expect(detail.shareImageUrl).toBeUndefined();
      expect(Number(detail.cardCount)).toBe(5);
      expect(JSON.stringify(detail)).not.toContain("/covers/");

      const image = await fetch(`${base}/api/sets/${setId}/covers/0`);
      expect(image.status).toBe(404);
      const cache = image.headers.get("cache-control") ?? "";
      expect(cache).toContain("no-store");
      expect(image.headers.get("cdn-cache-control")).toBe("no-store");
      expect(image.headers.get("etag")).toBeNull();
      expect(image.headers.get("content-type")).toContain("application/json");
      const body = await image.text();
      expect(body).not.toContain("masked-cover-switch");
      expect(body).not.toContain(readyId);
    }
  });
});
