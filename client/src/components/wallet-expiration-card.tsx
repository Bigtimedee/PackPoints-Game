import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, Info, Zap, Calendar, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ExpirationInfo {
  balance: number;
  expiringNext30Days: number;
  expiringNext60Days: number;
  expiringNext90Days: number;
  nextExpirationDate: string | null;
  nextExpirationAmount: number;
  bucketsBySource: {
    earned: number;
    purchased: number;
    bonus: number;
    adjustment: number;
  };
  weeklyExpirations: Array<{
    weekStart: string;
    weekEnd: string;
    amount: number;
  }>;
  policy: {
    earnedDaysToExpire: number;
    purchasedDaysToExpire: number | null;
    bonusDefaultDaysToExpire: number;
    gracePeriodDays: number;
    inactivityEnabled: boolean;
    inactivityDays: number;
  } | null;
}

interface ExpiringSoonInfo {
  expiringSoon: number;
  gracePeriodDays: number;
  buckets: Array<{
    id: string;
    amount: number;
    sourceType: string;
    expiresAt: string;
    earnedAt: string;
  }>;
}

function ExpirationDetailsModal({ data }: { data: ExpirationInfo }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1" data-testid="button-expiration-details">
          <Info className="h-4 w-4" />
          View Details
          <ChevronRight className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            PackPTS Expiration Details
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Balance Breakdown</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Earned (gameplay)</span>
                  <span className="font-mono text-sm" data-testid="text-balance-earned">
                    {data.bucketsBySource.earned.toLocaleString()} PTS
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Purchased</span>
                  <span className="font-mono text-sm" data-testid="text-balance-purchased">
                    {data.bucketsBySource.purchased.toLocaleString()} PTS
                  </span>
                </div>
                {data.bucketsBySource.bonus > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Bonus</span>
                    <span className="font-mono text-sm">
                      {data.bucketsBySource.bonus.toLocaleString()} PTS
                    </span>
                  </div>
                )}
                {data.bucketsBySource.adjustment > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Adjustments</span>
                    <span className="font-mono text-sm">
                      {data.bucketsBySource.adjustment.toLocaleString()} PTS
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Upcoming Expirations</h4>
              {data.weeklyExpirations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No points expiring in the next 90 days</p>
              ) : (
                <div className="space-y-2">
                  {data.weeklyExpirations.map((week, index) => (
                    <div 
                      key={index} 
                      className="flex justify-between items-center text-sm border-l-2 border-muted pl-3 py-1"
                    >
                      <span className="text-muted-foreground">
                        {format(new Date(week.weekStart), "MMM d")} - {format(new Date(week.weekEnd), "MMM d")}
                      </span>
                      <span className="font-mono text-amber-600 dark:text-amber-400">
                        -{week.amount.toLocaleString()} PTS
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.policy && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Expiration Policy</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Earned points expire after {data.policy.earnedDaysToExpire} days</p>
                  <p>
                    Purchased points expire after{" "}
                    {data.policy.purchasedDaysToExpire 
                      ? `${data.policy.purchasedDaysToExpire} days` 
                      : "never"}
                  </p>
                  <p>Bonus points expire after {data.policy.bonusDefaultDaysToExpire} days</p>
                  {data.policy.inactivityEnabled && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Points may expire after {data.policy.inactivityDays} days of inactivity
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function WalletExpirationCard() {
  const { data, isLoading, error } = useQuery<ExpirationInfo>({
    queryKey: ["/api/wallet/expirations"],
    refetchInterval: 60000,
    retry: 1,
  });

  const { data: expiringSoon } = useQuery<ExpiringSoonInfo>({
    queryKey: ["/api/wallet/expiring-soon"],
    refetchInterval: 60000,
    retry: 1,
  });

  if (error) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-amber-500/5 to-orange-500/5">
        <CardContent className="p-4">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const hasExpiringSoon = data.expiringNext30Days > 0;
  const hasUrgentExpiry = expiringSoon && expiringSoon.expiringSoon > 0;

  return (
    <Card 
      className={`bg-gradient-to-br ${hasUrgentExpiry ? 'from-amber-500/10 to-orange-500/10 border-amber-500/30' : 'from-muted/30 to-muted/10'}`}
      data-testid="card-wallet-expiration"
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-accent" />
              <span className="font-mono text-2xl font-bold" data-testid="text-wallet-balance">
                {data.balance.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-sm">PackPTS</span>
            </div>

            {hasUrgentExpiry ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-amber-500/20 text-amber-700 dark:text-amber-400 gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {expiringSoon?.expiringSoon.toLocaleString()} expiring soon
                </Badge>
              </div>
            ) : hasExpiringSoon ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span data-testid="text-expiring-30d">
                  {data.expiringNext30Days.toLocaleString()} expiring in 30 days
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {data.nextExpirationDate ? (
                  <span>
                    Next expiration: {formatDistanceToNow(new Date(data.nextExpirationDate), { addSuffix: true })}
                  </span>
                ) : (
                  <span>No upcoming expirations</span>
                )}
              </div>
            )}
          </div>

          <ExpirationDetailsModal data={data} />
        </div>
      </CardContent>
    </Card>
  );
}
