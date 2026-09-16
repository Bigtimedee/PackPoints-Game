/**
 * Host play-sets kit PNGs in client/public.
 * Prefers Design exports (copy/rename only). Eng cream generate is fallback
 * for missing files — never invent new creatives when Design is present.
 * Run: npx tsx scripts/generate-play-sets-kit.ts
 */
import fs from "fs";
import path from "path";
import {
  copyPlaySetsDesignExports,
  materializePlaySetsCdnAliases,
} from "../server/contentFactory/copyPlaySetsDesign";
import { writePlaySetsKitFiles, writePlaySetsStoryFiles } from "../server/contentFactory/generatePlaySetsKit";
import { PLAY_SETS_KIT_FILES, PLAY_SETS_STORY_FILES } from "../shared/playSetsShare";

const outDir = path.resolve("client/public/assets/play-sets");
const design = copyPlaySetsDesignExports({ destDir: outDir });
for (const file of design.copied) {
  console.log(`design ${file}`);
}
if (design.copied.length === 0) {
  console.warn("Design exports missing at packpts-design/play-sets/exports/; leaving existing kit files.");
}

const hosted = [
  ...new Set([...Object.values(PLAY_SETS_KIT_FILES), ...Object.values(PLAY_SETS_STORY_FILES)]),
];
const needFallback = hosted.some((file) => !fs.existsSync(path.join(outDir, file)));
if (needFallback) {
  const written = [
    ...await writePlaySetsKitFiles(outDir),
    ...await writePlaySetsStoryFiles(outDir),
  ];
  for (const file of written) {
    console.log(`generated ${file}`);
  }
}

const aliases = materializePlaySetsCdnAliases(outDir);
for (const file of aliases.copied) {
  console.log(`alias ${file}`);
}
