/** Exact-source, visually inspected first cohort. Not a metadata-based approval of all base cards.
 * Portrait originals were inspected 2026-10-06. Source hash/name/id must all match;
 * changing an image or expanding the cohort requires another layout review.
 * Live bakes and explicit post-bake QA are still required. The set remains held.
 */
import type { MaskRegion } from "@shared/schema";
export const TOPPS_1988_SET_ID = "affd57b8-2b1d-4ea3-9f51-1530d8088e5c";
export const TOPPS_1988_PROFILE_ID = "1988-topps-diagonal-reviewed-v1";
/** Conservative stair-step triangle over the slanted lower-right name ribbon.
 * 12 narrow overlapping strips, never a full-width bottom band. 13.85% area.
 * The inspected faces and upper bodies remain entirely outside this corner.
 */
export const TOPPS_1988_REGIONS: readonly MaskRegion[] = Array.from({ length: 12 }, (_, i) => {
  const x = 40 + i * 5;
  const y = 100 - (x + 5 - 40) * 0.7 - 1;
  return { xPct: x, yPct: y, wPct: Math.min(5.2, 100 - x), hPct: 100 - y, type: "blur" as const, radiusPct: 0 };
});
export interface ReviewedToppsSource { cardId: string; player: string; number: string; imageUrl: string; sha256: string }
export const TOPPS_1988_REVIEWED_SOURCES: readonly ReviewedToppsSource[] = [
  {
    "cardId": "002e0c66-c1c9-4084-afba-eb28acaa2e8d",
    "player": "Jim Presley",
    "number": "285",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168111638x423406014295006460/resize",
    "sha256": "f63728bc423d13e4601da192ae74e9995e1e6d0e6ab94cb8c2caec05805e3546"
  },
  {
    "cardId": "0047f249-6173-4083-9344-2d619c80515b",
    "player": "Neal Heaton",
    "number": "765",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463929355x234297227906887550/resize",
    "sha256": "acd7fbcec260bc995139a142409e0086ca9e65cda10e9cb34cff2b993bfff94b"
  },
  {
    "cardId": "01579e64-c557-4ea4-8e6d-48a533836d50",
    "player": "John Farrell",
    "number": "533",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721405140277x345773170480552240/crop_image",
    "sha256": "0e34b7148505d89d346a45c48dcfbd5e529ac971b769a0a905afd5024fe24b28"
  },
  {
    "cardId": "01699363-f81b-4158-8960-991ccbcba7e3",
    "player": "Donnie Moore",
    "number": "471",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601951339x813980121183987200/resize",
    "sha256": "2cfbdb2e05ddad228e7e6fee86d04f62716baad9afdfe87e145ed5d3106d555d"
  },
  {
    "cardId": "01c0d709-44ef-459e-b00e-8de39c79519e",
    "player": "Dennis Boyd",
    "number": "704",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724466070039x935766033914894100/crop_image",
    "sha256": "48bd777cbc5af124c8c8a35ed60e8ad8b8db13e03096b2c32965f3bd8b5a0a98"
  },
  {
    "cardId": "0258d36f-c940-4151-bfae-13404ec30888",
    "player": "Jim Fregosi",
    "number": "714",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730678460570x788031397806705900/crop_image",
    "sha256": "47f9ed8bfbc18914a5de65bcf1523f5c313779294a87f2d073d40b23e468387b"
  },
  {
    "cardId": "02733163-0f24-48a1-a3c8-d3eaac7b9af8",
    "player": "Glenn Davis",
    "number": "430",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739940195702x261354154220323040/crop_image",
    "sha256": "134c347af89183a389671cabe5edbe2d4cba6863072cd2a94c0e209c7d03b19f"
  },
  {
    "cardId": "0383d01c-fe53-4b8d-a1a4-c007c0dab3ad",
    "player": "Mickey Hatcher",
    "number": "607",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726738435056x721496835705651700/crop_image",
    "sha256": "e648be59ef50507e889db27f36cb05201e178e3d4b0e8cda605a4a6a31ed7feb"
  },
  {
    "cardId": "03afa332-dfb5-45f0-a989-fe3677e9e458",
    "player": "Rick Leach",
    "number": "323",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779482473682x172910393660043140/resize",
    "sha256": "affbff38645753429d4560842c0e486b40659952f4871c2fe49834d2646de93a"
  },
  {
    "cardId": "040fc8b3-308e-4552-9829-70afb0dbc33f",
    "player": "Rafael Santana",
    "number": "233",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998740x118185961239120940/crop_image",
    "sha256": "92c0be9df6509ffb104f7f6ee88a8b5daff34bc2ea1e3f28f3ae4e2a0575efca"
  }
];
export function isTopps1988Plan(plan: unknown): boolean {
  if (!plan || typeof plan !== "object") return false;
  const p = plan as { layoutClass?: string; regions?: MaskRegion[] };
  return p.layoutClass === "BOTTOM_PLAQUE" && Array.isArray(p.regions)
    && p.regions.length === TOPPS_1988_REGIONS.length
    && p.regions.every((r, i) => {
      const expected = TOPPS_1988_REGIONS[i];
      return r.type === expected.type && r.radiusPct === 0
        && ["xPct", "yPct", "wPct", "hPct"].every((key) =>
          Math.abs(Number(r[key as keyof MaskRegion]) - Number(expected[key as keyof MaskRegion])) < 1e-8);
    });
}
