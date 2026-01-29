import { 
  CatalogProvider, 
  CatalogSport, 
  DiagnoseCoverageResult, 
  ProviderCard, 
  SearchCardsInput, 
  SearchCardsResult 
} from "../types";
import { cardHedgeFetch, CardSearchResponse, normalizeImageUrl } from "../../../cardhedge/client";

export class CardHedgeProvider implements CatalogProvider {
  provider = "cardhedge" as const;

  async diagnoseCoverage(input: { sport: CatalogSport }): Promise<DiagnoseCoverageResult> {
    const { sport } = input;
    const notes: string[] = [];
    const workingCategories: string[] = [];
    let totalSampleCount = 0;

    const categoriesToTry = [
      sport,
      sport.toLowerCase(),
      sport.toUpperCase(),
      null,
    ];

    for (const category of categoriesToTry) {
      try {
        const response = await cardHedgeFetch<CardSearchResponse>(
          "/v1/cards/card-search",
          "POST",
          {
            category: category,
            search: sport,
            page: 1,
            page_size: 5,
          },
          { useCache: false }
        );

        const count = response.count ?? response.cards?.length ?? 0;
        const categoryLabel = category === null ? "(no category filter)" : `"${category}"`;
        
        if (count > 0) {
          notes.push(`Category ${categoryLabel}: ${count} cards found`);
          if (category !== null) {
            workingCategories.push(category);
          }
          totalSampleCount += count;
        } else {
          notes.push(`Category ${categoryLabel}: 0 cards found`);
        }
      } catch (error) {
        const categoryLabel = category === null ? "(no category filter)" : `"${category}"`;
        notes.push(`Category ${categoryLabel}: ERROR - ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    const fallbackResponse = await this.testFallbackSearch(sport);
    notes.push(`Fallback search (sport only): ${fallbackResponse.count} cards found`);
    totalSampleCount += fallbackResponse.count;

    return {
      ok: workingCategories.length > 0 || fallbackResponse.count > 0,
      notes: notes.join("\n"),
      sampleCount: totalSampleCount,
      workingCategories,
    };
  }

  private async testFallbackSearch(sport: string): Promise<{ count: number }> {
    try {
      const response = await cardHedgeFetch<CardSearchResponse>(
        "/v1/cards/card-search",
        "POST",
        {
          search: sport,
          page: 1,
          page_size: 5,
        },
        { useCache: false }
      );
      return { count: response.count ?? response.cards?.length ?? 0 };
    } catch {
      return { count: 0 };
    }
  }

  async searchCards(input: SearchCardsInput): Promise<SearchCardsResult> {
    const { search, set, category, page, pageSize } = input;

    const requestBody: Record<string, unknown> = {
      page,
      page_size: pageSize,
      raw_images_only: true,
    };

    if (search) {
      requestBody.search = search;
    }
    if (set) {
      requestBody.set = set;
    }
    if (category) {
      requestBody.category = category;
    }

    const response = await cardHedgeFetch<CardSearchResponse>(
      "/v1/cards/card-search",
      "POST",
      requestBody
    );

    const cards: ProviderCard[] = (response.cards || []).map((card) => ({
      provider: "cardhedge",
      providerCardId: card.card_id || "",
      description: card.description,
      player: card.player,
      set: card.set,
      number: card.number,
      variant: card.variant,
      image: normalizeImageUrl(card.image) || undefined,
      category: card.category,
      setType: card.set_type,
      raw: card,
    }));

    return {
      pages: response.pages || 1,
      count: response.count ?? response.cards?.length ?? 0,
      cards,
    };
  }
}

export const cardHedgeProvider = new CardHedgeProvider();
