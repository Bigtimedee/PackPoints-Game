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
  Clock, Zap, FileText, Send, Loader2, ShieldAlert
} from "lucide-react";

interface Overview {
  enabled: boolean;
  circuitBreaker: { state: string; failureCount: number; openUntil: number };
  registeredJobs: string[];
  schedule: { name: string; cronHour: number; cronMinute: number; lastRun: string }[];
  recentPlans: any[];
  recentRuns: any[];
  pendingQueueCount: number;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCEEDED" || status === "POSTED" || status === "ACTIVE"
    ? "default" : status === "FAILED" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
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
  const { data, isLoading } = useQuery<{ runs: any[] }>({
    queryKey: ["/api/admin/growth/runs"],
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-2">
      {data?.runs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No job runs yet</p>
      )}
      {data?.runs.map(run => (
        <div key={run.id} className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{run.jobName.replace(/_/g, " ")}</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-2">
            {run.error && (
              <span className="text-xs text-destructive max-w-[200px] truncate">{run.error}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
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
          <TabsTrigger value="items" data-testid="tab-items">Content</TabsTrigger>
          <TabsTrigger value="queue" data-testid="tab-queue">Queue</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Job Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="items"><ContentItemsTab /></TabsContent>
        <TabsContent value="queue"><QueueTab /></TabsContent>
        <TabsContent value="logs"><JobLogsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
