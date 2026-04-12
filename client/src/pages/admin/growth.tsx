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
import { Copy, Check, Play, RefreshCw, ExternalLink } from "lucide-react";

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
      <div className="rounded-md border overflow-hidden">
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

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Platform</th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-left p-3 font-medium hidden sm:table-cell">Preview</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
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
                <td className="p-3 text-right">
                  {queue.status === "PENDING" && (
                    <div className="flex justify-end gap-2">
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
                    </div>
                  )}
                  {queue.status === "POSTED" && (
                    <span className="text-xs text-muted-foreground">
                      {queue.postedAt ? new Date(queue.postedAt).toLocaleDateString() : "Posted"}
                    </span>
                  )}
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
      <div className="rounded-md border overflow-hidden">
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
      </Tabs>
    </div>
  );
}
