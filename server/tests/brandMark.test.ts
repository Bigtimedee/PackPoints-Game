/**
 * brandMark.test.ts
 *
 * Locks the single shipped PackPTS mark: masked-P (white P + gold bar).
 * The glossy 3-card shield (packpts-logo.png) must not ship.
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("PackPTS brand mark — single locked masked-P", () => {
  it("keeps the locked SVG master", () => {
    const svg = readFileSync(path.join(ROOT, "client/public/packpts-mark.svg"), "utf8");
    expect(svg).toContain("#0b0f16");
    expect(svg).toContain("#F5C518");
    expect(svg).toContain("M292 196");
  });

  it("does not ship the glossy shield mark", () => {
    expect(existsSync(path.join(ROOT, "client/src/assets/packpts-logo.png"))).toBe(false);
    const header = readFileSync(path.join(ROOT, "client/src/components/header.tsx"), "utf8");
    expect(header).not.toContain("packpts-logo");
    expect(header).toContain("/packpts-mark.svg");
  });
});
