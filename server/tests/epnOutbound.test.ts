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
