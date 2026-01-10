import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Gamepad2, CreditCard, TrendingUp, Activity, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface MetricsData {
  dau: number;
  matchesPerUser: number;
  purchaseConversion: number;
  packptsLiability: number;
  redemptionRate: number;
  totalRevenue?: number;
  activeSubscriptions?: number;
}

export default function AdminMetrics() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data, isLoading, error } = useQuery<MetricsData>({
    queryKey: ["/api/admin/metrics"],
    queryFn: async () => {
      const response = await fetch("/api/admin/metrics", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch metrics");
      }
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">
            <p>Failed to load metrics data.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const metricCards = [
    { 
      title: "Daily Active Users", 
      value: data.dau?.toLocaleString() ?? "0", 
      icon: Users, 
      color: "text-blue-500",
      description: "Users active today"
    },
    { 
      title: "Matches/User", 
      value: data.matchesPerUser?.toFixed(2) ?? "0", 
      icon: Gamepad2, 
      color: "text-green-500",
      description: "Average matches per user"
    },
    { 
      title: "Purchase Conversion", 
      value: `${((data.purchaseConversion ?? 0) * 100).toFixed(1)}%`, 
      icon: TrendingUp, 
      color: "text-yellow-500",
      description: "Users who made a purchase"
    },
    { 
      title: "PackPTS Liability", 
      value: (data.packptsLiability ?? 0).toLocaleString(), 
      icon: Wallet, 
      color: "text-purple-500",
      description: "Total outstanding points"
    },
    { 
      title: "Redemption Rate", 
      value: `${((data.redemptionRate ?? 0) * 100).toFixed(1)}%`, 
      icon: Activity, 
      color: "text-orange-500",
      description: "Points redeemed vs earned"
    },
    { 
      title: "Active Subscriptions", 
      value: data.activeSubscriptions?.toLocaleString() ?? "0", 
      icon: CreditCard, 
      color: "text-emerald-500",
      description: "Current paid subscribers"
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-metrics-title">Platform Metrics</h1>
        <p className="text-muted-foreground">Key performance indicators for PackPoints</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.title} data-testid={`card-metric-${metric.title.toLowerCase().replace(/\s/g, '-')}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${metric.color}`} />
                  <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold font-mono">{metric.value}</p>
                <CardDescription className="mt-1">{metric.description}</CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
