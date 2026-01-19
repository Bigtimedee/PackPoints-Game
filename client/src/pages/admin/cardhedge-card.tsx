import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Search, ImageIcon, DollarSign, TrendingUp, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface NormalizedCardDetails {
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

export default function AdminCardHedgeCard() {
  const { toast } = useToast();
  const [cardIdInput, setCardIdInput] = useState("");
  const [rawImagesOnly, setRawImagesOnly] = useState(false);
  const [searchParams, setSearchParams] = useState<{ cardId: string; rawImagesOnly: boolean } | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const queryUrl = searchParams 
    ? `/api/cardhedge/card/${encodeURIComponent(searchParams.cardId)}?rawImagesOnly=${searchParams.rawImagesOnly}`
    : null;

  const { data: cardDetails, isLoading, error } = useQuery<NormalizedCardDetails>({
    queryKey: [queryUrl],
    enabled: !!queryUrl,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const handleSearch = () => {
    if (!cardIdInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter a card ID",
        variant: "destructive",
      });
      return;
    }
    setSearchParams({ cardId: cardIdInput.trim(), rawImagesOnly });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl" data-testid="container-cardhedge-lookup">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-page-title">
            <Search className="h-5 w-5" />
            CardHedge Card Lookup
          </CardTitle>
          <CardDescription data-testid="text-page-description">
            Test the CardHedge card details API by entering a card ID
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="cardId">Card ID</Label>
              <Input
                id="cardId"
                data-testid="input-card-id"
                placeholder="Enter CardHedge card_id..."
                value={cardIdInput}
                onChange={(e) => setCardIdInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="rawImagesOnly"
                data-testid="switch-raw-images"
                checked={rawImagesOnly}
                onCheckedChange={setRawImagesOnly}
              />
              <Label htmlFor="rawImagesOnly" className="text-sm" data-testid="label-raw-images">
                Raw Images Only
              </Label>
            </div>
            <Button
              data-testid="button-fetch-card"
              onClick={handleSearch}
              disabled={isLoading || !cardIdInput.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Fetch Card
                </>
              )}
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md" data-testid="container-error">
              <p className="text-sm text-destructive" data-testid="text-error-message">
                {(error as Error).message}
              </p>
            </div>
          )}

          {cardDetails && (
            <div className="space-y-6" data-testid="container-card-details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  {cardDetails.imageUrl ? (
                    <div className="relative aspect-[3/4] bg-muted rounded-lg overflow-hidden" data-testid="container-card-image">
                      <img
                        src={cardDetails.imageUrl}
                        alt={cardDetails.description || "Card image"}
                        className="w-full h-full object-contain"
                        data-testid="img-card-preview"
                      />
                    </div>
                  ) : (
                    <div className="aspect-[3/4] bg-muted rounded-lg flex items-center justify-center" data-testid="container-no-image">
                      <ImageIcon className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold" data-testid="text-player-name">
                      {cardDetails.player || "Unknown Player"}
                    </h3>
                    <p className="text-sm text-muted-foreground" data-testid="text-card-description">
                      {cardDetails.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2" data-testid="container-badges">
                    {cardDetails.rookie && (
                      <Badge variant="default" data-testid="badge-rookie">
                        <Star className="h-3 w-3 mr-1" />
                        Rookie
                      </Badge>
                    )}
                    {cardDetails.category && (
                      <Badge variant="secondary" data-testid="badge-category">{cardDetails.category}</Badge>
                    )}
                    {cardDetails.setType && (
                      <Badge variant="outline" data-testid="badge-set-type">{cardDetails.setType}</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4" data-testid="container-card-info">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Set</Label>
                      <p className="text-sm font-medium" data-testid="text-set-name">{cardDetails.set}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Number</Label>
                      <p className="text-sm font-medium" data-testid="text-card-number">{cardDetails.number}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Variant</Label>
                      <p className="text-sm font-medium" data-testid="text-variant">{cardDetails.variant || "Base"}</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Card ID</Label>
                      <p className="text-sm font-mono text-muted-foreground" data-testid="text-card-id">{cardDetails.cardId}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-4 border-t" data-testid="container-sales-data">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg font-bold" data-testid="text-sales-7d">
                          {cardDetails.sales7d ?? "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">7-Day Sales</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg font-bold" data-testid="text-sales-30d">
                          {cardDetails.sales30d ?? "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">30-Day Sales</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg font-bold" data-testid="text-gain">
                          {cardDetails.gain !== null ? `${cardDetails.gain > 0 ? "+" : ""}${cardDetails.gain.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">Gain</p>
                    </div>
                  </div>

                  {cardDetails.prices && cardDetails.prices.length > 0 && (
                    <div className="pt-4 border-t" data-testid="container-prices">
                      <Label className="text-xs text-muted-foreground">Prices by Grade</Label>
                      <div className="mt-2 space-y-1">
                        {cardDetails.prices.map((p, i) => (
                          <div key={i} className="flex justify-between text-sm" data-testid={`row-price-${i}`}>
                            <span className="text-muted-foreground" data-testid={`text-grade-${i}`}>{p.grade}</span>
                            <span className="font-medium" data-testid={`text-price-${i}`}>${p.price}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t" data-testid="container-raw-json">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Raw JSON Response</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="button-toggle-json"
                    onClick={() => setShowRawJson(!showRawJson)}
                  >
                    {showRawJson ? "Hide" : "Show"}
                  </Button>
                </div>
                {showRawJson && (
                  <pre
                    className="p-4 bg-muted rounded-md text-xs overflow-auto max-h-96"
                    data-testid="text-raw-json"
                  >
                    {JSON.stringify(cardDetails.raw, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {!cardDetails && !isLoading && !error && searchParams && (
            <div className="text-center py-8 text-muted-foreground" data-testid="container-no-results">
              No card found with that ID
            </div>
          )}

          {!searchParams && (
            <div className="text-center py-12 text-muted-foreground" data-testid="container-empty-state">
              <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Enter a card ID and click "Fetch Card" to see details</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
