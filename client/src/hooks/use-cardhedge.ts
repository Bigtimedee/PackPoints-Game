import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  CardSearchCard,
  CardSearchRequest,
  CardSearchSortedRequest,
  CardSearchResponse as BaseCardSearchResponse,
  ImageSearchRequest,
  ImageSearchResponse as BaseImageSearchResponse,
  CardDetails,
  CardHedgeApiResponse,
} from "@shared/cardhedge/types";

export type { CardSearchCard };

export type CardSearchApiResponse = CardHedgeApiResponse<BaseCardSearchResponse>;
export type ImageSearchApiResponse = CardHedgeApiResponse<BaseImageSearchResponse & { best_match?: { card_id: string; similarity: number } }>;
export type CardDetailsApiResponse = CardHedgeApiResponse<CardDetails>;

export type CardSearchParams = CardSearchRequest;
export type CardSearchSortedParams = CardSearchSortedRequest;
export type ImageSearchParams = ImageSearchRequest;

export function useCardSearch(params: CardSearchParams, options?: { enabled?: boolean }) {
  return useQuery<CardSearchApiResponse>({
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
  return useQuery<CardSearchApiResponse>({
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
  return useQuery<CardDetailsApiResponse>({
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
  
  return useMutation<ImageSearchApiResponse, Error, ImageSearchParams>({
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
  return useQuery<ImageSearchApiResponse>({
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
