import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { isLandscapeJpegFile } from "../masking/orientNote";
import { warmOkMarkerFilename } from "../startup/warmMaskGate";
import {
  maybeWriteWarmOkSidecar,
  runWarmSidecarBackfill,
  SIDECAR_BACKFILL_BATCH,
  type WarmSidecarCardRow,
} from "../startup/warmSidecarBackfill";

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
  buf[11] = 1;
  buf[15] = 0xff;
  buf[16] = 0xd9;
  return buf;
}

function row(cardId: string, patch: Partial<WarmSidecarCardRow> = {}): WarmSidecarCardRow {
  return {
    cardId,
    inPlayable: true,
    inBaseball: false,
    isPlayable: true,
    setActive: true,
    blockedReason: null,
    imageRotation: 0,
    imageCacheStatus: "ok",
    imageQuarantineReason: null,
    ...patch,
  };
}

describe("warm sidecar backfill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a sidecar only when the cached file passes the masked-route checks", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-sidecar-"));
    const portrait = jpeg(200, 300);
    const landscape = jpeg(300, 200);
    const okId = "card-ok";
    const namedId = "card-name";
    const brokenId = "card-broken";
    const cacheBadId = "card-cache";
    const wideId = "card-wide";
    const unknownId = "card-unknown";
    const markedId = "card-marked";
    const unplayableId = "card-unplayable";
    const inactiveId = "card-inactive";
    const staleId = "card-stale";
    await writeFile(path.join(dir, `${okId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${namedId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${brokenId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${cacheBadId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${wideId}_${CURRENT_MASK_VERSION}.jpg`), landscape);
    await writeFile(path.join(dir, `${unknownId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${markedId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, warmOkMarkerFilename(markedId)), "ok\n");
    await writeFile(path.join(dir, `${unplayableId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${inactiveId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, `${staleId}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    await writeFile(path.join(dir, warmOkMarkerFilename(staleId)), "ok\n");
    await writeFile(path.join(dir, `${staleId}_v0.ok`), "old\n");
    expect(isLandscapeJpegFile(path.join(dir, `${wideId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
    expect(isLandscapeJpegFile(path.join(dir, `${okId}_${CURRENT_MASK_VERSION}.jpg`))).toBe(false);

    const asked: string[][] = [];
    const counts = await runWarmSidecarBackfill({
      dir,
      pauseMs: 0,
      sleep: async () => {},
      loadEligibility: async (ids) => {
        asked.push(ids);
        const rows = new Map<string, WarmSidecarCardRow>();
        for (const id of ids) {
          if (id === namedId) rows.set(id, row(id, { blockedReason: "mask_name_uncovered" }));
          else if (id === brokenId) rows.set(id, row(id, { imageQuarantineReason: "placeholder" }));
          else if (id === cacheBadId) rows.set(id, row(id, { imageCacheStatus: "bad" }));
          else if (id === unknownId) rows.set(id, row(id, { inPlayable: false, inBaseball: false }));
          else if (id === unplayableId) rows.set(id, row(id, { isPlayable: false }));
          else if (id === inactiveId) rows.set(id, row(id, { setActive: false }));
          else if (id === staleId) rows.set(id, row(id, { imageQuarantineReason: "broken" }));
          else rows.set(id, row(id));
        }
        return rows;
      },
    });

    expect(asked.flat()).toContain(markedId);
    expect(await readFile(path.join(dir, warmOkMarkerFilename(okId)), "utf8")).toBe("ok\n");
    expect(await readFile(path.join(dir, warmOkMarkerFilename(markedId)), "utf8")).toBe("ok\n");
    await expect(readFile(path.join(dir, warmOkMarkerFilename(namedId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(brokenId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(cacheBadId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(wideId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(unknownId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(unplayableId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(inactiveId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, warmOkMarkerFilename(staleId)), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, `${staleId}_v0.ok`), "utf8")).rejects.toThrow();
    expect(counts.written).toBe(1);
    expect(counts.skipped).toBe(8);
    expect(counts.removed).toBe(1);
    const summary = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).join("\n");
    expect(summary).toContain(`warm sidecar backfill scanned=${counts.scanned} written=1 skipped=8 removed=1`);
  });

  it("checks the database 50 files at a time", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-sidecar-batch-"));
    const portrait = jpeg(200, 300);
    const total = SIDECAR_BACKFILL_BATCH + 1;
    for (let i = 0; i < total; i += 1) {
      const id = `batch-${String(i).padStart(2, "0")}`;
      await writeFile(path.join(dir, `${id}_${CURRENT_MASK_VERSION}.jpg`), portrait);
    }
    const sizes: number[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runWarmSidecarBackfill({
      dir,
      pauseMs: 1,
      sleep: async () => {},
      loadEligibility: async (ids) => {
        sizes.push(ids.length);
        return new Map(ids.map((id) => [id, row(id)]));
      },
    });
    expect(sizes).toEqual([SIDECAR_BACKFILL_BATCH, 1]);
  });

  it("writes the sidecar lazily for a cached file that passed the checks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "packpts-sidecar-lazy-"));
    const cardId = "lazy-card";
    const filename = `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
    await writeFile(path.join(dir, filename), jpeg(200, 300));
    const wrote = await maybeWriteWarmOkSidecar(cardId, filename, {
      dir,
      loadEligibility: async () => new Map([[cardId, row(cardId)]]),
    });
    expect(wrote).toBe(true);
    expect(await readFile(path.join(dir, warmOkMarkerFilename(cardId)), "utf8")).toBe("ok\n");
    const again = await maybeWriteWarmOkSidecar(cardId, filename, {
      dir,
      loadEligibility: async () => {
        throw new Error("should not query once the sidecar exists");
      },
    });
    expect(again).toBe(false);
    await writeFile(path.join(dir, `lazy-wide_${CURRENT_MASK_VERSION}.jpg`), jpeg(200, 300));
    const refused = await maybeWriteWarmOkSidecar("lazy-wide", `lazy-wide_${CURRENT_MASK_VERSION}.jpg`, {
      dir,
      loadEligibility: async () => new Map([["lazy-wide", row("lazy-wide", { blockedReason: "mask_name_uncovered" })]]),
    });
    expect(refused).toBe(false);
    await expect(readFile(path.join(dir, warmOkMarkerFilename("lazy-wide")), "utf8")).rejects.toThrow();
  });
});
