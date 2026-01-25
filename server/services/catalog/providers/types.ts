export type CatalogSport = "Baseball" | "Basketball" | "Football" | "Hockey";

export type SetDefinition = {
  sport: CatalogSport;
  year: number;
  brand?: string;
  setName: string;
  keywords: string[];
};

export type ProviderCard = {
  provider: string;
  providerCardId: string;
  description?: string;
  player?: string;
  set?: string;
  number?: string;
  variant?: string;
  image?: string;
  category?: string;
  setType?: string;
  raw: unknown;
};

export interface DiagnoseCoverageResult {
  ok: boolean;
  notes: string;
  sampleCount: number;
  workingCategories: string[];
}

export interface SearchCardsInput {
  search?: string;
  set?: string;
  category?: string | null;
  page: number;
  pageSize: number;
}

export interface SearchCardsResult {
  pages: number;
  count: number;
  cards: ProviderCard[];
}

export interface CatalogProvider {
  provider: string;
  diagnoseCoverage(input: { sport: CatalogSport }): Promise<DiagnoseCoverageResult>;
  searchCards(input: SearchCardsInput): Promise<SearchCardsResult>;
}
