import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { writeMaskFailureSidecar, setMaskReadySidecarDirForTests } from "../masking/maskReadySidecar";
import { sendMaskedCard } from "../services/playImageSend";
import {
  getMaskedImagePath,
  resetMaskBakeForTests,
  setMaskPathLoaderForTests,
  takeCoverageRefusal,
} from "../masking/maskingService";

describe("a fail marker returns 422 without baking", () => {
  let dir = "";

  afterEach(async () => {
    setMaskReadySidecarDirForTests(null);
    setMaskPathLoaderForTests(null);
    resetMaskBakeForTests();
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("does not call the bake when the sidecar already refused the card", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-fail-"));
    setMaskReadySidecarDirForTests(dir);
    writeMaskFailureSidecar("refused-card", "name_text_visible", dir);
    let baked = false;
    setMaskPathLoaderForTests(async () => {
      baked = true;
      return "should-not-bake.jpg";
    });

    await expect(getMaskedImagePath("refused-card")).resolves.toBeNull();
    expect(baked).toBe(false);
    expect(takeCoverageRefusal("refused-card")).toBe("name_text_visible");
  });

  it("answers the masked route with 422 before any bake", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "packpts-fail-"));
    setMaskReadySidecarDirForTests(dir);
    writeMaskFailureSidecar("refused-card", "name_text_visible", dir);
    let baked = false;
    setMaskPathLoaderForTests(async () => {
      baked = true;
      return "should-not-bake.jpg";
    });
    let status = 0;
    let body: { error?: string } = {};
    const res = {
      setHeader() { return this; },
      status(code: number) { status = code; return this; },
      json(payload: { error?: string }) { body = payload; return this; },
    };
    await sendMaskedCard(
      { headers: {} } as Request,
      res as unknown as Response,
      "refused-card",
    );
    expect(status).toBe(422);
    expect(body.error).toBe("Playable mask refused");
    expect(baked).toBe(false);
  });
});
