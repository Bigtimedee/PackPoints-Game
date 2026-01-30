import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface CardSearchCard {
  card_id: string;
  category?: string;
  category_group?: string;
  description?: string;
  player?: string;
  set?: string;
  set_type?: string;
  number?: string;
  variant?: string;
  rookie?: boolean;
  image?: string;
  sales_7day?: number;
  sales_30day?: number;
  gain?: number;
  gain_30day?: number;
}

export interface CardSearchResponse {
  ok: boolean;
  data: {
    pages?: number;
    count?: number;
    cards: CardSearchCard[];
  };
  error?: string;
}

export interface CardSearchParams {
  search?: string;
  player?: string;
  set?: string;
  category?: string;
  page?: number;
  page_size?: number;
  raw_images_only?: boolean;
  rookie?: boolean;
}

export interface CardSearchSortedParams extends CardSearchParams {
  sort_by?: "sales_7day" | "sales_30day" | "gain" | "gain_30day";
  sort_order?: "asc" | "desc";
}

export interface ImageSearchParams {
  image_url?: string;
  image_base64?: string;
  k?: number;
}

export interface ImageSearchResult {
  similarity: string;
  distance: number;
  card_data?: {
    card_id: string;
    description?: string;
    player?: string;
    set?: string;
    number?: string;
  } | null;
}

export interface ImageSearchResponse {
  ok: boolean;
  data: {
    success: boolean;
    results: ImageSearchResult[];
    total_results: number;
    query_id: string;
    has_cardhedge_matches: boolean;
    best_match?: { card_id: string; similarity: number };
  };
  error?: string;
}

export interface CardDetailsResponse {
  ok: boolean;
  data: {
    cards: CardSearchCard[];
  };
  error?: string;
}

export function useCardSearch(params: CardSearchParams, options?: { enabled?: boolean }) {
  return useQuery<CardSearchResponse>({
    queryKey: ["/api/cardhedge/search", params],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/cardhedge/search", params);
      return response.json();
    },
    enabled: options?.enabled !== false && (!!params.search || !!params.player || !!params.set),
    staleTime: 60 * 1000,
  });
}

export function useCardSearchSorted(params: CardSearchSortedParams, options?: { enabled?: boolean }) {
  return useQuery<CardSearchResponse>({
    queryKey: ["/api/cardhedge/search-sorted", params],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/cardhedge/search-sorted", params);
      return response.json();
    },
    enabled: options?.enabled !== false && (!!params.search || !!params.player || !!params.set),
    staleTime: 60 * 1000,
  });
}

export function useCardDetails(cardId: string | null, options?: { enabled?: boolean }) {
  return useQuery<CardDetailsResponse>({
    queryKey: ["/api/cardhedge/card-details", cardId],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/cardhedge/card-details", { card_id: cardId });
      return response.json();
    },
    enabled: options?.enabled !== false && !!cardId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useImageSearchMutation() {
  const queryClient = useQueryClient();
  
  return useMutation<ImageSearchResponse, Error, ImageSearchParams>({
    mutationFn: async (params) => {
      const response = await apiRequest("POST", "/api/cardhedge/image-search", params);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardhedge/image-search"] });
    },
  });
}

export function useImageSearch(params: ImageSearchParams | null, options?: { enabled?: boolean }) {
  return useQuery<ImageSearchResponse>({
    queryKey: ["/api/cardhedge/image-search", params?.image_url || params?.image_base64?.slice(0, 50)],
    queryFn: async () => {
      if (!params) throw new Error("Image search params required");
      const response = await apiRequest("POST", "/api/cardhedge/image-search", params);
      return response.json();
    },
    enabled: options?.enabled !== false && !!params && (!!params.image_url || !!params.image_base64),
    staleTime: 5 * 60 * 1000,
  });
}
