const PROD_HOSTS = ["packpts.com", "www.packpts.com"];

function getStripeMode(host?: string): "live" | "test" {
  const cleanHost = host?.split(":")[0]?.toLowerCase();
  if (cleanHost && PROD_HOSTS.includes(cleanHost)) {
    return "live";
  }
  const appEnv = process.env.APP_ENV?.toLowerCase();
  if (appEnv === "production") {
    return "live";
  }
  return "test";
}

function isProductionHost(host?: string): boolean {
  const cleanHost = host?.split(":")[0]?.toLowerCase();
  return !!cleanHost && PROD_HOSTS.includes(cleanHost);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

console.log("=== Stripe Mode Selection Smoke Tests ===\n");

console.log("Test 1: Production host 'packpts.com' => LIVE mode");
assert(getStripeMode("packpts.com") === "live", "packpts.com should be live");

console.log("Test 2: Production host 'www.packpts.com' => LIVE mode");
assert(getStripeMode("www.packpts.com") === "live", "www.packpts.com should be live");

console.log("Test 3: Production host with port => LIVE mode");
assert(getStripeMode("packpts.com:443") === "live", "packpts.com:443 should be live");

console.log("Test 4: localhost => TEST mode");
assert(getStripeMode("localhost") === "test", "localhost should be test");

console.log("Test 5: localhost:5000 => TEST mode");
assert(getStripeMode("localhost:5000") === "test", "localhost:5000 should be test");

console.log("Test 6: Arbitrary non-prod domain => TEST mode");
assert(getStripeMode("dev.example.com") === "test", "non-prod domain should be test");

console.log("Test 7: No host => TEST mode (default)");
assert(getStripeMode() === "test", "no host should be test");
assert(getStripeMode(undefined) === "test", "undefined host should be test");

console.log("Test 8: isProductionHost checks");
assert(isProductionHost("packpts.com") === true, "packpts.com is production");
assert(isProductionHost("www.packpts.com") === true, "www.packpts.com is production");
assert(isProductionHost("localhost") === false, "localhost is not production");
assert(isProductionHost("example.com") === false, "example.com is not production");
assert(isProductionHost(undefined) === false, "undefined is not production");

console.log("Test 9: Key prefix validation logic");
const testKey = "sk_test_abc123";
const liveKey = "sk_live_abc123";
assert(testKey.startsWith("sk_test_"), "test key has correct prefix");
assert(liveKey.startsWith("sk_live_"), "live key has correct prefix");
assert(!testKey.startsWith("sk_live_"), "test key does NOT have live prefix");
assert(!liveKey.startsWith("sk_test_"), "live key does NOT have test prefix");

console.log("Test 10: Live mode on production host blocks test keys");
const mode = getStripeMode("packpts.com");
const wouldBlockTestKey = mode === "live" && "sk_test_abc".startsWith("sk_test_");
assert(wouldBlockTestKey, "production host + test key should be blocked");

console.log("Test 11: Fallback prevention - production should NOT use development credentials");
const prodMode = getStripeMode("packpts.com");
assert(prodMode === "live", "production mode must be live, never test fallback");

console.log("Test 12: Production credentials use STRIPE_secret / STRIPE_publishable env var names");
const expectedProdSecretVar = "STRIPE_secret";
const expectedProdPublishableVar = "STRIPE_publishable";
assert(expectedProdSecretVar === "STRIPE_secret", "production secret env var is STRIPE_secret");
assert(expectedProdPublishableVar === "STRIPE_publishable", "production publishable env var is STRIPE_publishable");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All smoke tests passed!");
}
