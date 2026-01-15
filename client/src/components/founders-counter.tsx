import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Users, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface CapStatus {
  currentActive: number;
  maxActive: number;
  gateClosed: boolean;
}

export function FoundersCounter() {
  const { data: capStatus, isLoading } = useQuery<CapStatus>({
    queryKey: ["/api/access/cap"],
    retry: false,
  });

  if (isLoading || !capStatus) {
    return null;
  }

  const spotsRemaining = Math.max(0, capStatus.maxActive - capStatus.currentActive);
  const percentFull = Math.min(100, (capStatus.currentActive / capStatus.maxActive) * 100);
  const isFull = capStatus.gateClosed || spotsRemaining === 0;

  if (isFull) {
    return (
      <div className="bg-muted/50 border rounded-lg p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">All 500 Founder Spots Filled!</span>
          <Sparkles className="w-5 h-5 text-yellow-500" />
        </div>
        <p className="text-sm text-muted-foreground">
          Join the waitlist to be notified when spots open up.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/20 rounded-lg p-4">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold" data-testid="text-founders-count">
                {capStatus.currentActive} / {capStatus.maxActive} Founders
              </span>
              {spotsRemaining <= 50 && (
                <Badge variant="destructive" className="text-xs">
                  Only {spotsRemaining} spots left!
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Be one of the first 500 to join and get exclusive benefits
            </p>
          </div>
        </div>
        <div className="flex-1 max-w-xs hidden md:block">
          <Progress value={percentFull} className="h-2" />
          <p className="text-xs text-muted-foreground text-right mt-1">
            {Math.round(percentFull)}% full
          </p>
        </div>
        <Link href="/auth?tab=signup">
          <Button size="sm" data-testid="button-claim-founder-spot">
            Claim Your Spot
          </Button>
        </Link>
      </div>
    </div>
  );
}
