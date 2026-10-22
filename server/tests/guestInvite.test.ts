import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clampDailyScore, guestInviteBanner, guestInviteDisplayName, guestInviteExpiry, GUEST_INVITE_TTL_MS } from "@shared/guestInvite";

describe("guest invite copy and expiry", () => {
  it("says Beat X's N/5 and falls back when there is no username", () => {
    expect(guestInviteBanner("Casey", 3)).toBe("Beat Casey's 3/5");
    expect(guestInviteBanner("a player", 4)).toBe("Beat a player's 4/5");
    expect(guestInviteBanner("Casey Jones", 2)).toBe("Beat a player's 2/5");
    expect(guestInviteDisplayName("")).toBe("a player");
    expect(clampDailyScore(9)).toBe(5);
    expect(clampDailyScore(-1)).toBe(0);
  });

  it("expires 30 days after it is issued", () => {
    const from = Date.parse("2026-10-22T00:00:00Z");
    expect(guestInviteExpiry(from).getTime() - from).toBe(GUEST_INVITE_TTL_MS);
    expect(GUEST_INVITE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("migrates on claim and sends friends to Daily 5", () => {
    const claim = readFileSync(new URL("../services/anonIdentity.ts", import.meta.url), "utf8");
    const routes = readFileSync(new URL("../routes/referrals.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("../services/guestInvites.ts", import.meta.url), "utf8");
    expect(claim).toContain("migrateGuestInvites(");
    expect(routes).toContain("/daily5?ref=");
    expect(routes).toContain("redeemGuestInvite(");
    expect(service).toContain("evaluateWelcomeBonus(");
    expect(service).not.toContain("earn(");
  });
});
