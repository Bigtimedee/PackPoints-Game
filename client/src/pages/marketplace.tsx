import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingBag, Zap, ExternalLink, DollarSign } from "lucide-react";
import { SiEbay } from "react-icons/si";
import type { RedemptionOption } from "@shared/schema";

function RedemptionCard({ option }: { option: RedemptionOption }) {
  const platformIcon = option.platform === "goldin" ? (
    <span className="font-bold text-xs">G</span>
  ) : (
    <SiEbay className="h-4 w-4" />
  );

  const platformName = option.platform === "goldin" ? "Goldin" : "eBay";
  const platformColor = option.platform === "goldin" ? "bg-amber-500" : "bg-blue-500";

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
        <Button variant="outline" className="w-full gap-2" data-testid={`button-redeem-${option.id}`}>
          Get Discount
          <ExternalLink className="h-4 w-4" />
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

export default function Marketplace() {
  const { data: redemptions, isLoading } = useQuery<RedemptionOption[]>({
    queryKey: ["/api/marketplace"],
  });

  const { data: tiersData } = useQuery<{ tiers: RedemptionTier[] }>({
    queryKey: ["/api/redemption/tiers"],
  });

  const tiers = (tiersData?.tiers || []).filter(t => t.isActive);
  const userPoints = 2500;

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-marketplace-title">Marketplace</h1>
            <p className="text-muted-foreground">Use your PackPTS as a discount toward real trading cards</p>
          </div>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-md bg-secondary">
                <Zap className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Balance</p>
                <p className="text-xl font-bold font-mono" data-testid="text-user-balance">{userPoints.toLocaleString()} pts</p>
              </div>
            </CardContent>
          </Card>
        </div>

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
                  <p className="text-muted-foreground">Earn PackPoints by correctly identifying players in games</p>
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
                  <RedemptionCard key={option.id} option={option} />
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
      </div>
    </div>
  );
}
