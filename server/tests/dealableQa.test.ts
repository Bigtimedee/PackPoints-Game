/**
 * Design sweeps every dealable card, not only the 24 cover candidates.
 * The page is eligibleDealFilter. A non-dealable card never gets a scan.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { setMaskReadySidecarDirForTests, writeMaskFailureSidecar } from "../masking/maskReadySidecar";
import { warmMaskPlanFilename } from "../masking/maskPlanStore";
import { MaskBakeTimeoutError, resetMaskBakeForTests, setMaskPathLoaderForTests } from "../masking/maskingService";
import { registerCoverQaRoutes } from "../routes/coverQa";
import { registerDealableQaRoutes } from "../routes/dealableQa";
import { eligibleDealFilter } from "../services/playableSetEligibility";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";

const TOKEN = "design-qa-token";
const setId = `aea515e2-${randomUUID().slice(9)}`;
const hoopId = `229f0379-${randomUUID().slice(9)}`;
const inactiveId = randomUUID();
const userSetId = randomUUID();

const bakedId = randomUUID();
const tieLowId = "00000000-0000-4000-8000-000000000001";
const tieHighId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const coldId = randomUUID();
const timeoutId = randomUUID();
const badNameId = randomUUID();
const nullNumberId = randomUUID();
const blockedNameId = randomUUID();
const blockedNumberId = randomUUID();
const surnameId = randomUUID();
const unplayableId = randomUUID();
const rejectedId = randomUUID();
const unverifiedId = randomUUID();
const refusedSidecarId = randomUUID();
const hoopOkId = randomUUID();
const hoopBlockedId = randomUUID();
const inactiveCardId = randomUUID();

const dealableIds = [bakedId, tieLowId, tieHighId, coldId, timeoutId, badNameId, nullNumberId];
const blockedIds = [blockedNameId, blockedNumberId, surnameId, unplayableId, rejectedId, unverifiedId, refusedSidecarId];
const allCardIds = [...dealableIds, ...blockedIds, hoopOkId, hoopBlockedId, inactiveCardId];

const RAW_HOST = "https://packpts.example/raw";
const bytes = new Map<string, Buffer>();
const bakeCalls: string[] = [];

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

function card(opts: {
  id: string;
  gameSetId: string;
  player: string;
  number?: string | null;
  variant?: string | null;
  isPlayable?: boolean;
  blockedReason?: string | null;
  contentVerified?: boolean | null;
  imageReviewStatus?: string;
}) {
  return {
    id: opts.id,
    gameSetId: opts.gameSetId,
    cardhedgeCardId: `dealable-qa:${opts.id}`,
    player: opts.player,
    set: "QA Dealable",
    number: opts.number ?? null,
    variant: opts.variant ?? null,
    description: opts.player,
    imageUrl: `${RAW_HOST}/${opts.id}.jpg`,
    category: "basketball",
    isPlayable: opts.isPlayable ?? true,
    contentVerified: (opts.contentVerified === undefined ? true : opts.contentVerified) as boolean | null,
    imageReviewStatus: opts.imageReviewStatus ?? "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    blockedReason: opts.blockedReason ?? null,
    lastImageCheck: new Date(),
  };
}

describe("dealable QA routes", () => {
  const app = express();
  registerDealableQaRoutes(app);
  registerCoverQaRoutes(app);
  const server = createServer(app);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-dealable-qa-"));
    setMaskReadySidecarDirForTests(dir);
    resetMaskBakeForTests();
    setMaskPathLoaderForTests(async (cardId) => {
      bakeCalls.push(cardId);
      if (cardId === timeoutId) throw new MaskBakeTimeoutError("bake", cardId, 25);
      if (cardId === badNameId) return "not-a-mask.jpg";
      if (cardId === coldId) {
        const body = Buffer.from(`masked-cold-${cardId}`);
        bytes.set(cardId, body);
        await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), body);
        await writeFile(path.join(dir, warmOkMarkerFilename(cardId)), "ok\n");
        return `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
      }
      return null;
    });
    setToken(TOKEN);
    setCoversFlag(undefined);

    await db.insert(gameSets).values([
      {
        id: setId,
        sport: "basketball",
        brand: "Fleer",
        year: 1989,
        setName: `QA Dealable ${setId.slice(0, 8)}`,
        isUserCreated: false,
        isActive: true,
      },
      {
        id: hoopId,
        sport: "basketball",
        brand: "Topps",
        year: 2024,
        setName: `QA Hoop ${hoopId.slice(0, 8)}`,
        isUserCreated: false,
        isActive: true,
      },
      {
        id: inactiveId,
        sport: "basketball",
        brand: "Fleer",
        year: 1988,
        setName: `QA Inactive ${inactiveId.slice(0, 8)}`,
        isUserCreated: false,
        isActive: false,
      },
      {
        id: userSetId,
        sport: "basketball",
        brand: "Fleer",
        year: 1988,
        setName: `QA User ${userSetId.slice(0, 8)}`,
        isUserCreated: true,
        isActive: true,
      },
    ]);

    const bakedBody = Buffer.from(`masked-ready-${bakedId}`);
    bytes.set(bakedId, bakedBody);
    await writeFile(path.join(dir, warmOkMarkerFilename(bakedId)), "ok\n");
    await writeFile(path.join(dir, `${bakedId}_${CURRENT_MASK_VERSION}.jpg`), bakedBody);
    await writeFile(path.join(dir, warmMaskPlanFilename(bakedId)), JSON.stringify({
      layoutClass: "TOP_PLATE",
      regions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 20, type: "solid" }],
      maskVersion: CURRENT_MASK_VERSION,
    }));
    const blockedBody = Buffer.from(`masked-secret-${blockedNameId}`);
    await writeFile(path.join(dir, warmOkMarkerFilename(blockedNameId)), "ok\n");
    await writeFile(path.join(dir, `${blockedNameId}_${CURRENT_MASK_VERSION}.jpg`), blockedBody);
    const refusedBody = Buffer.from(`masked-refused-${refusedSidecarId}`);
    await writeFile(path.join(dir, warmOkMarkerFilename(refusedSidecarId)), "ok\n");
    await writeFile(path.join(dir, `${refusedSidecarId}_${CURRENT_MASK_VERSION}.jpg`), refusedBody);
    writeMaskFailureSidecar(refusedSidecarId, "name_plate_unresolved", dir);

    await db.insert(playableCards).values([
      card({ id: bakedId, gameSetId: setId, player: "QA Deal D", number: "12", variant: "base" }),
      card({ id: tieLowId, gameSetId: setId, player: "QA Deal A", number: "13", variant: "All-Star" }),
      card({ id: tieHighId, gameSetId: setId, player: "QA Deal B", number: "13" }),
      card({ id: coldId, gameSetId: setId, player: "QA Deal C", number: "30" }),
      card({ id: timeoutId, gameSetId: setId, player: "QA Deal Timeout", number: "40" }),
      card({ id: badNameId, gameSetId: setId, player: "QA Deal Bad", number: "14" }),
      card({ id: nullNumberId, gameSetId: setId, player: "QA Deal Null" }),
      card({ id: blockedNameId, gameSetId: setId, player: "Kevin Johnson", number: "50" }),
      card({ id: blockedNumberId, gameSetId: setId, player: "Combo Person", number: "163" }),
      card({
        id: surnameId,
        gameSetId: setId,
        player: "Surname Leak",
        number: "4",
        blockedReason: "name_visible_outside_mask",
      }),
      card({ id: unplayableId, gameSetId: setId, player: "Benched Player", number: "5", isPlayable: false }),
      card({
        id: rejectedId,
        gameSetId: setId,
        player: "Rejected Scan",
        number: "6",
        imageReviewStatus: "rejected",
      }),
      card({ id: unverifiedId, gameSetId: setId, player: "Unverified Scan", number: "7", contentVerified: false }),
      card({ id: refusedSidecarId, gameSetId: setId, player: "Refused Plate", number: "15" }),
      card({ id: hoopOkId, gameSetId: hoopId, player: "Jalen Example", number: "8" }),
      card({ id: hoopBlockedId, gameSetId: hoopId, player: "Giannis Antetokounmpo", number: "34" }),
      card({ id: inactiveCardId, gameSetId: inactiveId, player: "Inactive Only", number: "1" }),
    ]);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setToken(previousToken);
    setCoversFlag(previousCovers);
    resetMaskBakeForTests();
    setMaskReadySidecarDirForTests(null);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(playableCards).where(inArray(playableCards.id, allCardIds)).catch(() => null);
    await db.delete(gameSets).where(inArray(gameSets.id, [setId, hoopId, inactiveId, userSetId])).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  function headers(token = TOKEN): HeadersInit {
    return { "X-QA-Token": token };
  }

  it("keeps the deal filter in one place", async () => {
    const src = await readFile(new URL("../services/dealableQa.ts", import.meta.url), "utf8");
    expect(src).toContain('eligibleDealFilter("playable_cards")');
    expect(src).not.toContain("currentMaskRefusalIds");
    expect(src).not.toContain("maskRefusalStillClearSql");
    expect(src).toContain("getMaskedImagePath");
    expect(src).not.toContain("sendUnmaskedCard");
    expect(src).not.toContain("playerIncludes");
    expect(src).not.toContain("Charles Haley");
    expect(src).not.toContain("Antetokounmpo");
    const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
    const dealableAt = routes.indexOf("registerDealableQaRoutes(app)");
    const coverAt = routes.indexOf("registerCoverQaRoutes(app)");
    expect(dealableAt).toBeGreaterThan(-1);
    expect(dealableAt).toBeLessThan(coverAt);
  });

  it("returns 404 when the token is unset, missing, wrong, or only a query param", async () => {
    setToken(undefined);
    const unset = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards`, { headers: headers() });
    expect(unset.status).toBe(404);
    expect(unset.headers.get("cache-control")).toContain("no-store");
    expect(unset.headers.get("x-robots-tag")).toBe("noindex");
    const unsetSets = await fetch(`${base}/api/qa/sets`, { headers: headers() });
    expect(unsetSets.status).toBe(404);
    const unsetImage = await fetch(`${base}/api/qa/cover-image/${bakedId}`, { headers: headers() });
    expect(unsetImage.status).toBe(404);

    setToken(TOKEN);
    const missing = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards`);
    expect(missing.status).toBe(404);
    const wrong = await fetch(`${base}/api/qa/sets?token=${TOKEN}`, { headers: headers("nope") });
    expect(wrong.status).toBe(404);
    const queryOnly = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?token=${TOKEN}&limit=2`);
    expect(queryOnly.status).toBe(404);
    expect(queryOnly.headers.get("x-robots-tag")).toBe("noindex");
    expect(await queryOnly.text()).not.toContain("QA Deal");
  });

  it("lists the eligibleDealFilter pool in a stable page order and hides blocked cards", async () => {
    setToken(TOKEN);
    const expected = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(and(eq(playableCards.gameSetId, setId), eligibleDealFilter("playable_cards")))
      .orderBy(asc(playableCards.number), asc(playableCards.id));
    const expectedIds = expected.map((row) => row.id);
    expect(expectedIds).toEqual([bakedId, tieLowId, tieHighId, badNameId, coldId, timeoutId, nullNumberId]);
    for (const id of blockedIds) expect(expectedIds).not.toContain(id);

    const first = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?offset=0&limit=2`, { headers: headers() });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(first.headers.get("x-robots-tag")).toBe("noindex");
    const page = await first.json() as {
      setId: string;
      setName: string;
      maskVersion: string;
      total: number;
      offset: number;
      limit: number;
      cards: Array<{
        cardId: string;
        player: string | null;
        number: string | null;
        variant: string | null;
        bandPlacement: string | null;
        baked: boolean;
      }>;
    };
    expect(page.setId).toBe(setId);
    expect(page.setName).toContain("QA Dealable");
    expect(page.maskVersion).toBe(CURRENT_MASK_VERSION);
    expect(page.total).toBe(expectedIds.length);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(2);
    expect(page.cards.map((row) => row.cardId)).toEqual(expectedIds.slice(0, 2));
    expect(page.cards[0]).toMatchObject({
      cardId: bakedId,
      player: "QA Deal D",
      number: "12",
      variant: "base",
      bandPlacement: "TOP_PLATE",
      baked: true,
    });
    expect(page.cards[1]).toMatchObject({
      cardId: tieLowId,
      player: "QA Deal A",
      number: "13",
      variant: "All-Star",
      bandPlacement: null,
      baked: false,
    });
    expect(JSON.stringify(page)).not.toContain("Kevin Johnson");
    expect(JSON.stringify(page)).not.toContain("Antetokounmpo");
    expect(JSON.stringify(page)).not.toContain("Surname Leak");

    const again = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?offset=0&limit=2`, { headers: headers() });
    expect(await again.json()).toEqual(page);

    const ids: string[] = [];
    for (let offset = 0; offset < expectedIds.length; offset += 2) {
      const res = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?offset=${offset}&limit=2`, { headers: headers() });
      const body = await res.json() as { cards: Array<{ cardId: string }>; total: number };
      expect(body.total).toBe(expectedIds.length);
      ids.push(...body.cards.map((row) => row.cardId));
    }
    expect(ids).toEqual(expectedIds);

    const capped = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?limit=900`, { headers: headers() });
    const cappedBody = await capped.json() as { limit: number; offset: number; cards: unknown[] };
    expect(cappedBody.limit).toBe(500);
    expect(cappedBody.offset).toBe(0);
    expect(cappedBody.cards).toHaveLength(expectedIds.length);

    const defaults = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?limit=0&offset=-4`, { headers: headers() });
    const defaultBody = await defaults.json() as { limit: number; offset: number };
    expect(defaultBody.limit).toBe(200);
    expect(defaultBody.offset).toBe(0);

    const past = await fetch(`${base}/api/qa/sets/${setId}/dealable-cards?offset=50&limit=10`, { headers: headers() });
    const pastBody = await past.json() as { total: number; cards: unknown[]; offset: number; limit: number };
    expect(pastBody.total).toBe(expectedIds.length);
    expect(pastBody.offset).toBe(50);
    expect(pastBody.limit).toBe(10);
    expect(pastBody.cards).toEqual([]);

    const hoop = await fetch(`${base}/api/qa/sets/${hoopId}/dealable-cards`, { headers: headers() });
    const hoopBody = await hoop.json() as { total: number; cards: Array<{ cardId: string }> };
    expect(hoopBody.total).toBe(1);
    expect(hoopBody.cards.map((row) => row.cardId)).toEqual([hoopOkId]);

    const sets = await fetch(`${base}/api/qa/sets`, { headers: headers() });
    expect(sets.status).toBe(200);
    const setsBody = await sets.json() as {
      maskVersion: string;
      sets: Array<{ setId: string; setName: string; total: number }>;
    };
    expect(setsBody.maskVersion).toBe(CURRENT_MASK_VERSION);
    const listed = setsBody.sets.find((row) => row.setId === setId);
    const hoopListed = setsBody.sets.find((row) => row.setId === hoopId);
    expect(listed).toMatchObject({ setId, total: expectedIds.length });
    expect(hoopListed).toMatchObject({ setId: hoopId, total: 1 });
    expect(setsBody.sets.some((row) => row.setId === inactiveId || row.setId === userSetId)).toBe(false);
    const names = setsBody.sets.map((row) => `${row.setName}\0${row.setId}`);
    expect(names).toEqual([...names].sort());

    expect((await fetch(`${base}/api/qa/sets/${inactiveId}/dealable-cards`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${base}/api/qa/sets/${userSetId}/dealable-cards`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${base}/api/qa/sets/${randomUUID()}/dealable-cards`, { headers: headers() })).status).toBe(404);
  });

  it("serves a masked jpeg for a dealable card and refuses every other card", async () => {
    setToken(TOKEN);
    setCoversFlag("true");
    bakeCalls.length = 0;

    const blocked = await fetch(`${base}/api/qa/cover-image/${blockedNameId}`, { headers: headers() });
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get("content-type")).toContain("application/json");
    expect(blocked.headers.get("x-card-id")).toBeNull();
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    const blockedText = await blocked.text();
    expect(blockedText).not.toContain("masked-secret");
    expect(blockedText).not.toContain(RAW_HOST);

    for (const id of [surnameId, unplayableId, rejectedId, unverifiedId, blockedNumberId, hoopBlockedId, refusedSidecarId]) {
      const res = await fetch(`${base}/api/qa/cover-image/${id}`, { headers: headers() });
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(RAW_HOST);
      expect(body).not.toContain("masked-refused");
    }
    expect(bakeCalls).toEqual([]);

    const ready = await fetch(`${base}/api/qa/cover-image/${bakedId}`, { headers: headers() });
    expect(ready.status).toBe(200);
    expect(ready.headers.get("content-type")).toContain("image/jpeg");
    expect(ready.headers.get("x-card-id")).toBe(bakedId);
    expect(ready.headers.get("x-mask-version")).toBe(CURRENT_MASK_VERSION);
    expect(ready.headers.get("x-robots-tag")).toBe("noindex");
    expect(ready.headers.get("cache-control")).toContain("no-store");
    const readyBytes = Buffer.from(await ready.arrayBuffer());
    expect(readyBytes).toEqual(bytes.get(bakedId));
    expect(readyBytes.toString()).not.toContain(RAW_HOST);
    expect(bakeCalls).toEqual([]);

    const cold = await fetch(`${base}/api/qa/cover-image/${coldId}`, { headers: headers() });
    expect(cold.status).toBe(200);
    expect(Buffer.from(await cold.arrayBuffer())).toEqual(bytes.get(coldId));
    expect(bakeCalls).toEqual([coldId]);

    const timed = await fetch(`${base}/api/qa/cover-image/${timeoutId}`, { headers: headers() });
    expect(timed.status).toBe(503);
    expect(timed.headers.get("retry-after")).toBe("5");
    expect(timed.headers.get("content-type")).toContain("application/json");
    const timedText = await timed.text();
    expect(timedText).not.toContain(RAW_HOST);
    expect(timedText).not.toContain("masked-");

    const bad = await fetch(`${base}/api/qa/cover-image/${badNameId}`, { headers: headers() });
    expect(bad.status).toBe(404);
    expect(await bad.text()).not.toContain(RAW_HOST);
    expect(bakeCalls).toEqual([coldId, timeoutId, badNameId]);

    const missing = await fetch(`${base}/api/qa/cover-image/${randomUUID()}`, { headers: headers() });
    expect(missing.status).toBe(404);
    setCoversFlag(undefined);
  });
});
