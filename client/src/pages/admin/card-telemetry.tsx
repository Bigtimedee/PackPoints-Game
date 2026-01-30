import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle, XCircle, RefreshCw, BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface TelemetryStats {
  totalEvents: number;
  byStage: Record<string, number>;
  imageOkRateBySet: Array<{ setKey: string; total: number; valid: number; rate: number }>;
  replacementStats: { matchesWithReplacements: number; totalReplacements: number };
}

export default function AdminCardTelemetry() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data, isLoading, error } = useQuery<TelemetryStats>({
    queryKey: ["/api/admin/telemetry/cards"],
    queryFn: async () => {
      const response = await fetch("/api/admin/telemetry/cards", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch telemetry");
      }
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
    refetchInterval: 30000,
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader-telemetry" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">
            <p>Failed to load telemetry data.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const totalValidations = (data.byStage.validate || 0) + (data.byStage.validate_fail || 0);
  const validationSuccessRate = totalValidations > 0 
    ? ((data.byStage.validate || 0) / totalValidations * 100).toFixed(1) 
    : "N/A";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Card Delivery Telemetry</h1>
        <p className="text-muted-foreground">Last 24 hours of card delivery metrics</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-events">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalEvents.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Telemetry events logged</p>
          </CardContent>
        </Card>

        <Card data-testid="card-validation-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Validation Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{validationSuccessRate}%</div>
            <p className="text-xs text-muted-foreground">
              {data.byStage.validate || 0} valid / {totalValidations} total
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-image-failures">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Image Failures</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.byStage.image_fail || 0}</div>
            <p className="text-xs text-muted-foreground">Client-reported image errors</p>
          </CardContent>
        </Card>

        <Card data-testid="card-replacements">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Card Replacements</CardTitle>
            <RefreshCw className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.replacementStats.totalReplacements}</div>
            <p className="text-xs text-muted-foreground">
              {data.replacementStats.matchesWithReplacements} matches affected
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="card-stage-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Events by Stage
            </CardTitle>
            <CardDescription>Breakdown of telemetry events by pipeline stage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(data.byStage).map(([stage, count]) => (
                <div key={stage} className="flex items-center justify-between" data-testid={`stage-${stage}`}>
                  <span className="text-sm font-medium capitalize">{stage.replace(/_/g, " ")}</span>
                  <span className="text-sm text-muted-foreground">{count.toLocaleString()}</span>
                </div>
              ))}
              {Object.keys(data.byStage).length === 0 && (
                <p className="text-sm text-muted-foreground">No events recorded yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-set-rates">
          <CardHeader>
            <CardTitle>Validation by Set</CardTitle>
            <CardDescription>Image validation success rates by card set</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.imageOkRateBySet.map((set) => (
                <div key={set.setKey} className="flex items-center justify-between" data-testid={`set-${set.setKey}`}>
                  <span className="text-sm font-medium">{set.setKey}</span>
                  <span className="text-sm text-muted-foreground">
                    {(set.rate * 100).toFixed(1)}% ({set.valid}/{set.total})
                  </span>
                </div>
              ))}
              {data.imageOkRateBySet.length === 0 && (
                <p className="text-sm text-muted-foreground">No set validation data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
