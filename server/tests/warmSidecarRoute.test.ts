import type { Request } from "express";
import fs from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

const maybeWrite = vi.hoisted(() => vi.fn(async () => false));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => {
      throw new Error("no row");
    }),
    update: vi.fn(),
    insert: vi.fn(),
  },
  pool: { on: vi.fn(), query: vi.fn() },
}));

vi.mock("../startup/warmSidecarBackfill", () => ({
  maybeWriteWarmOkSidecar: maybeWrite,
}));

import { MASKED_CARDS_DIR } from "../masking/maskPlanStore";
import { resetMaskBakeForTests, setMaskPathLoaderForTests } from "../masking/maskingService";
import { sendMaskedCard } from "../services/playImageSend";

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

describe("masked route sidecar", () => {
  afterEach(() => {
    maybeWrite.mockClear();
    setMaskPathLoaderForTests(null);
    resetMaskBakeForTests();
    vi.restoreAllMocks();
  });

  it("asks to record a sidecar when a cached masked file passed the route checks", async () => {
    const cardId = "route-sidecar-card";
    const filename = `${cardId}_${CURRENT_MASK_VERSION}.jpg`;
    await fs.promises.mkdir(MASKED_CARDS_DIR, { recursive: true });
    const filePath = path.join(MASKED_CARDS_DIR, filename);
    await writeFile(filePath, jpeg(200, 300));
    vi.spyOn(fs, "createReadStream").mockReturnValue({ pipe() { return this; } } as never);
    const res = fakeRes();
    await sendMaskedCard({ headers: {} } as Request, res as never, cardId);
    expect(maybeWrite).toHaveBeenCalledWith(cardId, filename);
    expect(res.statusCode).toBe(200);
    await fs.promises.unlink(filePath).catch(() => {});
  });

  it("does not record a sidecar when the bake never returns a file", async () => {
    const { MaskBakeTimeoutError } = await import("../masking/maskingService");
    setMaskPathLoaderForTests(async () => {
      throw new MaskBakeTimeoutError("fetch", "secret-card", 10);
    });
    const res = fakeRes();
    await sendMaskedCard({ headers: {} } as Request, res as never, "secret-card");
    expect(res.statusCode).toBe(503);
    expect(maybeWrite).not.toHaveBeenCalled();
  });
});
