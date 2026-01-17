import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Activity, TrendingUp, RefreshCw, Loader2, AlertTriangle, Globe } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GeoStats {
  byState: { state: string; sessions: number; uniqueUsers: number; uniqueIps: number }[];
  totalSessions: number;
  totalUniqueUsers: number;
  totalUniqueIps: number;
  windowDays: number;
}

interface CoverageStats {
  totalStates: number;
  statesWithUsers: number;
  coveragePercent: number;
  topStates: { state: string; userCount: number; percent: number }[];
  usersWithHomeState: number;
  usersWithoutHomeState: number;
  homeStateInferenceRate: number;
  vpnDetectedSessions: number;
  windowDays: number;
}

export default function AdminGeo() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [timeWindow, setTimeWindow] = useState<string>("30d");
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data: geoStats, isLoading: geoLoading } = useQuery<GeoStats>({
    queryKey: ["/api/admin/geo/states", timeWindow],
    queryFn: () => fetch(`/api/admin/geo/states?window=${timeWindow}`).then(r => r.json()),
    enabled: isAuthenticated && user?.isAdmin,
    refetchInterval: 60000,
  });

  const { data: coverage, isLoading: coverageLoading } = useQuery<CoverageStats>({
    queryKey: ["/api/admin/geo/coverage", timeWindow],
    queryFn: () => fetch(`/api/admin/geo/coverage?window=${timeWindow}`).then(r => r.json()),
    enabled: isAuthenticated && user?.isAdmin,
    refetchInterval: 60000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/geo/recompute"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/geo/states"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/geo/coverage"] });
      toast({
        title: "Recompute Complete",
        description: "Home states and rollups have been recalculated.",
      });
    },
    onError: () => {
      toast({
        title: "Recompute Failed",
        description: "Failed to recompute geo data. Check server logs.",
        variant: "destructive",
      });
    },
  });

  if (authLoading || geoLoading || coverageLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const statCards = [
    { 
      title: "States Covered", 
      value: coverage?.statesWithUsers || 0, 
      subtitle: `of 51 (${coverage?.coveragePercent?.toFixed(0) || 0}%)`,
      icon: MapPin, 
      color: "text-blue-500" 
    },
    { 
      title: "Total Sessions", 
      value: (geoStats?.totalSessions || 0).toLocaleString(), 
      subtitle: `Last ${timeWindow}`,
      icon: Activity, 
      color: "text-green-500" 
    },
    { 
      title: "Unique Users", 
      value: (geoStats?.totalUniqueUsers || 0).toLocaleString(), 
      subtitle: "With geo data",
      icon: Users, 
      color: "text-purple-500" 
    },
    { 
      title: "Home State Rate", 
      value: `${coverage?.homeStateInferenceRate?.toFixed(0) || 0}%`, 
      subtitle: `${coverage?.usersWithHomeState || 0} users inferred`,
      icon: TrendingUp, 
      color: "text-orange-500" 
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-admin-geo-title">Geo Intelligence</h1>
          <p className="text-muted-foreground">User location analytics by US state</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={timeWindow} onValueChange={setTimeWindow}>
            <SelectTrigger className="w-[120px]" data-testid="select-time-window">
              <SelectValue placeholder="Time window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7d</SelectItem>
              <SelectItem value="30d">Last 30d</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending}
            data-testid="button-recompute-geo"
          >
            {recomputeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Recompute
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} data-testid={`card-geo-stat-${stat.title.toLowerCase().replace(/\s/g, '-')}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                  <span className="text-xs text-muted-foreground">{stat.title}</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {coverage && coverage.vpnDetectedSessions > 0 && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="font-medium text-sm">VPN/Proxy Detected</p>
              <p className="text-xs text-muted-foreground">
                {coverage.vpnDetectedSessions} sessions flagged as VPN/proxy in the selected window
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Top States by Sessions
            </CardTitle>
            <CardDescription>States with most activity in the selected window</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {geoStats?.byState?.slice(0, 10).map((state, index) => (
                <div 
                  key={state.state} 
                  className="flex items-center justify-between"
                  data-testid={`row-state-${state.state}`}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="w-8 text-center font-mono">
                      {index + 1}
                    </Badge>
                    <span className="font-medium">{state.state}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {state.uniqueUsers} users
                    </span>
                    <Badge variant="secondary">
                      {state.sessions} sessions
                    </Badge>
                  </div>
                </div>
              ))}
              {(!geoStats?.byState || geoStats.byState.length === 0) && (
                <p className="text-muted-foreground text-center py-4">
                  No geo data collected yet. Sessions will appear here once users interact.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Home State Distribution
            </CardTitle>
            <CardDescription>Inferred home states (3+ days, 5+ sessions required)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {coverage?.topStates?.slice(0, 10).map((state, index) => (
                <div 
                  key={state.state} 
                  className="flex items-center justify-between"
                  data-testid={`row-home-state-${state.state}`}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="w-8 text-center font-mono">
                      {index + 1}
                    </Badge>
                    <span className="font-medium">{state.state}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {state.userCount} users
                    </span>
                    <Badge variant="secondary">
                      {state.percent.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
              {(!coverage?.topStates || coverage.topStates.length === 0) && (
                <p className="text-muted-foreground text-center py-4">
                  No home states inferred yet. Users need 3+ distinct days and 5+ sessions.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All States Activity</CardTitle>
          <CardDescription>Complete breakdown of sessions by state for the selected time window</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">State</th>
                  <th className="text-right py-2 px-3 font-medium">Sessions</th>
                  <th className="text-right py-2 px-3 font-medium">Unique Users</th>
                  <th className="text-right py-2 px-3 font-medium">Unique IPs</th>
                  <th className="text-right py-2 px-3 font-medium">Sessions/User</th>
                </tr>
              </thead>
              <tbody>
                {geoStats?.byState?.map((state) => (
                  <tr key={state.state} className="border-b hover:bg-muted/50" data-testid={`table-row-${state.state}`}>
                    <td className="py-2 px-3 font-medium">{state.state}</td>
                    <td className="py-2 px-3 text-right font-mono">{state.sessions.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-mono">{state.uniqueUsers.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-mono">{state.uniqueIps.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      {state.uniqueUsers > 0 ? (state.sessions / state.uniqueUsers).toFixed(1) : '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!geoStats?.byState || geoStats.byState.length === 0) && (
              <p className="text-muted-foreground text-center py-8">
                No geo session data available yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
