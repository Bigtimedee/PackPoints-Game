import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
const store = readFileSync(new URL("../../pages/store.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../../../server/routes.ts", import.meta.url), "utf8");
describe("store bundles wiring", () => {
  it("reads the bundles route the server actually serves", () => {
    expect(store).toContain('queryKey: ["/api/store/bundles"]');
    expect(store).toContain("data?.bundles");
    expect(routes).toContain('app.get("/api/store/bundles"');
    expect(store).not.toContain("/api/store/products");
  });
  it("sends the return URLs checkout and subscribe require", () => {
    expect(store).toContain('"/api/store/checkout", { sku, ...storeReturnUrls() }');
    expect(store).toContain('"/api/store/subscribe", { sku, ...storeReturnUrls() }');
  });
  it("bundles response carries stripeConfigured", () => {
    expect(routes).toMatch(/res\.json\(\{ bundles, stripeConfigured \}\)/);
  });
  it("uses the points heading and intro", () => {
    expect(store).toContain("Get points");
    expect(store).toContain("Points let you keep playing and work toward rebates on real cards.");
    expect(store).not.toMatch(/for play only|don't count toward rebates|only from points you earn/);
  });
});
