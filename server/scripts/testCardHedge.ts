import { cardSearch } from "../integrations/cardhedge/client";

async function runTests() {
  console.log("=== CardHedge Integration Smoke Tests ===\n");
  
  let passed = 0;
  let failed = 0;
  
  async function test(name: string, fn: () => Promise<boolean>) {
    try {
      const result = await fn();
      if (result) {
        console.log(`✓ ${name}`);
        passed++;
      } else {
        console.log(`✗ ${name} - assertion failed`);
        failed++;
      }
    } catch (error) {
      console.log(`✗ ${name} - ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }
  
  await test("1. API Key Configured", async () => {
    return !!process.env.CARDHEDGE_API_KEY;
  });
  
  await test("2. Basic Search Returns Cards", async () => {
    const result = await cardSearch(
      { search: "Topps", page: 1, page_size: 5 },
      { rawImagesOnly: false, filterPlaceholders: false }
    );
    console.log(`   - Count: ${result.count}, Pages: ${result.pages}, Cards returned: ${result.cards.length}`);
    return result.cards.length > 0;
  });
  
  await test("3. 1987 Topps Set Search", async () => {
    const result = await cardSearch(
      { set: "1987 Topps Baseball", page: 1, page_size: 10 },
      { rawImagesOnly: false, filterPlaceholders: false }
    );
    console.log(`   - Total count: ${result.count}, Pages: ${result.pages}`);
    return result.count > 0;
  });
  
  await test("4. Cards Have Required Fields", async () => {
    const result = await cardSearch(
      { search: "1987 Topps", page: 1, page_size: 5 },
      { rawImagesOnly: false, filterPlaceholders: false }
    );
    const card = result.cards[0];
    if (!card) return false;
    
    const hasFields = !!(card.card_id && card.player && card.set);
    console.log(`   - Sample card: ${card.player} - ${card.set}`);
    console.log(`   - Has image: ${!!card.image}`);
    return hasFields;
  });
  
  await test("5. Raw Images Filter Works", async () => {
    const result = await cardSearch(
      { search: "Topps Baseball", page: 1, page_size: 20, raw_images_only: true },
      { rawImagesOnly: true, filterPlaceholders: false }
    );
    console.log(`   - Raw images count: ${result.count}`);
    return result.cards.length > 0;
  });
  
  await test("6. Count Uses Metadata (Not Array Length)", async () => {
    const result = await cardSearch(
      { search: "Topps", page: 1, page_size: 10 },
      { rawImagesOnly: false, filterPlaceholders: false }
    );
    const metadataCount = result.count;
    const arrayLength = result.cards.length;
    console.log(`   - Metadata count: ${metadataCount}, Array length: ${arrayLength}`);
    return metadataCount > arrayLength;
  });
  
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
