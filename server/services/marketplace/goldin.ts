import { db } from "../../db";
import { goldinCuratedListings } from "@shared/schema";
import { eq, and, or, sql, ilike, arrayContains } from "drizzle-orm";
import type { Listing, SearchParams } from "./types";
import type { GoldinCuratedListing, InsertGoldinCuratedListing } from "@shared/schema";

export async function getCuratedGoldinListings(params: SearchParams): Promise<Listing[]> {
  const limit = params.limit || 20;
  const query = params.q.toLowerCase();

  const listings = await db.query.goldinCuratedListings.findMany({
    where: and(
      eq(goldinCuratedListings.isActive, true),
      or(
        ilike(goldinCuratedListings.title, `%${query}%`),
        ilike(goldinCuratedListings.description, `%${query}%`),
        sql`${goldinCuratedListings.tags}::text ILIKE ${'%' + query + '%'}`
      )
    ),
    limit,
    orderBy: (listings, { desc }) => [desc(listings.createdAt)],
  });

  return listings.map(normalizeGoldinListing);
}

export async function getAllCuratedGoldinListings(): Promise<Listing[]> {
  const listings = await db.query.goldinCuratedListings.findMany({
    where: eq(goldinCuratedListings.isActive, true),
    orderBy: (listings, { desc }) => [desc(listings.createdAt)],
  });

  return listings.map(normalizeGoldinListing);
}

function normalizeGoldinListing(listing: GoldinCuratedListing): Listing {
  let price: Listing["price"] = null;
  
  if (listing.priceDisplay) {
    const match = listing.priceDisplay.match(/[\d,]+\.?\d*/);
    if (match) {
      price = {
        amount: parseFloat(match[0].replace(/,/g, "")),
        currency: "USD",
      };
    }
  }

  return {
    source: "goldin",
    listingId: listing.id,
    title: listing.title,
    imageUrl: listing.imageUrl || undefined,
    price,
    shipping: null,
    condition: null,
    endTime: listing.endsAt?.toISOString() || null,
    url: listing.destinationUrl,
    lastUpdated: listing.createdAt?.toISOString() || new Date().toISOString(),
  };
}

export async function createCuratedListing(data: InsertGoldinCuratedListing): Promise<GoldinCuratedListing> {
  const [listing] = await db
    .insert(goldinCuratedListings)
    .values(data)
    .returning();
  
  return listing;
}

export async function updateCuratedListing(
  id: string,
  data: Partial<InsertGoldinCuratedListing>
): Promise<GoldinCuratedListing | null> {
  const [listing] = await db
    .update(goldinCuratedListings)
    .set(data)
    .where(eq(goldinCuratedListings.id, id))
    .returning();
  
  return listing || null;
}

export async function deleteCuratedListing(id: string): Promise<boolean> {
  const [listing] = await db
    .update(goldinCuratedListings)
    .set({ isActive: false })
    .where(eq(goldinCuratedListings.id, id))
    .returning();
  
  return !!listing;
}

export async function getCuratedListingById(id: string): Promise<GoldinCuratedListing | null> {
  const listing = await db.query.goldinCuratedListings.findFirst({
    where: eq(goldinCuratedListings.id, id),
  });
  
  return listing || null;
}

export async function getAllCuratedListingsAdmin(): Promise<GoldinCuratedListing[]> {
  return db.query.goldinCuratedListings.findMany({
    orderBy: (listings, { desc }) => [desc(listings.createdAt)],
  });
}
