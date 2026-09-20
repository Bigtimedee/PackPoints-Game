/**
 * brandMark.test.ts
 *
 * Two-role SoR: B masked-P in app chrome; A masked-card on marketing only.
 * Header ships Design's B wordmark companion as packpts-logo.png (394×128).
 * The glossy 3-card shield must not return.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("PackPTS brand mark — B in app chrome", () => {
  it("keeps the locked SVG master", () => {
    const svg = readFileSync(path.join(ROOT, "client/public/packpts-mark.svg"), "utf8");
    expect(svg).toContain("#0b0f16");
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("M292 196");
  });

  it("ships Design B wordmark as packpts-logo.png (not the shield)", async () => {
    const logoPath = path.join(ROOT, "client/src/assets/packpts-logo.png");
    expect(existsSync(logoPath)).toBe(true);
    const meta = await sharp(logoPath).metadata();
    expect(meta.width).toBe(394);
    expect(meta.height).toBe(128);
    const header = readFileSync(path.join(ROOT, "client/src/components/header.tsx"), "utf8");
    expect(header).toContain("packpts-logo.png");
    expect(header).toContain("img-logo");
    expect(header).not.toContain("/packpts-mark.svg");
  });

  it("lists the maskable PWA icon and hosts the X avatar as B", () => {
    const manifest = readFileSync(path.join(ROOT, "client/public/manifest.webmanifest"), "utf8");
    expect(manifest).toContain("icon-512-maskable.png");
    expect(manifest).toContain("maskable");
    expect(
      existsSync(path.join(ROOT, "client/public/assets/brand/playpackpts-avatar-masked-p-1024.png")),
    ).toBe(true);
  });
});
