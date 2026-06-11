/**
 * /admin/growth
 *
 * Growth Agent admin UI: content plans, publishing queue, item previews,
 * copy buttons, mark-posted / mark-skipped actions, job trigger.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Play, RefreshCw, ExternalLink, Film, Download, TrendingUp } from "lucide-react";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface GrowthPlan {
  id: string;
  date: string;
  status: "PENDING" | "GENERATING" | "COMPLETE" | "FAILED";
  themes: string[] | null;
  goals: string | null;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface GrowthItem {
  id: string;
  planId: string;
  platform: "TIKTOK" | "INSTAGRAM" | "X" | "REDDIT";
  contentType: string;
  status: "DRAFT" | "QUEUED" | "POSTED" | "SKIPPED" | "FAILED";
  caption: string | null;
  hashtags: string[];
  hook: string | null;
  script: string | null;
  overlayText: string | null;
  cta: string | null;
  assetRefs: { label: string; description: string }[];
  errorMessage: string | null;
  mediaRequired: boolean | null;
  mediaStatus: "NOT_REQUIRED" | "PENDING" | "GENERATED" | "UPLOADED" | "FAILED" | null;
  publishBlockReason: string | null;
  metadata?: {
    videoUrl?: string;
    thumbnailUrl?: string;
    renderStatus?: "PENDING" | "RENDERING" | "DONE" | "ERROR";
    renderError?: string;
    template?: string;
    renderedAt?: string;
  } | null;
}

interface QueueRow {
  queue: {
    id: string;
    contentItemId: string;
    platform: string;
    status: "PENDING" | "POSTED" | "SKIPPED" | "FAILED";
    postedAt: string | null;
    retryCount: number;
    errorMessage: string | null;
    createdAt: string;
  };
  item: GrowthItem | null;
}

interface JobRun {
  id: string;
  jobType: string;
  status: "RUNNING" | "COMPLETE" | "FAILED";
  targetDate: string;
  itemsGenerated: number;
  log: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "bg-black text-white",
  INSTAGRAM: "bg-pink-600 text-white",
  X: "bg-sky-500 text-white",
  REDDIT: "bg-orange-500 text-white",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  GENERATING: "bg-blue-100 text-blue-800",
  COMPLETE: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  DRAFT: "bg-slate-100 text-slate-700",
  QUEUED: "bg-yellow-100 text-yellow-800",
  POSTED: "bg-green-100 text-green-800",
  SKIPPED: "bg-gray-100 text-gray-600",
  RUNNING: "bg-blue-100 text-blue-800",
  BLOCKED: "bg-red-100 text-red-800",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${PLATFORM_COLORS[platform] ?? "bg-slate-200 text-slate-700"}`}
    >
      {platform}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {status}
    </span>
  );
}

// ──────────────────────────────────────────────
// Item Preview Dialog
// ──────────────────────────────────────────────

function ItemPreviewDialog({ item }: { item: GrowthItem }) {
  const hashtagText = (item.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5 text-xs">
          <ExternalLink className="h-3.5 w-3.5" />
          Preview
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlatformBadge platform={item.platform} />
            <span>{item.contentType.replace(/_/g, " ")}</span>
            <StatusBadge status={item.status} />
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-4 text-sm">
            {item.hook && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Hook</p>
                <p className="bg-muted rounded p-2">{item.hook}</p>
                <div className="mt-1">
                  <CopyButton text={item.hook} label="Copy hook" />
                </div>
              </div>
            )}

            {item.caption && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Caption</p>
                <p className="bg-muted rounded p-2 whitespace-pre-wrap">{item.caption}</p>
                <div className="mt-1">
                  <CopyButton text={item.caption} label="Copy caption" />
                </div>
              </div>
            )}

            {hashtagText && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Hashtags</p>
                <p className="bg-muted rounded p-2 text-blue-600">{hashtagText}</p>
                <div className="mt-1">
                  <CopyButton text={hashtagText} label="Copy hashtags" />
                </div>
              </div>
            )}

            {item.script && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                  Script {item.platform === "TIKTOK" ? "(record this)" : ""}
                </p>
                <p className="bg-muted rounded p-2 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {item.script}
                </p>
                <div className="mt-1">
                  <CopyButton text={item.script} label="Copy script" />
                </div>
              </div>
            )}

            {item.overlayText && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Overlay Text</p>
                <p className="bg-muted rounded p-2">{item.overlayText}</p>
                <div className="mt-1">
                  <CopyButton text={item.overlayText} label="Copy overlay" />
                </div>
              </div>
            )}

            {item.cta && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">CTA</p>
                <p className="bg-muted rounded p-2">{item.cta}</p>
              </div>
            )}

            {item.assetRefs?.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Asset Refs</p>
                <ul className="space-y-1">
                  {item.assetRefs.map((ref, i) => (
                    <li key={i} className="bg-muted rounded p-2">
                      <span className="font-medium">{ref.label}:</span> {ref.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {item.errorMessage && (
              <div>
                <p className="text-xs font-semibold uppercase text-red-500 mb-1">Error</p>
                <p className="bg-red-50 border border-red-200 rounded p-2 text-red-700 text-xs">
                  {item.errorMessage}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────
// Plans Tab
// ──────────────────────────────────────────────

function PlansTab() {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const plansQuery = useQuery<GrowthPlan[]>({
    queryKey: ["/api/admin/growth/plans"],
    queryFn: () => fetch("/api/admin/growth/plans").then((r) => r.json()),
  });

  const itemsQuery = useQuery<GrowthItem[]>({
    queryKey: ["/api/admin/growth/plans", selectedPlanId, "items"],
    queryFn: () =>
      fetch(`/api/admin/growth/plans/${selectedPlanId}/items`).then((r) => r.json()),
    enabled: !!selectedPlanId,
  });

  const plans = plansQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Summary</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {plans.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  No plans yet. Trigger the growth agent to get started.
                </td>
              </tr>
            )}
            {plans.map((plan) => (
              <tr
                key={plan.id}
                className={`hover:bg-muted/30 cursor-pointer transition-colors ${selectedPlanId === plan.id ? "bg-muted/40" : ""}`}
                onClick={() => setSelectedPlanId(plan.id === selectedPlanId ? null : plan.id)}
              >
                <td className="p-3 font-mono">{plan.date}</td>
                <td className="p-3">
                  <StatusBadge status={plan.status} />
                </td>
                <td className="p-3 hidden md:table-cell text-muted-foreground truncate max-w-xs">
                  {plan.summary ?? plan.errorMessage ?? "—"}
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground">
                  {(plan.themes ?? []).slice(0, 2).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPlanId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Content Items — {plans.find((p) => p.id === selectedPlanId)?.date}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {itemsQuery.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
            {items.length > 0 && (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2 rounded-md border bg-muted/20 text-sm"
                  >
                    <PlatformBadge platform={item.platform} />
                    <span className="flex-1 text-muted-foreground">
                      {item.contentType.replace(/_/g, " ")}
                    </span>
                    <StatusBadge status={item.status} />
                    <ItemPreviewDialog item={item} />
                  </div>
                ))}
              </div>
            )}
            {!itemsQuery.isPending && items.length === 0 && (
              <p className="text-sm text-muted-foreground">No items for this plan.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Publishing Queue Tab
// ──────────────────────────────────────────────

function QueueTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const qc = useQueryClient();
  const { toast } = useToast();

  const queueQuery = useQuery<QueueRow[]>({
    queryKey: ["/api/admin/growth/queue", statusFilter, platformFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (platformFilter !== "all") params.set("platform", platformFilter);
      return fetch(`/api/admin/growth/queue?${params}`).then((r) => r.json());
    },
  });

  const markPosted = useMutation({
    mutationFn: (queueId: string) =>
      fetch(`/api/admin/growth/queue/${queueId}/mark-posted`, { method: "PATCH" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/queue"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/plans"] });
      toast({ title: "Marked as posted" });
    },
  });

  const markSkipped = useMutation({
    mutationFn: (queueId: string) =>
      fetch(`/api/admin/growth/queue/${queueId}/mark-skipped`, { method: "PATCH" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/queue"] });
      toast({ title: "Marked as skipped" });
    },
  });

  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());

  async function handleRender(queueId: string) {
    setRenderingIds((prev) => new Set(prev).add(queueId));
    try {
      const res = await fetch(`/api/admin/growth/queue/${queueId}/render`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Render failed");
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/queue"] });
      toast({ title: "Video rendered", description: data.template });
    } catch (err) {
      toast({ title: "Render error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRenderingIds((prev) => { const s = new Set(prev); s.delete(queueId); return s; });
    }
  }

  const rows = queueQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="POSTED">Posted</SelectItem>
            <SelectItem value="SKIPPED">Skipped</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="BLOCKED">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="TIKTOK">TikTok</SelectItem>
            <SelectItem value="INSTAGRAM">Instagram</SelectItem>
            <SelectItem value="X">X</SelectItem>
            <SelectItem value="REDDIT">Reddit</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Platform</th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-left p-3 font-medium hidden sm:table-cell">Preview</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium hidden sm:table-cell">Media</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {queueQuery.isPending ? "Loading…" : "No queue items match the current filters."}
                </td>
              </tr>
            )}
            {rows.map(({ queue, item }) => (
              <tr key={queue.id} className="hover:bg-muted/20">
                <td className="p-3">
                  <PlatformBadge platform={queue.platform} />
                </td>
                <td className="p-3 text-muted-foreground">
                  {item?.contentType?.replace(/_/g, " ") ?? "—"}
                </td>
                <td className="p-3 hidden sm:table-cell">
                  {item ? <ItemPreviewDialog item={item} /> : null}
                </td>
                <td className="p-3">
                  <StatusBadge status={queue.status} />
                </td>
                <td className="p-3 hidden sm:table-cell">
                  {item?.mediaRequired && item.mediaStatus !== "GENERATED" && item.mediaStatus !== "UPLOADED" ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800" title={item.publishBlockReason ?? undefined}>
                      No Media
                    </span>
                  ) : item?.mediaStatus === "GENERATED" || item?.mediaStatus === "UPLOADED" ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      Ready
                    </span>
                  ) : null}
                </td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-2 flex-wrap">
                    {/* Video render / download actions */}
                    {item && (
                      <>
                        {item.metadata?.renderStatus === "DONE" ? (
                          <>
                            {item.metadata.videoUrl && (
                              <a href={item.metadata.videoUrl} download>
                                <Button size="sm" variant="outline" className="gap-1.5">
                                  <Download className="h-3.5 w-3.5" />
                                  MP4
                                </Button>
                              </a>
                            )}
                            {item.metadata.thumbnailUrl && (
                              <a href={item.metadata.thumbnailUrl} download>
                                <Button size="sm" variant="outline" className="gap-1.5">
                                  <Download className="h-3.5 w-3.5" />
                                  Thumb
                                </Button>
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              onClick={() => handleRender(queue.id)}
                              disabled={renderingIds.has(queue.id)}
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${renderingIds.has(queue.id) ? "animate-spin" : ""}`} />
                              Re-render
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => handleRender(queue.id)}
                            disabled={renderingIds.has(queue.id) || item.metadata?.renderStatus === "RENDERING"}
                          >
                            <Film className={`h-3.5 w-3.5 ${renderingIds.has(queue.id) ? "animate-spin" : ""}`} />
                            {item.metadata?.renderStatus === "RENDERING" ? "Rendering…" : "Render Video"}
                          </Button>
                        )}
                      </>
                    )}

                    {/* Post / skip actions */}
                    {queue.status === "PENDING" && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => markPosted.mutate(queue.id)}
                          disabled={markPosted.isPending}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Posted
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markSkipped.mutate(queue.id)}
                          disabled={markSkipped.isPending}
                        >
                          Skip
                        </Button>
                      </>
                    )}
                    {queue.status === "POSTED" && (
                      <span className="text-xs text-muted-foreground">
                        {queue.postedAt ? new Date(queue.postedAt).toLocaleDateString() : "Posted"}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Job Runs Tab
// ──────────────────────────────────────────────

function JobRunsTab() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runsQuery = useQuery<JobRun[]>({
    queryKey: ["/api/admin/growth/job-runs"],
    queryFn: () => fetch("/api/admin/growth/job-runs").then((r) => r.json()),
  });

  const runs = runsQuery.data ?? [];
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Date</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium hidden sm:table-cell">Items</th>
              <th className="text-left p-3 font-medium hidden md:table-cell">Started</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No job runs yet.
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr
                key={run.id}
                className={`hover:bg-muted/30 cursor-pointer transition-colors ${selectedRunId === run.id ? "bg-muted/40" : ""}`}
                onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
              >
                <td className="p-3 font-mono">{run.targetDate}</td>
                <td className="p-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="p-3 hidden sm:table-cell">{run.itemsGenerated}</td>
                <td className="p-3 hidden md:table-cell text-muted-foreground text-xs">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground">
                  {run.errorMessage ? (
                    <span className="text-red-500 truncate max-w-[120px] block">{run.errorMessage}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Log — {selectedRun.targetDate}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                {selectedRun.log || "(no log)"}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Flywheel Tab
// ──────────────────────────────────────────────

interface GlobalRollup {
  dayKey: string;
  dau: number;
  matchesPlayed: number;
  daily5Entries: number;
  sharesTotal: number;
  invitesSent: number;
  signupsFromInvites: number;
  firstMatchesFromInvites: number;
  firstPurchasesFromInvites: number;
  kFactor: number | null;
  computedAt: string;
}

interface TopUser {
  userId: string;
  username: string | null;
  matchesPlayed: number;
  daily5Entries: number;
  sharesTotal: number;
  invitesSent: number;
  signupsFromInvites: number;
}

interface TopAsset {
  contentAssetId: string;
  shareCount: number;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function FlywheelTab() {
  const [days, setDays] = useState(30);
  const [computeDate, setComputeDate] = useState(
    () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  );
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rollups = [], isFetching: loadingRollups } = useQuery<GlobalRollup[]>({
    queryKey: ["/api/admin/growth/flywheel", days],
    queryFn: () =>
      fetch(`/api/admin/growth/flywheel?days=${days}`).then((r) => r.json()),
  });

  const { data: topUsers = [], isFetching: loadingUsers } = useQuery<TopUser[]>({
    queryKey: ["/api/admin/growth/flywheel/top-users", days],
    queryFn: () =>
      fetch(`/api/admin/growth/flywheel/top-users?days=${days}`).then((r) => r.json()),
  });

  const { data: topAssets = [], isFetching: loadingAssets } = useQuery<TopAsset[]>({
    queryKey: ["/api/admin/growth/flywheel/top-assets", days],
    queryFn: () =>
      fetch(`/api/admin/growth/flywheel/top-assets?days=${days}`).then((r) => r.json()),
  });

  const computeMutation = useMutation({
    mutationFn: (dayKey: string) =>
      fetch("/api/admin/growth/flywheel/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayKey }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/flywheel"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/flywheel/top-users"] });
      toast({ title: `Rollup complete — DAU: ${data.dau} on ${data.dayKey}` });
    },
    onError: (err: Error) => {
      toast({ title: "Compute failed", description: err.message, variant: "destructive" });
    },
  });

  // Summary: sum across loaded rollups
  const totals = rollups.reduce(
    (acc, r) => ({
      dau: Math.max(acc.dau, r.dau),
      matchesPlayed: acc.matchesPlayed + r.matchesPlayed,
      daily5Entries: acc.daily5Entries + r.daily5Entries,
      sharesTotal: acc.sharesTotal + r.sharesTotal,
      invitesSent: acc.invitesSent + r.invitesSent,
      signupsFromInvites: acc.signupsFromInvites + r.signupsFromInvites,
    }),
    { dau: 0, matchesPlayed: 0, daily5Entries: 0, sharesTotal: 0, invitesSent: 0, signupsFromInvites: 0 },
  );

  const latestKFactor = rollups[0]?.kFactor;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-auto">
          <input
            type="date"
            value={computeDate}
            onChange={(e) => setComputeDate(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm bg-background"
          />
          <Button
            size="sm"
            onClick={() => computeMutation.mutate(computeDate)}
            disabled={computeMutation.isPending}
            className="gap-2"
          >
            {computeMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" />
            )}
            Compute Rollup
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MetricCard label="Peak DAU" value={totals.dau.toLocaleString()} />
        <MetricCard label="Matches Played" value={totals.matchesPlayed.toLocaleString()} />
        <MetricCard label="Daily 5 Entries" value={totals.daily5Entries.toLocaleString()} />
        <MetricCard label="Shares" value={totals.sharesTotal.toLocaleString()} />
        <MetricCard label="Invites Sent" value={totals.invitesSent.toLocaleString()} />
        <MetricCard label="Signups from Invites" value={totals.signupsFromInvites.toLocaleString()} />
        <MetricCard
          label="K-Factor (latest)"
          value={latestKFactor != null ? latestKFactor.toFixed(3) : "—"}
        />
      </div>

      {/* Day-by-day trend table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Day-by-Day Trend</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRollups ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : rollups.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No rollup data yet. Click "Compute Rollup" to generate it.
            </p>
          ) : (
            <ScrollArea className="h-64">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-4 py-2">DAU</th>
                    <th className="text-right px-4 py-2">Matches</th>
                    <th className="text-right px-4 py-2">Daily 5</th>
                    <th className="text-right px-4 py-2">Shares</th>
                    <th className="text-right px-4 py-2">Invites</th>
                    <th className="text-right px-4 py-2">Signups</th>
                    <th className="text-right px-4 py-2">K-Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {rollups.map((r) => (
                    <tr key={r.dayKey} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono">{r.dayKey}</td>
                      <td className="text-right px-4 py-2">{r.dau.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{r.matchesPlayed.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{r.daily5Entries.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{r.sharesTotal.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{r.invitesSent.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{r.signupsFromInvites.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">
                        {r.kFactor != null ? r.kFactor.toFixed(3) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top users */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Users Driving Growth</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingUsers ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : topUsers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No user rollup data yet.</p>
            ) : (
              <ScrollArea className="h-64">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2">User</th>
                      <th className="text-right px-4 py-2">Signups</th>
                      <th className="text-right px-4 py-2">Invites</th>
                      <th className="text-right px-4 py-2">Shares</th>
                      <th className="text-right px-4 py-2">Matches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topUsers.map((u) => (
                      <tr key={u.userId} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 truncate max-w-[180px]">
                          {u.username ?? u.userId.slice(0, 8)}
                        </td>
                        <td className="text-right px-4 py-2 font-semibold">
                          {u.signupsFromInvites}
                        </td>
                        <td className="text-right px-4 py-2">{u.invitesSent}</td>
                        <td className="text-right px-4 py-2">{u.sharesTotal}</td>
                        <td className="text-right px-4 py-2">{u.matchesPlayed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Top content assets */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Shared Content Assets</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingAssets ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : topAssets.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No share data yet.</p>
            ) : (
              <ScrollArea className="h-64">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2">Asset ID</th>
                      <th className="text-right px-4 py-2">Shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAssets.map((a) => (
                      <tr key={a.contentAssetId} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs truncate max-w-[280px]">
                          {a.contentAssetId}
                        </td>
                        <td className="text-right px-4 py-2 font-semibold">{a.shareCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Post Analytics Tab
// ──────────────────────────────────────────────

interface AnalyticsSummary {
  totalImpressions: number;
  totalLikes: number;
  publishedPosts: number;
  avgImpressionsPerPost: number;
}

interface ByContentTypeRow {
  contentType: string;
  abGroup: string | null;
  postCount: number;
  totalImpressions: number;
  totalLikes: number;
  avgImpressions: number;
  avgLikes: number;
}

interface RecentPostRow {
  id: string;
  platform: string;
  contentType: string;
  abGroup: string | null;
  publishedAt: string | null;
  copyPreview: string;
  impressions: number | null;
  likes: number | null;
  shares: number | null;
  clicks: number | null;
  conversionRate: number | null;
}

interface AnalyticsData {
  summary: AnalyticsSummary;
  byContentType: ByContentTypeRow[];
  recentPosts: RecentPostRow[];
}

function PostAnalyticsTab() {
  const { data, isPending, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/social/analytics"],
    queryFn: () => fetch("/api/admin/social/analytics").then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
  });

  if (isPending) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (error) return <p className="text-sm text-destructive p-4">Failed to load analytics: {error.message}</p>;
  if (!data) return <p className="text-sm text-muted-foreground p-4">No data.</p>;

  const { summary, byContentType, recentPosts } = data;
  const displayPosts = recentPosts.slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Impressions" value={summary.totalImpressions.toLocaleString()} />
        <MetricCard label="Total Likes" value={summary.totalLikes.toLocaleString()} />
        <MetricCard label="Published Posts" value={summary.publishedPosts.toLocaleString()} />
        <MetricCard label="Avg Impressions / Post" value={summary.avgImpressionsPerPost.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Performance by Content Type</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {byContentType.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No published posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Content Type</th>
                    <th className="text-left p-3 font-medium">A/B Group</th>
                    <th className="text-right p-3 font-medium">Posts</th>
                    <th className="text-right p-3 font-medium">Total Impressions</th>
                    <th className="text-right p-3 font-medium">Avg Impressions</th>
                    <th className="text-right p-3 font-medium">Total Likes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byContentType.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="p-3">{row.contentType.replace(/_/g, " ")}</td>
                      <td className="p-3">{row.abGroup ?? "—"}</td>
                      <td className="text-right p-3">{row.postCount}</td>
                      <td className="text-right p-3">{row.totalImpressions.toLocaleString()}</td>
                      <td className="text-right p-3">{row.avgImpressions.toLocaleString()}</td>
                      <td className="text-right p-3">{row.totalLikes.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Posts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {displayPosts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No published posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Type</th>
                    <th className="text-left p-3 font-medium">Group</th>
                    <th className="text-left p-3 font-medium">Preview</th>
                    <th className="text-right p-3 font-medium">Impressions</th>
                    <th className="text-right p-3 font-medium">Likes</th>
                    <th className="text-right p-3 font-medium">Clicks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {displayPosts.map((post) => (
                    <tr key={post.id} className="hover:bg-muted/20">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3 text-xs">{post.contentType.replace(/_/g, " ")}</td>
                      <td className="p-3">{post.abGroup ?? "—"}</td>
                      <td className="p-3 max-w-[200px] truncate text-muted-foreground text-xs">
                        {post.copyPreview.slice(0, 60)}
                      </td>
                      <td className="text-right p-3">{(post.impressions ?? 0).toLocaleString()}</td>
                      <td className="text-right p-3">{(post.likes ?? 0).toLocaleString()}</td>
                      <td className="text-right p-3">{(post.clicks ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────
// A/B Tests Tab
// ──────────────────────────────────────────────

interface AbTestVariant {
  postCount: number;
  totalImpressions: number;
  totalLikes: number;
}

interface AbTestRow {
  id: string;
  contentType: string;
  testName: string;
  status: string;
  winner: string | null;
  winningMetric: string | null;
  hypothesis: string | null;
  startedAt: string | null;
  endedAt: string | null;
  variants: Record<string, AbTestVariant>;
}

const AB_STATUS_COLORS: Record<string, string> = {
  RUNNING: "bg-yellow-100 text-yellow-800",
  CONCLUDED: "bg-green-100 text-green-800",
  INCONCLUSIVE: "bg-gray-100 text-gray-600",
};

function AbTestsTab() {
  const { data: tests, isPending, error } = useQuery<AbTestRow[]>({
    queryKey: ["/api/admin/social/ab-tests"],
    queryFn: () => fetch("/api/admin/social/ab-tests").then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); }),
  });

  if (isPending) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (error) return <p className="text-sm text-destructive p-4">Failed to load A/B tests: {error.message}</p>;
  if (!tests || tests.length === 0) return <p className="text-sm text-muted-foreground p-4">No A/B tests found.</p>;

  return (
    <div className="space-y-4">
      {tests.map((test) => {
        const variantKeys = ["A", "B", "C"];
        const totalImpressions = variantKeys.reduce((acc, k) => acc + (test.variants[k]?.totalImpressions ?? 0), 0);
        const hasData = totalImpressions > 0;

        return (
          <Card key={test.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{test.contentType.replace(/_/g, " ")}</CardTitle>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${AB_STATUS_COLORS[test.status] ?? "bg-slate-100 text-slate-700"}`}
                >
                  {test.status}
                </span>
                {test.winner && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    Winner: {test.winner}
                  </span>
                )}
                {test.startedAt && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    Started {new Date(test.startedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {test.hypothesis && (
                <p className="text-xs text-muted-foreground mt-1">{test.hypothesis}</p>
              )}
            </CardHeader>
            <CardContent>
              {!hasData ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium">Metric</th>
                        {variantKeys.map((k) => (
                          <th key={k} className="text-right p-3 font-medium">
                            Variant {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <tr className="hover:bg-muted/20">
                        <td className="p-3 text-muted-foreground">Posts</td>
                        {variantKeys.map((k) => (
                          <td key={k} className="text-right p-3">
                            {test.variants[k]?.postCount ?? 0}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-muted/20">
                        <td className="p-3 text-muted-foreground">Impressions</td>
                        {variantKeys.map((k) => (
                          <td key={k} className="text-right p-3">
                            {(test.variants[k]?.totalImpressions ?? 0).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-muted/20">
                        <td className="p-3 text-muted-foreground">Likes</td>
                        {variantKeys.map((k) => (
                          <td key={k} className="text-right p-3">
                            {(test.variants[k]?.totalLikes ?? 0).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export default function AdminGrowth() {
  const [triggerDate, setTriggerDate] = useState(() => new Date().toISOString().slice(0, 10));
  const qc = useQueryClient();
  const { toast } = useToast();

  const triggerMutation = useMutation({
    mutationFn: (date: string) =>
      fetch("/api/admin/growth/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/plans"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/queue"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/growth/job-runs"] });
      if (data.status === "COMPLETE") {
        toast({ title: `Growth job complete — ${data.itemsGenerated} items generated` });
      } else {
        toast({ title: "Growth job failed", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Growth Agent</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate daily content plans and manage the social media publishing queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={triggerDate}
            onChange={(e) => setTriggerDate(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm bg-background"
          />
          <Button
            onClick={() => triggerMutation.mutate(triggerDate)}
            disabled={triggerMutation.isPending}
            className="gap-2"
          >
            {triggerMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Agent
          </Button>
        </div>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
          <TabsTrigger value="plans">Content Plans</TabsTrigger>
          <TabsTrigger value="runs">Job Runs</TabsTrigger>
          <TabsTrigger value="flywheel">Growth Flywheel</TabsTrigger>
          <TabsTrigger value="analytics">Post Analytics</TabsTrigger>
          <TabsTrigger value="abtests">A/B Tests</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          <QueueTab />
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <PlansTab />
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <JobRunsTab />
        </TabsContent>

        <TabsContent value="flywheel" className="mt-4">
          <FlywheelTab />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <PostAnalyticsTab />
        </TabsContent>

        <TabsContent value="abtests" className="mt-4">
          <AbTestsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
