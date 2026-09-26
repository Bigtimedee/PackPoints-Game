/**
 * Public /sets covers are baked masked JPEGs.
 * Raw photo URLs, player names, and card ids stay out of the JSON.
 * A missing sidecar is a placeholder, not a cold bake.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { contentAssets, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { handlePublicSetDetail, handlePublicSetsIndex } from "../services/publicSets";
import { clearReadyCoverIndexForTests, handlePublicSetCover } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const stamp = randomUUID().slice(0, 8);
const setId = randomUUID();
const setName = `1987 Topps Football ${stamp}`;

const unplayableId = randomUUID();
const montanaId = randomUUID();
const paytonId = randomUUID();
const cunninghamId = randomUUID();
const kellyId = randomUUID();
const benchId = randomUUID();
const cardIds = [unplayableId, montanaId, paytonId, cunninghamId, kellyId, benchId];

const names = ["JOE MONTANA", "WALTER PAYTON", "RANDALL CUNNINGHAM", "JIM KELLY"];
const bubble = (player: string) =>
  `https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/${player}/resize`;

let dir = "";
const montanaBytes = Buffer.from("masked-montana-v4.4");
const cunninghamBytes = Buffer.from("masked-cunningham-v4.4");
const unplayableBytes = Buffer.from("masked-unplayable-v4.4");

function card(id: string, player: string, createdAt: string, isPlayable = true) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `coverleak:${id}`,
    player,
    set: setName,
    description: `${setName} ${player}`,
    imageUrl: bubble(player.replace(/ /g, "_")),
    category: "football",
    isPlayable,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
    createdAt: new Date(createdAt),
  };
}

async function writeReady(cardId: string, bytes: Buffer) {
  await writeFile(path.join(dir, warmOkMarkerFilename(cardId)), "ok\n");
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), bytes);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "packpts-set-covers-"));
  setMaskReadySidecarDirForTests(dir);
  await writeReady(unplayableId, unplayableBytes);
  await writeReady(montanaId, montanaBytes);
  await writeReady(cunninghamId, cunninghamBytes);
  clearReadyCoverIndexForTests();

  await db.insert(gameSets).values({
    id: setId,
    sport: "football",
    brand: "Topps",
    year: 1987,
    setName,
    isUserCreated: false,
    isActive: true,
  });
  await db.insert(playableCards).values([
    card(unplayableId, "CHECKLIST CARD", "2020-01-01T00:00:00.000Z", false),
    card(montanaId, "JOE MONTANA", "2020-01-02T00:00:00.000Z"),
    card(paytonId, "WALTER PAYTON", "2020-01-03T00:00:00.000Z"),
    card(cunninghamId, "RANDALL CUNNINGHAM", "2020-01-04T00:00:00.000Z"),
    card(kellyId, "JIM KELLY", "2020-01-05T00:00:00.000Z"),
    card(benchId, "BENCH PLAYER", "2020-01-06T00:00:00.000Z"),
  ]);
  await db.insert(contentAssets).values({
    assetType: "MAKER_SHARE_CARD",
    sourceEventId: `maker_set_${setId}`,
    metadata: { imageUrl: bubble("JOE_MONTANA") },
    imagePath: bubble("JOE_MONTANA"),
  });
});

afterAll(async () => {
  setMaskReadySidecarDirForTests(null);
  clearReadyCoverIndexForTests();
  await db.delete(contentAssets).where(eq(contentAssets.sourceEventId, `maker_set_${setId}`)).catch(() => null);
  await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
  await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

function assertNoAnswerLeak(body: string) {
  for (const name of names) expect(body).not.toContain(name);
  expect(body).not.toContain("BENCH PLAYER");
  expect(body).not.toContain("CHECKLIST CARD");
  expect(body).not.toContain("bubble.io");
  expect(body).not.toContain("/api/images/card");
  expect(body).not.toContain("/api/cards/");
  expect(body).not.toContain("/api/play/r/");
  expect(body).not.toContain("coverleak:");
  for (const id of cardIds) expect(body).not.toContain(id);
}

describe("GET /api/sets cover leak", () => {
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
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns masked cover URLs and no raw scans, names, or card ids", async () => {
    const listRes = await fetch(`${base}/api/sets?limit=50`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { sets: Array<Record<string, unknown>> };
    const row = list.sets.find((set) => set.id === setId);
    expect(row).toBeTruthy();
    expect(row?.coverCardUrls).toEqual([
      `/api/sets/${setId}/covers/0`,
      `/api/sets/${setId}/covers/1`,
    ]);
    expect(row?.shareImageUrl).toBeUndefined();
    assertNoAnswerLeak(JSON.stringify(row));

    const detailRes = await fetch(`${base}/api/sets/${setId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as {
      previewCards: Array<{ imageUrl: string; year: number | null }>;
      shareImageUrl?: string;
      cardCount: number;
    };
    expect(Number(detail.cardCount)).toBe(5);
    expect(detail.shareImageUrl).toBeUndefined();
    expect(detail.previewCards).toEqual([
      { imageUrl: `/api/sets/${setId}/covers/0`, year: 1987 },
      { imageUrl: `/api/sets/${setId}/covers/1`, year: 1987 },
    ]);
    assertNoAnswerLeak(JSON.stringify(detail));
  });

  it("serves the baked masked JPEG for a ready slot and does not bake a cold one", async () => {
    const before = readdirSync(dir).sort();
    const started = Date.now();

    const first = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("image/jpeg");
    expect(first.headers.get("x-mask-version")).toBe(CURRENT_MASK_VERSION);
    expect(first.headers.get("x-card-id")).toBe(montanaId);
    expect(Buffer.from(await first.arrayBuffer())).toEqual(montanaBytes);
    expect(first.url).not.toContain(montanaId);

    const second = await fetch(`${base}/api/sets/${setId}/covers/1`);
    expect(second.status).toBe(200);
    expect(Buffer.from(await second.arrayBuffer())).toEqual(cunninghamBytes);
    expect(second.headers.get("x-card-id")).toBe(cunninghamId);

    const missing = await fetch(`${base}/api/sets/${setId}/covers/2`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-card-id")).toBeNull();
    expect(await missing.text()).not.toContain(paytonId);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(before.some((name) => name.startsWith(paytonId))).toBe(false);
    expect(before.some((name) => name.startsWith(kellyId))).toBe(false);
  });
});
