import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Users, Gamepad2, CreditCard, TrendingUp, Activity, Wallet, Paintbrush, BarChart2, Layers, Repeat, Filter } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface MetricsData {
  dau: number;
  matchesPerUser: number;
  purchaseConversionRate: number;
  packptsLiability: number;
  redemptionRate: number;
  totalRevenue?: number;
  activeSubscriptions?: number;
}

interface MakingFunnelStep {
  eventType: string;
  events: number;
  uniqueUsers: number;
  conversionFromPrev: number | null;
}

interface MakingFrictionKpis {
  identifyFailRate: number;
  identifyAttempts: number;
  timeToPublish: { p50Ms: number | null; p90Ms: number | null; samples: number };
  nameMixtape: {
    reachedUsers: number;
    publishedUsers: number;
    dropOffUsers: number;
    dropOffRate: number;
  };
  shareOpen: { openedUsers: number; publishedUsers: number; openRate: number };
}

interface MakingFunnelWindow {
  windowDays: 7 | 30;
  steps: MakingFunnelStep[];
  fails: {
    identifyFail: { events: number; uniqueUsers: number };
    publishFail: { events: number; uniqueUsers: number };
  };
  topDropOff: {
    from: string;
    to: string;
    lostUsers: number;
    lostEvents: number;
  } | null;
  friction?: MakingFrictionKpis;
}

interface MakingLayerMetrics {
  setsMadeByDay: { day: string; count: number }[];
  makerRate: number;
  makers30d?: number;
  mau30d?: number;
  publishedSetsNonStaff?: number;
  makerSupplyGate?: {
    publishedSetsNonStaff: number;
    target: number;
    remaining: number;
    progress: number;
    reached: boolean;
  };
  funnel?: {
    last7d: MakingFunnelWindow;
    last30d: MakingFunnelWindow;
  };
  setPlayDepth: number;
  topSets: {
    id: string;
    setName: string;
    makerNote: string | null;
    makerUsername: string | null;
    playCount: number;
    outboundClicks: number;
  }[];
  clicksBySet?: { setId: string; clicks: number }[];
}

interface RetentionHeadline {
  cohortWeek: string;
  cohortSize: number;
  returned: number;
  rate: number;
}

interface RetentionCohortRow {
  cohortWeek: string;
  cohortSize: number;
  d1Returned: number;
  d7Returned: number;
  d30Returned: number;
  d1Rate: number | null;
  d7Rate: number | null;
  d30Rate: number | null;
}

interface RetentionMetrics {
  timezone: string;
  asOfDay: string;
  definition: {
    cohort: string;
    returnOn: string;
    staff: string;
    pending: string;
  };
  headlines: {
    d1: RetentionHeadline | null;
    d7: RetentionHeadline | null;
    d30: RetentionHeadline | null;
  };
  cohorts: RetentionCohortRow[];
  makerRate: number;
  makers30d?: number;
  mau30d?: number;
}

function formatRetentionPct(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatReturned(returned: number, size: number, rate: number | null): string {
  if (rate === null) return "—";
  return `${returned} / ${size}`;
}

const FUNNEL_STEP_LABELS: Record<string, string> = {
  make_started: "/make start",
  identify_success: "Identify success",
  name_started: "Name / mixtape",
  publish_success: "Publish success",
  share_generated: "Share generated",
  share_opened: "Share opened",
  set_viewed: "/sets/:id view",
};

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function FunnelWindowCard({ title, window }: { title: string; window: MakingFunnelWindow }) {
  const drop = window.topDropOff;
  return (
    <Card data-testid={`card-maker-funnel-${window.windowDays}d`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>
          {drop
            ? `Top drop-off: ${FUNNEL_STEP_LABELS[drop.from] ?? drop.from} → ${FUNNEL_STEP_LABELS[drop.to] ?? drop.to} (−${drop.lostUsers} users / −${drop.lostEvents} events)`
            : "No funnel events in this window yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="text-left px-4 py-2 font-medium">Step</th>
              <th className="text-right px-4 py-2 font-medium">Events</th>
              <th className="text-right px-4 py-2 font-medium">Users</th>
              <th className="text-right px-4 py-2 font-medium">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {window.steps.map((step) => (
              <tr key={step.eventType} className="border-b last:border-0">
                <td className="px-4 py-2">{FUNNEL_STEP_LABELS[step.eventType] ?? step.eventType}</td>
                <td className="px-4 py-2 text-right font-mono">{step.events.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono">{step.uniqueUsers.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                  {step.conversionFromPrev == null
                    ? "—"
                    : `${(step.conversionFromPrev * 100).toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 text-xs text-muted-foreground space-y-1" data-testid={`text-make-friction-${window.windowDays}d`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Identify fail: {window.fails.identifyFail.events.toLocaleString()} events
              ({window.fails.identifyFail.uniqueUsers.toLocaleString()} users)
              {window.friction
                ? ` · ${(window.friction.identifyFailRate * 100).toFixed(0)}% fail rate`
                : ""}
            </span>
            <span>
              Publish fail: {window.fails.publishFail.events.toLocaleString()} events
              ({window.fails.publishFail.uniqueUsers.toLocaleString()} users)
            </span>
          </div>
          {window.friction && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Time-to-publish: p50 {formatDurationMs(window.friction.timeToPublish.p50Ms)}
                {" · "}p90 {formatDurationMs(window.friction.timeToPublish.p90Ms)}
                {" · "}{window.friction.timeToPublish.samples} samples
              </span>
              <span>
                Name/mixtape drop-off: {window.friction.nameMixtape.dropOffUsers.toLocaleString()} users
                {" "}({(window.friction.nameMixtape.dropOffRate * 100).toFixed(0)}%)
              </span>
              <span>
                Share open rate: {(window.friction.shareOpen.openRate * 100).toFixed(0)}%
                {" "}({window.friction.shareOpen.openedUsers.toLocaleString()} / {window.friction.shareOpen.publishedUsers.toLocaleString()})
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
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
      const response = await fetch("/api/admin/metrics", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch metrics");
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: mlData, isLoading: mlLoading } = useQuery<MakingLayerMetrics>({
    queryKey: ["/api/admin/metrics/making-layer"],
    queryFn: async () => {
      const response = await fetch("/api/admin/metrics/making-layer", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch Making Layer metrics");
      return response.json();
    },
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: retention, isLoading: retentionLoading } = useQuery<RetentionMetrics>({
    queryKey: ["/api/admin/retention"],
    queryFn: async () => {
      const response = await fetch("/api/admin/retention", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch retention");
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
    { title: "Daily Active Users", value: data.dau?.toLocaleString() ?? "0", icon: Users, color: "text-blue-500", description: "Users active today" },
    { title: "Matches/User", value: data.matchesPerUser?.toFixed(2) ?? "0", icon: Gamepad2, color: "text-green-500", description: "Average matches per user" },
    { title: "Purchase Conversion", value: `${((data.purchaseConversionRate ?? 0) * 100).toFixed(1)}%`, icon: TrendingUp, color: "text-yellow-500", description: "Users who made a purchase" },
    { title: "PackPTS Liability", value: (data.packptsLiability ?? 0).toLocaleString(), icon: Wallet, color: "text-purple-500", description: "Total outstanding points" },
    { title: "Redemption Rate", value: `${((data.redemptionRate ?? 0) * 100).toFixed(1)}%`, icon: Activity, color: "text-orange-500", description: "Points redeemed vs earned" },
    { title: "Active Subscriptions", value: data.activeSubscriptions?.toLocaleString() ?? "0", icon: CreditCard, color: "text-emerald-500", description: "Current paid subscribers" },
  ];

  const makerRate = retention?.makerRate ?? mlData?.makerRate ?? 0;
  const makers30d = retention?.makers30d ?? mlData?.makers30d;
  const mau30d = retention?.mau30d ?? mlData?.mau30d;

  return (
    <div className="space-y-10">
      <div className="space-y-4" data-testid="admin-retention-section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-primary" />
              <h1 className="text-3xl font-bold" data-testid="text-admin-metrics-title">Weekly retention</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              Internal Eng proof — D1 / D7 / D30 + Maker Rate. Not published externally.
            </p>
          </div>
          <Badge variant="outline" data-testid="badge-retention-internal">Admin only</Badge>
        </div>

        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">Cohort:</span>{" "}
              first <code className="text-xs">event_log</code> day (America/Chicago), not signup.
              Same activity spine as admin DAU and Maker Rate MAU.
            </p>
            <p>
              <span className="font-medium text-foreground">D_N:</span>{" "}
              ≥1 event on first-active CT date + N. Day 0 is not D1. “—” means the week’s window is still open — do not read it as 0%.
            </p>
            <p>
              <span className="font-medium text-foreground">Exclusions:</span>{" "}
              staff (<code className="text-xs">is_admin</code>, same as Maker Rate) and bots.
              Retention emails use last-played, not this table.
            </p>
            {retention && (
              <p data-testid="text-retention-as-of">
                As of {retention.asOfDay} ({retention.timezone}). Read cohort size before the rate.
              </p>
            )}
          </CardContent>
        </Card>

        {retentionLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : retention ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card data-testid="card-retention-d1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">D1 (latest mature)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{formatRetentionPct(retention.headlines.d1?.rate ?? null)}</p>
                  <CardDescription className="mt-1">
                    {retention.headlines.d1
                      ? `${retention.headlines.d1.returned} / ${retention.headlines.d1.cohortSize} · week of ${retention.headlines.d1.cohortWeek}`
                      : "No closed D1 week yet"}
                  </CardDescription>
                </CardContent>
              </Card>
              <Card data-testid="card-retention-d7">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">D7 (latest mature)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{formatRetentionPct(retention.headlines.d7?.rate ?? null)}</p>
                  <CardDescription className="mt-1">
                    {retention.headlines.d7
                      ? `${retention.headlines.d7.returned} / ${retention.headlines.d7.cohortSize} · week of ${retention.headlines.d7.cohortWeek}`
                      : "No closed D7 week yet"}
                  </CardDescription>
                </CardContent>
              </Card>
              <Card data-testid="card-retention-d30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">D30 (latest mature)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{formatRetentionPct(retention.headlines.d30?.rate ?? null)}</p>
                  <CardDescription className="mt-1">
                    {retention.headlines.d30
                      ? `${retention.headlines.d30.returned} / ${retention.headlines.d30.cohortSize} · week of ${retention.headlines.d30.cohortWeek}`
                      : "No closed D30 week yet"}
                  </CardDescription>
                </CardContent>
              </Card>
              <Card data-testid="card-retention-maker-rate">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Maker Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">{(makerRate * 100).toFixed(1)}%</p>
                  <CardDescription className="mt-1">
                    {makers30d != null && mau30d != null
                      ? `${makers30d} makers / ${mau30d} MAU · 30d, staff excluded`
                      : "% of 30d MAU who published ≥1 set in 30d"}
                  </CardDescription>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Weekly first-active cohorts</CardTitle>
                <CardDescription>
                  Monday-start ISO week in America/Chicago. Newest week first.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {retention.cohorts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No first-active cohorts in the last 13 weeks
                  </p>
                ) : (
                  <table className="w-full text-sm" data-testid="table-retention-cohorts">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left px-4 py-2 font-medium">Week (Mon)</th>
                        <th className="text-right px-4 py-2 font-medium">Cohort</th>
                        <th className="text-right px-4 py-2 font-medium">D1</th>
                        <th className="text-right px-4 py-2 font-medium">D7</th>
                        <th className="text-right px-4 py-2 font-medium">D30</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retention.cohorts.map((row) => (
                        <tr key={row.cohortWeek} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-2 font-mono">{row.cohortWeek}</td>
                          <td className="px-4 py-2 text-right font-mono font-bold">{row.cohortSize}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatRetentionPct(row.d1Rate)}
                            <span className="block text-xs text-muted-foreground font-normal">
                              {formatReturned(row.d1Returned, row.cohortSize, row.d1Rate)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatRetentionPct(row.d7Rate)}
                            <span className="block text-xs text-muted-foreground font-normal">
                              {formatReturned(row.d7Returned, row.cohortSize, row.d7Rate)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatRetentionPct(row.d30Rate)}
                            <span className="block text-xs text-muted-foreground font-normal">
                              {formatReturned(row.d30Returned, row.cohortSize, row.d30Rate)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Retention data unavailable.</p>
        )}
      </div>

      {/* Platform Metrics */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Platform Metrics</h2>
          <p className="text-muted-foreground">Key performance indicators for PackPTS</p>
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

      {/* Making Layer Metrics */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Paintbrush className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-xl font-bold">Making Layer</h2>
            <p className="text-muted-foreground text-sm">User-created set health and engagement</p>
          </div>
        </div>

        {mlLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : mlData ? (
          <div className="space-y-4">
            {/* Stat tiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-indigo-500" />
                    <CardTitle className="text-sm font-medium">Maker Rate</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">
                    {(mlData.makerRate * 100).toFixed(1)}%
                  </p>
                  <CardDescription className="mt-1">
                    % of 30d MAU who published ≥1 set in 30d
                  </CardDescription>
                </CardContent>
              </Card>
              <Card data-testid="card-metric-published-sets-non-staff">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-teal-500" />
                    <CardTitle className="text-sm font-medium">Published sets (non-staff)</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono" data-testid="text-maker-supply-gate">
                    {(mlData.makerSupplyGate?.publishedSetsNonStaff ?? mlData.publishedSetsNonStaff ?? 0).toLocaleString()}
                    <span className="text-lg font-medium text-muted-foreground">
                      {" "}/ {mlData.makerSupplyGate?.target ?? 10}
                    </span>
                  </p>
                  <Progress
                    className="mt-3 h-2"
                    value={(mlData.makerSupplyGate?.progress ?? 0) * 100}
                    data-testid="progress-maker-supply-gate"
                  />
                  <CardDescription className="mt-2">
                    {mlData.makerSupplyGate?.reached
                      ? "Diligence ≥10 gate reached (admin-only; not shown publicly)"
                      : `${mlData.makerSupplyGate?.remaining ?? 10} more non-staff published sets to the ≥10 gate`}
                  </CardDescription>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="h-5 w-5 text-pink-500" />
                    <CardTitle className="text-sm font-medium">Set Play Depth</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold font-mono">
                    {mlData.setPlayDepth.toFixed(1)}
                  </p>
                  <CardDescription className="mt-1">
                    Avg plays per user-created set (sets with ≥1 play)
                  </CardDescription>
                </CardContent>
              </Card>
            </div>

            {mlData.funnel && (
              <div className="space-y-3" data-testid="section-maker-supply-funnel">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Maker supply funnel</p>
                    <p className="text-xs text-muted-foreground">
                      event_log · staff excluded · admin only · no public volume claims
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <FunnelWindowCard title="Last 7 days" window={mlData.funnel.last7d} />
                  <FunnelWindowCard title="Last 30 days" window={mlData.funnel.last30d} />
                </div>
              </div>
            )}

            {/* Sets Made per day chart */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" />
                  <CardTitle className="text-sm font-medium">Sets Made per Day (last 30 days)</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {mlData.setsMadeByDay.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                    No sets created yet
                  </div>
                ) : (
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mlData.setsMadeByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                          labelFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        />
                        <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Sets Made" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top 10 sets table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Top 10 Sets by Plays</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {mlData.topSets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No user-created sets yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left px-4 py-2 font-medium">#</th>
                        <th className="text-left px-4 py-2 font-medium">Set Name</th>
                        <th className="text-left px-4 py-2 font-medium">Maker</th>
                        <th className="text-right px-4 py-2 font-medium">Plays</th>
                        <th className="text-right px-4 py-2 font-medium">Clicks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mlData.topSets.map((set, i) => (
                        <tr key={set.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-2 text-muted-foreground font-mono">{i + 1}</td>
                          <td className="px-4 py-2">
                            <p className="font-medium">{set.setName}</p>
                            {set.makerNote && (
                              <p className="text-xs text-muted-foreground italic line-clamp-1">"{set.makerNote}"</p>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{set.makerUsername ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono font-bold">{Number(set.playCount)}</td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">{set.outboundClicks ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
