import fs from "fs";
import path from "path";
import { readBuildIdFromIndexHtml, selectServedBuildId } from "@shared/buildVersion";
import { resolveBuildId } from "./resolveBuildId";

function bundleDir(): string {
  // esbuild's CJS server bundle defines __dirname as dist/, same as server/static.ts.
  // typeof does not throw when the ESM dev server has no __dirname.
  if (typeof __dirname === "string" && __dirname) return __dirname;
  return process.cwd();
}

export function indexHtmlCandidates(): string[] {
  const here = bundleDir();
  return [
    path.resolve(here, "public/index.html"),
    path.resolve(process.cwd(), "dist/public/index.html"),
    path.resolve(here, "dist/public/index.html"),
  ];
}

let cachedIndexBuildId: string | null = null;

export function readServedIndexBuildId(candidates?: string[]): string | null {
  if (!candidates && cachedIndexBuildId) return cachedIndexBuildId;
  const files = candidates ?? indexHtmlCandidates();
  for (const filePath of files) {
    try {
      const html = fs.readFileSync(filePath, "utf8");
      const id = readBuildIdFromIndexHtml(html);
      if (id) {
        if (!candidates) cachedIndexBuildId = id;
        return id;
      }
    } catch {
      // Try the next location. Dev has no built index; production uses dist/public.
    }
  }
  return null;
}

/**
 * Production reports the id embedded in the index.html this process serves.
 * Development uses the same in-process id Vite define injected, so a stale
 * dist/public/index.html cannot disagree with the dev bundle.
 */
export function getServedBuildId(): string {
  const fallback = resolveBuildId();
  if (process.env.NODE_ENV !== "production") return fallback;
  return selectServedBuildId(readServedIndexBuildId(), fallback);
}
