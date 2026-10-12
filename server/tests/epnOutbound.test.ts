import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({values:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../db", () => ({db:{insert:()=>({values:mocks.values})}}));
import { applyEpnTracking, generateEpnCustomId, logOutboundClick } from "../services/marketplace/outbound";

beforeEach(() => mocks.values.mockClear());
describe("EPN click tracking", () => {
  it("generates different IDs even within the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      expect(generateEpnCustomId("owner", "123")).not.toBe(generateEpnCustomId("owner", "123"));
    } finally {vi.restoreAllMocks();}
  });
  it("persists exactly the customid sent to eBay rather than the separately generated ID", async () => {
    const old = process.env.EPN_CAMPID;
    process.env.EPN_CAMPID = "123";
    try {
      const outboundUrl = applyEpnTracking("https://www.ebay.com/itm/123", "owner", "123");
      const actual = new URL(outboundUrl).searchParams.get("customid");
      expect(actual).toBeTruthy();
      await logOutboundClick({source:"ebay",listingId:"123",destinationUrl:"https://www.ebay.com/itm/123",outboundUrl,customId:"wrong-separate-id",userId:"owner",sessionId:null,ip:null,userAgent:null});
      expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({customId:actual,userId:"owner"}));
    } finally {
      if (old === undefined) delete process.env.EPN_CAMPID;
      else process.env.EPN_CAMPID = old;
    }
  });
  it("does not invent attribution when tracking is missing", async () => {
    await logOutboundClick({source:"ebay",listingId:"123",destinationUrl:"https://www.ebay.com/itm/123",outboundUrl:"https://www.ebay.com/itm/123",customId:"invented",userId:"owner",sessionId:null,ip:null,userAgent:null});
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({customId:undefined}));
  });
});

import { buildEpnEbayUrl as __build } from "../services/marketplace/outbound";
describe("EPN smart link format", () => {
  it("carries mkevt=1, mkcid=1, mkrid, campid, customid, toolid and drops stale tracking", () => {
    const u = new URL(__build({ baseEbayUrl: "https://www.ebay.com/itm/407243534695?_skw=x&hash=item1&amdata=enc%3A1&mkevt=0&campid=999", campid: "5339140766", customid: "packpts:u_a:i_407243534695:t_1" }));
    expect(u.pathname).toBe("/itm/407243534695");
    expect(u.searchParams.get("mkevt")).toBe("1");
    expect(u.searchParams.get("mkcid")).toBe("1");
    expect(u.searchParams.get("mkrid")).toBe("711-53200-19255-0");
    expect(u.searchParams.get("siteid")).toBe("0");
    expect(u.searchParams.get("campid")).toBe("5339140766");
    expect(u.searchParams.get("toolid")).toBe("10001");
    expect(u.searchParams.get("customid")).toBe("packpts:u_a:i_407243534695:t_1");
    expect(u.searchParams.has("hash")).toBe(false);
    expect(u.searchParams.has("amdata")).toBe(false);
  });
});
