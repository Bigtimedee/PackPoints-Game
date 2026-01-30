import type { CardSearchCard, CardSearchRequest, FetchEnoughCardsResult } from "../../../shared/cardhedge/types";
import { cardSearch } from "./client";

export async function fetchEnoughCards(
  params: CardSearchRequest,
  minCards: number = 50,
  maxPagesToScan: number = 5
): Promise<FetchEnoughCardsResult> {
  const accumulatedCards: CardSearchCard[] = [];
  let currentPage = params.page || 1;
  let totalPages = 1;
  let totalCount = 0;
  let pagesScanned = 0;

  while (accumulatedCards.length < minCards && pagesScanned < maxPagesToScan) {
    try {
      const response = await cardSearch(
        { ...params, page: currentPage },
        { rawImagesOnly: true, filterPlaceholders: true }
      );

      totalPages = response.pages;
      totalCount = response.count;
      pagesScanned++;

      for (const card of response.cards) {
        if (!accumulatedCards.some(c => c.card_id === card.card_id)) {
          accumulatedCards.push(card);
        }
      }

      console.log(
        `[fetchEnoughCards] Page ${currentPage}: got ${response.cards.length} cards, ` +
        `accumulated ${accumulatedCards.length}/${minCards}`
      );

      if (currentPage >= totalPages) {
        console.log("[fetchEnoughCards] No more pages available");
        break;
      }

      if (response.cards.length === 0) {
        console.log("[fetchEnoughCards] Empty page, stopping");
        break;
      }

      currentPage++;
    } catch (error) {
      console.error("[fetchEnoughCards] Error fetching page:", error);
      break;
    }
  }

  return {
    pages_scanned: pagesScanned,
    pages: totalPages,
    count: totalCount,
    cards: accumulatedCards,
  };
}

export async function fetchCardsWithRetry(
  params: CardSearchRequest,
  minCards: number = 1,
  maxRetries: number = 3
): Promise<CardSearchCard[]> {
  const delays = [250, 500, 1000];
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fetchEnoughCards(params, minCards, 3);
      if (result.cards.length >= minCards) {
        return result.cards;
      }
      
      console.log(
        `[fetchCardsWithRetry] Attempt ${attempt + 1}: got ${result.cards.length}/${minCards} cards`
      );
    } catch (error) {
      console.error(`[fetchCardsWithRetry] Attempt ${attempt + 1} failed:`, error);
    }

    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }

  const finalResult = await fetchEnoughCards(params, minCards, 5);
  return finalResult.cards;
}
