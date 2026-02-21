import { useState } from "react";
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
  Download, Hash, Clipboard, Video, Undo2, CheckSquare, ListChecks
} from "lucide-react";

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
  platformStatus?: { discord: boolean; x: boolean; instagram: boolean; reddit: boolean; tiktok?: boolean };
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
                  {platform === "x" ? "X / Twitter" : platform === "tiktok" ? "TikTok" : platform.charAt(0).toUpperCase() + platform.slice(1)}
                  {platform === "tiktok" && connected ? " (manual)" : connected ? "" : " (not configured)"}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

function copyToClipboard(text: string, label: string, toast: any) {
  navigator.clipboard.writeText(text);
  toast({ title: `${label} copied to clipboard` });
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

  const hashtagsStr = hashtags.join(" ");
  const captionPlusHashtags = caption + "\n\n" + hashtagsStr;

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

            {hasVideo && videoAsset.thumbnailUrl && (
              <div className="mb-3 mt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Video Preview</p>
                <div className="flex items-start gap-3">
                  <img src={videoAsset.thumbnailUrl} alt="Video thumbnail"
                    className="w-20 h-36 object-cover rounded border"
                    data-testid={`img-thumbnail-${item.id}`} />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>{videoAsset.width}x{videoAsset.height} &bull; {videoAsset.durationSec}s</p>
                    <p>{videoAsset.sizeBytes ? `${(videoAsset.sizeBytes / 1024 / 1024).toFixed(1)}MB` : ""}</p>
                    <p>Template: {videoAsset.templateId || "classic_countdown"}</p>
                    {videoAsset.createdAt && <p>Rendered: {new Date(videoAsset.createdAt).toLocaleString()}</p>}
                  </div>
                </div>
              </div>
            )}

            {videoError && !hasVideo && (
              <div className="mb-2 p-2 bg-destructive/10 rounded text-xs text-destructive">
                Render error: {videoError.message} ({videoError.at ? new Date(videoError.at).toLocaleString() : "unknown time"})
              </div>
            )}

            <div className="flex flex-wrap gap-1 mt-3">
              {!hasVideo && (
                <Button size="sm" variant="default"
                  onClick={() => onRenderVideo(item.id)}
                  disabled={isRendering}
                  data-testid={`button-render-video-${item.id}`}>
                  {isRendering ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                  Render Video
                </Button>
              )}
              {hasVideo && (
                <>
                  <Button size="sm" variant="outline" asChild
                    data-testid={`button-download-mp4-${item.id}`}>
                    <a href={videoAsset.url} download={`packpts_tiktok_${item.id}.mp4`}>
                      <Download className="h-3 w-3 mr-1" />
                      Download MP4
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild
                    data-testid={`button-download-thumb-${item.id}`}>
                    <a href={videoAsset.thumbnailUrl} download={`packpts_thumb_${item.id}.jpg`}>
                      <Download className="h-3 w-3 mr-1" />
                      Thumbnail
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => onRenderVideo(item.id, true)}
                    disabled={isRendering}
                    data-testid={`button-rerender-${item.id}`}>
                    {isRendering ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Re-render
                  </Button>
                </>
              )}
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
                onClick={() => copyToClipboard(captionPlusHashtags, "Caption + Hashtags", toast)}
                data-testid={`button-copy-caption-hashtags-${item.id}`}>
                <Copy className="h-3 w-3 mr-1" />
                Caption + Hashtags
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
              {assetRefs.length > 0 && (
                <Button size="sm" variant="outline"
                  onClick={() => downloadJsonFile(assetRefs, `tiktok_assets_${item.id}.json`)}
                  data-testid={`button-download-assets-${item.id}`}>
                  <Download className="h-3 w-3 mr-1" />
                  Asset List
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1 mt-2">
              {item.status === "READY" && (
                <Button size="sm" variant="default"
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
  const readyCount = data?.items.filter(i => i.status === "READY").length || 0;

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
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Open TikTok app on your phone</li>
              <li>Click "Copy Caption + Hashtags" for the item you want to post</li>
              <li>In TikTok, tap "+" to create a new post</li>
              <li>Record or upload your video following the script</li>
              <li>Paste caption + hashtags into the description</li>
              <li>Add any relevant sounds or effects from the audio notes</li>
              <li>Post the video</li>
              <li>Come back here and click "Mark as Posted"</li>
            </ol>
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

      {data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-empty-queue">
          Publishing queue is empty{platformFilter !== "all" ? ` for ${platformFilter}` : ""}
        </p>
      )}

      {data?.items
        .filter((item: any) => {
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
                      Posted
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
