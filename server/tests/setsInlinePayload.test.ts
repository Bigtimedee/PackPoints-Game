import { describe, expect, it, vi } from "vitest";

const ID = "2b77043a-6583-4d79-b59d-d2ab20291a17";
const cover = `/api/sets/${ID}/covers/0`;

vi.mock("../services/publicSets", () => ({
  listIntegratedPublicSets: async () => [
    { id: ID, setName: "1986 Topps Baseball", year: 1986, brand: "Topps", sport: "baseball", cardCount: 407, coverCardUrls: [cover], coverVersions: ["abcdef012345"] },
  ],
}));
vi.mock("../lib/setsCoversDisabled", () => ({ setsCoversDisabled: () => false }));

describe("/sets inline payload", () => {
  it("inlines the /api/sets list as JSON (replacing the fetch preload) with masked cover URLs only", async () => {
    const { decorateSpaIndexPage } = await import("../lib/spaIndexHtml");
    const shell = '<html><head><title>x</title></head><body><div id="root"><!--seo-content--></div></body></html>';
    const { html, status } = await decorateSpaIndexPage(shell, "/sets");
    expect(status).toBe(200);
    const m = /<script type="application\/json" id="pp-sets-data">([\s\S]*?)<\/script>/.exec(html);
    expect(m).toBeTruthy();
    const payload = JSON.parse(m![1]);
    expect(payload.sets).toHaveLength(1);
    expect(payload.sets[0].coverCardUrls).toEqual([cover]);
    expect(html).not.toContain('href="/api/sets?limit=50"');
    expect(html).not.toMatch(/bubble\.io|\/api\/images\/card|\/api\/cards\//);
    // Every cover the page references is a masked set cover slot.
    for (const u of html.match(/\/api\/sets\/[^"\s?]+/g) || []) expect(u).toMatch(/^\/api\/sets\/[0-9a-f-]{36}\/covers\/[0-7]$/);
  });
});
