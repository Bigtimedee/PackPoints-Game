/**
 * Backfill writes mask_bake_refusals for cards that were already refused.
 * It does not bake, and it does not clear the refusal.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { cardImageMaskCache, gameSets, maskBakeRefusals, playableCards } from "@shared/schema";
import { db } from "../db";
import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import {
  RESOLVES_NOW_REASON,
  setRefusalBackfillHooksForTests,
  sortBackfillCards,
} from "../masking/maskRefusalBackfill";
import type { NamePlateTrace } from "../masking/nameLocalization";
import { setMaskReadySidecarDirForTests, writeMaskFailureSidecar } from "../masking/maskReadySidecar";
import { resetMaskBakeForTests } from "../masking/maskingService";
import { registerDealableQaRoutes } from "../routes/dealableQa";

const TOKEN = "design-qa-token";
const setId = randomUUID();
const unresolvedId = "00000000-0000-4000-8000-0000000000b1";
const resolvesId = "ffffffff-ffff-4fff-8fff-0000000000b2";
const cardIds = [unresolvedId, resolvesId];
const previousToken = process.env.COVER_QA_TOKEN;

function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.COVER_QA_TOKEN;
  else process.env.COVER_QA_TOKEN = value;
}

function trace(decision: string): NamePlateTrace {
  return {
    imageWidth: 20,
    imageHeight: 28,
    expectedPlate: { x: 0, y: 0, w: 20, h: 6 },
    ocrBoxes: [],
    candidates: [],
    decision,
  };
}

describe("mask refusal backfill", () => {
  const app = express();
  registerDealableQaRoutes(app);
  const server = createServer(app);
  let base = "";
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-refusal-backfill-"));
    setMaskReadySidecarDirForTests(dir);
    resetMaskBakeForTests();
    setToken(TOKEN);
    writeMaskFailureSidecar(unresolvedId, "name_plate_unresolved", dir);
    writeMaskFailureSidecar(resolvesId, "name_plate_unresolved", dir);
    await db.insert(gameSets).values({
      id: setId,
      sport: "basketball",
      brand: "Fleer",
      year: 1989,
      setName: `QA Backfill ${setId.slice(0, 8)}`,
      isUserCreated: false,
      isActive: true,
    });
    await db.insert(playableCards).values([
      {
        id: unresolvedId,
        gameSetId: setId,
        cardhedgeCardId: `backfill:${unresolvedId}`,
        player: "QA Unresolved",
        set: "QA Backfill",
        number: "12",
        description: "QA Unresolved",
        imageUrl: "https://packpts.example/unresolved.jpg",
        category: "basketball",
        isPlayable: false,
        contentVerified: true,
        imageReviewStatus: "unreviewed",
        quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
        proposedUnplayable: false,
        blockedReason: "mask_name_uncovered",
        lastImageCheck: new Date(),
      },
      {
        id: resolvesId,
        gameSetId: setId,
        cardhedgeCardId: `backfill:${resolvesId}`,
        player: "QA Resolves",
        set: "QA Backfill",
        number: "13",
        description: "QA Resolves",
        imageUrl: "https://packpts.example/resolves.jpg",
        category: "basketball",
        isPlayable: false,
        contentVerified: true,
        imageReviewStatus: "unreviewed",
        quarantineStatus: "QUARANTINED_ADMIN_REVIEW",
        proposedUnplayable: false,
        blockedReason: "mask_name_uncovered",
        lastImageCheck: new Date(),
      },
    ]);
    setRefusalBackfillHooksForTests({
      loadSource: async () => Buffer.from("upright-source"),
      dryRun: async (card, source) => ({
        coverageOk: card.id === resolvesId,
        coverageReason: card.id === resolvesId ? null : "name_plate_unresolved",
        layoutClass: "TOP_PLATE",
        source: "profile",
        regions: [],
        plateTrace: trace(card.id === resolvesId ? RESOLVES_NOW_REASON : "name_plate_unresolved"),
        sourceBuffer: source,
      }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setToken(previousToken);
    setRefusalBackfillHooksForTests(null);
    resetMaskBakeForTests();
    setMaskReadySidecarDirForTests(null);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await db.delete(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, cardIds)).catch(() => null);
    await db.delete(playableCards).where(inArray(playableCards.id, cardIds)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => null);
  });

  function headers(token = TOKEN): HeadersInit {
    return { "X-QA-Token": token };
  }

  it("orders pinned cover ids ahead of other refusals", () => {
    const jordan = "119393bc-df92-4c46-aab7-8730dd9217c8";
    const other = "00000000-0000-4000-8000-0000000000aa";
    expect(sortBackfillCards([{ id: other }, { id: jordan }]).map((card) => card.id)).toEqual([jordan, other]);
  });

  it("returns 404 when the token is unset, missing, wrong, or only a query param", async () => {
    setToken(undefined);
    const unset = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}`, { method: "POST", headers: headers() });
    expect(unset.status).toBe(404);
    expect(unset.headers.get("cache-control")).toContain("no-store");
    expect(unset.headers.get("x-robots-tag")).toBe("noindex");
    setToken(TOKEN);
    const missing = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}`, { method: "POST" });
    expect(missing.status).toBe(404);
    const wrong = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}`, { method: "POST", headers: headers("nope") });
    expect(wrong.status).toBe(404);
    const queryOnly = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}&token=${TOKEN}`, { method: "POST" });
    expect(queryOnly.status).toBe(404);
    const rows = await db.select({ id: maskBakeRefusals.id }).from(maskBakeRefusals).where(inArray(maskBakeRefusals.cardId, cardIds));
    expect(rows).toEqual([]);
  });

  it("inserts one row per refused card, records resolves_now, and does not write a mask or clear the refusal", async () => {
    const beforeSidecars = (await readdir(dir)).sort();
    const beforeMasked = await readdir(MASKED_CARDS_DIR).catch(() => [] as string[]);
    const src = await readFile(new URL("../masking/maskRefusalBackfill.ts", import.meta.url), "utf8");
    expect(src).not.toContain("cardImageMaskCache");
    expect(src).not.toContain("writeMaskFailureSidecar");
    expect(src).not.toContain("writeOrientNote");
    expect(src).not.toContain("isPlayable");
    expect(src).toContain("runWarmBakeJob");
    expect(src).toContain("recordOrientNote: false");

    const first = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}&limit=50`, {
      method: "POST",
      headers: headers(),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const body = await first.json() as {
      scanned: number;
      inserted: number;
      skipped: number;
      errors: number;
      remaining: number;
    };
    expect(body).toEqual({ scanned: 2, inserted: 2, skipped: 0, errors: 0, remaining: 0 });

    const rows = await db
      .select({
        cardId: maskBakeRefusals.cardId,
        reason: maskBakeRefusals.reason,
        maskVersion: maskBakeRefusals.maskVersion,
        sourceImage: maskBakeRefusals.sourceImage,
      })
      .from(maskBakeRefusals)
      .where(inArray(maskBakeRefusals.cardId, cardIds));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.cardId === unresolvedId)?.reason).toBe("name_plate_unresolved");
    expect(rows.find((row) => row.cardId === resolvesId)?.reason).toBe(RESOLVES_NOW_REASON);
    expect(rows.every((row) => row.maskVersion === "v4.6")).toBe(true);
    expect(rows.every((row) => row.sourceImage && Buffer.from(row.sourceImage).toString() === "upright-source")).toBe(true);

    const cards = await db
      .select({ id: playableCards.id, blockedReason: playableCards.blockedReason, isPlayable: playableCards.isPlayable })
      .from(playableCards)
      .where(inArray(playableCards.id, cardIds));
    expect(cards.every((card) => card.blockedReason === "mask_name_uncovered" && card.isPlayable === false)).toBe(true);

    const cache = await db
      .select({ cardId: cardImageMaskCache.cardId })
      .from(cardImageMaskCache)
      .where(inArray(cardImageMaskCache.cardId, cardIds));
    expect(cache).toEqual([]);

    expect((await readdir(dir)).sort()).toEqual(beforeSidecars);
    const afterMasked = await readdir(MASKED_CARDS_DIR).catch(() => [] as string[]);
    expect(afterMasked.filter((name) => cardIds.some((id) => name.startsWith(id)))).toEqual([]);
    expect(afterMasked).toEqual(beforeMasked);

    const again = await fetch(`${base}/api/qa/rejected-cards/backfill?setId=${setId}&limit=900`, {
      method: "POST",
      headers: headers(),
    });
    const second = await again.json() as { scanned: number; inserted: number; skipped: number; remaining: number };
    expect(second).toMatchObject({ scanned: 0, inserted: 0, skipped: 2, remaining: 0 });
    const afterRows = await db
      .select({ id: maskBakeRefusals.id })
      .from(maskBakeRefusals)
      .where(inArray(maskBakeRefusals.cardId, cardIds));
    expect(afterRows).toHaveLength(2);
  });
});
