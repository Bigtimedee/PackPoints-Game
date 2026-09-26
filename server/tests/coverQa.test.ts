/**
 * COVER_QA_TOKEN lets Design review the same covers the public shelf uses.
 * A missing token is 404. SETS_COVERS_DISABLED does not close these routes.
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
import { coverQaHeaderMatches } from "../lib/coverQaAuth";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { warmMaskPlanFilename } from "../masking/maskPlanStore";
import { registerCoverQaRoutes } from "../routes/coverQa";
import { setPinnedCoversForTests } from "../config/pinnedCovers";
import { clearReadyCoverIndexForTests, handlePublicSetCover } from "../services/setCovers";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const TOKEN = "design-qa-token";
const setId = `aea515e2-${randomUUID().slice(9)}`;
const blockedId = randomUUID();
const spareNames = Array.from({ length: 9 }, (_, i) => `QA Cover ${i + 1}`);
const spareIds = spareNames.map(() => randomUUID());
const cardIds = [blockedId, ...spareIds];
const bytes = new Map<string, Buffer>();

let dir = "";
let base = "";
const previousToken = process.env.COVER_QA_TOKEN;
const previousCovers = process.env.SETS_COVERS_DISABLED;

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

function setCoversFlag(value: string | undefined) {
  if (value === undefined) delete process.env.SETS_COVERS_DISABLED;
  else process.env.SETS_COVERS_DISABLED = value;
}

describe("coverQaHeaderMatches", () => {
  it("matches only the configured token", () => {
    setToken(undefined);
    expect(coverQaHeaderMatches(TOKEN)).toBe(false);
    setToken(TOKEN);
    expect(coverQaHeaderMatches(TOKEN)).toBe(true);
    expect(coverQaHeaderMatches("design-qa-token ")).toBe(false);
    expect(coverQaHeaderMatches("nope")).toBe(false);
    expect(coverQaHeaderMatches(undefined)).toBe(false);
    setToken(previousToken);
  });
});

describe("cover QA routes", () => {
  const app = express();
  app.get("/api/sets/:setId/covers/:slot", (req, res) => {
    void handlePublicSetCover(req, res);
  });
  registerCoverQaRoutes(app);
  const server = createServer(app);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-cover-qa-"));
    setMaskReadySidecarDirForTests(dir);
    setToken(undefined);
    setCoversFlag(undefined);

    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Fleer",
      year: 1989,
      setName: `QA Fleer ${setId.slice(0, 8)}`,
      isUserCreated: false,
      isActive: true,
    });

    const rows = [
      {
        id: blockedId,
        player: "Kevin Johnson",
        createdAt: "2020-01-01T00:00:00.000Z",
        number: "7",
        variant: "base",
      },
      ...spareIds.map((id, index) => ({
        id,
        player: spareNames[index],
        createdAt: `2020-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        number: index === 0 ? "12" : null,
        variant: index === 0 ? "All-Star" : null,
      })),
    ];
    for (const row of rows) {
      const body = Buffer.from(`masked-${row.id}`);
      bytes.set(row.id, body);
      await writeFile(path.join(dir, warmOkMarkerFilename(row.id)), "ok\n");
      await writeFile(path.join(dir, `${row.id}_${CURRENT_MASK_VERSION}.jpg`), body);
    }
    await writeFile(path.join(dir, warmMaskPlanFilename(spareIds[0])), JSON.stringify({
      layoutClass: "BOTTOM_PLAQUE",
      regions: [{ xPct: 0, yPct: 70, wPct: 100, hPct: 30, type: "solid" }],
      maskVersion: CURRENT_MASK_VERSION,
    }));
    clearReadyCoverIndexForTests();
    setPinnedCoversForTests(setId, spareIds);

    await db.insert(playableCards).values(rows.map((row) => ({
      id: row.id,
      gameSetId: setId,
      cardhedgeCardId: `cover-qa:${row.id}`,
      player: row.player,
      set: "1989 Fleer",
      number: row.number,
      variant: row.variant,
      description: row.player,
      imageUrl: `https://packpts.com/cards/${row.id}.jpg`,
      category: "basketball",
      isPlayable: true,
      contentVerified: true as boolean | null,
      imageReviewStatus: "unreviewed",
      quarantineStatus: "OK",
      proposedUnplayable: false,
      lastImageCheck: new Date(),
      createdAt: new Date(row.createdAt),
    })));

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setToken(previousToken);
    setCoversFlag(previousCovers);
    setPinnedCoversForTests(setId, null);
    setMaskReadySidecarDirForTests(null);
    clearReadyCoverIndexForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  function candidatesUrl(search = ""): string {
    return `${base}/api/qa/sets/${setId}/cover-candidates${search}`;
  }

  it("returns 404 when the token is unset, missing, wrong, or only a query param", async () => {
    setToken(undefined);
    const unset = await fetch(candidatesUrl(), { headers: { "X-QA-Token": TOKEN } });
    expect(unset.status).toBe(404);
    expect(unset.headers.get("cache-control")).toContain("no-store");
    expect(unset.headers.get("x-robots-tag")).toBe("noindex");

    setToken(TOKEN);
    const missing = await fetch(candidatesUrl());
    expect(missing.status).toBe(404);
    const wrong = await fetch(candidatesUrl(`?token=${TOKEN}`), { headers: { "X-QA-Token": "nope" } });
    expect(wrong.status).toBe(404);
    const queryOnly = await fetch(candidatesUrl(`?token=${TOKEN}&n=12`));
    expect(queryOnly.status).toBe(404);
    expect(queryOnly.headers.get("x-robots-tag")).toBe("noindex");
    expect(queryOnly.headers.get("cache-control")).toContain("no-store");
  });

  it("lists cover candidates in picker order and serves the same masked bytes", async () => {
    setToken(TOKEN);
    setCoversFlag(undefined);
    clearReadyCoverIndexForTests();

    const listRes = await fetch(candidatesUrl("?n=12"), { headers: { "X-QA-Token": TOKEN } });
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("cache-control")).toContain("no-store");
    expect(listRes.headers.get("x-robots-tag")).toBe("noindex");
    const body = await listRes.json() as {
      setId: string;
      maskVersion: string;
      pinnedCount: number;
      validCount: number;
      pins: Array<{ cardId: string; role: string; status: string; reason: string | null; served: boolean }>;
      picker: Array<{ cardId: string; source: string; served: boolean }>;
      candidates: Array<{
        slot: number;
        cardId: string;
        gameSetId: string;
        player: string;
        number: string | null;
        variant: string | null;
        maskVersion: string;
        bandPlacement: string | null;
        baked: boolean;
        imagePath: string;
        source: string;
        served: boolean;
      }>;
    };
    expect(body.setId).toBe(setId);
    expect(body.maskVersion).toBe(CURRENT_MASK_VERSION);
    expect(body.pinnedCount).toBe(9);
    expect(body.validCount).toBe(8);
    expect(body.candidates).toHaveLength(8);
    expect(body.candidates.map((row) => row.cardId)).toEqual(spareIds.slice(0, 8));
    expect(body.candidates.map((row) => row.slot)).toEqual(spareIds.slice(0, 8).map((_, index) => index));
    expect(body.candidates.every((row) => row.source === "pick" && row.served)).toBe(true);
    expect(body.picker.map((row) => row.cardId)).toEqual(spareIds);
    expect(body.picker.every((row) => row.source === "picker")).toBe(true);
    expect(body.picker[8]).toMatchObject({ cardId: spareIds[8], served: false });
    expect(body.pins).toHaveLength(9);
    expect(body.pins[0]).toMatchObject({ cardId: spareIds[0], role: "pick", status: "pick", reason: null, served: true });
    expect(body.pins[8]).toMatchObject({ cardId: spareIds[8], role: "pick", status: "skipped", reason: "over-cap", served: false });
    expect(body.candidates.some((row) => row.cardId === blockedId)).toBe(false);
    expect(JSON.stringify(body)).not.toContain("Kevin Johnson");
    expect(body.candidates[0]).toMatchObject({
      slot: 0,
      cardId: spareIds[0],
      gameSetId: setId,
      player: "QA Cover 1",
      number: "12",
      variant: "All-Star",
      maskVersion: CURRENT_MASK_VERSION,
      bandPlacement: "BOTTOM_PLAQUE",
      baked: true,
      imagePath: `/api/qa/cover-image/${spareIds[0]}`,
    });

    for (let slot = 0; slot < 8; slot += 1) {
      const pub = await fetch(`${base}/api/sets/${setId}/covers/${slot}`);
      expect(pub.status).toBe(200);
      expect(pub.headers.get("x-card-id")).toBe(spareIds[slot]);
      expect(pub.headers.get("x-mask-version")).toBe(CURRENT_MASK_VERSION);
      if (slot === 0) {
        const qa = await fetch(`${base}${body.candidates[0].imagePath}`, { headers: { "X-QA-Token": TOKEN } });
        expect(qa.status).toBe(200);
        expect(qa.headers.get("x-card-id")).toBe(spareIds[0]);
        expect(qa.headers.get("x-mask-version")).toBe(CURRENT_MASK_VERSION);
        expect(qa.headers.get("cache-control")).toContain("no-store");
        expect(qa.headers.get("x-robots-tag")).toBe("noindex");
        expect(qa.headers.get("content-type")).toContain("image/jpeg");
        const qaBytes = Buffer.from(await qa.arrayBuffer());
        const pubBytes = Buffer.from(await pub.arrayBuffer());
        expect(qaBytes).toEqual(pubBytes);
        expect(qaBytes).toEqual(bytes.get(spareIds[0]));
        expect(qaBytes.toString()).not.toContain("packpts.com/cards");
      } else {
        await pub.arrayBuffer();
      }
    }

    const blocked = await fetch(`${base}/api/qa/cover-image/${blockedId}`, { headers: { "X-QA-Token": TOKEN } });
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    expect(blocked.headers.get("x-card-id")).toBeNull();
    expect(await blocked.text()).not.toContain("masked-");
  });

  it("still serves QA covers when the public switch is on", async () => {
    setToken(TOKEN);
    setCoversFlag("true");
    clearReadyCoverIndexForTests();
    const pub = await fetch(`${base}/api/sets/${setId}/covers/0`);
    expect(pub.status).toBe(404);
    const qa = await fetch(`${base}/api/qa/cover-image/${spareIds[0]}`, { headers: { "X-QA-Token": TOKEN } });
    expect(qa.status).toBe(200);
    expect(Buffer.from(await qa.arrayBuffer())).toEqual(bytes.get(spareIds[0]));
    const list = await fetch(candidatesUrl(), { headers: { "X-QA-Token": TOKEN } });
    const body = await list.json() as { candidates: Array<{ cardId: string }> };
    expect(body.candidates.slice(0, 8).map((row) => row.cardId)).toEqual(spareIds.slice(0, 8));
    setCoversFlag(undefined);
  });
});
