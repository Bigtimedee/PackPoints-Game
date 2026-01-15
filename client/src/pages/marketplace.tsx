import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShoppingBag, Zap, ExternalLink, DollarSign, Loader2, CheckCircle, Clock } from "lucide-react";
import { SiEbay } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RedemptionOption } from "@shared/schema";

interface RedemptionCardProps {
  option: RedemptionOption;
  userBalance: number;
  onRedeem: (option: RedemptionOption) => void;
  isRedeeming: boolean;
}

function RedemptionCard({ option, userBalance, onRedeem, isRedeeming }: RedemptionCardProps) {
  const platformIcon = option.platform === "goldin" ? (
    <span className="font-bold text-xs">G</span>
  ) : (
    <SiEbay className="h-4 w-4" />
  );

  const platformName = option.platform === "goldin" ? "Goldin" : "eBay";
  const platformColor = option.platform === "goldin" ? "bg-amber-500" : "bg-blue-500";
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
          disabled={!hasEnoughPoints || isRedeeming}
          onClick={() => onRedeem(option)}
        >
          {isRedeeming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
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

interface WalletData {
  balance: number;
}

interface RedemptionResponse {
  success: boolean;
  redemptionId?: string;
  status?: string;
  creditToken?: string;
  message?: string;
  error?: string;
}

export default function Marketplace() {
  const { toast } = useToast();
  const [selectedOption, setSelectedOption] = useState<RedemptionOption | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [lastRedemption, setLastRedemption] = useState<RedemptionResponse | null>(null);

  const { data: redemptions, isLoading } = useQuery<RedemptionOption[]>({
    queryKey: ["/api/marketplace"],
  });

  const { data: tiersData } = useQuery<{ tiers: RedemptionTier[] }>({
    queryKey: ["/api/redemption/tiers"],
  });

  const { data: walletData } = useQuery<WalletData>({
    queryKey: ["/api/wallet"],
  });

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
      
      queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
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

  const tiers = (tiersData?.tiers || []).filter(t => t.isActive);
  const userBalance = walletData?.balance || 0;

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
                <p className="text-xl font-bold font-mono" data-testid="text-user-balance">{userBalance.toLocaleString()} pts</p>
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
                  <RedemptionCard 
                    key={option.id} 
                    option={option} 
                    userBalance={userBalance}
                    onRedeem={handleRedeemClick}
                    isRedeeming={redeemMutation.isPending && selectedOption?.id === option.id}
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
