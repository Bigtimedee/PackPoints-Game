import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Megaphone, Play, RefreshCw, Copy, Check, AlertTriangle,
  Clock, Zap, FileText, Send, Loader2, ShieldAlert, Archive, CalendarDays,
  Download, Hash, Clipboard, Video, Undo2, CheckSquare, ListChecks,
  ChevronDown, ChevronUp, PackageOpen, X, ExternalLink, CircleCheck
} from "lucide-react";
import { SiTiktok, SiX, SiInstagram, SiFacebook } from "react-icons/si";

interface PipelineHealth {
  hasTodayPlan: boolean;
  todayContentCount: number;
  todayPostCount: number;
  lastPlanFailure?: string;
  stalled: boolean;
  stalledReason?: string;
}

interface DetailedPipelineStage {
  stage: string;
  status: "GREEN" | "YELLOW" | "RED";
  message: string;
  lastRun?: { status: string; at: string; error?: string } | null;
}

interface DetailedPipelineHealth {
  overall: "GREEN" | "YELLOW" | "RED";
  openai: { status: "GREEN" | "YELLOW" | "RED"; source: string; lastCheck: any };
  circuitBreaker: { status: "GREEN" | "YELLOW" | "RED"; isOpen: boolean };
  stages: DetailedPipelineStage[];
  summary: string;
}

interface TikTokConfig {
  enabled: boolean;
  mode: string;
}

interface Overview {
  enabled: boolean;
  circuitBreaker: { state: string; failureCount: number; openUntil: number };
  registeredJobs: string[];
  schedule: { name: string; cronHour: number; cronMinute: number; lastRun: string }[];
  recentPlans: any[];
  recentRuns: any[];
  pendingQueueCount: number;
  platformStatus?: { discord: boolean; x: boolean; instagram: boolean; facebook?: boolean; reddit: boolean; tiktok?: boolean };
  
  tiktokConfig?: TikTokConfig;
  pipelineHealth?: PipelineHealth;
  detailedPipelineHealth?: DetailedPipelineHealth;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCEEDED" || status === "POSTED" || status === "ACTIVE"
    ? "default"
    : status === "FAILED" ? "destructive"
    : status === "RETRY_PENDING" ? "outline"
    : "secondary";
  return <Badge variant={variant} data-testid={`badge-status-${status.toLowerCase()}`}>{status === "RETRY_PENDING" ? "RETRYING" : status}</Badge>;
}


let _showCopyFallback: ((text: string, label: string) => void) | null = null;

function registerCopyFallback(fn: (text: string, label: string) => void) {
  _showCopyFallback = fn;
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(textarea);
  return ok;
}

async function copyToClipboard(text: string, label: string, toast: any) {
  if (!text || !text.trim()) {
    toast({ title: `No ${label.toLowerCase()} content to copy`, variant: "destructive" });
    return;
  }

  let success = false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      success = true;
    }
  } catch {}

  if (!success) {
    success = fallbackCopyText(text);
  }

  if (success) {
    toast({ title: `${label} copied to clipboard` });
  } else {
    if (_showCopyFallback) {
      _showCopyFallback(text, label);
    } else {
      toast({ title: `Could not copy automatically. Please select and copy the text manually.`, variant: "destructive" });
    }
  }
}

function triggerFileDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}

function CopyFallbackModal({ text, label, onClose }: { text: string; label: string; onClose: () => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectAll = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}
      data-testid="copy-fallback-modal">
      <div className="bg-background border rounded-lg shadow-lg p-4 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-sm">Copy {label}</h3>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="button-close-copy-modal">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Auto-copy didn't work. Select all the text below and copy it manually (Ctrl+C / Cmd+C).
        </p>
        <textarea
          ref={textareaRef}
          readOnly
          value={text}
          className="flex-1 min-h-[200px] w-full border rounded p-2 text-xs font-mono bg-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          data-testid="textarea-copy-fallback"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={handleSelectAll} data-testid="button-select-all-copy">
            Select All
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} data-testid="button-done-copy">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    let success = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        success = true;
      }
    } catch {}
    if (!success) {
      success = fallbackCopyText(text);
    }
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} data-testid="button-copy">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function CredentialHealthCard() {
  const { data, isLoading, refetch } = useQuery<{ credentials: { platform: string; valid: boolean; error?: string }[] }>({
    queryKey: ["/api/admin/growth/credential-health"],
    refetchInterval: 3 * 60 * 1000,
  });

  if (isLoading || !data?.credentials) return null;

  const POSTING_PLATFORMS = ["x", "instagram", "facebook", "discord", "reddit"];
  const all = POSTING_PLATFORMS.map(p => {
    const found = data.credentials.find(c => c.platform === p);
    return found ?? { platform: p, valid: false, error: "Not checked" };
  });

  const platformLabel = (p: string) =>
    p === "x" ? "X / Twitter" : p.charAt(0).toUpperCase() + p.slice(1);

  return (
    <Card data-testid="card-credential-health">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Live Credential Status</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => refetch()}
            data-testid="button-refresh-creds">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {all.map(c => (
            <div key={c.platform}
              title={c.valid ? "Credentials valid" : (c.error || "Invalid")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${
                c.valid
                  ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}>
              {c.valid
                ? <Check className="h-3 w-3" />
                : <AlertTriangle className="h-3 w-3" />}
              {platformLabel(c.platform)}
              {!c.valid && c.error && (
                <span className="text-[10px] opacity-70 max-w-[200px] truncate ml-1">— {c.error}</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface DiagnoseResult {
  credentials: Record<string, { valid: boolean; error?: string }>;
  queue: { autoReady: number; manualReady: number };
  itemCounts: { status: string; postingMode: string; platform: string; count: number }[];
  recentFailed: { id: string; platform: string; type: string; error: string | null; updatedAt: string }[];
  envVars: Record<string, boolean>;
}

function DiagnosePanel() {
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("GET", "/api/admin/growth/diagnose");
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Diagnostic failed");
    } finally {
      setLoading(false);
    }
  };

  const platformLabel = (p: string) =>
    p === "x" ? "X / Twitter" : p.charAt(0).toUpperCase() + p.slice(1);

  return (
    <Card data-testid="card-diagnose">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            Publisher Diagnostics
          </CardTitle>
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Run Diagnostics
          </Button>
        </div>
        <CardDescription>Live credential validation + queue state snapshot</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!result && !loading && (
          <p className="text-xs text-muted-foreground">Click "Run Diagnostics" to check system health.</p>
        )}
        {result && (
          <div className="space-y-4">
            {/* Credentials */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Credentials (live API check)</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.credentials).map(([platform, c]) => (
                  <div key={platform}
                    title={c.valid ? "Valid" : (c.error || "Invalid")}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${
                      c.valid
                        ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                        : "bg-destructive/10 border-destructive/30 text-destructive"
                    }`}>
                    {c.valid ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {platformLabel(platform)}
                    {!c.valid && c.error && (
                      <span className="text-[10px] opacity-80 ml-1 max-w-[220px] truncate">— {c.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Queue counts */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Queue State</p>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">AUTO+READY (will post): </span>
                  <span className={`font-bold ${result.queue.autoReady === 0 ? "text-yellow-500" : "text-green-500"}`}>
                    {result.queue.autoReady}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">MANUAL_QUEUE+READY (stuck): </span>
                  <span className={`font-bold ${result.queue.manualReady > 0 ? "text-yellow-500" : ""}`}>
                    {result.queue.manualReady}
                  </span>
                </div>
              </div>
            </div>

            {/* Item counts table */}
            {result.itemCounts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items by Status</p>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2">Platform</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Mode</th>
                        <th className="text-right p-2">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.itemCounts.map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{row.platform}</td>
                          <td className="p-2">
                            <Badge variant={row.status === "POSTED" ? "default" : row.status === "FAILED" ? "destructive" : "secondary"} className="text-[10px]">
                              {row.status}
                            </Badge>
                          </td>
                          <td className="p-2 text-muted-foreground">{row.postingMode}</td>
                          <td className="p-2 text-right font-mono font-bold">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent failures */}
            {result.recentFailed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Recent Failures ({result.recentFailed.length})
                </p>
                <div className="space-y-1">
                  {result.recentFailed.map(f => (
                    <div key={f.id} className="text-xs rounded bg-destructive/10 px-2 py-1">
                      <span className="font-medium">{f.platform}/{f.type}</span>
                      <span className="text-muted-foreground ml-2 font-mono">{f.error || "No error message"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Env vars */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Env Vars Set</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(result.envVars).map(([k, v]) => (
                  <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${v ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`}>
                    {v ? "✓" : "✗"} {k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
                  {platform === "x" ? "X / Twitter" : platform === "tiktok" ? "TikTok" : platform === "facebook" ? "Facebook" : platform.charAt(0).toUpperCase() + platform.slice(1)}
                  {platform === "tiktok" && connected ? " (manual)" : connected ? "" : " (not configured)"}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CredentialHealthCard />

      

      {data.detailedPipelineHealth && (
        <Card className={
          data.detailedPipelineHealth.overall === "RED" ? "border-destructive" :
          data.detailedPipelineHealth.overall === "YELLOW" ? "border-yellow-500" : "border-green-500"
        } data-testid="card-pipeline-health">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              {data.detailedPipelineHealth.overall === "RED" ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : data.detailedPipelineHealth.overall === "YELLOW" ? (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              ) : (
                <Check className="h-5 w-5 text-green-500" />
              )}
              <span className="text-sm font-medium">
                Pipeline Health: {data.detailedPipelineHealth.overall}
              </span>
              <Badge variant={
                data.detailedPipelineHealth.overall === "RED" ? "destructive" :
                data.detailedPipelineHealth.overall === "YELLOW" ? "outline" : "default"
              } data-testid="badge-pipeline-overall">
                {data.detailedPipelineHealth.overall}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-pipeline-summary">
              {data.detailedPipelineHealth.summary}
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  data.detailedPipelineHealth.openai.status === "GREEN" ? "bg-green-500" :
                  data.detailedPipelineHealth.openai.status === "YELLOW" ? "bg-yellow-500" : "bg-red-500"
                }`} />
                <span>OpenAI: {data.detailedPipelineHealth.openai.source || "not checked"}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  data.detailedPipelineHealth.circuitBreaker.isOpen ? "bg-red-500" : "bg-green-500"
                }`} />
                <span>Circuit Breaker: {data.detailedPipelineHealth.circuitBreaker.isOpen ? "OPEN" : "Closed"}</span>
              </div>
            </div>
            <div className="space-y-1">
              {data.detailedPipelineHealth.stages.map((stage) => (
                <div key={stage.stage} className="flex items-center gap-2 text-sm"
                  data-testid={`pipeline-stage-${stage.stage.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    stage.status === "GREEN" ? "bg-green-500" :
                    stage.status === "YELLOW" ? "bg-yellow-500" : "bg-red-500"
                  }`} />
                  <span className="font-medium min-w-[160px]">{stage.stage}</span>
                  <span className="text-muted-foreground truncate">{stage.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.pipelineHealth?.stalled && !data.detailedPipelineHealth && (
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

      <DiagnosePanel />

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

function ContentItemCard({ item }: { item: any }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/growth/items/${item.id}/retry`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Item reset to READY", description: "It will be retried on the next auto-post cycle." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/items"] });
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const metadata = item.metadata as any || {};
  const hashtags: string[] = metadata?.hashtags || [];
  const hashtagStr = hashtags.map((t: string) => `#${t}`).join(" ");
  const imageUrl = metadata?.imageUrl;
  const videoAsset = metadata?.video_asset;

  const body = item.body || "";
  const caption = item.title ? `${item.title}\n\n${body}` : body;
  const fullCaption = hashtagStr ? `${caption}\n\n${hashtagStr}` : caption;

  const xText = (body + (hashtagStr ? `\n\n${hashtagStr}` : "")).slice(0, 280);
  const igText = fullCaption.slice(0, 2200);

  const platformIcon = item.platform === "x" ? <SiX className="h-3 w-3" /> :
    item.platform === "instagram" ? <SiInstagram className="h-3 w-3" /> :
    item.platform === "facebook" ? <SiFacebook className="h-3 w-3" /> :
    item.platform === "tiktok" ? <SiTiktok className="h-3 w-3" /> : null;

  return (
    <Card className={item.status === "FAILED" ? "border-destructive/50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className="flex items-center gap-1">
                {platformIcon}
                {item.platform}
              </Badge>
              <Badge variant="outline">{item.type}</Badge>
              <StatusBadge status={item.status} />
              <Badge variant={item.postingMode === "AUTO" ? "default" : "secondary"}>
                {item.postingMode}
              </Badge>
            </div>
            {item.title && <p className="font-medium text-sm" data-testid={`text-title-${item.id}`}>{item.title}</p>}
            {item.body && (
              <p className={`text-sm text-muted-foreground mt-1 whitespace-pre-line ${expanded ? "" : "line-clamp-4"}`}
                data-testid={`text-body-${item.id}`}>
                {item.body}
              </p>
            )}
            {item.body && item.body.length > 200 && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs mt-1"
                onClick={() => setExpanded(!expanded)}
                data-testid={`button-expand-${item.id}`}>
                {expanded ? <><ChevronUp className="h-3 w-3 mr-1" /> Show less</> : <><ChevronDown className="h-3 w-3 mr-1" /> Show more</>}
              </Button>
            )}

            {item.status === "FAILED" && item.error && (
              <div className="mt-2 p-2 rounded-md bg-destructive/10 border border-destructive/20"
                data-testid={`error-details-${item.id}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-destructive mb-0.5">Error Details</p>
                    <p className="text-xs text-destructive/80 break-all">{item.error}</p>
                  </div>
                </div>
              </div>
            )}

            {["instagram", "facebook", "tiktok", "x"].includes(item.platform) && !imageUrl && !videoAsset && (
              <div className="mt-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30"
                data-testid={`warning-no-media-${item.id}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">
                    No media attached — upload a photo or video when posting to {item.platform}.
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-2">
              {new Date(item.createdAt).toLocaleString()}
              {item.postedAt && <> &middot; Posted {new Date(item.postedAt).toLocaleString()}</>}
            </p>
          </div>
        </div>

        <div className="mt-3 border-t pt-3 space-y-3">
          {(imageUrl || videoAsset?.path) && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Media</p>
              <div className="flex flex-wrap gap-2 items-start">
                {imageUrl && (
                  <>
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                      <img src={imageUrl} alt="Content image" className="max-h-24 rounded-md object-cover border cursor-pointer hover:opacity-80 transition-opacity"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        data-testid={`img-content-${item.id}`} />
                    </a>
                    <Button variant="outline" size="sm"
                      onClick={() => triggerFileDownload(imageUrl, `packpts_${item.platform}_${item.id}.jpg`)}
                      data-testid={`button-download-image-${item.id}`}>
                      <Download className="h-3 w-3 mr-1" />
                      Download Image
                    </Button>
                  </>
                )}
                {videoAsset?.path && (
                  <Button variant="outline" size="sm" asChild
                    data-testid={`button-download-video-${item.id}`}>
                    <a href={`/api/admin/growth/video/${item.id}/download`} download>
                      <Download className="h-3 w-3 mr-1" />
                      Download MP4
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Caption</p>
            <div className="flex flex-wrap gap-2">
              {item.status === "FAILED" && (
                <Button variant="destructive" size="sm"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                  data-testid={`button-retry-item-${item.id}`}>
                  {retryMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Retry
                </Button>
              )}

              {item.platform === "x" && (
                <Button variant="outline" size="sm"
                  onClick={() => copyToClipboard(xText, "Caption copied (280 chars)", toast)}
                  data-testid={`button-copy-x-${item.id}`}>
                  <SiX className="h-3 w-3 mr-1" />
                  Copy Caption
                </Button>
              )}

              {item.platform === "instagram" && (
                <Button variant="outline" size="sm"
                  onClick={() => copyToClipboard(igText, "Caption copied", toast)}
                  data-testid={`button-copy-ig-${item.id}`}>
                  <SiInstagram className="h-3 w-3 mr-1" />
                  Copy Caption
                </Button>
              )}

              {item.platform === "facebook" && (
                <Button variant="outline" size="sm"
                  onClick={() => copyToClipboard(fullCaption, "Caption copied", toast)}
                  data-testid={`button-copy-fb-${item.id}`}>
                  <SiFacebook className="h-3 w-3 mr-1" />
                  Copy Caption
                </Button>
              )}

              <Button variant="outline" size="sm"
                onClick={() => copyToClipboard(fullCaption, "Caption + hashtags copied", toast)}
                data-testid={`button-copy-full-${item.id}`}>
                <Clipboard className="h-3 w-3 mr-1" />
                Copy Caption + Hashtags
              </Button>

              {hashtagStr && (
                <Button variant="outline" size="sm"
                  onClick={() => copyToClipboard(hashtagStr, "Hashtags copied", toast)}
                  data-testid={`button-copy-hashtags-${item.id}`}>
                  <Hash className="h-3 w-3 mr-1" />
                  Copy Hashtags
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContentItemsTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const { data, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ["/api/admin/growth/items"],
  });

  const bulkRetryMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/admin/growth/items/bulk-retry", { ids });
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "Bulk retry complete", description: `${result.retried} items reset to READY` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/items"] });
    },
    onError: (err: any) => {
      toast({ title: "Bulk retry failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  const items = data?.items || [];
  const filteredItems = items.filter(item => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (platformFilter !== "all" && item.platform !== platformFilter) return false;
    return true;
  });

  const failedItems = filteredItems.filter(i => i.status === "FAILED");
  const failedCount = items.filter(i => i.status === "FAILED").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="READY">Ready</SelectItem>
            <SelectItem value="POSTED">Posted</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="QUEUED">Queued</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-platform-filter">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="x">X / Twitter</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="discord">Discord</SelectItem>
            <SelectItem value="reddit">Reddit</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
          </SelectContent>
        </Select>
        {failedCount > 0 && (
          <Button variant="destructive" size="sm"
            onClick={() => bulkRetryMutation.mutate(failedItems.map(i => i.id))}
            disabled={bulkRetryMutation.isPending || failedItems.length === 0}
            data-testid="button-bulk-retry">
            {bulkRetryMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Retry All Failed ({statusFilter === "all" ? failedCount : failedItems.length})
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filteredItems.length} items</span>
      </div>

      {filteredItems.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No content items match filters</p>
      )}
      {filteredItems.map(item => (
        <ContentItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}


function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJsonFile(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TikTokQueueCard({ item, onMarkPosted, onMarkReady, onRenderVideo, isPending, isRendering, selected, onSelect }: {
  item: any;
  onMarkPosted: (id: string) => void;
  onMarkReady: (id: string) => void;
  onRenderVideo: (id: string, forceRerender?: boolean) => void;
  isPending: boolean;
  isRendering: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  const { toast } = useToast();
  const [showMore, setShowMore] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [mediaDownloaded, setMediaDownloaded] = useState(false);
  const [textCopied, setTextCopied] = useState<string | null>(null);
  const assets = item.assets || {};
  const meta = item.contentItem?.metadata || assets;
  const hook = meta.hook || assets.hook || "";
  const script = meta.script || assets.script || "";
  const caption = meta.caption || item.copyText || "";
  const hashtags: string[] = meta.hashtags || assets.hashtags || [];
  const cta = meta.cta || assets.cta || "";
  const thumbnailText = meta.thumbnail_text || assets.thumbnail_text || "";
  const formatNotes = meta.format_notes || assets.format_notes || "";
  const audioNotes = meta.audio_notes || assets.audio_notes || "";
  const onScreenText: string[] = meta.on_screen_text || assets.on_screen_text || [];
  const assetRefs: any[] = meta.asset_refs || assets.asset_refs || [];
  const contentType = item.contentItem?.type || "TIKTOK";
  const scheduledFor = item.contentItem?.scheduledFor;
  const formatId = meta.format_id || assets.format_id || null;

  const videoAsset = meta.video_asset || assets.video_asset || null;
  const videoError = meta.video_error || null;
  const hasVideo = !!videoAsset?.url;
  const videoFileExists = item.videoFileExists ?? false;

  const hashtagsStr = hashtags.join(" ");
  const captionPlusHashtags = caption + "\n\n" + hashtagsStr;

  const tiktokCopyText = caption + "\n\n" + hashtagsStr;

  const xLink = "https://packpts.com";
  const xBase = caption.length > 0 ? caption : hook;
  const buildXPost = () => {
    const link = xLink;
    let tags = "";
    for (let i = Math.min(3, hashtags.length); i > 0; i--) {
      const candidate = hashtags.slice(0, i).join(" ");
      if (candidate.length + link.length + 4 < 250) { tags = candidate; break; }
    }
    const parts: string[] = [];
    const suffixLen = (tags ? tags.length + 1 : 0) + link.length + 1;
    const availableForCaption = 280 - suffixLen;
    if (availableForCaption >= 20) {
      const trimmed = xBase.length > availableForCaption
        ? xBase.slice(0, availableForCaption - 1).trimEnd() + "…"
        : xBase;
      parts.push(trimmed);
    }
    if (tags) parts.push(tags);
    parts.push(link);
    const result = parts.join("\n");
    if (result.length > 280) return result.slice(0, 279) + "…";
    return result;
  };
  const xCopyText = buildXPost();

  const igCopyText = hashtags.length > 0
    ? caption + "\n\n.\n.\n.\n" + hashtagsStr
    : caption;

  const copyAllContent = [
    `TIKTOK POST -- ${contentType.replace(/^TIKTOK_(VIRAL_)?/, "").replace(/_/g, " ")}`,
    `${"=".repeat(40)}`,
    "",
    `CAPTION (paste into TikTok):`,
    caption,
    "",
    `HASHTAGS:`,
    hashtagsStr,
    "",
    `SCRIPT:`,
    script,
    "",
    `HOOK: ${hook}`,
    "",
    `ON-SCREEN TEXT:`,
    ...onScreenText.map((t: string, i: number) => `  ${i + 1}. ${t}`),
    "",
    `CTA: ${cta}`,
    ...(thumbnailText ? [``, `THUMBNAIL TEXT: ${thumbnailText}`] : []),
    ...(audioNotes ? [``, `AUDIO NOTES: ${audioNotes}`] : []),
    ...(formatNotes ? [``, `FORMAT NOTES: ${formatNotes}`] : []),
  ].join("\n");

  const scriptFileContent = [
    `HOOK: ${hook}`,
    "",
    `SCRIPT:`,
    script,
    "",
    `ON-SCREEN TEXT:`,
    ...onScreenText.map((t: string, i: number) => `  ${i + 1}. ${t}`),
    "",
    `CTA: ${cta}`,
    "",
    `CAPTION:`,
    caption,
    "",
    `HASHTAGS:`,
    hashtagsStr,
    "",
    `THUMBNAIL TEXT: ${thumbnailText}`,
    "",
    `FORMAT NOTES:`,
    formatNotes,
    "",
    `AUDIO NOTES:`,
    audioNotes,
  ].join("\n");

  return (
    <Card className={`${item.status === "POSTED" ? "opacity-60" : ""}`}
      data-testid={`tiktok-queue-card-${item.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {item.status === "READY" && (
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) => onSelect(item.id, !!checked)}
              data-testid={`checkbox-select-${item.id}`}
              className="mt-1"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline" className="gap-1">
                <Video className="h-3 w-3" />
                TikTok
              </Badge>
              <Badge variant="secondary">{contentType.replace(/^TIKTOK_(VIRAL_)?/, "").replace(/_/g, " ")}</Badge>
              {formatId && (
                <Badge className="bg-purple-600 text-white text-xs" data-testid={`badge-format-${item.id}`}>
                  {formatId.replace(/_/g, " ")}
                </Badge>
              )}
              <StatusBadge status={item.status} />
              {hasVideo && (
                <Badge className="bg-green-600 text-white text-xs gap-1">
                  <Play className="h-3 w-3" />
                  Video Ready
                </Badge>
              )}
              {videoError && !hasVideo && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Render Failed
                </Badge>
              )}
              {scheduledFor && (
                <span className="text-xs text-muted-foreground">
                  Scheduled: {new Date(scheduledFor).toLocaleString()}
                </span>
              )}
            </div>

            {hook && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hook</p>
                <p className="text-sm font-medium" data-testid={`text-hook-${item.id}`}>{hook}</p>
              </div>
            )}

            {thumbnailText && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thumbnail</p>
                <p className="text-sm" data-testid={`text-thumbnail-${item.id}`}>{thumbnailText}</p>
              </div>
            )}

            {caption && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Caption</p>
                <p className="text-sm text-muted-foreground line-clamp-3" data-testid={`text-caption-${item.id}`}>{caption}</p>
              </div>
            )}

            {hashtags.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hashtags</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {hashtags.slice(0, 8).map((tag: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                  {hashtags.length > 8 && (
                    <Badge variant="outline" className="text-xs">+{hashtags.length - 8} more</Badge>
                  )}
                </div>
              </div>
            )}

            {hasVideo && item.contentItem?.id && (
              <div className="mb-3 mt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Video Preview</p>
                <div className="flex items-start gap-3">
                  {videoFileExists && !thumbError ? (
                    <img src={`/api/admin/growth/video/${item.contentItem.id}/download?type=thumbnail&inline=true`} alt="Video thumbnail"
                      className="w-20 h-36 object-cover rounded border"
                      data-testid={`img-thumbnail-${item.id}`}
                      onError={() => setThumbError(true)} />
                  ) : (
                    <div className="w-20 h-36 rounded border border-dashed border-muted-foreground/30 bg-muted/50 flex items-center justify-center flex-col gap-1"
                      data-testid={`placeholder-thumbnail-${item.id}`}>
                      <Video className="h-5 w-5 text-muted-foreground/50" />
                      <span className="text-[10px] text-muted-foreground/60 text-center leading-tight">Re-render needed</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>{videoAsset.width}x{videoAsset.height} &bull; {videoAsset.durationSec}s</p>
                    <p>{videoAsset.sizeBytes ? `${(videoAsset.sizeBytes / 1024 / 1024).toFixed(1)}MB` : ""}</p>
                    <p>Template: {videoAsset.templateId || "classic_countdown"}</p>
                    {videoAsset.createdAt && <p>Rendered: {new Date(videoAsset.createdAt).toLocaleString()}</p>}
                    {!videoFileExists && (
                      <p className="text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        File missing — re-render to download
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {videoError && !hasVideo && (
              <div className="mb-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
                Render error: {videoError.message} ({videoError.at ? new Date(videoError.at).toLocaleString() : "unknown time"})
              </div>
            )}

            <div className="mt-4 space-y-3 border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posting Steps</p>

              <div className="flex items-start gap-2">
                <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${mediaDownloaded ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"}`}>
                  {mediaDownloaded ? <Check className="h-3 w-3" /> : "1"}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1">Download media</p>
                  <div className="flex flex-wrap gap-1">
                    {hasVideo && videoFileExists && item.contentItem?.id && (
                      <Button size="sm" variant="default"
                        onClick={() => {
                          triggerFileDownload(
                            `/api/admin/growth/video/${item.contentItem.id}/download`,
                            `packpts_tiktok_${item.id}.mp4`
                          );
                          setMediaDownloaded(true);
                        }}
                        data-testid={`button-download-mp4-${item.id}`}>
                        <Download className="h-3 w-3 mr-1" />
                        Download MP4
                      </Button>
                    )}
                    {hasVideo && videoFileExists && item.contentItem?.id && (
                      <Button size="sm" variant="outline"
                        onClick={() => {
                          triggerFileDownload(
                            `/api/admin/growth/video/${item.contentItem.id}/download?type=thumbnail`,
                            `packpts_thumb_${item.id}.jpg`
                          );
                        }}
                        data-testid={`button-download-thumb-${item.id}`}>
                        <Download className="h-3 w-3 mr-1" />
                        Thumbnail
                      </Button>
                    )}
                    {hasVideo && !videoFileExists && (
                      <Button size="sm" variant="default"
                        onClick={() => onRenderVideo(item.id, true)}
                        disabled={isRendering}
                        data-testid={`button-rerender-video-${item.id}`}>
                        {isRendering ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        Re-render Video
                      </Button>
                    )}
                    {!hasVideo && (
                      <Button size="sm" variant="default"
                        onClick={() => onRenderVideo(item.id)}
                        disabled={isRendering}
                        data-testid={`button-render-video-${item.id}`}>
                        {isRendering ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                        Render Video
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${textCopied ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"}`}>
                  {textCopied ? <Check className="h-3 w-3" /> : "2"}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1">Copy text for platform</p>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant={textCopied === "tiktok" ? "default" : "outline"}
                      onClick={() => {
                        copyToClipboard(tiktokCopyText, "TikTok caption + hashtags", toast);
                        setTextCopied("tiktok");
                      }}
                      data-testid={`button-copy-tiktok-${item.id}`}>
                      {textCopied === "tiktok" ? <Check className="h-3 w-3 mr-1" /> : <SiTiktok className="h-3 w-3 mr-1" />}
                      Copy for TikTok
                    </Button>
                    <Button size="sm" variant={textCopied === "x" ? "default" : "outline"}
                      onClick={() => {
                        copyToClipboard(xCopyText, "X post (280 chars)", toast);
                        setTextCopied("x");
                      }}
                      data-testid={`button-copy-x-${item.id}`}>
                      {textCopied === "x" ? <Check className="h-3 w-3 mr-1" /> : <SiX className="h-3 w-3 mr-1" />}
                      Copy for X
                    </Button>
                    <Button size="sm" variant={textCopied === "ig" ? "default" : "outline"}
                      onClick={() => {
                        copyToClipboard(igCopyText, "Instagram caption copied", toast);
                        setTextCopied("ig");
                      }}
                      data-testid={`button-copy-ig-${item.id}`}>
                      {textCopied === "ig" ? <Check className="h-3 w-3 mr-1" /> : <SiInstagram className="h-3 w-3 mr-1" />}
                      Copy Caption
                    </Button>
                    <Button size="sm" variant={textCopied === "fb" ? "default" : "outline"}
                      onClick={() => {
                        copyToClipboard(tiktokCopyText, "Facebook caption copied", toast);
                        setTextCopied("fb");
                      }}
                      data-testid={`button-copy-fb-${item.id}`}>
                      {textCopied === "fb" ? <Check className="h-3 w-3 mr-1" /> : <SiFacebook className="h-3 w-3 mr-1" />}
                      Copy Caption
                    </Button>
                  </div>
                  {textCopied && (
                    <p className="text-[10px] text-green-500 mt-1 flex items-center gap-1">
                      <CircleCheck className="h-3 w-3" />
                      {textCopied === "tiktok" && "Caption copied — paste into TikTok description"}
                      {textCopied === "x" && `Caption copied (${xCopyText.length}/280 chars) — paste into X compose`}
                      {textCopied === "ig" && "Caption copied — paste into Instagram caption"}
                      {textCopied === "fb" && "Caption copied — paste into Facebook post"}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-primary text-primary-foreground">
                  3
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1">Post & mark done</p>
                  <div className="flex flex-wrap gap-1">
                    {item.status === "READY" && (
                      <Button size="sm" variant="outline"
                        onClick={() => onMarkPosted(item.id)}
                        disabled={isPending}
                        data-testid={`button-mark-posted-${item.id}`}>
                        <Check className="h-3 w-3 mr-1" />
                        Mark as Posted
                      </Button>
                    )}
                    {item.status === "POSTED" && (
                      <Button size="sm" variant="outline"
                        onClick={() => onMarkReady(item.id)}
                        disabled={isPending}
                        data-testid={`button-undo-posted-${item.id}`}>
                        <Undo2 className="h-3 w-3 mr-1" />
                        Undo Posted
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2">
              <Button size="sm" variant="ghost"
                onClick={() => setShowMore(!showMore)}
                data-testid={`button-toggle-more-${item.id}`}>
                {showMore ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                {showMore ? "Hide individual actions" : "More actions"}
              </Button>
              {showMore && (
                <div className="flex flex-wrap gap-1 mt-1">
                  <Button size="sm" variant="outline"
                    onClick={() => copyToClipboard(copyAllContent, "All content (raw)", toast)}
                    data-testid={`button-copy-all-${item.id}`}>
                    <PackageOpen className="h-3 w-3 mr-1" />
                    Copy All (Raw)
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => copyToClipboard(caption, "Caption", toast)}
                    data-testid={`button-copy-caption-${item.id}`}>
                    <Clipboard className="h-3 w-3 mr-1" />
                    Copy Caption
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => copyToClipboard(hashtagsStr, "Hashtags", toast)}
                    data-testid={`button-copy-hashtags-${item.id}`}>
                    <Hash className="h-3 w-3 mr-1" />
                    Copy Hashtags
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => copyToClipboard(script, "Script", toast)}
                    data-testid={`button-copy-script-${item.id}`}>
                    <FileText className="h-3 w-3 mr-1" />
                    Copy Script
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => downloadTextFile(scriptFileContent, `tiktok_script_${item.id}.txt`)}
                    data-testid={`button-download-script-${item.id}`}>
                    <Download className="h-3 w-3 mr-1" />
                    Download Script
                  </Button>
                  {hasVideo && (
                    <Button size="sm" variant="ghost"
                      onClick={() => onRenderVideo(item.id, true)}
                      disabled={isRendering}
                      data-testid={`button-rerender-${item.id}`}>
                      {isRendering ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Re-render
                    </Button>
                  )}
                  {assetRefs.length > 0 && (
                    <Button size="sm" variant="outline"
                      onClick={() => downloadJsonFile(assetRefs, `tiktok_assets_${item.id}.json`)}
                      data-testid={`button-download-assets-${item.id}`}>
                      <Download className="h-3 w-3 mr-1" />
                      Asset List
                    </Button>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Created: {new Date(item.createdAt).toLocaleString()}
              {item.postedAt && ` | Posted: ${new Date(item.postedAt).toLocaleString()}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueTab() {
  const { toast } = useToast();
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showChecklist, setShowChecklist] = useState(false);
  const [copyFallback, setCopyFallback] = useState<{ text: string; label: string } | null>(null);

  registerCopyFallback((text, label) => setCopyFallback({ text, label }));

  const queryParams = new URLSearchParams();
  if (platformFilter !== "all") queryParams.set("platform", platformFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (dateFilter) queryParams.set("date", dateFilter);
  const queryString = queryParams.toString();

  const { data, isLoading, refetch } = useQuery<{ items: any[] }>({
    queryKey: ["/api/admin/growth/queue", queryString],
    queryFn: () => fetch(`/api/admin/growth/queue${queryString ? `?${queryString}` : ""}`).then(r => r.json()),
  });

  const markPostedMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/growth/queue/${id}/posted`),
    onSuccess: () => {
      toast({ title: "Marked as posted" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
  });

  const markReadyMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/growth/queue/${id}/mark-ready`),
    onSuccess: () => {
      toast({ title: "Reverted to READY" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
  });

  const bulkMarkPostedMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/admin/growth/queue/bulk-mark-posted", { ids }),
    onSuccess: async (res) => {
      const result = await res.json();
      toast({ title: `${result.markedCount} items marked as posted` });
      setSelectedIds(new Set<string>());
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/growth/overview"] });
    },
  });

  const [renderingId, setRenderingId] = useState<string | null>(null);
  const renderVideoMutation = useMutation({
    mutationFn: ({ id, forceRerender }: { id: string; forceRerender?: boolean }) =>
      apiRequest("POST", `/api/admin/growth/queue/${id}/render-video`, { forceRerender }),
    onSuccess: async (res) => {
      const result = await res.json();
      if (result.ok) {
        toast({ title: "Video rendered successfully" });
      } else {
        toast({ title: "Render failed", description: result.error, variant: "destructive" });
      }
      setRenderingId(null);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Render failed", description: err?.message, variant: "destructive" });
      setRenderingId(null);
    },
  });

  const handleRenderVideo = (id: string, forceRerender?: boolean) => {
    setRenderingId(id);
    renderVideoMutation.mutate({ id, forceRerender });
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set<string>(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (!data?.items) return;
    const readyIds = data.items.filter((i: any) => i.status === "READY").map((i: any) => i.id as string);
    if (selectedIds.size === readyIds.length) {
      setSelectedIds(new Set<string>());
    } else {
      setSelectedIds(new Set<string>(readyIds));
    }
  };

  const handleBulkCopyCaptions = () => {
    if (!data?.items) return;
    const captions = data.items
      .filter((i: any) => selectedIds.has(i.id))
      .map(i => {
        const meta = i.contentItem?.metadata || i.assets || {};
        return meta.caption || i.copyText || "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
    copyToClipboard(captions, "Captions", toast);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  const isTikTokView = platformFilter === "tiktok";
  const readyCount = data?.items?.filter((i: any) => i.status === "READY").length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-platform-filter">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="reddit">Reddit</SelectItem>
            <SelectItem value="discord">Discord</SelectItem>
            <SelectItem value="x">X / Twitter</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="READY">Ready</SelectItem>
            <SelectItem value="POSTED">Posted</SelectItem>
          </SelectContent>
        </Select>

        <Select value={formatFilter} onValueChange={setFormatFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-format-filter">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            <SelectItem value="only_real_fans">Only Real Fans</SelectItem>
            <SelectItem value="difficulty_ladder">Difficulty Ladder</SelectItem>
            <SelectItem value="memory_shock">Memory Shock</SelectItem>
            <SelectItem value="pack_pull_drama">Pack Pull Drama</SelectItem>
            <SelectItem value="leaderboard_flex">Leaderboard Flex</SelectItem>
            <SelectItem value="era_wars">Era Wars</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
            data-testid="input-date-filter"
          />
          {dateFilter && (
            <Button size="sm" variant="ghost" onClick={() => setDateFilter("")}>Clear</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDateFilter(todayStr)}
            data-testid="button-filter-today">
            Today
          </Button>
        </div>

        <Button size="sm" variant="ghost" onClick={() => refetch()} data-testid="button-refresh-queue">
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>

        <Button size="sm" variant="outline" onClick={() => setShowChecklist(!showChecklist)}
          data-testid="button-toggle-checklist">
          <ListChecks className="h-3 w-3 mr-1" />
          Posting Checklist
        </Button>
      </div>

      {showChecklist && (
        <Card className="border-primary/20" data-testid="card-posting-checklist">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Manual Posting Checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
              <li><strong className="text-foreground">Click "Copy All for Posting"</strong> on the TikTok item below</li>
              <li>If a video is ready, click <strong className="text-foreground">"Download MP4"</strong> to save it</li>
              <li>Open TikTok and tap <strong className="text-foreground">"+"</strong> to create a new post</li>
              <li>Upload the MP4 or record your own video using the copied script</li>
              <li>Paste the copied content into a notes app to reference the caption, hashtags, and script</li>
              <li>Copy just the caption + hashtags into TikTok's description field</li>
              <li>Post the video</li>
              <li>Come back here and click <strong className="text-foreground">"Mark as Posted"</strong></li>
            </ol>
            <p className="text-xs text-muted-foreground mt-3 italic">
              Tip: "Copy All" puts everything in your clipboard at once -- caption, hashtags, script, hook, and CTA. Paste it into Notes to reference while creating your TikTok post.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedIds.size > 0 && (
        <Card className="border-primary/30 bg-primary/5" data-testid="card-bulk-actions">
          <CardContent className="p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button size="sm" variant="default"
                onClick={() => bulkMarkPostedMutation.mutate(Array.from(selectedIds))}
                disabled={bulkMarkPostedMutation.isPending}
                data-testid="button-bulk-mark-posted">
                <CheckSquare className="h-3 w-3 mr-1" />
                Bulk Mark as Posted
              </Button>
              <Button size="sm" variant="outline"
                onClick={handleBulkCopyCaptions}
                data-testid="button-bulk-copy-captions">
                <Copy className="h-3 w-3 mr-1" />
                Bulk Copy Captions
              </Button>
              <Button size="sm" variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-clear-selection">
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {readyCount > 1 && selectedIds.size === 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleSelectAll} data-testid="button-select-all">
            <CheckSquare className="h-3 w-3 mr-1" />
            Select All Ready ({readyCount})
          </Button>
        </div>
      )}

      {data?.items?.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-empty-queue">
          Publishing queue is empty{platformFilter !== "all" ? ` for ${platformFilter}` : ""}
        </p>
      )}

      {data?.items
        ?.filter((item: any) => {
          if (formatFilter === "all") return true;
          const meta = item.contentItem?.metadata || item.assets || {};
          const fid = meta.format_id || item.assets?.format_id;
          return fid === formatFilter;
        })
        .map((item: any) => {
        if (item.platform === "tiktok") {
          return (
            <TikTokQueueCard
              key={item.id}
              item={item}
              onMarkPosted={(id) => markPostedMutation.mutate(id)}
              onMarkReady={(id) => markReadyMutation.mutate(id)}
              onRenderVideo={handleRenderVideo}
              isPending={markPostedMutation.isPending || markReadyMutation.isPending}
              isRendering={renderVideoMutation.isPending && renderingId === item.id}
              selected={selectedIds.has(item.id)}
              onSelect={handleSelect}
            />
          );
        }

        return (
          <Card key={item.id} data-testid={`queue-card-${item.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline">{item.platform}</Badge>
                    <StatusBadge status={item.status} />
                    {item.contentItem?.type && (
                      <Badge variant="secondary">{item.contentItem.type.replace(/_/g, " ")}</Badge>
                    )}
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
                      Mark as Posted
                    </Button>
                  )}
                  {item.status === "POSTED" && (
                    <Button size="sm" variant="ghost"
                      onClick={() => markReadyMutation.mutate(item.id)}
                      disabled={markReadyMutation.isPending}
                      data-testid={`button-undo-posted-${item.id}`}>
                      <Undo2 className="h-3 w-3 mr-1" />
                      Undo
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {copyFallback && (
        <CopyFallbackModal
          text={copyFallback.text}
          label={copyFallback.label}
          onClose={() => setCopyFallback(null)}
        />
      )}
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

  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-2">
      {data?.runs?.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No job runs yet</p>
      )}
      {data?.runs?.map(run => {
        const isExpanded = expandedRun === run.id;
        const d = run.details || {};
        const hasPostingStats = typeof d.posted === "number" || typeof d.failed === "number";
        const errors: { id: string; platform: string; type: string; error: string }[] = d.errors || [];

        return (
          <div key={run.id}
            className="rounded-md bg-muted/50 overflow-hidden cursor-pointer select-none"
            onClick={() => setExpandedRun(isExpanded ? null : run.id)}
            data-testid={`job-run-${run.id}`}>
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{run.jobName.replace(/_/g, " ")}</span>
                  <StatusBadge status={run.status} />
                  {hasPostingStats && (
                    <span className="text-xs text-muted-foreground">
                      {d.posted ?? 0} posted · {d.failed ?? 0} failed · {d.skippedCredentials ?? 0} skipped · {d.total ?? 0} total
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {(run.status === "FAILED" || run.status === "SKIPPED" || run.status === "RETRY_PENDING") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); retryMutation.mutate(run.jobName); }}
                      disabled={retryMutation.isPending}
                      data-testid={`button-retry-${run.id}`}>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()}
                  </span>
                  {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                </div>
              </div>
              {run.status === "SKIPPED" && d.reason && (
                <p className="text-xs text-muted-foreground">{d.reason}</p>
              )}
              {run.status === "RETRY_PENDING" && d.retryAt && (
                <p className="text-xs text-muted-foreground">
                  Retry #{d.retryCount || 1}/{d.maxRetries || 3} scheduled at {new Date(d.retryAt).toLocaleString()}
                </p>
              )}
              {run.error && !isExpanded && (
                <p className="text-xs text-destructive line-clamp-1">{run.error}</p>
              )}
            </div>

            {isExpanded && (
              <div className="border-t px-3 pb-3 pt-2 space-y-3">
                {run.error && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Error</p>
                    <p className="text-xs text-destructive font-mono whitespace-pre-wrap">{run.error}</p>
                  </div>
                )}
                {hasPostingStats && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Result</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Posted</span><span className="font-medium text-green-500">{d.posted ?? 0}</span>
                      <span className="text-muted-foreground">Failed</span><span className={`font-medium ${(d.failed ?? 0) > 0 ? "text-destructive" : ""}`}>{d.failed ?? 0}</span>
                      <span className="text-muted-foreground">Skipped (credentials)</span><span className={`font-medium ${(d.skippedCredentials ?? 0) > 0 ? "text-yellow-500" : ""}`}>{d.skippedCredentials ?? 0}</span>
                      <span className="text-muted-foreground">Auto-healed</span><span className="font-medium">{d.autoHealed ?? 0}</span>
                      <span className="text-muted-foreground">Backlog promoted</span><span className="font-medium">{d.backlogPromoted ?? 0}</span>
                      <span className="text-muted-foreground">Total items</span><span className="font-medium">{d.total ?? 0}</span>
                    </div>
                  </div>
                )}
                {errors.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Item Errors ({errors.length})</p>
                    <div className="space-y-1">
                      {errors.map((e, i) => (
                        <div key={i} className="text-xs rounded bg-destructive/10 px-2 py-1">
                          <span className="font-medium">{e.platform}/{e.type}</span>
                          <span className="text-muted-foreground ml-2 font-mono">{e.error}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!hasPostingStats && !run.error && (
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-auto max-h-48">
                    {JSON.stringify(d, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
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
      {data?.plans?.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-plans">No content plans yet</p>
      )}
      {data?.plans?.map(plan => {
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
