import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  canAccessMake,
  containsForbiddenPublicMakeCopy,
} from "../makeAccess";

const PUBLIC_SURFACES = [
  "../../pages/home.tsx",
  "../../pages/browse-sets.tsx",
  "../../pages/set-page.tsx",
  "../../pages/profile.tsx",
  "../../components/header.tsx",
  "../../components/mobile-nav.tsx",
] as const;

describe("canAccessMake", () => {
  it("reopens /make for guests and non-staff", () => {
    expect(canAccessMake({ isAdmin: true })).toBe(true);
    expect(canAccessMake({ isAdmin: false })).toBe(true);
    expect(canAccessMake(null)).toBe(true);
    expect(canAccessMake(undefined)).toBe(true);
    expect(canAccessMake({})).toBe(true);
  });
});

describe("public UI lock", () => {
  it("keeps home, browse, set, profile, and nav free of Make / publish-PC CTAs", () => {
    for (const rel of PUBLIC_SURFACES) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src, rel).not.toMatch(/href=["']\/make["']/);
      expect(src, rel).not.toMatch(/navigate\(["']\/make["']\)/);
      expect(src, rel).not.toMatch(/setLocation\(["']\/make["']\)/);
      expect(containsForbiddenPublicMakeCopy(src), rel).toBe(false);
    }
  });
});
