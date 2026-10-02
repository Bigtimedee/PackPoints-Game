/**
 * A cached /api/play/m/ JPEG is not sent when the card or set is gone,
 * the set is held, or the card was refused. Boot purge drops orphan files.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import {
  cardImageMaskCache,
  gameSets,
  maskBakeRefusals,
  playableCards,
} from "@shared/schema";
import { db } from "../db";
import { ensureHeldSets, isHeldSet } from "../config/heldSets";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { logMaskCachePurge } from "../masking/maskCachePurge";
import { writeMaskFailureSidecar } from "../masking/maskReadySidecar";
import { setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { registerDealableQaRoutes } from "../routes/dealableQa";
import { handleMaskedToken } from "../services/playImageHttp";
import { maskTokenMatches, maskedPlayPath } from "../services/playImageToken";
import { sendMaskedCard } from "../services/playImageSend";
import {
  invalidatePublicMaskSetCache,
  PUBLIC_MASK_CACHE_CONTROL,
  publicMaskDenyReason,
  resetPublicMaskSetCacheForTests,
} from "../services/publicMaskGate";

const DELETED_HOOPS = "c2ce5d11-bc9b-43ea-888e-609fdcec76e0";
const stamp = randomUUID().slice(0, 8);
const TOKEN = `mask-gate-${stamp}`;
const previousExtra = process.env.CLEARED_SET_IDS_EXTRA;
const previousToken = process.env.COVER_QA_TOKEN;

const clearedSetId = randomUUID();
const heldSetId = randomUUID();
const goneSetId = randomUUID();
const clearedCardId = randomUUID();
const refusedCardId = randomUUID();
const heldCardId = randomUUID();
const goneCardId = randomUUID();
const planted = [clearedCardId, refusedCardId, heldCardId, goneCardId];

function jpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(20);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

function card(id: string, setId: string, player: string) {
  return {
    id,
    gameSetId: setId,
    cardhedgeCardId: `gate:${stamp}:${id}`,
    player,
    set: "1990 Hoops Basketball",
    description: player,
    imageUrl: `https://packpts.com/cards/${id}.jpg`,
    category: "basketball",
    number: "12",
    isPlayable: true,
    contentVerified: true as boolean | null,
    imageReviewStatus: "unreviewed",
    quarantineStatus: "OK",
    proposedUnplayable: false,
    lastImageCheck: new Date(),
  };
}

async function plantJpeg(cardId: string) {
  await writeFile(path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), jpeg(200, 300));
  await writeFile(path.join(MASKED_CARDS_DIR, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
}

const app = express();
app.get("/api/play/m/:scope/:sessionId/:index/:token", (req, res) => {
  void handleMaskedToken(req, res, {
    authorizeCardId: async () => "denied",
    resolveReveal: async () => ({ ok: false, reason: "bad" }),
    resolveMask: async (scope, sessionId, index, token) => {
      for (const id of planted) {
        if (maskTokenMatches(scope, sessionId, index, id, token)) return id;
      }
      return null;
    },
    sendUnmasked: async (res) => {
      res.status(500).end();
    },
    sendMasked: sendMaskedCard,
  });
});
registerDealableQaRoutes(app);
const server = createServer(app);
let base = "";

beforeAll(async () => {
  process.env.CLEARED_SET_IDS_EXTRA = clearedSetId;
  process.env.COVER_QA_TOKEN = TOKEN;
  resetPublicMaskSetCacheForTests();
  await mkdir(MASKED_CARDS_DIR, { recursive: true });
  await db.insert(gameSets).values([
    {
      id: clearedSetId,
      sport: "basketball",
      brand: "Hoops",
      year: 1990,
      setName: "1990 Hoops Basketball",
      isUserCreated: false,
      isActive: true,
      cardsImportedCount: 8,
    },
    {
      id: heldSetId,
      sport: "basketball",
      brand: "Hoops",
      year: 1990,
      setName: "1990 Hoops Basketball",
      isUserCreated: false,
      isActive: true,
      cardsImportedCount: 8,
    },
    {
      id: goneSetId,
      sport: "basketball",
      brand: "Hoops",
      year: 1990,
      setName: "1990 Hoops Basketball",
      isUserCreated: false,
      isActive: true,
      cardsImportedCount: 8,
    },
  ]);
  await db.insert(playableCards).values([
    card(clearedCardId, clearedSetId, "Quiet Player"),
    card(refusedCardId, clearedSetId, "Refused Player"),
    card(heldCardId, heldSetId, "Scott Hastings"),
    card(goneCardId, goneSetId, "Scott Hastings"),
  ]);
  await db.insert(cardImageMaskCache).values([
    {
      cardId: goneCardId,
      rawImageUrl: `https://packpts.com/cards/${goneCardId}.jpg`,
      maskedImagePath: `${goneCardId}_${CURRENT_MASK_VERSION}.jpg`,
      maskVersion: CURRENT_MASK_VERSION,
    },
    {
      cardId: heldCardId,
      rawImageUrl: `https://packpts.com/cards/${heldCardId}.jpg`,
      maskedImagePath: `${heldCardId}_${CURRENT_MASK_VERSION}.jpg`,
      maskVersion: CURRENT_MASK_VERSION,
    },
  ]);
  for (const id of planted) await plantJpeg(id);
  writeMaskFailureSidecar(refusedCardId, "mask_name_uncovered");
  await db.delete(playableCards).where(eq(playableCards.id, goneCardId));
  await db.delete(gameSets).where(eq(gameSets.id, goneSetId));
  await ensureHeldSets();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  resetPublicMaskSetCacheForTests();
  setMaskReadySidecarDirForTests(null);
  if (previousExtra === undefined) delete process.env.CLEARED_SET_IDS_EXTRA;
  else process.env.CLEARED_SET_IDS_EXTRA = previousExtra;
  if (previousToken === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = previousToken;
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  await db.delete(cardImageMaskCache).where(inArray(cardImageMaskCache.cardId, planted)).catch(() => null);
  await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, planted)).catch(() => null);
  await db.delete(playableCards).where(inArray(playableCards.id, [clearedCardId, refusedCardId, heldCardId])).catch(() => null);
  await db.delete(gameSets).where(inArray(gameSets.id, [clearedSetId, heldSetId, goneSetId])).catch(() => null);
  for (const id of planted) {
    for (const name of [
      `${id}_${CURRENT_MASK_VERSION}.jpg`,
      `${id}_${CURRENT_MASK_VERSION}.ok`,
      `${id}_${CURRENT_MASK_VERSION}.fail`,
      `${id}_${CURRENT_MASK_VERSION}.orient.json`,
    ]) {
      await rm(path.join(MASKED_CARDS_DIR, name), { force: true }).catch(() => null);
    }
  }
});

function playUrl(cardId: string): string {
  return `${base}${maskedPlayPath({ scope: "solo", sessionId: `sess-${stamp}`, index: 0, cardId })}`;
}

describe("public mask cache gate", () => {
  it("returns 404 for a cache hit when the set was deleted", async () => {
    expect(existsSync(path.join(MASKED_CARDS_DIR, `${goneCardId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
    const res = await fetch(playUrl(goneCardId));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control") || "").toContain("no-store");
    expect(res.headers.get("content-type") || "").not.toContain("image/jpeg");
    expect(res.headers.get("x-mask-cache")).toBeNull();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 2).toString("hex")).not.toBe("ffd8");
    expect(existsSync(path.join(MASKED_CARDS_DIR, `${goneCardId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
  });

  it("returns 404 for a cache hit when the set is held, and QA can still view it", async () => {
    expect(isHeldSet(heldSetId)).toBe(true);
    const blocked = await fetch(playUrl(heldCardId));
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get("cache-control") || "").toContain("no-store");
    expect(Buffer.from(await blocked.arrayBuffer()).subarray(0, 2).toString("hex")).not.toBe("ffd8");

    const cached = await publicMaskDenyReason(heldCardId);
    expect(cached).toBe("held");
    process.env.CLEARED_SET_IDS_EXTRA = `${clearedSetId},${heldSetId}`;
    expect(await publicMaskDenyReason(heldCardId)).toBe("held");
    invalidatePublicMaskSetCache(heldSetId);
    expect(await publicMaskDenyReason(heldCardId)).toBeNull();
    process.env.CLEARED_SET_IDS_EXTRA = clearedSetId;
    invalidatePublicMaskSetCache(heldSetId);
    await ensureHeldSets();
    expect(isHeldSet(heldSetId)).toBe(true);

    const qa = await fetch(`${base}/api/qa/cover-image/${heldCardId}`, {
      headers: { "X-QA-Token": TOKEN },
    });
    expect(qa.status).toBe(200);
    expect(qa.headers.get("content-type") || "").toContain("image/jpeg");
    expect(Buffer.from(await qa.arrayBuffer()).subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("returns 404 for a cache hit when the card is refused", async () => {
    const res = await fetch(playUrl(refusedCardId));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control") || "").toContain("no-store");
    expect(res.headers.get("x-mask-cache")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString("hex")).not.toBe("ffd8");
    expect(existsSync(path.join(MASKED_CARDS_DIR, `${refusedCardId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
  });

  it("serves a cleared card from the warm file with a short private cache", async () => {
    const res = await fetch(playUrl(clearedCardId));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-mask-cache")).toBe("hit");
    expect(res.headers.get("cache-control")).toBe(PUBLIC_MASK_CACHE_CONTROL);
    expect(res.headers.get("cache-control")).not.toContain("86400");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("lets an admin review route skip the hold", async () => {
    const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
    expect(routes).toContain("const allowHeld = await callerIsAdmin(req)");
    expect(routes).toContain("rejectPublicMask(req, res, req.params.cardId, { allowHeld })");
    expect(await publicMaskDenyReason(heldCardId, { allowHeld: true })).toBeNull();
  });
});

describe("mask cache purge", () => {
  it("removes orphan files and cache rows and logs the deleted set", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-purge-"));
    setMaskReadySidecarDirForTests(dir);
    const orphanId = randomUUID();
    const keeperSet = randomUUID();
    const keeperCard = randomUUID();
    const orphanJpeg = path.join(dir, `${orphanId}_${CURRENT_MASK_VERSION}.jpg`);
    const keeperJpeg = path.join(dir, `${keeperCard}_${CURRENT_MASK_VERSION}.jpg`);
    try {
      await db.insert(gameSets).values({
        id: keeperSet,
        sport: "basketball",
        brand: "Fleer",
        year: 1989,
        setName: `Purge Keeper ${stamp}`,
        isUserCreated: false,
        isActive: true,
      });
      await db.insert(playableCards).values(card(keeperCard, keeperSet, "Keeper Player"));
      await writeFile(orphanJpeg, jpeg(200, 300));
      await writeFile(path.join(dir, `${orphanId}_${CURRENT_MASK_VERSION}.json`), "{}\n");
      await writeFile(keeperJpeg, jpeg(200, 300));
      await db.insert(cardImageMaskCache).values([
        {
          cardId: orphanId,
          rawImageUrl: "https://packpts.com/cards/orphan.jpg",
          maskedImagePath: `${orphanId}_${CURRENT_MASK_VERSION}.jpg`,
          maskVersion: CURRENT_MASK_VERSION,
        },
        {
          cardId: keeperCard,
          rawImageUrl: "https://packpts.com/cards/keeper.jpg",
          maskedImagePath: `${keeperCard}_${CURRENT_MASK_VERSION}.jpg`,
          maskVersion: CURRENT_MASK_VERSION,
        },
      ]);
      await db.insert(maskBakeRefusals).values({
        cardId: orphanId,
        gameSetId: DELETED_HOOPS,
        reason: "mask_name_uncovered",
        maskVersion: CURRENT_MASK_VERSION,
      });
      const lines: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((line) => {
        lines.push(String(line));
      });
      const result = await logMaskCachePurge();
      spy.mockRestore();
      const boot = lines.find((line) => line.startsWith("[MaskCachePurge] "));
      expect(boot).toBe(`[MaskCachePurge] orphans=${result.orphans} sets=${result.sets.map((id) => id.slice(0, 8)).join(",")}`);
      expect(boot).toContain("c2ce5d11");
      expect(result.orphans).toBeGreaterThanOrEqual(1);
      expect(existsSync(orphanJpeg)).toBe(false);
      expect(existsSync(path.join(dir, `${orphanId}_${CURRENT_MASK_VERSION}.json`))).toBe(false);
      expect(existsSync(keeperJpeg)).toBe(true);
      const [orphanRow] = await db.select({ cardId: cardImageMaskCache.cardId }).from(cardImageMaskCache).where(eq(cardImageMaskCache.cardId, orphanId));
      const [keeperRow] = await db.select({ cardId: cardImageMaskCache.cardId }).from(cardImageMaskCache).where(eq(cardImageMaskCache.cardId, keeperCard));
      expect(orphanRow).toBeUndefined();
      expect(keeperRow?.cardId).toBe(keeperCard);
      const index = await readFile(new URL("../index.ts", import.meta.url), "utf8");
      expect(index).toContain("logMaskCachePurge()");
      const deleter = await readFile(new URL("../services/gameSetDelete.ts", import.meta.url), "utf8");
      expect(deleter).toContain("purgeMaskCacheForCards");
    } finally {
      setMaskReadySidecarDirForTests(null);
      await db.delete(cardImageMaskCache).where(inArray(cardImageMaskCache.cardId, [orphanId, keeperCard])).catch(() => null);
      await db.delete(maskBakeRefusals).where(eq(maskBakeRefusals.cardId, orphanId)).catch(() => null);
      await db.delete(playableCards).where(eq(playableCards.id, keeperCard)).catch(() => null);
      await db.delete(gameSets).where(eq(gameSets.id, keeperSet)).catch(() => null);
      await rm(dir, { recursive: true, force: true }).catch(() => null);
    }
  });
});
