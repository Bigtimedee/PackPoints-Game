import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readServedIndexBuildId } from "../lib/servedBuildId";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readServedIndexBuildId", () => {
  it("returns the build id embedded in the served index.html", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packpts-build-"));
    dirs.push(dir);
    const file = path.join(dir, "index.html");
    fs.writeFileSync(
      file,
      `<html><head><meta name="packpts-build-id" content="abc123def" /></head><body></body></html>`,
    );
    expect(readServedIndexBuildId([file])).toBe("abc123def");
    expect(readServedIndexBuildId([path.join(dir, "missing.html")])).toBeNull();
  });
});
