/** P0 2026-10-30: volume at 100%, ENOSPC on every mask bake and score card. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import {
  classifyRootFile, evictToTarget, isEnospc, janitorStatus, listCandidates,
  resetJanitorForTests, runJanitor, setProtectedLoaderForTests, volumeBreakdown,
  volumeWritesPaused, writeWithEnospcRetry, type VolumeUsage,
} from "../storage/volumeJanitor";

let root: string;
const NOW = Date.parse("2026-10-30T18:00:00Z");

function put(rel: string, bytes: number, ageMin = 0): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes));
  const t = (NOW - ageMin * 60_000) / 1000;
  fs.utimesSync(full, t, t);
  return full;
}

/** Fake disk: total 1000, used = sum of file bytes + base. */
function fakeUsage(base: number, total = 1000): () => Promise<VolumeUsage> {
  return async () => {
    const b = await volumeBreakdown(root);
    const used = base + Object.values(b).reduce((s, r) => s + r.bytes, 0);
    return { totalBytes: total, usedBytes: used, freeBytes: total - used, usedPct: (used / total) * 100 };
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vol-"));
  resetJanitorForTests();
  setProtectedLoaderForTests(async () => new Set(["pinned1"]));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  setProtectedLoaderForTests(null);
});

describe("volume janitor", () => {
  it("classifies bakes by mask version", () => {
    expect(classifyRootFile(`abc_${CURRENT_MASK_VERSION}.jpg`)).toBe("mask_bake_current");
    expect(classifyRootFile("abc_v4.1_r90.jpg")).toBe("mask_bake_stale");
    expect(classifyRootFile(`abc_${CURRENT_MASK_VERSION}.ok`)).toBe("other");
  });

  it("evicts stale versions, then old share PNGs, then oldest current bakes; never protected or non-regenerable files", async () => {
    put("old1_v4.1.jpg", 100, 10);
    put("generated/share/2026-10-20/a.png", 100, 9000);
    put("generated/share/2026-10-30/today.png", 50);
    put("generated/share/play-sets/s.png", 50, 9000);
    put(`cardA_${CURRENT_MASK_VERSION}.jpg`, 100, 500);
    put(`cardB_${CURRENT_MASK_VERSION}.jpg`, 100, 5);
    put(`pinned1_${CURRENT_MASK_VERSION}.jpg`, 100, 99999);
    put(`cardA_${CURRENT_MASK_VERSION}.ok`, 3, 500);
    put(".db-backups/daily-1.dump", 200, 99999);
    put("cardA_v4.6.plan.json", 10, 99999);

    // used = 813 of 1000; target 60% => free >= 213
    const r = await evictToTarget({ root, targetPct: 60, now: NOW, usage: fakeUsage(0), protectedCardIds: new Set(["pinned1"]) });
    expect(r.deleted).toEqual({ stale_mask_version: 1, old_share_png: 1, current_mask_lru: 1 });
    expect(fs.existsSync(path.join(root, `cardA_${CURRENT_MASK_VERSION}.jpg`))).toBe(false);
    expect(fs.existsSync(path.join(root, `cardB_${CURRENT_MASK_VERSION}.jpg`))).toBe(true);
    for (const keep of [`pinned1_${CURRENT_MASK_VERSION}.jpg`, `cardA_${CURRENT_MASK_VERSION}.ok`, ".db-backups/daily-1.dump",
      "cardA_v4.6.plan.json", "generated/share/2026-10-30/today.png", "generated/share/play-sets/s.png"]) {
      expect(fs.existsSync(path.join(root, keep)), keep).toBe(true);
    }
    expect(r.after.usedPct).toBeLessThanOrEqual(60);
  });

  it("does nothing under the target", async () => {
    put("old1_v4.1.jpg", 100);
    const r = await evictToTarget({ root, targetPct: 70, now: NOW, usage: fakeUsage(0) });
    expect(r.freedBytes).toBe(0);
    expect(fs.existsSync(path.join(root, "old1_v4.1.jpg"))).toBe(true);
  });

  it("protected Daily 5 / pinned ids are not candidates", async () => {
    put(`pinned1_${CURRENT_MASK_VERSION}.jpg`, 10);
    const c = await listCandidates({ root, protectedCardIds: new Set(["pinned1"]), now: NOW });
    expect(c).toHaveLength(0);
  });

  it("ENOSPC triggers one eviction and one retry", async () => {
    put("old1_v4.1.jpg", 400);
    const usage = fakeUsage(500);
    let calls = 0;
    const out = await writeWithEnospcRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return "ok";
    }, { root, usage });
    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(fs.existsSync(path.join(root, "old1_v4.1.jpg"))).toBe(false);
    expect(janitorStatus().enospcCount).toBe(1);
    expect(volumeWritesPaused()).toBe(false);
  });

  it("a second ENOSPC is not retried forever and other errors pass through", async () => {
    const write = vi.fn(async () => { throw Object.assign(new Error("x"), { code: "ENOSPC" }); });
    await expect(writeWithEnospcRetry(write, { root, usage: fakeUsage(990) })).rejects.toThrow();
    expect(write).toHaveBeenCalledTimes(2);
    expect(volumeWritesPaused()).toBe(true);
    await expect(writeWithEnospcRetry(async () => { throw Object.assign(new Error("y"), { code: "EACCES" }); })).rejects.toThrow("y");
    expect(isEnospc({ code: "EACCES" })).toBe(false);
  });

  it("runJanitor skips below high water and clears the pause", async () => {
    expect(await runJanitor("periodic", { root, usage: fakeUsage(100) })).toBeNull();
    expect(volumeWritesPaused()).toBe(false);
  });

  it("warmup stops while writes are paused", async () => {
    const src = fs.readFileSync(path.join(__dirname, "../startup/maskWarmup.ts"), "utf8");
    expect(src).toContain("shouldStop: () => warmupStop || volumeWritesPaused()");
  });
});
