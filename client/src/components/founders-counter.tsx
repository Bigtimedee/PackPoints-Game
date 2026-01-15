import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Users, Sparkles, Flame, Zap, Clock } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface CapStatus {
  currentActive: number;
  maxActive: number;
  enabled: boolean;
}

function getUrgencyTier(spotsRemaining: number): {
  message: string;
  badge: string | null;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  icon: typeof Flame;
} {
  if (spotsRemaining <= 0) {
    return {
      message: "All Founder spots have been claimed!",
      badge: null,
      badgeVariant: "default",
      icon: Sparkles,
    };
  }
  if (spotsRemaining <= 49) {
    return {
      message: "Final spots remaining!",
      badge: "Almost gone!",
      badgeVariant: "destructive",
      icon: Zap,
    };
  }
  if (spotsRemaining <= 99) {
    return {
      message: "Almost full - act now!",
      badge: "Hurry!",
      badgeVariant: "destructive",
      icon: Flame,
    };
  }
  if (spotsRemaining <= 249) {
    return {
      message: "Only a handful of spots left!",
      badge: "Limited",
      badgeVariant: "secondary",
      icon: Clock,
    };
  }
  if (spotsRemaining <= 399) {
    return {
      message: "Spots filling up fast!",
      badge: null,
      badgeVariant: "default",
      icon: Users,
    };
  }
  return {
    message: "Limited Founder spots available",
    badge: null,
    badgeVariant: "default",
    icon: Users,
  };
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
  const isFull = !capStatus.enabled || spotsRemaining === 0;

  if (isFull) {
    return (
      <div className="bg-muted/50 border rounded-lg p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">All Founder Spots Claimed!</span>
          <Sparkles className="w-5 h-5 text-yellow-500" />
        </div>
        <p className="text-sm text-muted-foreground">
          Join the waitlist to be notified when spots open up.
        </p>
      </div>
    );
  }

  const urgency = getUrgencyTier(spotsRemaining);
  const UrgencyIcon = urgency.icon;

  return (
    <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/20 rounded-lg p-4">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <UrgencyIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold" data-testid="text-founders-urgency">
                {urgency.message}
              </span>
              {urgency.badge && (
                <Badge variant={urgency.badgeVariant} className="text-xs">
                  {urgency.badge}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Be among the first to join and get exclusive benefits
            </p>
          </div>
        </div>
        <div className="flex-1 max-w-xs hidden md:block">
          <Progress value={percentFull} className="h-2" />
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
