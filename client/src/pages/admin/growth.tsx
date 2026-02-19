import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Play, RefreshCw, Copy, Check, AlertTriangle,
  Clock, Zap, FileText, Send, Loader2, ShieldAlert, Archive, CalendarDays
} from "lucide-react";

interface PipelineHealth {
  hasTodayPlan: boolean;
  todayContentCount: number;
  todayPostCount: number;
  lastPlanFailure?: string;
  stalled: boolean;
  stalledReason?: string;
}

interface Overview {
  enabled: boolean;
  circuitBreaker: { state: string; failureCount: number; openUntil: number };
  registeredJobs: string[];
  schedule: { name: string; cronHour: number; cronMinute: number; lastRun: string }[];
  recentPlans: any[];
  recentRuns: any[];
  pendingQueueCount: number;
  platformStatus?: { discord: boolean; x: boolean; instagram: boolean; reddit: boolean };
  pipelineHealth?: PipelineHealth;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCEEDED" || status === "POSTED" || status === "ACTIVE"
    ? "default"
    : status === "FAILED" ? "destructive"
    : status === "RETRY_PENDING" ? "outline"
    : "secondary";
  return <Badge variant={variant} data-testid={`badge-status-${status.toLowerCase()}`}>{status === "RETRY_PENDING" ? "RETRYING" : status}</Badge>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} data-testid="button-copy">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function OverviewTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<Overview>({
    queryKey: ["/api/admin/growth/overview"],
  });

  const runJobMutation = useMutation({
    mutationFn: (jobName: string) => apiRequest("POST", "/api/admin/growth/run-job", { jobName }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: `Job ${data.status}`, description: data.error || `Run ID: ${data.runId}` });
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Job failed", description: err.message, variant: "destructive" });
    },
  });

  const resetCBMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/growth/circuit-breaker/reset"),
    onSuccess: () => {
      toast({ title: "Circuit breaker reset" });
      refetch();
    },
  });

  if (isLoading || !data) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Status</span>
            </div>
            <Badge variant={data.enabled ? "default" : "secondary"} className="mt-2">
              {data.enabled ? "ENABLED" : "DISABLED"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Circuit Breaker</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={data.circuitBreaker.state === "OPEN" ? "destructive" : "default"}>
                {data.circuitBreaker.state}
              </Badge>
              {data.circuitBreaker.state === "OPEN" && (
                <Button size="sm" variant="outline" onClick={() => resetCBMutation.mutate()}
                  data-testid="button-reset-cb">
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Pending Queue</span>
            </div>
            <p className="text-2xl font-bold font-mono mt-2" data-testid="text-pending-count">
              {data.pendingQueueCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {data.platformStatus && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Send className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Platform Connections</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.platformStatus).map(([platform, connected]) => (
                <Badge key={platform} variant={connected ? "default" : "secondary"}
                  data-testid={`badge-platform-${platform}`}>
                  {connected ? <Check className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                  {platform === "x" ? "X / Twitter" : platform.charAt(0).toUpperCase() + platform.slice(1)}
                  {connected ? "" : " (not configured)"}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.pipelineHealth?.stalled && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">Pipeline Stalled</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-stalled-reason">
              {data.pipelineHealth.stalledReason}
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold font-mono" data-testid="text-plan-status">
                  {data.pipelineHealth.hasTodayPlan ? "1" : "0"}
                </p>
                <p className="text-xs text-muted-foreground">Plans Today</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono" data-testid="text-content-count">
                  {data.pipelineHealth.todayContentCount}
                </p>
                <p className="text-xs text-muted-foreground">Content Items</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono" data-testid="text-post-count">
                  {data.pipelineHealth.todayPostCount}
                </p>
                <p className="text-xs text-muted-foreground">Posts Made</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Manual Job Trigger
          </CardTitle>
          <CardDescription>Run jobs manually regardless of schedule</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.registeredJobs.map(job => (
              <Button key={job} variant="outline" size="sm"
                disabled={runJobMutation.isPending}
                onClick={() => runJobMutation.mutate(job)}
                data-testid={`button-run-${job}`}>
                {runJobMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                {job.replace(/_/g, " ")}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.schedule.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
                <span className="text-sm font-medium">{s.name.replace(/_/g, " ")}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {String(s.cronHour).padStart(2, "0")}:{String(s.cronMinute).padStart(2, "0")} UTC
                  </Badge>
                  {s.lastRun && <span className="text-xs text-muted-foreground">{s.lastRun}</span>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContentItemsTab() {
  const { data, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ["/api/admin/growth/items"],
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-3">
      {data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No content items yet</p>
      )}
      {data?.items.map(item => (
        <Card key={item.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge variant="outline">{item.platform}</Badge>
                  <Badge variant="outline">{item.type}</Badge>
                  <StatusBadge status={item.status} />
                  <Badge variant={item.postingMode === "AUTO" ? "default" : "secondary"}>
                    {item.postingMode}
                  </Badge>
                </div>
                {item.title && <p className="font-medium text-sm">{item.title}</p>}
                {item.body && (
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line line-clamp-4">
                    {item.body}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              {item.body && <CopyButton text={item.body} />}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QueueTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ items: any[] }>({
    queryKey: ["/api/admin/growth/queue"],
  });

  const markPostedMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/growth/queue/${id}/posted`),
    onSuccess: () => {
      toast({ title: "Marked as posted" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-3">
      {data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">Publishing queue is empty</p>
      )}
      {data?.items.map(item => (
        <Card key={item.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge variant="outline">{item.platform}</Badge>
                  <StatusBadge status={item.status} />
                </div>
                {item.copyText && (
                  <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line line-clamp-6">
                    {item.copyText}
                  </p>
                )}
                {item.notes && <p className="text-xs italic mt-1">{item.notes}</p>}
                <p className="text-xs text-muted-foreground mt-2">
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {item.copyText && <CopyButton text={item.copyText} />}
                {item.status === "READY" && (
                  <Button size="sm" variant="outline"
                    onClick={() => markPostedMutation.mutate(item.id)}
                    disabled={markPostedMutation.isPending}
                    data-testid={`button-mark-posted-${item.id}`}>
                    <Check className="h-3 w-3 mr-1" />
                    Posted
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function JobLogsTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ runs: any[] }>({
    queryKey: ["/api/admin/growth/runs"],
  });

  const retryMutation = useMutation({
    mutationFn: (jobName: string) => apiRequest("POST", "/api/admin/growth/run-job", { jobName }),
    onSuccess: async (res) => {
      const result = await res.json();
      toast({ title: `Retry ${result.status}`, description: result.error || `Run ID: ${result.runId}` });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const [expandedError, setExpandedError] = useState<string | null>(null);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-2">
      {data?.runs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No job runs yet</p>
      )}
      {data?.runs.map(run => (
        <div key={run.id} className="p-3 rounded-md bg-muted/50 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{run.jobName.replace(/_/g, " ")}</span>
              <StatusBadge status={run.status} />
            </div>
            <div className="flex items-center gap-2">
              {(run.status === "FAILED" || run.status === "SKIPPED" || run.status === "RETRY_PENDING") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => retryMutation.mutate(run.jobName)}
                  disabled={retryMutation.isPending}
                  data-testid={`button-retry-${run.id}`}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </div>
          </div>
          {run.error && (
            <div
              className="cursor-pointer"
              onClick={() => setExpandedError(expandedError === run.id ? null : run.id)}
              data-testid={`error-detail-${run.id}`}>
              <p className={`text-xs text-destructive ${expandedError === run.id ? "" : "line-clamp-2"}`}>
                {run.error}
              </p>
              <span className="text-xs text-muted-foreground">
                {expandedError === run.id ? "Click to collapse" : "Click to expand"}
              </span>
            </div>
          )}
          {run.status === "SKIPPED" && run.details?.reason && (
            <p className="text-xs text-muted-foreground">
              {run.details.reason}
            </p>
          )}
          {run.status === "RETRY_PENDING" && run.details?.retryAt && (
            <p className="text-xs text-muted-foreground">
              Retry #{run.details.retryCount || 1}/{run.details.maxRetries || 3} scheduled at {new Date(run.details.retryAt).toLocaleString()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ContentPlansTab() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ plans: any[] }>({
    queryKey: ["/api/admin/growth/plans"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/admin/growth/plans/${id}`, { status }),
    onSuccess: () => {
      toast({ title: "Plan updated" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-3">
      {data?.plans.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-plans">No content plans yet</p>
      )}
      {data?.plans.map(plan => {
        const platforms = Array.isArray(plan.targetPlatforms) ? plan.targetPlatforms : [];
        return (
          <Card key={plan.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium" data-testid={`text-plan-date-${plan.id}`}>{plan.date}</span>
                    <StatusBadge status={plan.status} />
                  </div>
                  {plan.theme && (
                    <p className="text-sm font-medium mb-1" data-testid={`text-plan-theme-${plan.id}`}>{plan.theme}</p>
                  )}
                  {plan.hook && (
                    <p className="text-sm text-muted-foreground mb-1" data-testid={`text-plan-hook-${plan.id}`}>
                      {plan.hook}
                    </p>
                  )}
                  {platforms.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {platforms.map((p: string) => (
                        <Badge key={p} variant="outline" data-testid={`badge-plan-platform-${p}`}>{p}</Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(plan.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {plan.status === "ACTIVE" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatusMutation.mutate({ id: plan.id, status: "ARCHIVED" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-archive-plan-${plan.id}`}>
                      <Archive className="h-3 w-3 mr-1" />
                      Archive
                    </Button>
                  )}
                  {plan.status === "ARCHIVED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatusMutation.mutate({ id: plan.id, status: "ACTIVE" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-activate-plan-${plan.id}`}>
                      <Play className="h-3 w-3 mr-1" />
                      Activate
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function AdminGrowth() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-growth-title">Growth Agent</h1>
          <p className="text-sm text-muted-foreground">AI-powered content generation and social automation</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="plans" data-testid="tab-plans">Plans</TabsTrigger>
          <TabsTrigger value="items" data-testid="tab-items">Content</TabsTrigger>
          <TabsTrigger value="queue" data-testid="tab-queue">Queue</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Job Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="plans"><ContentPlansTab /></TabsContent>
        <TabsContent value="items"><ContentItemsTab /></TabsContent>
        <TabsContent value="queue"><QueueTab /></TabsContent>
        <TabsContent value="logs"><JobLogsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
