/**
 * Host play-sets kit PNGs in client/public.
 * Prefers Design exports (copy/rename only). Eng cream generate is fallback
 * for missing files — never invent new creatives when Design is present.
 * Run: npx tsx scripts/generate-play-sets-kit.ts
 */
import path from "path";
import { copyPlaySetsDesignExports } from "../server/contentFactory/copyPlaySetsDesign";
import { writePlaySetsKitFiles, writePlaySetsStoryFiles } from "../server/contentFactory/generatePlaySetsKit";

const outDir = path.resolve("client/public/assets/play-sets");
const design = copyPlaySetsDesignExports({ destDir: outDir });
for (const file of design.copied) {
  console.log(`design ${file}`);
}
if (design.copied.length === 0) {
  console.warn("Design exports missing at packpts-design/play-sets/exports/; leaving existing kit files.");
}

const needFallback = design.copied.length === 0;
if (needFallback) {
  const written = [
    ...await writePlaySetsKitFiles(outDir),
    ...await writePlaySetsStoryFiles(outDir),
  ];
  for (const file of written) {
    console.log(`generated ${file}`);
  }
}
