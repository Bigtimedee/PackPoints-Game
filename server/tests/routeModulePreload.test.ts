import { build } from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { injectRouteModulePreload, modulePreloadTags, routeModuleSrc, type ManifestChunk } from "../lib/routeModulePreload";

const manifest: Record<string, ManifestChunk> = {
  "src/main.tsx": { file: "assets/index-aaaaaaaa.js", src: "src/main.tsx", isEntry: true },
  "src/pages/home.tsx": {
    file: "assets/home-bbbbbbbb.js",
    src: "src/pages/home.tsx",
    isDynamicEntry: true,
    imports: ["src/main.tsx", "_shared.js"],
  },
  "src/pages/browse-sets.tsx": {
    file: "assets/browse-sets-cccccccc.js",
    src: "src/pages/browse-sets.tsx",
    isDynamicEntry: true,
    imports: ["_shared.js"],
  },
  "src/pages/daily5.tsx": { file: "assets/daily5-dddddddd.js", src: "src/pages/daily5.tsx", isDynamicEntry: true },
  "src/pages/points.tsx": { file: "assets/points-eeeeeeee.js", src: "src/pages/points.tsx", isDynamicEntry: true },
  "_shared.js": { file: "assets/shared-ffffffff.js" },
};

describe("route module preload", () => {
  it("maps the measured routes onto their page modules", () => {
    expect(routeModuleSrc("/")).toBe("src/pages/home.tsx");
    expect(routeModuleSrc("/daily")).toBe("src/pages/daily5.tsx");
    expect(routeModuleSrc("/sets")).toBe("src/pages/browse-sets.tsx");
    expect(routeModuleSrc("/points")).toBe("src/pages/points.tsx");
    expect(routeModuleSrc("/game/solo")).toBe("src/pages/game.tsx");
  });

  it("preloads only the route chunk, not the shell or every shared import", () => {
    const tags = modulePreloadTags(manifest, "src/pages/home.tsx");
    expect(tags).toEqual(['<link rel="modulepreload" crossorigin href="/assets/home-bbbbbbbb.js" />']);
    const html = injectRouteModulePreload("<html><head></head><body></body></html>", "/sets", manifest);
    expect(html).toContain('href="/assets/browse-sets-cccccccc.js"');
    expect(html).not.toContain("shared-ffffffff.js");
    expect(html).not.toContain("index-aaaaaaaa.js");
    expect(injectRouteModulePreload("<html><head></head></html>", "/nope", manifest)).not.toContain("modulepreload");
  });

  it("does not throw when the server bundle is CJS and import.meta is empty", async () => {
    const outfile = path.join(os.tmpdir(), `route-preload-${process.pid}.cjs`);
    await build({
      entryPoints: [path.resolve(__dirname, "../lib/routeModulePreload.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    expect(() => mod.loadViteManifest()).not.toThrow();
    fs.rmSync(outfile, { force: true });
  });
});
