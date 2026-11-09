/**
 * Synthetic exact-output precheck. No scans, names, or source URLs.
 * The paint gates stay 28 and 30. An antialiased edge is not an interior hole.
 * Uncovered name ink outside the plate still holds.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderMeasuredProposal } from "../services/baseballExpansion/discoveryCohort";
import {
  EXACT_FILL_RGB,
  PAINTED_FILL_MAX_DELTA,
  PAINTED_SOURCE_MIN_DELTA,
  SHORT_SURNAME_RESIDUAL_HOLD,
  TRUE_INTERIOR_HOLD,
  chebyshev,
  classifyPaint,
  evaluateExactOutputPrecheck,
} from "../services/baseballExpansion/exactOutputPrecheck";

const CAPSULE: [number, number, number] = [29, 170, 216];
const INK: [number, number, number] = [231, 253, 255];
const BLEND: [number, number, number] = [164, 170, 142];

function blank(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(width * height * 3);
  for (let i = 0; i < buffer.length; i += 3) {
    buffer[i] = CAPSULE[0];
    buffer[i + 1] = CAPSULE[1];
    buffer[i + 2] = CAPSULE[2];
  }
  return buffer;
}

function put(buffer: Buffer, width: number, x: number, y: number, rgb: readonly number[]): void {
  const index = (y * width + x) * 3;
  buffer[index] = rgb[0]!;
  buffer[index + 1] = rgb[1]!;
  buffer[index + 2] = rgb[2]!;
}

describe("exact output precheck", () => {
  it("keeps the paint gates and labels the known edge blend as antialiasing", () => {
    expect(PAINTED_FILL_MAX_DELTA).toBe(28);
    expect(PAINTED_SOURCE_MIN_DELTA).toBe(30);
    expect(chebyshev(BLEND, EXACT_FILL_RGB)).toBe(32);
    expect(chebyshev(BLEND, INK)).toBe(113);
    expect(classifyPaint(INK, BLEND)).toBe("changed_not_solid");
    expect(classifyPaint(INK, EXACT_FILL_RGB)).toBe("solid_fill");
    expect(classifyPaint(INK, INK)).toBe("unpainted");
  });

  it("does not treat an antialiased boundary as an interior hole, and still holds residual ink", () => {
    const width = 30;
    const height = 24;
    const polygon = [[6, 8], [22, 8], [22, 18], [6, 18]] as const;
    const source = blank(width, height);
    const opaque = blank(width, height);
    put(source, width, 12, 12, INK);
    put(opaque, width, 12, 12, EXACT_FILL_RGB);
    put(source, width, 10, 8, INK);
    put(opaque, width, 10, 8, BLEND);
    for (let i = 0; i < SHORT_SURNAME_RESIDUAL_HOLD; i += 1) {
      put(source, width, 8 + i, 4, INK);
      put(opaque, width, 8 + i, 4, INK);
    }
    const result = evaluateExactOutputPrecheck({
      width, height, source, opaque, polygon, capsule: CAPSULE, badgeXMax: -1, shortSurname: true,
    });
    expect(result.aaEdge).toBe(1);
    expect(result.trueInterior).toBe(0);
    expect(result.interiorDefect).toBe(false);
    expect(result.aaEdgeCountsAsInteriorDefect).toBe(false);
    expect(result.residualNameInk).toBe(SHORT_SURNAME_RESIDUAL_HOLD);
    expect(result.residualHold).toBe(true);
    expect(result.verdict).toBe("hold_residual_ink");
    expect(result.releaseAuthorized).toBe(false);
    expect(result.solidFill).toBeGreaterThan(0);
  });

  it("passes when the only uncovered name ink is the antialiased edge", () => {
    const width = 30;
    const height = 24;
    const polygon = [[6, 8], [22, 8], [22, 18], [6, 18]] as const;
    const source = blank(width, height);
    const opaque = blank(width, height);
    put(source, width, 12, 12, INK);
    put(opaque, width, 12, 12, EXACT_FILL_RGB);
    put(source, width, 10, 8, INK);
    put(opaque, width, 10, 8, BLEND);
    const result = evaluateExactOutputPrecheck({
      width, height, source, opaque, polygon, capsule: CAPSULE, badgeXMax: -1,
    });
    expect(result.aaEdge).toBe(1);
    expect(result.trueInterior).toBe(0);
    expect(result.residualNameInk).toBe(0);
    expect(result.interiorDefect).toBe(false);
    expect(result.residualHold).toBe(false);
    expect(result.verdict).toBe("pass_exact_output");
    expect(result.releaseAuthorized).toBe(false);
  });

  it("holds a real interior miss that was not painted", () => {
    const width = 30;
    const height = 24;
    const polygon = [[6, 8], [22, 8], [22, 18], [6, 18]] as const;
    const source = blank(width, height);
    const opaque = blank(width, height);
    for (let i = 0; i < TRUE_INTERIOR_HOLD; i += 1) {
      put(source, width, 10 + i, 12, INK);
      put(opaque, width, 10 + i, 12, INK);
    }
    const result = evaluateExactOutputPrecheck({
      width, height, source, opaque, polygon, capsule: CAPSULE, badgeXMax: -1,
    });
    expect(result.trueInterior).toBe(TRUE_INTERIOR_HOLD);
    expect(result.aaEdge).toBe(0);
    expect(result.interiorDefect).toBe(true);
    expect(result.verdict).toBe("hold_interior");
    expect(result.releaseAuthorized).toBe(false);
  });

  it("sees the renderer cover the interior and leave ink outside the plate", async () => {
    const width = 48;
    const height = 36;
    const polygon = [[8, 12], [36, 12], [36, 28], [8, 28]];
    const cream: [number, number, number] = [242, 240, 236];
    const raw = blank(width, height);
    for (let y = 18; y <= 20; y += 1) for (let x = 18; x <= 21; x += 1) put(raw, width, x, y, cream);
    for (let y = 4; y <= 5; y += 1) for (let x = 18; x <= 21; x += 1) put(raw, width, x, y, cream);
    const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
    const sha = (await import("crypto")).createHash("sha256").update(jpeg).digest("hex");
    const rendered = await renderMeasuredProposal({
      jpeg,
      proposal: {
        setId: "synthetic",
        memberKey: "synthetic",
        supplierId: "synthetic",
        sourceSha256: sha,
        width,
        height,
        geometryVersion: "plate-polygon-v1",
        polygonPixels: polygon,
        polygonNormalized: polygon.map(([x, y]) => [x / width, y / height]),
      },
      member: { originalSha256: sha, originalWidth: width, originalHeight: height, supplierId: "synthetic", setId: "synthetic" },
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.approval).toBe(false);
    const source = await sharp(jpeg).raw().toBuffer();
    const opaque = await sharp(rendered.native).raw().toBuffer();
    const result = evaluateExactOutputPrecheck({
      width, height, source, opaque, polygon, capsule: CAPSULE, badgeXMax: -1, shortSurname: true,
    });
    expect(result.trueInterior).toBe(0);
    expect(result.residualNameInk).toBeGreaterThan(0);
    expect(result.residualHold).toBe(true);
    expect(result.verdict).toBe("hold_residual_ink");
    expect(result.releaseAuthorized).toBe(false);
    const interior = (19 * width + 19) * 3;
    expect(chebyshev([opaque[interior]!, opaque[interior + 1]!, opaque[interior + 2]!], EXACT_FILL_RGB)).toBeLessThanOrEqual(PAINTED_FILL_MAX_DELTA);
    const outside = (5 * width + 20) * 3;
    expect(chebyshev([opaque[outside]!, opaque[outside + 1]!, opaque[outside + 2]!], EXACT_FILL_RGB)).toBeGreaterThan(PAINTED_FILL_MAX_DELTA);
  });
});
