import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Coins, Crown, Star, ShieldCheck, Sparkles, CreditCard, ShoppingBag, ArrowRight } from "lucide-react";
import { SiEbay } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { WalletExpirationCard } from "@/components/wallet-expiration-card";
import { Link } from "wouter";

interface PackPtsBundle {
  sku: string;
  name: string;
  packptsGrant: number;
  priceUsd: number;
  formattedPrice: string;
  description: string;
  valuePerDollar: number;
  isBestValue: boolean;
}

interface StoreProductsResponse {
  products: PackPtsBundle[];
  stripeConfigured: boolean;
}

function BundleCard({ 
  bundle, 
  onPurchase, 
  isPurchasing 
}: { 
  bundle: PackPtsBundle; 
  onPurchase: (sku: string) => void;
  isPurchasing: boolean;
}) {
  const getIcon = () => {
    if (bundle.packptsGrant >= 15000) return <Crown className="h-8 w-8" />;
    if (bundle.packptsGrant >= 6000) return <Star className="h-8 w-8" />;
    return <Coins className="h-8 w-8" />;
  };

  const getGradient = () => {
    if (bundle.packptsGrant >= 15000) return "from-amber-500/20 to-yellow-500/20";
    if (bundle.packptsGrant >= 6000) return "from-purple-500/20 to-pink-500/20";
    return "from-blue-500/20 to-cyan-500/20";
  };

  return (
    <Card 
      className={`overflow-visible hover-elevate relative ${bundle.isBestValue ? 'ring-2 ring-accent' : ''}`}
      data-testid={`card-bundle-${bundle.sku}`}
    >
      {bundle.isBestValue && (
        <Badge 
          className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground gap-1"
          data-testid="badge-best-value"
        >
          <Sparkles className="h-3 w-3" />
          Best Value
        </Badge>
      )}
      <div className={`aspect-[4/3] bg-gradient-to-br ${getGradient()} rounded-t-md flex items-center justify-center`}>
        <div className="text-muted-foreground/80">
          {getIcon()}
        </div>
      </div>
      <CardContent className="p-4 space-y-4">
        <div className="text-center">
          <h3 className="font-semibold text-lg" data-testid={`text-bundle-name-${bundle.sku}`}>
            {bundle.name}
          </h3>
          <div className="flex items-center justify-center gap-1 mt-2">
            <Zap className="h-5 w-5 text-accent" />
            <span className="text-2xl font-bold font-mono text-accent" data-testid={`text-bundle-pts-${bundle.sku}`}>
              {bundle.packptsGrant.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-sm">PackPTS</span>
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            <span className="font-mono">{bundle.valuePerDollar.toLocaleString()} pts/$</span>
          </div>
        </div>

        <Button 
          className="w-full gap-2"
          size="lg"
          onClick={() => onPurchase(bundle.sku)}
          disabled={isPurchasing}
          data-testid={`button-buy-${bundle.sku}`}
        >
          <CreditCard className="h-4 w-4" />
          {bundle.formattedPrice}
        </Button>
      </CardContent>
    </Card>
  );
}

function StoreSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <Skeleton className="aspect-[4/3] rounded-t-md" />
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2 text-center">
              <Skeleton className="h-5 w-1/2 mx-auto" />
              <Skeleton className="h-8 w-3/4 mx-auto" />
            </div>
            <Skeleton className="h-4 w-1/3 mx-auto" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Store() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<StoreProductsResponse>({
    queryKey: ["/api/store/products"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (sku: string) => {
      const response = await apiRequest("POST", "/api/store/checkout", { sku });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Checkout Error",
        description: error.message || "Failed to start checkout. Please try again.",
      });
    },
  });

  const handlePurchase = (sku: string) => {
    if (!data?.stripeConfigured) {
      toast({
        variant: "destructive",
        title: "Payments Not Available",
        description: "Payment processing is not configured. Please try again later.",
      });
      return;
    }
    checkoutMutation.mutate(sku);
  };

  const bundles = data?.products || [];

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3" data-testid="text-store-title">
            Get PackPTS
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Power up your gameplay with PackPTS. Use them to enter premium game modes, 
            compete in tournaments, and redeem for real trading card discounts.
          </p>
        </div>

        <div className="max-w-md mx-auto mb-8">
          <WalletExpirationCard />
        </div>

        <div className="flex items-center justify-center gap-4 mb-8">
          <Card className="inline-flex">
            <CardContent className="p-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Secure Checkout</span>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <StoreSkeleton />
        ) : bundles.length === 0 ? (
          <div className="text-center py-12">
            <Coins className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Bundles Available</h2>
            <p className="text-muted-foreground">Check back soon for PackPTS bundles.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {bundles.map((bundle) => (
                <BundleCard
                  key={bundle.sku}
                  bundle={bundle}
                  onPurchase={handlePurchase}
                  isPurchasing={checkoutMutation.isPending}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-16 max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How PackPTS Work</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-secondary shrink-0">
                  <Zap className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div>
                  <h4 className="font-medium">Play Premium Games</h4>
                  <p className="text-sm text-muted-foreground">
                    Use PackPTS to enter 1v1 matches, tournaments, and competitive modes.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-secondary shrink-0">
                  <Coins className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div>
                  <h4 className="font-medium">Earn While You Play</h4>
                  <p className="text-sm text-muted-foreground">
                    Win games to earn more PackPTS and climb the leaderboards.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-secondary shrink-0">
                  <Crown className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div>
                  <h4 className="font-medium">Redeem for Value</h4>
                  <p className="text-sm text-muted-foreground">
                    Convert PackPTS into store credit for real baseball cards on Goldin and eBay.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 max-w-2xl mx-auto">
          <Card className="overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-amber-500/10 via-blue-500/10 to-purple-500/10">
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="shrink-0 flex gap-2">
                  <div className="p-3 rounded-full bg-amber-500/20">
                    <span className="font-bold text-lg text-amber-500">G</span>
                  </div>
                  <div className="p-3 rounded-full bg-blue-500/20">
                    <SiEbay className="h-5 w-5 text-blue-500" />
                  </div>
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h3 className="font-semibold text-lg mb-1">Browse Live Listings</h3>
                  <p className="text-sm text-muted-foreground">
                    Search real-time listings from Goldin Auctions and eBay. Use your PackPTS as a discount!
                  </p>
                </div>
                <Link href="/marketplace">
                  <Button className="gap-2" data-testid="button-browse-marketplace">
                    <ShoppingBag className="h-4 w-4" />
                    Marketplace
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
