import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { cardImageCache, cardImageQuarantine, gameSets, playableCards } from "@shared/schema";
import {
  invalidateMaskReadySidecar,
  invalidateMaskSidecarsForGameSet,
  setMaskReadySidecarDirForTests,
} from "../masking/maskReadySidecar";

const hasDb = Boolean(process.env.DATABASE_URL);
const setId = randomUUID();

function jpeg(): Buffer {
  const buf = Buffer.alloc(20);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(300, 7);
  buf.writeUInt16BE(200, 9);
  buf[11] = 1;
  buf[15] = 0xff;
  buf[16] = 0xd9;
  return buf;
}

async function plant(dir: string, cardId: string): Promise<void> {
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`), jpeg());
  await writeFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "ok\n");
  await writeFile(path.join(dir, `${cardId}_v0.ok`), "old\n");
  await writeFile(path.join(dir, `other_${CURRENT_MASK_VERSION}.ok`), "keep\n");
}

async function expectSidecarsGone(dir: string, cardId: string): Promise<void> {
  await expect(readFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.ok`), "utf8")).rejects.toThrow();
  await expect(readFile(path.join(dir, `${cardId}_v0.ok`), "utf8")).rejects.toThrow();
  expect(await readFile(path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}.jpg`))).toBeInstanceOf(Buffer);
  expect(await readFile(path.join(dir, `other_${CURRENT_MASK_VERSION}.ok`), "utf8")).toBe("keep\n");
}

describe("mask sidecar invalidation wiring", () => {
  it("every ineligible writer calls the shared helper", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const routes = readFileSync(join(root, "../routes.ts"), "utf8");
    const quality = readFileSync(join(root, "../services/cards/imageQuality.ts"), "utf8");
    const gate = readFileSync(join(root, "../services/images/imageGate.ts"), "utf8");
    const masking = readFileSync(join(root, "../masking/maskingService.ts"), "utf8");
    const gameSetDelete = readFileSync(join(root, "../services/gameSetDelete.ts"), "utf8");
    const validation = readFileSync(join(root, "../services/imageValidation.ts"), "utf8");
    expect(quality).toContain("invalidateMaskReadySidecar(cardId)");
    expect(gate).toContain("invalidateMaskReadySidecar(cardId)");
    expect(masking).toContain("invalidateMaskReadySidecar(cardId)");
    expect(gameSetDelete).toContain("invalidateMaskReadySidecars(outcome.cardIds)");
    expect(validation).toContain("invalidateMaskReadySidecar(cardId)");
    expect(validation).toContain("invalidateMaskReadySidecars(proposedCards.map((card) => card.id))");
    for (const name of [
      "invalidateMaskSidecarsForGameSet",
      "markPlayerMismatchUnplayable",
      "rejectReportedCardImage",
      "rejectCardReview",
      "flagMultiPlayerCards",
      "excludePlayableCard",
      "notePlayableClassification",
      "noteImportedCardUnplayable",
      "invalidateMaskReadySidecars(purgedCardIds)",
    ]) {
      expect(routes, name).toContain(name);
    }
  });
});

describe("invalidateMaskReadySidecar", () => {
  it("deletes every version sidecar and leaves the jpeg and other cards", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-sidecar-inv-"));
    const cardId = randomUUID();
    await plant(dir, cardId);
    const removed = invalidateMaskReadySidecar(cardId, dir);
    expect(removed.sort()).toEqual([`${cardId}_${CURRENT_MASK_VERSION}.ok`, `${cardId}_v0.ok`].sort());
    await expectSidecarsGone(dir, cardId);
  });
});

describe.skipIf(!hasDb)("ineligible card paths drop the sidecar", () => {
  let dir = "";
  let db: Awaited<typeof import("../db")>["db"];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-sidecar-paths-"));
    setMaskReadySidecarDirForTests(dir);
    ({ db } = await import("../db"));
    await db.insert(gameSets).values({
      id: setId,
      sport: "baseball",
      brand: "Test",
      year: 1987,
      setName: "Sidecar Invalidation",
      isActive: true,
    });
  });

  afterAll(async () => {
    setMaskReadySidecarDirForTests(null);
    if (!db) return;
    for (const name of ["quarantine", "cachebad", "validate"]) {
      const id = cardId(name);
      await db.delete(cardImageQuarantine).where(eq(cardImageQuarantine.cardId, id)).catch(() => null);
      await db.delete(cardImageCache).where(eq(cardImageCache.cardId, id)).catch(() => null);
    }
    await db.delete(playableCards).where(eq(playableCards.gameSetId, setId)).catch(() => null);
    await db.delete(gameSets).where(eq(gameSets.id, setId)).catch(() => null);
  });

  function cardId(name: string): string {
    return `00000000-0000-4000-8000-${name.padEnd(12, "0").slice(0, 12)}`;
  }

  async function insertCard(name: string, patch: Record<string, unknown> = {}): Promise<string> {
    const id = cardId(name);
    await db.insert(playableCards).values({
      id,
      gameSetId: setId,
      cardhedgeCardId: `sidecar-inv:${name}:${randomUUID()}`,
      player: "Eddie Murray",
      imageUrl: "https://images.cardhedger.com/real.jpg",
      category: "baseball",
      isPlayable: true,
      ...patch,
    });
    await plant(dir, id);
    return id;
  }

  it("quarantineCard", async () => {
    const id = await insertCard("quarantine");
    const { quarantineCard } = await import("../services/cards/imageQuality");
    await quarantineCard(id, "broken image");
    await expectSidecarsGone(dir, id);
  });

  it("markImageBad", async () => {
    const id = await insertCard("cachebad");
    await db.insert(cardImageCache).values({
      cardId: id,
      sourceUrl: "https://images.cardhedger.com/real.jpg",
      normalizedUrl: "https://images.cardhedger.com/real.jpg",
      proxiedPath: `/api/images/card/${id}`,
      status: "ok",
    });
    const { markImageBad } = await import("../services/images/imageGate");
    await markImageBad(id, "proxy_fetch_failed:404");
    await expectSidecarsGone(dir, id);
    const [row] = await db.select({ status: cardImageCache.status }).from(cardImageCache).where(eq(cardImageCache.cardId, id));
    expect(row?.status).toBe("bad");
  });

  it("getOrValidateCardImage when the cache status is bad", async () => {
    const id = await insertCard("validate");
    const { getOrValidateCardImage } = await import("../services/images/imageGate");
    const result = await getOrValidateCardImage(id, "https://images.cardhedger.com/placeholder-card.jpg");
    expect(result.status).toBe("bad");
    await expectSidecarsGone(dir, id);
  });

  it("quarantineUncoveredName", async () => {
    const id = await insertCard("name");
    const { quarantineUncoveredName } = await import("../masking/maskingService");
    await quarantineUncoveredName(id, "name still visible");
    await expectSidecarsGone(dir, id);
    const [row] = await db.select({ blockedReason: playableCards.blockedReason }).from(playableCards).where(eq(playableCards.id, id));
    expect(row?.blockedReason).toBe("mask_name_uncovered");
  });

  it("player mismatch", async () => {
    const id = await insertCard("mismatch");
    const { markPlayerMismatchUnplayable } = await import("../services/playableIneligible");
    await markPlayerMismatchUnplayable(id, "stored vs API");
    await expectSidecarsGone(dir, id);
  });

  it("report reject", async () => {
    const id = await insertCard("report");
    const { rejectReportedCardImage } = await import("../services/playableIneligible");
    await rejectReportedCardImage(id);
    await expectSidecarsGone(dir, id);
  });

  it("admin review reject", async () => {
    const id = await insertCard("review");
    const { rejectCardReview } = await import("../services/playableIneligible");
    await rejectCardReview(id, "mismatch");
    await expectSidecarsGone(dir, id);
  });

  it("flag multi-player", async () => {
    const id = await insertCard("multi");
    const { flagMultiPlayerCards } = await import("../services/playableIneligible");
    await flagMultiPlayerCards([id]);
    await expectSidecarsGone(dir, id);
  });

  it("admin exclude", async () => {
    const id = await insertCard("exclude");
    const { excludePlayableCard } = await import("../services/playableIneligible");
    await excludePlayableCard(id, "manual");
    await expectSidecarsGone(dir, id);
  });

  it("classifier backfill", async () => {
    const id = await insertCard("class");
    const { notePlayableClassification } = await import("../services/playableIneligible");
    await notePlayableClassification(id, false, "checklist");
    await expectSidecarsGone(dir, id);
  });

  it("import of an unplayable card", async () => {
    const id = await insertCard("import");
    const { noteImportedCardUnplayable } = await import("../services/playableIneligible");
    noteImportedCardUnplayable(id, false);
    await expectSidecarsGone(dir, id);
    noteImportedCardUnplayable(id, true);
  });

  it("admin image revalidation", async () => {
    const id = await insertCard("reval", { imageUrl: "https://images.cardhedger.com/placeholder-card.jpg" });
    const { revalidateCard } = await import("../services/imageValidation");
    const result = await revalidateCard(id, "playable", "ADMIN_MANUAL");
    expect(result.valid).toBe(false);
    await expectSidecarsGone(dir, id);
  });

  it("apply proposed unplayable", async () => {
    const id = await insertCard("proposal", { proposedUnplayable: true });
    const { applyProposedChanges } = await import("../services/imageValidation");
    const applied = await applyProposedChanges(setId, "sidecar-test");
    expect(applied.applied).toBeGreaterThan(0);
    await expectSidecarsGone(dir, id);
  });

  it("set deactivation", async () => {
    const id = await insertCard("setoff");
    const removed = await invalidateMaskSidecarsForGameSet(setId, dir);
    expect(removed.some((name) => name.startsWith(`${id}_`))).toBe(true);
    await expectSidecarsGone(dir, id);
  });

  it("hard-delete of a game set", async () => {
    const id = randomUUID();
    const doomedSet = randomUUID();
    await db.insert(gameSets).values({
      id: doomedSet,
      sport: "baseball",
      brand: "Test",
      year: 1988,
      setName: "Sidecar Delete Set",
      isActive: true,
    });
    await db.insert(playableCards).values({
      id,
      gameSetId: doomedSet,
      cardhedgeCardId: `sidecar-inv:delete:${randomUUID()}`,
      player: "Cal Ripken",
      imageUrl: "https://images.cardhedger.com/real.jpg",
      category: "baseball",
      isPlayable: true,
    });
    await plant(dir, id);
    const { hardDeleteGameSet } = await import("../services/gameSetDelete");
    expect(await hardDeleteGameSet(doomedSet)).toBe(true);
    await expectSidecarsGone(dir, id);
  });
});
