/**
 * TikTok end-to-end smoke test
 *
 * Exercises the full post pipeline:
 *   1. composePostImage  — fetch card, build branded PNG, upload to R2 (or local)
 *   2. generateDraftPost — build copy + hashtags
 *   3. publishPhoto      — send to TikTok (skipped when TIKTOK_ACCESS_TOKEN is absent)
 *
 * Run with:
 *   npx tsx server/services/socialMedia/tests/tiktok.e2e.ts
 *
 * Environment:
 *   Required for image upload test: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *                                   R2_BUCKET_NAME, R2_PUBLIC_URL
 *   Required for TikTok publish test: TIKTOK_ACCESS_TOKEN
 */

import { composePostImage } from "../imageComposer";
import { generateDraftPost } from "../contentGenerator";
import { isStorageConfigured } from "../imageStorage";
import { createLogger } from "../logger";

const logger = createLogger("TikTokE2E");

function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string, err: unknown) { console.error(`  ✗ ${msg}`, err); }

async function testImageCompose(): Promise<string | null> {
  console.log("\n[1] Image composition + storage");
  try {
    const result = await composePostImage({
      platform: "TIKTOK",
      contentType: "TRIVIA_CARD",
      cardQuery: { category: "Baseball", sortBy: "sales_7day" },
    });

    pass(`Card fetched: ${result.cardPlayer} — ${result.cardSet}`);
    pass(`Image path: ${result.imagePath}`);

    if (result.imagePath.startsWith("http")) {
      pass(`R2 upload successful: ${result.imagePath}`);
    } else if (isStorageConfigured()) {
      fail("R2 configured but imagePath is not a URL — upload may have failed", result.imagePath);
    } else {
      pass("R2 not configured — local path stored (expected in dev)");
    }

    return result.imagePath;
  } catch (err) {
    fail("composePostImage threw", err);
    return null;
  }
}

async function testDraftGeneration(): Promise<string> {
  console.log("\n[2] Draft post generation");
  try {
    const draft = await generateDraftPost("TIKTOK", "TRIVIA_CARD");
    pass(`Content type: ${draft.contentType}`);
    pass(`AB group: ${draft.abGroup}`);
    pass(`Copy (${draft.copyText.length} chars): ${draft.copyText.slice(0, 80)}…`);
    pass(`Hashtags: ${draft.hashtags?.join(" ")}`);
    pass(`Fact check passed: ${draft.factCheckPassed}`);
    return draft.copyText;
  } catch (err) {
    fail("generateDraftPost threw", err);
    return "Test draft — PackPTS card trivia game. Play free at packpts.com";
  }
}

async function testPublish(imageUrl: string, copyText: string): Promise<void> {
  console.log("\n[3] TikTok publish");

  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    console.log("  ⚠ TIKTOK_ACCESS_TOKEN not set — skipping live publish");
    return;
  }

  if (!imageUrl.startsWith("http")) {
    console.log("  ⚠ Image URL is local path — TikTok PULL_FROM_URL requires a public HTTPS URL; skipping publish");
    console.log(`    imagePath: ${imageUrl}`);
    console.log("    → Set R2 credentials to enable full e2e publish test");
    return;
  }

  try {
    const { publishPhoto } = await import("../publisher/tiktok");
    const postId = await publishPhoto(copyText.slice(0, 150), imageUrl);
    pass(`TikTok photo published! platformPostId: ${postId}`);
  } catch (err) {
    fail("publishPhoto threw", err);
  }
}

async function main() {
  console.log("=== TikTok E2E Smoke Test ===");
  console.log(`R2 configured: ${isStorageConfigured()}`);
  console.log(`TikTok token present: ${!!process.env.TIKTOK_ACCESS_TOKEN}`);

  const imageUrl = await testImageCompose();
  const copyText = await testDraftGeneration();
  await testPublish(imageUrl ?? "", copyText);

  console.log("\n=== Done ===\n");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
