import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { withUtm } from "@shared/utm";

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

describe("withUtm", () => {
  it("tags PackPTS links and keeps existing utm values", () => {
    expect(withUtm("https://packpts.com", { source: "share", medium: "share_card", campaign: "score" }))
      .toBe("https://packpts.com/?utm_source=share&utm_medium=share_card&utm_campaign=score");
    expect(withUtm("https://packpts.com/daily?utm_source=x", { source: "share", medium: "m", campaign: "c" }))
      .toBe("https://packpts.com/daily?utm_source=x&utm_medium=m&utm_campaign=c");
    expect(withUtm("https://ebay.com/itm/1", { source: "s", medium: "m", campaign: "c" })).toBe("https://ebay.com/itm/1");
  });
  it("brand links in emails and shares are tagged", () => {
    expect(read("server/services/emailService.ts")).not.toMatch(/href="\$\{siteUrl\}"/);
    expect(read("server/services/newsletterService.ts")).toContain('campaign: "newsletter"');
    expect(read("server/services/rebateService.ts")).toContain('campaign: "rebate_receipt"');
    expect(read("client/src/pages/game.tsx")).not.toContain('shareUrl="https://packpts.com"');
    expect(read("client/src/pages/match.tsx")).not.toContain("url: 'https://packpts.com',");
  });
});
