import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShoppingBag, Zap, ExternalLink, DollarSign, Loader2, CheckCircle, Clock, Search, Timer, AlertCircle, Layers, TrendingDown } from "lucide-react";
import { SiEbay } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/use-wallet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AffiliateDisclosure } from "@/components/affiliate-disclosure";
import type { RedemptionOption, GameSet } from "@shared/schema";

interface RedemptionCardProps {
  option: RedemptionOption;
  userBalance: number;
  onRedeem: (option: RedemptionOption) => void;
  isRedeeming: boolean;
  walletStatus?: "NORMAL" | "RESTRICTED" | "FROZEN" | "UNDER_REVIEW";
}

function RedemptionCard({ option, userBalance, onRedeem, isRedeeming, walletStatus = "NORMAL" }: RedemptionCardProps) {
  const platformIcon = option.platform === "goldin" ? (
    <span className="font-bold text-xs">G</span>
  ) : (
    <SiEbay className="h-4 w-4" />
  );

  const platformName = option.platform === "goldin" ? "Goldin" : "eBay";
  const platformColor = option.platform === "goldin" ? "bg-amber-500" : "bg-blue-500";
  const isWalletActive = walletStatus === "NORMAL";
  const hasEnoughPoints = userBalance >= option.pointsCost;

  return (
    <Card className="overflow-visible hover-elevate" data-testid={`card-redemption-${option.id}`}>
      <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 rounded-t-md relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <ShoppingBag className="h-16 w-16 text-muted-foreground/30" />
        </div>
        <Badge className={`absolute top-3 right-3 ${platformColor} text-white gap-1`}>
          {platformIcon}
          {platformName}
        </Badge>
      </div>
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="font-semibold truncate" data-testid={`text-redemption-title-${option.id}`}>{option.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{option.description}</p>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 font-mono text-sm">
            <DollarSign className="h-4 w-4 text-accent" />
            <span className="font-semibold text-accent" data-testid={`text-usd-value-${option.id}`}>{option.usdValue} USD</span>
          </div>
          <Badge variant="secondary" className="font-mono gap-1" data-testid={`badge-points-cost-${option.id}`}>
            <Zap className="h-3 w-3" />
            {option.pointsCost.toLocaleString()}
          </Badge>
        </div>
        <Button 
          variant="outline" 
          className="w-full gap-2" 
          data-testid={`button-redeem-${option.id}`}
          disabled={!isWalletActive || !hasEnoughPoints || isRedeeming}
          onClick={() => onRedeem(option)}
        >
          {isRedeeming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : !isWalletActive ? (
            "Account Restricted"
          ) : hasEnoughPoints ? (
            <>
              Get Discount
              <ExternalLink className="h-4 w-4" />
            </>
          ) : (
            "Not Enough Points"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function MarketplaceSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {[...Array(8)].map((_, i) => (
        <Card key={i}>
          <Skeleton className="aspect-[4/3] rounded-t-md" />
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface RedemptionTier {
  id: string;
  name: string;
  packptsRequired: number;
  usdCapCents: number;
  effectiveRatePct: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

interface RedemptionResponse {
  success: boolean;
  redemptionId?: string;
  status?: string;
  creditToken?: string;
  message?: string;
  error?: string;
}

interface LiveListing {
  id: string;
  source: "ebay" | "goldin";
  title: string;
  priceCents: number | null;
  currency: string;
  imageUrl: string | null;
  destinationUrl: string;
  condition: string | null;
  endsAt: string | null;
  outboundUrl?: string;
}

interface LiveListingsResponse {
  listings: LiveListing[];
  sources: { ebay: boolean; goldin: boolean };
  cached: boolean;
}

interface GameContext {
  gameSet: GameSet;
  contextKey: string;
}

interface ContextsResponse {
  activeContexts: GameContext[];
  allSets: GameSet[];
  userId: string | null;
}

interface ContextualSearchResult {
  gameSet: GameSet;
  contextKey: string;
  listings: LiveListing[];
  lastUpdated: string;
  cached: boolean;
  broadened: boolean;
  query: string;
}

interface ContextualSearchResponse {
  contexts: ContextualSearchResult[];
  appliedContextIds: string[];
  noteIfBroadened: string | null;
}

function formatTimeRemaining(endsAt: string | null): string {
  if (!endsAt) return "";
  const end = new Date(endsAt);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  if (diffMs < 0) return "Ended";
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

interface QuoteResult {
  rMax: number;
  creditCentsMax: number;
  policySummary: {
    minMargin: number;
    packptsValueUsd: number;
  };
  explanationText: string;
  purchaseIntentId: string;
}

interface BatchQuote {
  listing: { provider: string; externalId: string };
  cashPriceCents: number;
  ptsMaxApplicable: number;
  ptsApplied: number;
  usdDueCents: number;
  usdSavingsCents: number;
  effectiveValuePerPtMicrousds: number;
  reasons: string[];
  ctaLabel: string;
}

interface LiveListingCardProps {
  listing: LiveListing;
  userBalance?: number;
  isAuthenticated?: boolean;
  onRedemptionComplete?: () => void;
  batchQuote?: BatchQuote | null;
  walletStatus?: "NORMAL" | "RESTRICTED" | "FROZEN" | "UNDER_REVIEW";
}

function LiveListingCard({ listing, userBalance = 0, isAuthenticated = false, onRedemptionComplete, batchQuote, walletStatus = "NORMAL" }: LiveListingCardProps) {
  const [showRedemptionModal, setShowRedemptionModal] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [selectedAmount, setSelectedAmount] = useState(0);
  const { toast } = useToast();
  
  // Calculate PackPTS offer from batch quote
  // User can only apply if they have a normal wallet status (not frozen or under review)
  const isWalletActive = walletStatus === "NORMAL";
  const canApplyPackPTS = isWalletActive && batchQuote && batchQuote.ptsMaxApplicable > 0;
  const savingsInDollars = batchQuote ? (batchQuote.usdSavingsCents / 100).toFixed(2) : "0.00";
  const priceWithPackPTS = batchQuote ? (batchQuote.usdDueCents / 100).toFixed(2) : null;
  const ptsToApply = batchQuote?.ptsApplied || 0;
  
  const platformIcon = listing.source === "goldin" ? (
    <span className="font-bold text-xs">G</span>
  ) : (
    <SiEbay className="h-4 w-4" />
  );

  const platformName = listing.source === "goldin" ? "Goldin" : "eBay";
  const platformColor = listing.source === "goldin" ? "bg-amber-500" : "bg-blue-500";
  const timeRemaining = formatTimeRemaining(listing.endsAt);
  const isEndingSoon = listing.endsAt && new Date(listing.endsAt).getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const quoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketplace/redemption/quote", {
        source: listing.source,
        listingId: listing.id,
        listingUrl: listing.destinationUrl,
        priceCents: listing.priceCents || 0,
        currency: listing.currency || "usd",
      });
      return res.json() as Promise<QuoteResult>;
    },
    onSuccess: (data) => {
      setQuote(data);
      if (data.rMax > 0) {
        setSelectedAmount(Math.min(data.rMax, userBalance));
        setShowRedemptionModal(true);
      } else {
        toast({
          title: "Not Eligible",
          description: data.explanationText,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to get redemption quote",
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!quote) throw new Error("No quote available");
      const res = await apiRequest("POST", "/api/marketplace/redemption/apply", {
        purchaseIntentId: quote.purchaseIntentId,
        requestedRedeemPackpts: selectedAmount,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setShowRedemptionModal(false);
      if (data.success) {
        toast({
          title: "PackPTS Reserved",
          description: data.message,
        });
        onRedemptionComplete?.();
        queryClient.invalidateQueries({ queryKey: ["/wallet"] });
      } else {
        toast({
          title: "Redemption Denied",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply redemption",
        variant: "destructive",
      });
    },
  });

  const handleApplyPackPTS = () => {
    if (!isAuthenticated) {
      toast({
        title: "Sign In Required",
        description: "Please sign in to use PackPTS for discounts",
        variant: "destructive",
      });
      return;
    }
    if (!listing.priceCents) {
      toast({
        title: "Price Required",
        description: "Cannot apply PackPTS to listings without a price",
        variant: "destructive",
      });
      return;
    }
    quoteMutation.mutate();
  };

  const creditAmount = quote ? (selectedAmount * (quote.policySummary.packptsValueUsd || 0.002)).toFixed(2) : "0.00";

  return (
    <>
      <Card 
        className="overflow-visible hover-elevate"
        data-testid={`card-listing-${listing.id}`}
      >
        <div className="aspect-[4/3] bg-gradient-to-br from-muted to-muted/50 rounded-t-md relative overflow-hidden">
          {listing.imageUrl ? (
            <img 
              src={listing.imageUrl} 
              alt={listing.title}
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ShoppingBag className="h-16 w-16 text-muted-foreground/30" />
            </div>
          )}
          <Badge className={`absolute top-3 right-3 ${platformColor} text-white gap-1`}>
            {platformIcon}
            {platformName}
          </Badge>
          {isEndingSoon && timeRemaining && (
            <Badge variant="destructive" className="absolute top-3 left-3 gap-1">
              <Timer className="h-3 w-3" />
              {timeRemaining}
            </Badge>
          )}
        </div>
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="font-semibold line-clamp-2 text-sm" data-testid={`text-listing-title-${listing.id}`}>
              {listing.title}
            </h3>
            {listing.condition && (
              <p className="text-xs text-muted-foreground mt-1">{listing.condition}</p>
            )}
          </div>
          {/* Dual Price Display */}
          <div className="space-y-2">
            {listing.priceCents !== null ? (
              <>
                {/* Top Line: Buy Now price */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Buy Now</span>
                  </div>
                  <span className="font-mono font-semibold" data-testid={`text-price-${listing.id}`}>
                    ${(listing.priceCents / 100).toFixed(2)}
                  </span>
                </div>
                
                {/* Second Line: PackPTS offer (highlighted) */}
                {isAuthenticated && canApplyPackPTS && priceWithPackPTS && (
                  <div className="flex items-center justify-between gap-2 bg-accent/10 rounded-md px-2 py-1.5 border border-accent/20">
                    <div className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-accent" />
                      <span className="text-xs font-medium text-accent">With PackPTS:</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-semibold text-accent text-sm" data-testid={`text-packpts-price-${listing.id}`}>
                        {ptsToApply.toLocaleString()} pts + ${priceWithPackPTS}
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Savings badge */}
                {isAuthenticated && canApplyPackPTS && parseFloat(savingsInDollars) >= 0.50 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20 gap-1">
                      <TrendingDown className="h-3 w-3" />
                      Save ${savingsInDollars}
                    </Badge>
                    {parseFloat(savingsInDollars) >= 5 && (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                        Best Price
                      </Badge>
                    )}
                  </div>
                )}
                
                {/* PackPTS unavailable message */}
                {isAuthenticated && batchQuote && !canApplyPackPTS && batchQuote.reasons.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    <span>PackPTS unavailable: {batchQuote.reasons[0]}</span>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Price TBD</span>
            )}
            
            {timeRemaining && !isEndingSoon && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Timer className="h-3 w-3" />
                {timeRemaining}
              </Badge>
            )}
          </div>
          
          {/* CTA Button - Show Apply PackPTS if user can redeem or if no batch quote but has balance */}
          {isAuthenticated && listing.priceCents && isWalletActive && (canApplyPackPTS || (!batchQuote && userBalance > 0)) ? (
            <Button 
              variant="default" 
              className="w-full gap-2" 
              size="sm"
              onClick={handleApplyPackPTS}
              disabled={quoteMutation.isPending}
              data-testid={`button-apply-packpts-${listing.id}`}
            >
              {quoteMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3" />
                  Apply PackPTS
                </>
              )}
            </Button>
          ) : isAuthenticated && !isWalletActive ? (
            <Button 
              variant="secondary" 
              className="w-full gap-2" 
              size="sm"
              disabled
              data-testid={`button-wallet-restricted-${listing.id}`}
            >
              <Zap className="h-3 w-3" />
              Account Restricted
            </Button>
          ) : isAuthenticated && userBalance === 0 ? (
            <Button 
              variant="secondary" 
              className="w-full gap-2" 
              size="sm"
              asChild
              data-testid={`button-earn-packpts-${listing.id}`}
            >
              <a href="/play">
                <Zap className="h-3 w-3" />
                Earn PackPTS
              </a>
            </Button>
          ) : null}
          
          <Button 
            variant="outline" 
            className="w-full gap-2" 
            size="sm"
            asChild
            data-testid={`button-view-listing-${listing.id}`}
          >
            <a 
              href={listing.outboundUrl || "#"} 
              target="_blank" 
              rel="noopener noreferrer"
              aria-label={`View ${listing.title} on ${platformName}`}
            >
              View Listing
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showRedemptionModal} onOpenChange={setShowRedemptionModal}>
        <DialogContent data-testid="dialog-redemption">
          <DialogHeader>
            <DialogTitle>Apply PackPTS to Purchase</DialogTitle>
            <DialogDescription>
              Use your PackPTS as credit toward this purchase on {platformName}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">{listing.title}</p>
              <p>Price: ${((listing.priceCents || 0) / 100).toFixed(2)}</p>
              <p>Your Balance: {userBalance.toLocaleString()} PackPTS</p>
              {quote && <p>Maximum Redeemable: {quote.rMax.toLocaleString()} PackPTS</p>}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="redemption-amount">PackPTS to Apply</Label>
              <div className="flex items-center gap-4">
                <input
                  id="redemption-amount"
                  type="range"
                  min={0}
                  max={Math.min(quote?.rMax || 0, userBalance)}
                  value={selectedAmount}
                  onChange={(e) => setSelectedAmount(Number(e.target.value))}
                  className="flex-1"
                  data-testid="slider-redemption-amount"
                />
                <span className="font-mono text-sm w-24 text-right">
                  {selectedAmount.toLocaleString()}
                </span>
              </div>
            </div>
            
            <div className="bg-muted rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground">Credit Value</p>
              <p className="text-2xl font-bold text-accent" data-testid="text-credit-value">
                ${creditAmount}
              </p>
            </div>
            
            {quote?.rMax === 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p>This listing is not eligible for PackPTS credit due to margin requirements.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRedemptionModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending || selectedAmount === 0}
              data-testid="button-confirm-redemption"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Applying...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Apply {selectedAmount.toLocaleString()} PackPTS
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LiveListingsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {[...Array(8)].map((_, i) => (
        <Card key={i}>
          <Skeleton className="aspect-[4/3] rounded-t-md" />
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Marketplace() {
  const { toast } = useToast();
  const searchParams = useSearch();
  const [selectedOption, setSelectedOption] = useState<RedemptionOption | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [lastRedemption, setLastRedemption] = useState<RedemptionResponse | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "ebay" | "goldin">("all");
  const [sortBy, setSortBy] = useState<"relevance" | "priceAsc" | "priceDesc" | "endingSoon">("relevance");
  
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [useContextualSearch, setUseContextualSearch] = useState(true);
  
  const urlSetId = new URLSearchParams(searchParams).get("setId");
  
  useEffect(() => {
    if (urlSetId) {
      setSelectedSetId(urlSetId);
    }
  }, [urlSetId]);

  const { data: redemptions, isLoading } = useQuery<RedemptionOption[]>({
    queryKey: ["/api/marketplace"],
  });

  const { data: tiersData } = useQuery<{ tiers: RedemptionTier[] }>({
    queryKey: ["/api/redemption/tiers"],
  });

  // Use the shared wallet hook for consistent balance across the app
  const { wallet, availablePts, debtPts, canRedeem, riskState } = useWallet();
  
  const { data: contextsData } = useQuery<ContextsResponse>({
    queryKey: ["/api/marketplace/contexts"],
  });
  
  const { 
    data: contextualSearchData, 
    isLoading: isLoadingContextual, 
    error: contextualError,
    refetch: refetchContextual,
  } = useQuery<ContextualSearchResponse>({
    queryKey: ["/api/marketplace/contextual-search", selectedSetId, activeSearch, sourceFilter, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeSearch) params.set("q", activeSearch);
      if (selectedSetId) params.set("setId", selectedSetId);
      params.set("source", sourceFilter);
      params.set("sort", sortBy);
      params.set("limit", "24");
      
      const res = await fetch(`/api/marketplace/contextual-search?${params}`);
      if (!res.ok) throw new Error("Failed to search listings");
      return res.json();
    },
    enabled: useContextualSearch,
    staleTime: 5 * 60 * 1000,
  });

  const { data: liveListingsData, isLoading: isLoadingListings, error: listingsError } = useQuery<LiveListingsResponse>({
    queryKey: ["/api/marketplace/search", activeSearch, sourceFilter, sortBy],
    queryFn: async () => {
      if (!activeSearch) return { listings: [], sources: { ebay: false, goldin: false }, cached: false };
      const params = new URLSearchParams({
        q: activeSearch,
        source: sourceFilter,
        sort: sortBy,
        limit: "24",
      });
      const res = await fetch(`/api/marketplace/search?${params}`);
      if (!res.ok) throw new Error("Failed to search listings");
      return res.json();
    },
    enabled: activeSearch.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Collect all listings for batch quote
  const allListings = [
    ...(liveListingsData?.listings || []),
    ...(contextualSearchData?.contexts?.flatMap(c => c.listings) || []),
  ];

  // Batch quote query - fetches quotes for all visible listings
  const { data: batchQuotesData } = useQuery<{ quotes: Record<string, BatchQuote> }>({
    queryKey: ["/api/marketplace/redemption/quote-batch", allListings.map(l => `${l.source}:${l.id}`).join(",")],
    queryFn: async () => {
      if (allListings.length === 0) return { quotes: {} };
      const items = allListings
        .filter(l => l.priceCents && l.priceCents > 0)
        .map(l => ({
          provider: l.source,
          externalId: l.id,
          priceCents: l.priceCents || 0,
          currency: l.currency || "USD",
        }));
      if (items.length === 0) return { quotes: {} };
      const res = await apiRequest("POST", "/api/marketplace/redemption/quote-batch", { items });
      if (!res.ok) return { quotes: {} };
      return res.json();
    },
    enabled: allListings.length > 0 && contextsData?.userId != null,
    staleTime: 60 * 1000, // Cache for 60 seconds
  });

  // Helper to get batch quote for a listing
  const getBatchQuote = (listing: LiveListing): BatchQuote | null => {
    const key = `${listing.source}:${listing.id}`;
    return batchQuotesData?.quotes?.[key] || null;
  };

  const redeemMutation = useMutation({
    mutationFn: async (packptsAmount: number) => {
      const idempotencyKey = `redeem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const response = await apiRequest("POST", "/api/redeem", {
        packptsAmount,
        idempotencyKey,
      });
      return response.json() as Promise<RedemptionResponse>;
    },
    onSuccess: (data) => {
      setConfirmDialogOpen(false);
      setLastRedemption(data);
      setSuccessDialogOpen(true);
      
      queryClient.invalidateQueries({ queryKey: ["/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/redeem/history"] });
      
      if (data.status === "PENDING_REVIEW") {
        toast({
          title: "Redemption Submitted",
          description: "Your redemption is pending review. We'll notify you once approved.",
        });
      } else {
        toast({
          title: "Redemption Successful!",
          description: "Your credit has been issued.",
        });
      }
    },
    onError: (error: Error) => {
      setConfirmDialogOpen(false);
      toast({
        title: "Redemption Failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleRedeemClick = (option: RedemptionOption) => {
    setSelectedOption(option);
    setConfirmDialogOpen(true);
  };

  const handleConfirmRedeem = () => {
    if (selectedOption) {
      redeemMutation.mutate(selectedOption.pointsCost);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActiveSearch(searchQuery.trim());
    }
  };

  const tiers = (tiersData?.tiers || []).filter(t => t.isActive);
  // Use availablePts for consistent balance display (floor at 0, excludes debt)
  const userBalance = availablePts;

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-marketplace-title">Marketplace</h1>
            <p className="text-muted-foreground">Browse live listings and redeem PackPTS for discounts</p>
          </div>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-secondary">
                <Zap className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Balance</p>
                <p className="text-xl font-bold font-mono" data-testid="text-user-balance">{userBalance.toLocaleString()} pts</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="live" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="live" data-testid="tab-live-listings">Live Listings</TabsTrigger>
            <TabsTrigger value="redeem" data-testid="tab-redeem">Redeem PackPTS</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-6">
            {contextsData?.allSets && contextsData.allSets.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Game Sets</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="contextual-mode"
                        checked={useContextualSearch}
                        onCheckedChange={setUseContextualSearch}
                        data-testid="switch-contextual-mode"
                      />
                      <Label htmlFor="contextual-mode" className="text-sm text-muted-foreground">
                        Match to your games
                      </Label>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={selectedSetId === null ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedSetId(null)}
                      data-testid="button-context-all"
                    >
                      All Sets
                    </Button>
                    {contextsData.allSets.map((set) => (
                      <Button
                        key={set.id}
                        variant={selectedSetId === set.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedSetId(set.id)}
                        data-testid={`button-context-${set.id}`}
                      >
                        {set.setName}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            
            <Card>
              <CardContent className="p-4">
                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={selectedSetId 
                        ? "Search within this set... (e.g., Kirby Puckett)"
                        : "Search for cards... (e.g., 1987 Topps Mark McGwire)"
                      }
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      data-testid="input-search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
                      <SelectTrigger className="w-32" data-testid="select-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Sources</SelectItem>
                        <SelectItem value="ebay">eBay Only</SelectItem>
                        <SelectItem value="goldin">Goldin Only</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                      <SelectTrigger className="w-36" data-testid="select-sort">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relevance">Relevance</SelectItem>
                        <SelectItem value="priceAsc">Price: Low to High</SelectItem>
                        <SelectItem value="priceDesc">Price: High to Low</SelectItem>
                        <SelectItem value="endingSoon">Ending Soon</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="submit" data-testid="button-search">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {useContextualSearch ? (
              isLoadingContextual ? (
                <LiveListingsSkeleton />
              ) : contextualError ? (
                <Card>
                  <CardContent className="p-12 text-center space-y-4">
                    <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
                    <div>
                      <h3 className="font-semibold text-lg">Search Failed</h3>
                      <p className="text-muted-foreground">
                        Unable to search listings right now. Please try again later.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : contextualSearchData?.contexts && contextualSearchData.contexts.length > 0 ? (
                <div className="space-y-8">
                  {contextualSearchData.noteIfBroadened && (
                    <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                      {contextualSearchData.noteIfBroadened}
                    </div>
                  )}
                  {contextualSearchData.contexts.map((contextResult) => (
                    <div key={contextResult.contextKey} className="space-y-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="gap-1" data-testid={`badge-context-${contextResult.gameSet.id}`}>
                            <Layers className="h-3 w-3" />
                            {contextResult.gameSet.setName}
                          </Badge>
                          {contextResult.broadened && (
                            <span className="text-xs text-muted-foreground">(broadened search)</span>
                          )}
                          {contextResult.cached && (
                            <span className="text-xs text-muted-foreground">(cached)</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {contextResult.listings.length} listings
                        </p>
                      </div>
                      {contextResult.listings.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                          {contextResult.listings.map((listing) => (
                            <LiveListingCard 
                              key={listing.id} 
                              listing={listing}
                              userBalance={userBalance}
                              isAuthenticated={!!contextsData?.userId}
                              batchQuote={getBatchQuote(listing)}
                              walletStatus={riskState.status as "NORMAL" | "UNDER_REVIEW" | "FROZEN"}
                            />
                          ))}
                        </div>
                      ) : (
                        <Card>
                          <CardContent className="p-6 text-center">
                            <p className="text-muted-foreground">No listings found for this set</p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  ))}
                  <AffiliateDisclosure variant="full" className="mt-6" />
                </div>
              ) : (
                <Card>
                  <CardContent className="p-12 text-center space-y-4">
                    <Layers className="h-12 w-12 mx-auto text-muted-foreground" />
                    <div>
                      <h3 className="font-semibold text-lg">Browse Cards From Your Games</h3>
                      <p className="text-muted-foreground">
                        Select a game set above to see matching listings, or enter a search term to find specific cards.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )
            ) : !activeSearch ? (
              <Card>
                <CardContent className="p-12 text-center space-y-4">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold text-lg">Search for Cards</h3>
                    <p className="text-muted-foreground">
                      Find live listings from eBay and Goldin Auctions. Use your PackPTS as a discount when you purchase!
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : isLoadingListings ? (
              <LiveListingsSkeleton />
            ) : listingsError ? (
              <Card>
                <CardContent className="p-12 text-center space-y-4">
                  <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
                  <div>
                    <h3 className="font-semibold text-lg">Search Failed</h3>
                    <p className="text-muted-foreground">
                      Unable to search listings right now. Please try again later.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : liveListingsData?.listings && liveListingsData.listings.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-sm text-muted-foreground">
                    Found {liveListingsData.listings.length} listings for "{activeSearch}"
                    {liveListingsData.cached && (
                      <span className="ml-2 text-xs">(cached)</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    {liveListingsData.sources.ebay && (
                      <Badge variant="secondary" className="gap-1">
                        <SiEbay className="h-3 w-3" />
                        eBay
                      </Badge>
                    )}
                    {liveListingsData.sources.goldin && (
                      <Badge variant="secondary" className="gap-1">
                        <span className="font-bold text-xs">G</span>
                        Goldin
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {liveListingsData.listings.map((listing) => (
                    <LiveListingCard 
                      key={listing.id} 
                      listing={listing}
                      userBalance={userBalance}
                      isAuthenticated={!!contextsData?.userId}
                      batchQuote={getBatchQuote(listing)}
                      walletStatus={riskState.status as "NORMAL" | "UNDER_REVIEW" | "FROZEN"}
                    />
                  ))}
                </div>
                <AffiliateDisclosure variant="full" className="mt-6" />
              </>
            ) : (
              <Card>
                <CardContent className="p-12 text-center space-y-4">
                  <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold text-lg">No Listings Found</h3>
                    <p className="text-muted-foreground">
                      Try a different search term or check back later.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="redeem">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              <aside className="lg:col-span-1">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">How It Works</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                        1
                      </div>
                      <p className="text-muted-foreground">Earn PackPTS by correctly identifying players in games</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                        2
                      </div>
                      <p className="text-muted-foreground">Browse available redemption options from Goldin and eBay</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                        3
                      </div>
                      <p className="text-muted-foreground">Use your PackPTS as a discount toward the card of your choice</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Discount Tiers</CardTitle>
                    <CardDescription className="text-xs">PackPTS = discounts, not cash</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {tiers.length > 0 ? (
                      tiers.map((tier) => {
                        const actualPayout = Math.floor(tier.usdCapCents * (tier.effectiveRatePct / 100));
                        return (
                          <div key={tier.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted" data-testid={`tier-${tier.id}`}>
                            <span className="font-mono">{tier.packptsRequired.toLocaleString()} PTS</span>
                            <span className="font-mono text-accent">Up to ${(actualPayout / 100).toFixed(2)} off</span>
                          </div>
                        );
                      })
                    ) : (
                      <>
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                      </>
                    )}
                  </CardContent>
                </Card>
              </aside>

              <div className="lg:col-span-3">
                <div className="flex items-center gap-2 mb-6">
                  <Badge variant="outline">All Platforms</Badge>
                  <Badge variant="secondary">Goldin</Badge>
                  <Badge variant="secondary">eBay</Badge>
                </div>

                {isLoading ? (
                  <MarketplaceSkeleton />
                ) : redemptions && redemptions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {redemptions.map((option) => (
                      <RedemptionCard 
                        key={option.id} 
                        option={option} 
                        userBalance={userBalance}
                        onRedeem={handleRedeemClick}
                        isRedeeming={redeemMutation.isPending && selectedOption?.id === option.id}
                        walletStatus={riskState.status as "NORMAL" | "UNDER_REVIEW" | "FROZEN"}
                      />
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-12 text-center space-y-4">
                      <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground" />
                      <div>
                        <h3 className="font-semibold text-lg">No Redemptions Available</h3>
                        <p className="text-muted-foreground">Check back soon for new redemption options!</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent data-testid="dialog-confirm-redemption">
          <DialogHeader>
            <DialogTitle>Confirm Redemption</DialogTitle>
            <DialogDescription>
              You're about to redeem your PackPTS for store credit.
            </DialogDescription>
          </DialogHeader>
          
          {selectedOption && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted">
                <div>
                  <p className="font-semibold">{selectedOption.title}</p>
                  <p className="text-sm text-muted-foreground">{selectedOption.platform === "goldin" ? "Goldin Auctions" : "eBay"}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-accent">${selectedOption.usdValue} USD</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Points Required</span>
                <span className="font-mono font-semibold">{selectedOption.pointsCost.toLocaleString()} PTS</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your Balance</span>
                <span className="font-mono">{userBalance.toLocaleString()} PTS</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t pt-2">
                <span className="text-muted-foreground">Balance After</span>
                <span className="font-mono font-semibold">{(userBalance - selectedOption.pointsCost).toLocaleString()} PTS</span>
              </div>
              
              {selectedOption.usdValue >= 25 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
                  <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <p>Redemptions of $25 or more require admin review before the credit is issued.</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setConfirmDialogOpen(false)}
              disabled={redeemMutation.isPending}
              data-testid="button-cancel-redemption"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmRedeem}
              disabled={redeemMutation.isPending}
              data-testid="button-confirm-redemption"
            >
              {redeemMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                "Confirm Redemption"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent data-testid="dialog-redemption-success">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {lastRedemption?.status === "PENDING_REVIEW" ? (
                <>
                  <Clock className="h-5 w-5 text-amber-500" />
                  Pending Review
                </>
              ) : (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Redemption Complete
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            {lastRedemption?.status === "PENDING_REVIEW" ? (
              <p className="text-muted-foreground">
                Your redemption request has been submitted for review. You'll receive your credit once an admin approves it.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Your credit has been issued! Check your email for instructions on how to use it.
              </p>
            )}
            
            {lastRedemption?.creditToken && (
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-xs text-muted-foreground mb-1">Your Credit Code</p>
                <p className="font-mono font-bold text-lg">{lastRedemption.creditToken}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setSuccessDialogOpen(false)} data-testid="button-close-success">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
