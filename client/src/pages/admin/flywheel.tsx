import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, Users, Share2, UserPlus, Target, RefreshCw, Loader2,
  Image, Calendar, ArrowRight, Download, BarChart3
} from "lucide-react";

interface GlobalRollup {
  id: string;
  date: string;
  dau: number;
  matches: number;
  daily5Entries: number;
  shares: number;
  invites: number;
  signupsFromInvites: number;
  kFactorEstimate: number;
}

interface ContentAsset {
  id: string;
  assetType: string;
  userId: string | null;
  sourceEventId: string | null;
  metadata: any;
  imagePath: string | null;
  createdAt: string;
}

interface FlywheelData {
  rollups: GlobalRollup[];
  todayLive: {
    shares: number;
    invites: number;
    contentAssets: number;
  };
}

function MetricCard({ label, value, icon: Icon, trend, color = "primary" }: {
  label: string;
  value: string | number;
  icon: any;
  trend?: string;
  color?: string;
}) {
  return (
    <Card data-testid={`metric-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold font-mono mt-1">{value}</p>
            {trend && <p className="text-xs text-muted-foreground mt-1">{trend}</p>}
          </div>
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KFactorChart({ rollups }: { rollups: GlobalRollup[] }) {
  if (rollups.length === 0) return null;

  const maxK = Math.max(0.1, ...rollups.map(r => r.kFactorEstimate || 0));
  const chartHeight = 120;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          K-Factor Trend
        </CardTitle>
        <CardDescription>Viral coefficient over time (K &gt; 1 = viral growth)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1 h-32" data-testid="chart-kfactor">
          {rollups.slice(-30).map((r, i) => {
            const height = maxK > 0 ? (r.kFactorEstimate / maxK) * chartHeight : 0;
            const isViral = r.kFactorEstimate >= 1;
            return (
              <div key={r.date} className="flex-1 flex flex-col items-center gap-1" title={`${r.date}: K=${r.kFactorEstimate?.toFixed(3)}`}>
                <div
                  className={`w-full rounded-t ${isViral ? "bg-green-500" : "bg-primary/60"}`}
                  style={{ height: `${Math.max(2, height)}px` }}
                />
                {i % 7 === 0 && (
                  <span className="text-[8px] text-muted-foreground rotate-45 origin-left">
                    {r.date.slice(5)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>K=0</span>
          <span className="text-green-600 font-medium">K=1 (viral threshold)</span>
          <span>K={maxK.toFixed(2)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FlywheelDashboard() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<FlywheelData>({
    queryKey: ["/api/admin/growth/flywheel"],
  });

  const { data: topAssets } = useQuery<{ assets: ContentAsset[] }>({
    queryKey: ["/api/admin/growth/flywheel/top-assets"],
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/growth/flywheel/compute", {});
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/flywheel"] });
      toast({ title: "Rollup computed", description: `${result.date}: DAU=${result.dau}, K=${result.kFactor?.toFixed(3)}` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to compute rollup", variant: "destructive" });
    },
  });

  const rollups = data?.rollups || [];
  const latest = rollups.length > 0 ? rollups[rollups.length - 1] : null;
  const assets = topAssets?.assets || [];

  const kAlert = latest && latest.kFactorEstimate >= 0.8;

  return (
    <div className="space-y-6" data-testid="admin-flywheel-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Growth Flywheel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gameplay → Content → Shares → Invites → New Users
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => computeMutation.mutate()}
          disabled={computeMutation.isPending}
          data-testid="button-compute-rollup"
        >
          {computeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Compute Yesterday
        </Button>
      </div>

      {kAlert && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Target className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">K-Factor approaching viral threshold!</p>
              <p className="text-sm text-muted-foreground">
                Current K = {latest?.kFactorEstimate?.toFixed(3)} (K ≥ 1.0 = viral growth)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="DAU"
              value={latest?.dau ?? 0}
              icon={Users}
              trend={rollups.length > 1 ? `prev: ${rollups[rollups.length - 2]?.dau ?? 0}` : undefined}
            />
            <MetricCard
              label="Matches/Day"
              value={latest?.matches ?? 0}
              icon={Target}
            />
            <MetricCard
              label="Shares/Day"
              value={latest?.shares ?? data?.todayLive?.shares ?? 0}
              icon={Share2}
              trend={`Today live: ${data?.todayLive?.shares ?? 0}`}
            />
            <MetricCard
              label="Invites/Day"
              value={latest?.invites ?? data?.todayLive?.invites ?? 0}
              icon={UserPlus}
              trend={`Signups: ${latest?.signupsFromInvites ?? 0}`}
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <MetricCard
              label="K-Factor"
              value={latest?.kFactorEstimate?.toFixed(3) ?? "0.000"}
              icon={TrendingUp}
              trend={latest && latest.kFactorEstimate >= 1 ? "VIRAL" : "Sub-viral"}
            />
            <MetricCard
              label="Content Assets"
              value={data?.todayLive?.contentAssets ?? 0}
              icon={Image}
              trend="Total generated"
            />
            <MetricCard
              label="Today Invites"
              value={data?.todayLive?.invites ?? 0}
              icon={UserPlus}
              trend="Live count"
            />
          </div>

          <KFactorChart rollups={rollups} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Daily Rollup History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rollups.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No rollup data yet. Click "Compute Yesterday" to generate.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-2">Date</th>
                        <th className="p-2">DAU</th>
                        <th className="p-2">Matches</th>
                        <th className="p-2">Shares</th>
                        <th className="p-2">Invites</th>
                        <th className="p-2">Signups</th>
                        <th className="p-2">K-Factor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollups.slice().reverse().slice(0, 14).map(r => (
                        <tr key={r.date} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono text-xs">{r.date}</td>
                          <td className="p-2 font-mono">{r.dau}</td>
                          <td className="p-2 font-mono">{r.matches}</td>
                          <td className="p-2 font-mono">{r.shares}</td>
                          <td className="p-2 font-mono">{r.invites}</td>
                          <td className="p-2 font-mono">{r.signupsFromInvites}</td>
                          <td className="p-2">
                            <Badge variant={r.kFactorEstimate >= 1 ? "default" : "secondary"} className="font-mono text-xs">
                              {r.kFactorEstimate?.toFixed(3)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Image className="h-4 w-4" />
                Recent Content Assets
              </CardTitle>
              <CardDescription>Latest auto-generated score cards and streak badges</CardDescription>
            </CardHeader>
            <CardContent>
              {assets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No content assets generated yet.</p>
              ) : (
                <div className="space-y-2">
                  {assets.map(asset => (
                    <div key={asset.id} className="flex items-center justify-between p-3 rounded-md bg-muted/50" data-testid={`asset-${asset.id}`}>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{asset.assetType}</Badge>
                        <div>
                          <p className="text-sm font-medium">
                            {(asset.metadata as any)?.username || asset.userId?.slice(0, 8) || "system"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {asset.sourceEventId} · {new Date(asset.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {asset.imagePath && (
                          <Button variant="ghost" size="icon" asChild>
                            <a href={asset.imagePath} target="_blank" rel="noopener noreferrer" data-testid={`button-view-asset-${asset.id}`}>
                              <ArrowRight className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
