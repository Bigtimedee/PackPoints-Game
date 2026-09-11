/**
 * Write the three Marketing play-sets kit PNGs into client/public.
 * Run: npx tsx scripts/generate-play-sets-kit.ts
 */
import path from "path";
import { writePlaySetsKitFiles } from "../server/contentFactory/generatePlaySetsKit";

const outDir = path.resolve("client/public/assets/play-sets");
const written = await writePlaySetsKitFiles(outDir);
for (const file of written) {
  console.log(file);
}
