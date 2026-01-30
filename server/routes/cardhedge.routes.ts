import { Router, Request, Response } from "express";
import type {
  CardSearchRequest,
  CardSearchSortedRequest,
  ImageSearchRequest,
  CardDetailsRequest,
  CardHedgeApiResponse,
  CardSearchResponse,
  ImageSearchResponse,
  CardDetails,
} from "../../shared/cardhedge/types";
import { cardSearch, cardSearchSorted, imageSearch, cardDetails, CardHedgeError } from "../integrations/cardhedge/client";
import { fetchEnoughCards } from "../integrations/cardhedge/fetchEnoughCards";

const router = Router();

const VALID_CATEGORIES = ["Baseball", "Basketball", "Football", "Hockey", "Soccer", "Pokemon"];

function sendError(res: Response, code: string, message: string, status: number = 400): void {
  const response: CardHedgeApiResponse<never> = {
    ok: false,
    error: { code, message, status },
  };
  res.status(status).json(response);
}

function sendSuccess<T>(res: Response, data: T): void {
  const response: CardHedgeApiResponse<T> = { ok: true, data };
  res.json(response);
}

router.post("/search", async (req: Request, res: Response) => {
  try {
    const body = req.body as CardSearchRequest;

    if (!body.search && !body.set && !body.category && !body.player) {
      return sendError(res, "VALIDATION_ERROR", "At least one of search, set, category, or player is required", 422);
    }

    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      console.log(`[CardHedge] Warning: non-standard category "${body.category}"`);
    }

    const params: CardSearchRequest = {
      search: body.search || null,
      set: body.set || null,
      category: body.category || null,
      player: body.player || null,
      rookie: body.rookie ?? null,
      raw_images_only: body.raw_images_only ?? true,
      page: Math.max(body.page || 1, 1),
      page_size: Math.min(Math.max(body.page_size || 50, 1), 100),
    };

    const result = await cardSearch(params, { rawImagesOnly: true, filterPlaceholders: true });
    sendSuccess<CardSearchResponse>(res, result);
  } catch (error) {
    handleCardHedgeError(res, error);
  }
});

router.post("/search-sorted", async (req: Request, res: Response) => {
  try {
    const body = req.body as CardSearchSortedRequest;

    if (!body.search && !body.set && !body.category && !body.player) {
      return sendError(res, "VALIDATION_ERROR", "At least one of search, set, category, or player is required", 422);
    }

    const params: CardSearchSortedRequest = {
      search: body.search || null,
      set: body.set || null,
      category: body.category || null,
      player: body.player || null,
      rookie: body.rookie ?? null,
      raw_images_only: body.raw_images_only ?? true,
      page: Math.max(body.page || 1, 1),
      page_size: Math.min(Math.max(body.page_size || 50, 1), 100),
      sort_by: body.sort_by,
      sort_order: body.sort_order,
    };

    const result = await cardSearchSorted(params, { rawImagesOnly: true, filterPlaceholders: true });
    sendSuccess<CardSearchResponse>(res, result);
  } catch (error) {
    handleCardHedgeError(res, error);
  }
});

router.post("/card-details", async (req: Request, res: Response) => {
  try {
    const body = req.body as CardDetailsRequest;

    if (!body.card_id || typeof body.card_id !== "string") {
      return sendError(res, "VALIDATION_ERROR", "card_id is required", 422);
    }

    const params: CardDetailsRequest = {
      card_id: body.card_id,
      raw_images_only: body.raw_images_only ?? true,
    };

    const result = await cardDetails(params);
    sendSuccess<CardDetails>(res, result);
  } catch (error) {
    handleCardHedgeError(res, error);
  }
});

router.post("/image-search", async (req: Request, res: Response) => {
  try {
    const body = req.body as ImageSearchRequest;

    if (!body.image_url && !body.image_base64) {
      return sendError(res, "MISSING_IMAGE_INPUT", "Either image_url or image_base64 is required", 400);
    }

    const params: ImageSearchRequest = {
      image_url: body.image_url || null,
      image_base64: body.image_base64 || null,
      k: Math.min(Math.max(body.k || 10, 1), 50),
    };

    const result = await imageSearch(params);

    type ResponseWithBestMatch = ImageSearchResponse & {
      best_match?: { card_id: string; similarity: number };
    };
    
    const response: ResponseWithBestMatch = { ...result };

    if (result.results && result.results.length > 0) {
      const sorted = [...result.results].sort((a, b) => 
        parseFloat(b.similarity) - parseFloat(a.similarity)
      );
      
      const best = sorted[0];
      const similarity = parseFloat(best.similarity);
      
      if (similarity >= 85 && best.card_data?.card_id) {
        response.best_match = {
          card_id: best.card_data.card_id,
          similarity,
        };
      }
    }

    sendSuccess(res, response);
  } catch (error) {
    handleCardHedgeError(res, error);
  }
});

router.post("/fetch-enough", async (req: Request, res: Response) => {
  try {
    const body = req.body as CardSearchRequest & { min_cards?: number; max_pages?: number };

    if (!body.search && !body.set && !body.category && !body.player) {
      return sendError(res, "VALIDATION_ERROR", "At least one of search, set, category, or player is required", 422);
    }

    const minCards = Math.min(Math.max(body.min_cards || 50, 1), 200);
    const maxPages = Math.min(Math.max(body.max_pages || 5, 1), 10);

    const result = await fetchEnoughCards(body, minCards, maxPages);
    sendSuccess(res, result);
  } catch (error) {
    handleCardHedgeError(res, error);
  }
});

function handleCardHedgeError(res: Response, error: unknown): void {
  if (error instanceof CardHedgeError) {
    sendError(res, error.code, error.message, error.status);
  } else if (error instanceof Error) {
    console.error("[CardHedge Route] Error:", error);
    sendError(res, "INTERNAL_ERROR", error.message, 500);
  } else {
    console.error("[CardHedge Route] Unknown error:", error);
    sendError(res, "INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
}

export default router;
