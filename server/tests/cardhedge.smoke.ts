/**
 * CardHedge API Smoke Test
 * Run with: npx tsx server/tests/cardhedge.smoke.ts
 * 
 * Tests all CardHedge API endpoints to verify they're working correctly.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

async function testSearch(): Promise<TestResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/cardhedge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: "Ohtani", category: "Baseball", page_size: 5 }),
    });
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Search failed");
    if (!Array.isArray(data.data?.cards)) throw new Error("No cards array returned");
    if (data.data.cards.length === 0) throw new Error("No cards found");
    
    return { name: "Search", passed: true, duration: Date.now() - start };
  } catch (error) {
    return { name: "Search", passed: false, duration: Date.now() - start, error: String(error) };
  }
}

async function testSearchSorted(): Promise<TestResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/cardhedge/search-sorted`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        search: "Trout", 
        category: "Baseball", 
        page_size: 10,
        sort_by: "sales_30day",
        sort_order: "desc"
      }),
    });
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Search sorted failed");
    if (!Array.isArray(data.data?.cards)) throw new Error("No cards array returned");
    
    return { name: "Search Sorted", passed: true, duration: Date.now() - start };
  } catch (error) {
    return { name: "Search Sorted", passed: false, duration: Date.now() - start, error: String(error) };
  }
}

async function testCardDetails(): Promise<TestResult> {
  const start = Date.now();
  try {
    // First get a card ID from search
    const searchResponse = await fetch(`${BASE_URL}/api/cardhedge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: "Ohtani", category: "Baseball", page_size: 1 }),
    });
    const searchData = await searchResponse.json();
    
    if (!searchData.ok || !searchData.data?.cards?.[0]?.card_id) {
      throw new Error("Could not get card ID for details test");
    }
    
    const cardId = searchData.data.cards[0].card_id;
    
    const response = await fetch(`${BASE_URL}/api/cardhedge/card-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: cardId }),
    });
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Card details failed");
    if (!Array.isArray(data.data?.cards)) throw new Error("No cards array returned");
    if (data.data.cards.length === 0) throw new Error("Card not found in details");
    
    return { name: "Card Details", passed: true, duration: Date.now() - start };
  } catch (error) {
    return { name: "Card Details", passed: false, duration: Date.now() - start, error: String(error) };
  }
}

async function testImageSearch(): Promise<TestResult> {
  const start = Date.now();
  try {
    // Use a sample card image URL for testing
    const testImageUrl = "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721089050927x363050362695842370/crop_image";
    
    const response = await fetch(`${BASE_URL}/api/cardhedge/image-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: testImageUrl, k: 5 }),
    });
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Image search failed");
    if (!Array.isArray(data.data?.results)) throw new Error("No results array returned");
    
    return { name: "Image Search", passed: true, duration: Date.now() - start };
  } catch (error) {
    return { name: "Image Search", passed: false, duration: Date.now() - start, error: String(error) };
  }
}

async function runTests() {
  console.log("🔍 CardHedge API Smoke Tests\n");
  console.log(`Base URL: ${BASE_URL}\n`);
  
  const results: TestResult[] = [];
  
  // Run tests sequentially to avoid rate limiting
  results.push(await testSearch());
  results.push(await testSearchSorted());
  results.push(await testCardDetails());
  results.push(await testImageSearch());
  
  // Print results
  console.log("\n📊 Results:\n");
  let passed = 0;
  let failed = 0;
  
  for (const result of results) {
    const status = result.passed ? "✅" : "❌";
    console.log(`${status} ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    if (result.passed) passed++;
    else failed++;
  }
  
  console.log(`\n📈 Summary: ${passed}/${results.length} tests passed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
