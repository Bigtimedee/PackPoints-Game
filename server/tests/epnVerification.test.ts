import { describe, it, expect } from "vitest";
import { canonicalEbayItem, matchesEpnIntent, parseEpnMoney, verifyEpnSecret } from "../services/epnVerification";

describe("EPN evidence verification", () => {
  const secret = "s".repeat(40);
  it("fails closed on absent, short, wrong or non-string secrets", () => {
    expect(verifyEpnSecret(undefined, secret)).toBe(false);
    expect(verifyEpnSecret("short", "short")).toBe(false);
    for (const supplied of [undefined, [secret], "x".repeat(40), "s".repeat(39)]) {
      expect(verifyEpnSecret(secret, supplied)).toBe(false);
    }
    expect(verifyEpnSecret(secret, secret)).toBe(true);
  });
  it("rejects missing, negative, malformed, overflow and partial money", () => {
    for (const value of [undefined, "", "0", "-1", "NaN", "Infinity", "70abc", "7e1", "70.001", "9007199254740992"]) {
      expect(parseEpnMoney(value)).toBeNull();
    }
    expect(parseEpnMoney("70.00")).toBe(7000);
    expect(parseEpnMoney("0.01")).toBe(1);
  });
  it("normalizes only exact REST item ids, never prefix or URL substrings", () => {
    expect(canonicalEbayItem("v1|191860799962|0")).toBe("191860799962");
    expect(canonicalEbayItem("19186079996")).not.toBe("191860799962");
  });
  const intent = { userId: "owner", source: "ebay", listingId: "v1|191860799962|0", priceCents: 7000, currency: "USD", createdAt: new Date(1000) };
  const click = { id: "click", userId: "owner", source: "ebay", listingId: "191860799962", createdAt: new Date(2000) };
  it("requires user, item, USD price, source and click after apply", () => {
    expect(matchesEpnIntent(intent, click, 7000)).toBe(true);
    for (const change of [{userId:null}, {userId:"other"}, {listingId:"19186079996"}, {source:"goldin"}, {createdAt:new Date(500)}, {createdAt:null}, {id:""}]) {
      expect(matchesEpnIntent(intent, {...click, ...change}, 7000)).toBe(false);
    }
    expect(matchesEpnIntent(intent, click, 6999)).toBe(true); // lower total: prorated credit
    expect(matchesEpnIntent(intent, click, 0)).toBe(false);
    expect(matchesEpnIntent(intent, click, 70_001)).toBe(false); // over 10 x the applied price
    expect(matchesEpnIntent({...intent, currency:"EUR"}, click, 7000)).toBe(false);
  });
});

import { epnItemList, epnMoneyList, resolveEpnLine, normalizeEpnCustomId } from "../services/epnVerification";
import { generateEpnCustomId } from "../services/marketplace/outbound";
describe("EPN item lists ({join(items...)})", () => {
  it("splits joined item ids and Browse ids", () => {
    expect(epnItemList("407243534695")).toEqual(["407243534695"]);
    expect(epnItemList("407243534695,191860799962")).toEqual(["407243534695", "191860799962"]);
    expect(epnItemList("[407243534695; 191860799962]")).toEqual(["407243534695", "191860799962"]);
    expect(epnItemList("v1|407243534695|0")).toEqual(["407243534695"]);
  });
  it("picks the clicked line and its price", () => {
    expect(resolveEpnLine("v1|407243534695|0", "407243534695", "1.49")).toEqual({ itemId: "407243534695", salePriceCents: 149 });
    expect(resolveEpnLine("v1|407243534695|0", "191860799962,407243534695", "3.00,1.49")).toEqual({ itemId: "407243534695", salePriceCents: 149 });
    expect(resolveEpnLine("v1|407243534695|0", "407243534695", "1.49 USD")).toEqual({ itemId: "407243534695", salePriceCents: 149 });
    expect(resolveEpnLine("v1|407243534695|0", "191860799962", "1.49")).toBeNull();
    expect(resolveEpnLine("v1|407243534695|0", "407243534695,1", "1.49,2,3")).toBeNull();
    expect(epnMoneyList("$1.49")).toEqual([149]);
  });
  it("new customids carry the numeric item id, no '|'", () => {
    const id = generateEpnCustomId("0125683a-f641-4318", "v1|407243534695|0");
    expect(id).toContain(":i_407243534695:");
    expect(id).not.toContain("|");
  });
  it("normalizes echoed customids", () => {
    expect(normalizeEpnCustomId("packpts:u_x:i_v1|4072435346|:t_ab-c")).toBe("packpts:u_x:i_v14072435346:t_ab-c");
  });
});
