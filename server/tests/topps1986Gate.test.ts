import { describe, expect, it } from "vitest";
const { passesSourceAspectGate, TOPPS_1986_SOURCE_ASPECT_GATE: G, getMaskProfile } = await import("../masking/maskProfiles");
describe("1986 Topps source aspect gate", () => {
  it("keeps base scans, refuses composites, landscape and low-res", () => {
    expect(passesSourceAspectGate(705, 1200, G)).toBe(false); // 0.5875
    expect(passesSourceAspectGate(747, 1028, G)).toBe(true);
    expect(passesSourceAspectGate(1188, 829, G)).toBe(false);
    expect(passesSourceAspectGate(362, 495, G)).toBe(true);
    expect(passesSourceAspectGate(300, 410, G)).toBe(false);
  });
  it("is not set on any live profile", () => {
    for (const id of ["3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4","37fd025d-2ae1-4c92-b8ad-133375d0c722","91cfdf3f-a620-4e73-adc8-22b8df221716","aea515e2-24bc-42bd-a602-1514b89e8cd1","352b33d1-c110-4e09-b641-8e3c02a94442","a09b2fe7-728e-431b-9df8-bbf2652aa3b2","3235b4fd-858a-424b-b9df-6f0f2d070d1b"])
      expect(getMaskProfile(null, id).sourceAspectGate).toBeUndefined();
    for (const n of ["1990 Hoops Basketball","1989 Fleer Basketball","2024 Topps Baseball","1987 Topps Football","1993 Chronicles"])
      expect(getMaskProfile(n).sourceAspectGate).toBeUndefined();
  });
  it("registers Design's 1986 Topps fixed band by id and hint", () => {
    const p = getMaskProfile(null, "2b77043a-6583-4d79-b59d-d2ab20291a17");
    expect(p.id).toBe("1986-topps");
    expect(p.fixedNameBand).toBe(true);
    expect(p.regions).toEqual([{ xPct: 0, yPct: 86, wPct: 100, hPct: 14, type: "blur", radiusPct: 0 }]);
    expect(getMaskProfile("1986 Topps Baseball").id).toBe("1986-topps");
  });
});
