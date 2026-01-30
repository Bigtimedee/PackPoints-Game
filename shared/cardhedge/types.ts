export type Category =
  | "Baseball"
  | "Basketball"
  | "Football"
  | "Hockey"
  | "Soccer"
  | "Pokemon"
  | string;

export type CardSearchCard = {
  card_id: string;
  category: Category;
  category_group?: string;
  description: string;
  player: string;
  set: string;
  set_type?: string;
  number?: string;
  variant?: string;
  rookie?: boolean;
  image: string;
  sales_7day?: number;
  sales_30day?: number;
  gain?: number;
  gain_30day?: number;
};

export type CardSearchRequest = {
  search?: string | null;
  set?: string | null;
  category?: Category | null;
  player?: string | null;
  rookie?: boolean | "Rookie" | null;
  raw_images_only?: boolean | null;
  page?: number;
  page_size?: number;
};

export type CardSearchSortedRequest = CardSearchRequest & {
  sort_by?: string;
  sort_order?: "asc" | "desc";
};

export type CardSearchResponse = {
  pages: number;
  count: number;
  cards: CardSearchCard[];
};

export type ImageSearchRequest = {
  image_url?: string | null;
  image_base64?: string | null;
  k?: number;
};

export type CardData = {
  card_id: string;
  description?: string;
  player?: string;
  set?: string;
  number?: string;
};

export type ImageSearchResultItem = {
  similarity: string;
  distance: number;
  ximilar_id?: string;
  product_id?: string | null;
  card_data?: CardData | null;
};

export type ImageSearchResponse = {
  success: boolean;
  results: ImageSearchResultItem[];
  total_results: number;
  query_id: string;
  has_cardhedge_matches: boolean;
  message?: string | null;
};

export type CardDetailsRequest = {
  card_id: string;
  raw_images_only?: boolean | null;
};

export type CardDetails = {
  cards: CardSearchCard[];
};

export type CardHedgeApiResponse<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
  };
};

export type FetchEnoughCardsResult = {
  pages_scanned: number;
  pages: number;
  count: number;
  cards: CardSearchCard[];
};
