/**
 * Copy/rename Design play-sets exports into the static assets folder.
 * Never invent art — only copy files that exist on disk.
 */
import fs from "fs";
import path from "path";
import {
  PLAY_SETS_DESIGN_EXPORT_DIR,
  PLAY_SETS_DESIGN_EXPORT_MAP,
} from "@shared/playSetsShare";

export function playSetsDesignExportDir(cwd = process.cwd()): string {
  return path.resolve(cwd, PLAY_SETS_DESIGN_EXPORT_DIR);
}

export function copyPlaySetsDesignExports(opts?: {
  sourceDir?: string;
  destDir?: string;
}): { copied: string[]; missing: string[] } {
  const sourceDir = opts?.sourceDir ?? playSetsDesignExportDir();
  const destDir = opts?.destDir ?? path.resolve(process.cwd(), "client/public/assets/play-sets");
  fs.mkdirSync(destDir, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];
  for (const { from, to } of PLAY_SETS_DESIGN_EXPORT_MAP) {
    const src = path.join(sourceDir, from);
    if (!fs.existsSync(src)) {
      missing.push(from);
      continue;
    }
    const dest = path.join(destDir, to);
    fs.copyFileSync(src, dest);
    copied.push(dest);
  }
  return { copied, missing };
}
