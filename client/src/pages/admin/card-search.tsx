import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, ImageIcon, ChevronLeft, ChevronRight, Star, TrendingUp, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CardResult {
  cardId: string;
  description: string | null;
  player: string | null;
  set: string | null;
  number: string | null;
  variant: string | null;
  category: string | null;
  categoryGroup: string | null;
  setType: string | null;
  imageUrl: string | null;
  rookie: boolean;
  sales7d: number | null;
  sales30d: number | null;
  gain: number | null;
  prices: Array<{ grade: string; price: string }>;
  raw: Record<string, unknown>;
}

interface SearchResponse {
  pages: number;
  count: number;
  cards: CardResult[];
}

const CATEGORIES = ["Baseball", "Basketball", "Football", "Hockey"];

export default function AdminCardSearch() {
  const { toast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [category, setCategory] = useState<string>("");
  const [setFilter, setSetFilter] = useState("");
  const [rookieOnly, setRookieOnly] = useState(false);
  const [rawImagesOnly, setRawImagesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchParams, setSearchParams] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading, error, isFetching } = useQuery<SearchResponse>({
    queryKey: ["/api/admin/cardhedge/search", searchParams],
    enabled: !!searchParams,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/admin/cardhedge/search", searchParams);
      return res.json();
    },
  });

  const handleSearch = () => {
    const effectiveCategory = category && category !== "all" ? category : null;
    if (!searchText.trim() && !effectiveCategory && !setFilter.trim()) {
      toast({
        title: "Search Required",
        description: "Please enter a search term, select a category, or enter a set name",
        variant: "destructive",
      });
      return;
    }
    setPage(1);
    setSearchParams({
      search: searchText.trim() || null,
      category: effectiveCategory,
      set: setFilter.trim() || null,
      rookie: rookieOnly || null,
      raw_images_only: rawImagesOnly || null,
      page: 1,
      page_size: pageSize,
    });
  };

  const handlePageChange = (newPage: number) => {
    if (!searchParams) return;
    setPage(newPage);
    setSearchParams({
      ...searchParams,
      page: newPage,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl" data-testid="container-card-search">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-page-title">
            <Search className="h-5 w-5" />
            CardHedge Card Search
          </CardTitle>
          <CardDescription data-testid="text-page-description">
            Search the CardHedge database for cards to import or review
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                data-testid="input-search"
                placeholder="Player name, card name..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-category-all">All Categories</SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} data-testid={`option-category-${cat.toLowerCase()}`}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="set">Set</Label>
              <Input
                id="set"
                data-testid="input-set"
                placeholder="e.g. 2018 Topps Chrome"
                value={setFilter}
                onChange={(e) => setSetFilter(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pageSize">Results Per Page</Label>
              <Select value={pageSize.toString()} onValueChange={(v) => setPageSize(parseInt(v))}>
                <SelectTrigger id="pageSize" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="rookieOnly"
                data-testid="switch-rookie"
                checked={rookieOnly}
                onCheckedChange={setRookieOnly}
              />
              <Label htmlFor="rookieOnly" className="text-sm">Rookies Only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="rawImagesOnly"
                data-testid="switch-raw-images"
                checked={rawImagesOnly}
                onCheckedChange={setRawImagesOnly}
              />
              <Label htmlFor="rawImagesOnly" className="text-sm">Raw Images Only</Label>
            </div>
            <Button
              data-testid="button-search"
              onClick={handleSearch}
              disabled={isLoading || isFetching}
            >
              {(isLoading || isFetching) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </>
              )}
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md" data-testid="container-error">
              <p className="text-sm text-destructive" data-testid="text-error-message">
                {(error as Error).message || "Card data temporarily unavailable — retrying"}
              </p>
            </div>
          )}

          {data && (
            <div className="space-y-4" data-testid="container-results">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground" data-testid="text-result-count">
                  Found {data.count} cards ({data.pages} pages)
                </p>
                {data.pages > 1 && (
                  <div className="flex items-center gap-2" data-testid="container-pagination">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-prev-page"
                      disabled={page <= 1 || isFetching}
                      onClick={() => handlePageChange(page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm" data-testid="text-current-page">
                      Page {page} of {data.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-next-page"
                      disabled={page >= data.pages || isFetching}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="container-cards-grid">
                {data.cards.map((card, index) => (
                  <Card key={card.cardId || index} className="overflow-hidden" data-testid={`card-result-${card.cardId || index}`}>
                    <div className="aspect-[3/4] bg-muted relative">
                      {card.imageUrl ? (
                        <img
                          src={card.imageUrl}
                          alt={card.description || "Card"}
                          className="w-full h-full object-contain"
                          data-testid={`img-card-${card.cardId || index}`}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                      {card.rookie && (
                        <Badge variant="default" className="absolute top-2 right-2" data-testid={`badge-rookie-${card.cardId || index}`}>
                          <Star className="h-3 w-3 mr-1" />
                          RC
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-3 space-y-2">
                      <h4 className="font-semibold text-sm line-clamp-1" data-testid={`text-player-${card.cardId || index}`}>
                        {card.player || "Unknown"}
                      </h4>
                      <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`text-description-${card.cardId || index}`}>
                        {card.description}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-set-${card.cardId || index}`}>
                          {card.set}
                        </Badge>
                        {card.number && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-number-${card.cardId || index}`}>
                            #{card.number}
                          </Badge>
                        )}
                        {card.variant && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-variant-${card.cardId || index}`}>
                            {card.variant}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1 pt-2 border-t text-xs">
                        <div className="text-center">
                          <DollarSign className="h-3 w-3 mx-auto text-muted-foreground" />
                          <span data-testid={`text-sales7d-${card.cardId || index}`}>
                            {card.sales7d ?? "—"}
                          </span>
                          <p className="text-muted-foreground text-[10px]">7d</p>
                        </div>
                        <div className="text-center">
                          <DollarSign className="h-3 w-3 mx-auto text-muted-foreground" />
                          <span data-testid={`text-sales30d-${card.cardId || index}`}>
                            {card.sales30d ?? "—"}
                          </span>
                          <p className="text-muted-foreground text-[10px]">30d</p>
                        </div>
                        <div className="text-center">
                          <TrendingUp className="h-3 w-3 mx-auto text-muted-foreground" />
                          <span data-testid={`text-gain-${card.cardId || index}`}>
                            {card.gain !== null ? `${card.gain > 0 ? "+" : ""}${card.gain.toFixed(1)}%` : "—"}
                          </span>
                          <p className="text-muted-foreground text-[10px]">Gain</p>
                        </div>
                      </div>
                      {card.prices && card.prices.length > 0 && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">Prices:</p>
                          <div className="flex flex-wrap gap-1">
                            {card.prices.slice(0, 3).map((p, i) => (
                              <Badge key={i} variant="outline" className="text-xs" data-testid={`badge-price-${card.cardId || index}-${i}`}>
                                {p.grade}: ${p.price}
                              </Badge>
                            ))}
                            {card.prices.length > 3 && (
                              <Badge variant="outline" className="text-xs">+{card.prices.length - 3}</Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {data.pages > 1 && (
                <div className="flex justify-center pt-4" data-testid="container-pagination-bottom">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-prev-page-bottom"
                      disabled={page <= 1 || isFetching}
                      onClick={() => handlePageChange(page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {data.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-next-page-bottom"
                      disabled={page >= data.pages || isFetching}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!data && !isLoading && !error && (
            <div className="text-center py-12 text-muted-foreground" data-testid="container-empty-state">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Enter search criteria and click "Search" to find cards</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
