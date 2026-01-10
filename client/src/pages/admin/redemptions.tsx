import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  RotateCcw,
  Clock,
  DollarSign,
  Coins
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Redemption {
  id: string;
  userId: string;
  packptsSpent: number;
  usdValue: number;
  type: string;
  status: string;
  creditToken: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
}

interface RedemptionListResponse {
  redemptions: Redemption[];
  total: number;
  page: number;
  pageSize: number;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    case "completed":
      return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
    case "approved":
      return <Badge variant="default"><CheckCircle className="h-3 w-3 mr-1" />Used</Badge>;
    case "rejected":
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
    case "reversed":
      return <Badge variant="destructive"><RotateCcw className="h-3 w-3 mr-1" />Reversed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminRedemptions() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedRedemption, setSelectedRedemption] = useState<Redemption | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | "reverse" | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error } = useQuery<RedemptionListResponse>({
    queryKey: ["/api/admin/redemptions", page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: page.toString(), pageSize: "20" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      const res = await fetch(`/api/admin/redemptions?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch redemptions");
      return res.json();
    },
  });

  const { data: pendingData } = useQuery<RedemptionListResponse>({
    queryKey: ["/api/admin/redemptions/pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/redemptions/pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch pending redemptions");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (redemptionId: string) => {
      return apiRequest("POST", `/api/admin/redemptions/${redemptionId}/approve`);
    },
    onSuccess: () => {
      toast({ title: "Redemption approved", description: "Credit token has been issued" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemptions"] });
      setSelectedRedemption(null);
      setActionType(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ redemptionId, reason }: { redemptionId: string; reason: string }) => {
      return apiRequest("POST", `/api/admin/redemptions/${redemptionId}/reject`, { reason });
    },
    onSuccess: () => {
      toast({ title: "Redemption rejected", description: "PackPTS have been refunded" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemptions"] });
      setSelectedRedemption(null);
      setActionType(null);
      setReason("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to reject", description: error.message, variant: "destructive" });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async ({ redemptionId, reason }: { redemptionId: string; reason: string }) => {
      return apiRequest("POST", `/api/admin/redemptions/${redemptionId}/reverse`, { reason });
    },
    onSuccess: () => {
      toast({ title: "Redemption reversed", description: "PackPTS have been returned to user" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemptions"] });
      setSelectedRedemption(null);
      setActionType(null);
      setReason("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to reverse", description: error.message, variant: "destructive" });
    },
  });

  const handleAction = () => {
    if (!selectedRedemption || !actionType) return;

    if (actionType === "approve") {
      approveMutation.mutate(selectedRedemption.id);
    } else if (actionType === "reject") {
      if (!reason.trim()) {
        toast({ title: "Reason required", variant: "destructive" });
        return;
      }
      rejectMutation.mutate({ redemptionId: selectedRedemption.id, reason });
    } else if (actionType === "reverse") {
      if (!reason.trim()) {
        toast({ title: "Reason required", variant: "destructive" });
        return;
      }
      reverseMutation.mutate({ redemptionId: selectedRedemption.id, reason });
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;
  const pendingCount = pendingData?.total || 0;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-admin-redemptions-title">Redemption Management</h1>
          <p className="text-muted-foreground">Review, approve, and manage PackPTS redemptions</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-full bg-yellow-500/10">
                <Clock className="h-6 w-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono" data-testid="text-pending-count">{pendingCount}</p>
                <p className="text-sm text-muted-foreground">Pending Review</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono" data-testid="text-total-redemptions">{data?.total || 0}</p>
                <p className="text-sm text-muted-foreground">Total Redemptions</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-500/10">
                <Coins className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono">$25+</p>
                <p className="text-sm text-muted-foreground">Review Threshold</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Redemptions</CardTitle>
                <CardDescription>Manage user redemption requests</CardDescription>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="approved">Used</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">Failed to load redemptions</div>
            ) : data && data.redemptions.length > 0 ? (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">PackPTS</TableHead>
                        <TableHead className="text-right">USD Value</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.redemptions.map((r) => (
                        <TableRow key={r.id} data-testid={`row-redemption-${r.id}`}>
                          <TableCell className="text-sm">
                            {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.userId.slice(0, 8)}...
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {r.packptsSpent.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                            ${(r.usdValue / 100).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {r.status === "pending" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setSelectedRedemption(r); setActionType("approve"); }}
                                    data-testid={`button-approve-${r.id}`}
                                  >
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => { setSelectedRedemption(r); setActionType("reject"); }}
                                    data-testid={`button-reject-${r.id}`}
                                  >
                                    <XCircle className="h-4 w-4 text-red-500" />
                                  </Button>
                                </>
                              )}
                              {r.status === "completed" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setSelectedRedemption(r); setActionType("reverse"); }}
                                  data-testid={`button-reverse-${r.id}`}
                                >
                                  <RotateCcw className="h-4 w-4 text-orange-500" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} ({data.total} total)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No redemptions found
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!actionType} onOpenChange={() => { setActionType(null); setReason(""); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {actionType === "approve" && "Approve Redemption"}
                {actionType === "reject" && "Reject Redemption"}
                {actionType === "reverse" && "Reverse Redemption (Fraud)"}
              </DialogTitle>
              <DialogDescription>
                {actionType === "approve" && "This will issue a credit token to the user."}
                {actionType === "reject" && "This will refund PackPTS to the user's wallet."}
                {actionType === "reverse" && "This will void the credit and refund PackPTS to the user."}
              </DialogDescription>
            </DialogHeader>

            {selectedRedemption && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 p-4 rounded-md bg-muted">
                  <div>
                    <p className="text-sm text-muted-foreground">PackPTS Spent</p>
                    <p className="font-mono font-bold">{selectedRedemption.packptsSpent.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">USD Value</p>
                    <p className="font-mono font-bold text-green-600">${(selectedRedemption.usdValue / 100).toFixed(2)}</p>
                  </div>
                </div>

                {(actionType === "reject" || actionType === "reverse") && (
                  <div>
                    <label className="text-sm font-medium">Reason</label>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={actionType === "reverse" ? "Describe the fraud reason..." : "Explain rejection reason..."}
                      className="mt-1"
                      data-testid="input-reason"
                    />
                  </div>
                )}

                {actionType === "reverse" && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">
                      This action cannot be undone. The credit token will be invalidated.
                    </p>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setActionType(null); setReason(""); }}>
                Cancel
              </Button>
              <Button
                variant={actionType === "approve" ? "default" : "destructive"}
                onClick={handleAction}
                disabled={approveMutation.isPending || rejectMutation.isPending || reverseMutation.isPending}
                data-testid="button-confirm-action"
              >
                {(approveMutation.isPending || rejectMutation.isPending || reverseMutation.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {actionType === "approve" && "Approve"}
                {actionType === "reject" && "Reject & Refund"}
                {actionType === "reverse" && "Reverse (Fraud)"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
