import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("plaque options are fixed per set, slot, card and CT day", () => {
  const src = fs.readFileSync(path.join(__dirname, "../services/setCovers.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function plaqueOptions"), src.indexOf("export async function handlePublicSetCoverPlaque"));
  it("uses an HMAC seed from a server secret and no randomness", () => {
    expect(fn).toContain('createHmac("sha256", plaqueSecret()).update(key)');
    expect(fn).toContain("const key = `${setId}|${slot}|${day}|${cardId}`");
    expect(fn).not.toMatch(/randomInt|Math\.random/);
    expect(src).toMatch(/process\.env\.SESSION_SECRET \|\| process\.env\.JWT_SECRET/);
  });
  it("orders the pool deterministically before ranking", () => {
    expect(fn).toContain(".orderBy(asc(playableCards.id))");
  });
});
