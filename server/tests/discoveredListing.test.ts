import { describe, it, expect, beforeAll } from "vitest";
import {
  generateListingToken,
  generateOutboundToken,
  verifyDiscoveredListing,
} from "../services/marketplace/outbound";

const listing = {
  source: "ebay" as const,
  listingId: "123456789012",
  url: "https://www.ebay.com/itm/123456789012",
  title: "1987 Topps test card",
  price: { amount: 42.5, currency: "USD" },
};

describe("PackPTS applies only to listings the app showed", () => {
  beforeAll(() => {
    process.env.OUTBOUND_SECRET = process.env.OUTBOUND_SECRET || "test-outbound-secret";
  });

  it("accepts a token the server issued and returns server-side price and url", () => {
    const v = verifyDiscoveredListing(generateListingToken(listing), { source: "ebay", listingId: listing.listingId });
    expect(v).toMatchObject({ listingUrl: listing.url, priceCents: 4250, currency: "USD" });
  });

  it("rejects a missing token", () => {
    expect(verifyDiscoveredListing(undefined, { source: "ebay", listingId: listing.listingId })).toBeNull();
    expect(verifyDiscoveredListing("", { source: "ebay", listingId: listing.listingId })).toBeNull();
  });

  it("rejects a forged or edited token", () => {
    const [enc, sig] = generateListingToken(listing).split(".");
    const edited = JSON.parse(Buffer.from(enc, "base64url").toString());
    edited.priceCents = 4_000_000;
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`;
    expect(verifyDiscoveredListing(forged, { source: "ebay", listingId: listing.listingId })).toBeNull();
    expect(verifyDiscoveredListing("not.a.token", { source: "ebay", listingId: listing.listingId })).toBeNull();
  });

  it("rejects a token for a different listing or source", () => {
    const t = generateListingToken(listing);
    expect(verifyDiscoveredListing(t, { source: "ebay", listingId: "999" })).toBeNull();
    expect(verifyDiscoveredListing(t, { source: "goldin", listingId: listing.listingId })).toBeNull();
  });

  it("rejects an old-style token with no price", () => {
    const t = generateOutboundToken({ source: "ebay", listingId: listing.listingId, destinationUrl: listing.url });
    expect(verifyDiscoveredListing(t, { source: "ebay", listingId: listing.listingId })).toBeNull();
  });

  it("rejects an expired token", () => {
    const real = Date.now;
    const t = generateListingToken(listing);
    Date.now = () => real() + 2 * 3600 * 1000;
    try {
      expect(verifyDiscoveredListing(t, { source: "ebay", listingId: listing.listingId })).toBeNull();
    } finally {
      Date.now = real;
    }
  });
});
