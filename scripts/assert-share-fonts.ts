/**
 * SOCIAL_PNG_QA font gate — fail the job if Inter or DejaVu is missing.
 * Run: npx tsx scripts/assert-share-fonts.ts
 */
import { assertShareFontsPresent } from "../server/contentFactory/fonts";

const found = assertShareFontsPresent();
console.log("[ShareFonts] Inter", found.interDir);
console.log("[ShareFonts] DejaVu", found.dejaVuRegular);
