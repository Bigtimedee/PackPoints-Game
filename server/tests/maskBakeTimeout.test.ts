import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaskResult } from "../masking/maskCardImage";

const dbUpdate = vi.hoisted(() => vi.fn(() => ({
  set: () => ({ where: () => Promise.resolve() }),
})));

vi.mock("../db", () => ({
  db: {
    update: dbUpdate,
    insert: vi.fn(() => ({
      values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
    })),
    select: vi.fn(),
  },
  pool: { on: vi.fn() },
}));

import { withSourceFetchTimeout } from "../services/images/sourceFetch";
import { sendMaskedCard } from "../services/playImageSend";
import { kickPreMask } from "../masking/preMaskDeal";
import { clearMaskFailureSidecar } from "../masking/maskReadySidecar";
import {
  MaskBakeTimeoutError,
  bakeMaskedCardFromUrl,
  enqueueMaskBake,
  maskBakeSlotsInUse,
  resetMaskBakeForTests,
  setMaskBakeTimingsForTests,
  setMaskPathLoaderForTests,
  type MaskBakeSource,
} from "../masking/maskingService";
import * as maskCardImage from "../masking/maskCardImage";

const source = (cardId: string): MaskBakeSource => ({
  cardId,
  imageUrl: `https://images.example/${cardId}.jpg`,
  playerName: "Ken Phelps",
  setHint: "1987 Topps baseball",
  gameSetId: null,
});

function hangFetch(counter?: { n: number }) {
  return () => {
    if (counter) counter.n += 1;
    return new Promise(() => {});
  };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string | number) {
      res.headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const failedCover: MaskResult = {
  maskedBuffer: Buffer.from("masked"),
  ocrApplied: false,
  ocrMatches: [],
  source: "default",
  regions: [{ xPct: 0, yPct: 54, wPct: 100, hPct: 46, type: "blur", radiusPct: 0 }],
  layoutClass: "BOTTOM_PLAQUE",
  coverageOk: false,
  coverageReason: "mask_name_uncovered",
  plateTrace: {
    imageWidth: 200,
    imageHeight: 280,
    expectedPlate: null,
    ocrBoxes: [],
    candidates: [],
    decision: "default",
  },
  sourceBuffer: Buffer.from("source"),
};

describe("mask bake timeouts", () => {
  beforeEach(() => {
    resetMaskBakeForTests();
    clearMaskFailureSidecar("card-uncovered");
    dbUpdate.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetMaskBakeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a source fetch that never resolves", async () => {
    vi.stubGlobal("fetch", hangFetch());
    const started = Date.now();
    await expect(withSourceFetchTimeout(async (signal) => {
      await fetch("https://images.example/stuck.jpg", { signal });
      return "done";
    }, 80)).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("releases the bake slot when fetch never settles, then the next request retries", async () => {
    const calls = { n: 0 };
    vi.stubGlobal("fetch", hangFetch(calls));
    setMaskBakeTimingsForTests({ fetchMs: 80, deadlineMs: 1_000 });
    const cardId = "card-hang-fetch";

    const first = enqueueMaskBake(cardId, () => bakeMaskedCardFromUrl(source(cardId)));
    const joined = enqueueMaskBake(cardId, () => bakeMaskedCardFromUrl(source(cardId)));
    await expect(first).rejects.toBeInstanceOf(MaskBakeTimeoutError);
    await expect(joined).rejects.toBeInstanceOf(MaskBakeTimeoutError);
    expect(calls.n).toBe(1);
    expect(maskBakeSlotsInUse()).toBe(0);
    expect(dbUpdate).not.toHaveBeenCalled();

    const logLine = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).find((line) => line.startsWith("[MaskBake]"));
    expect(logLine).toMatch(/^\[MaskBake\] timeout stage=fetch card=card-hang-fetch ms=\d+$/);
    expect(logLine).not.toContain("http");
    expect(logLine).not.toContain(source(cardId).imageUrl);

    await expect(enqueueMaskBake(cardId, () => bakeMaskedCardFromUrl(source(cardId)))).rejects.toBeInstanceOf(MaskBakeTimeoutError);
    expect(calls.n).toBe(2);
    expect(maskBakeSlotsInUse()).toBe(0);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("frees a slot held by a bake that never settles so a waiter can run", async () => {
    const calls = { n: 0 };
    vi.stubGlobal("fetch", hangFetch(calls));
    setMaskBakeTimingsForTests({ fetchMs: 120, deadlineMs: 1_000 });

    const first = enqueueMaskBake("slot-a", () => bakeMaskedCardFromUrl(source("slot-a")));
    const second = enqueueMaskBake("slot-b", () => bakeMaskedCardFromUrl(source("slot-b")));
    const third = enqueueMaskBake("slot-c", () => bakeMaskedCardFromUrl(source("slot-c")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.n).toBe(2);
    expect(maskBakeSlotsInUse()).toBe(2);

    await Promise.allSettled([first, second, third]);
    expect(calls.n).toBe(3);
    expect(maskBakeSlotsInUse()).toBe(0);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("does not quarantine when OCR never settles or when a late coverage failure follows a timeout", async () => {
    vi.stubGlobal("fetch", async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
    setMaskBakeTimingsForTests({ fetchMs: 5_000, deadlineMs: 60 });

    const hang = vi.spyOn(maskCardImage, "maskCardImage").mockImplementation(() => new Promise(() => {}) as Promise<MaskResult>);
    await expect(bakeMaskedCardFromUrl(source("card-ocr-hang"))).rejects.toMatchObject({
      name: "MaskBakeTimeoutError",
      stage: "ocr",
    });
    expect(maskBakeSlotsInUse()).toBe(0);
    expect(dbUpdate).not.toHaveBeenCalled();
    hang.mockRestore();

    vi.spyOn(maskCardImage, "maskCardImage").mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(failedCover), 180);
    }));
    await expect(bakeMaskedCardFromUrl(source("card-late-cover"))).rejects.toBeInstanceOf(MaskBakeTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(maskBakeSlotsInUse()).toBe(0);
  });

  it("still quarantines a real coverage failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
    vi.spyOn(maskCardImage, "maskCardImage").mockResolvedValue(failedCover);
    await expect(bakeMaskedCardFromUrl(source("card-uncovered"))).resolves.toBeNull();
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(maskBakeSlotsInUse()).toBe(0);
  });

  it("does not quarantine a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    await expect(bakeMaskedCardFromUrl(source("card-net"))).resolves.toBeNull();
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(maskBakeSlotsInUse()).toBe(0);
  });

  it("returns 503 for a masked-image timeout without the card id", async () => {
    setMaskPathLoaderForTests(async () => {
      throw new MaskBakeTimeoutError("fetch", "secret-card-42", 9000);
    });
    const res = fakeRes();
    await sendMaskedCard({ headers: {} } as Request, res as never, "secret-card-42");
    expect(res.statusCode).toBe(503);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["retry-after"]).toBe("5");
    const body = JSON.stringify(res.body);
    expect(body).toContain("Masked image temporarily unavailable");
    expect(body).not.toContain("secret-card-42");
    expect(body).not.toContain("http");
    expect(body).not.toContain("imageUrl");
  });

  it("logs PreMask completion when a bake times out", async () => {
    setMaskPathLoaderForTests(async (cardId) => {
      if (cardId === "slow") throw new MaskBakeTimeoutError("bake", cardId, 40);
      return "warm.jpg";
    });
    kickPreMask(["ok-a", "slow", "ok-b"], "solo-start");
    await vi.waitFor(() => {
      const line = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).find((entry) => entry.startsWith("[PreMask]"));
      expect(line).toMatch(/^\[PreMask\] solo-start warmed 2\/3 timedOut=1 in \d+ms$/);
    });
    const warned = vi.mocked(console.warn).mock.calls.map((args) => String(args[0]));
    expect(warned.join(" ")).not.toContain("[PreMask]");
  });
});
