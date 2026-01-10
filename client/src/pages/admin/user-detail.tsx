import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Wallet, Shield, Plus, Minus, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface WalletData {
  wallet: {
    id: number;
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  ledger: {
    id: number;
    entryType: string;
    amount: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
  }[];
}

interface Entitlement {
  id: number;
  entitlementKey: string;
  source: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function AdminUserDetail() {
  const [, navigate] = useLocation();
  const params = useParams();
  const userId = params.userId as string;
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantKey, setGrantKey] = useState("");
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data: walletData, isLoading: walletLoading } = useQuery<WalletData>({
    queryKey: ["/api/admin/users", userId, "wallet"],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}/wallet`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch wallet");
      }
      return response.json();
    },
    enabled: !!userId && isAuthenticated && user?.isAdmin,
  });
  
  const { data: entitlements, isLoading: entitlementsLoading } = useQuery<{ entitlements: Entitlement[] }>({
    queryKey: ["/api/admin/users", userId, "entitlements"],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}/entitlements`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch entitlements");
      }
      return response.json();
    },
    enabled: !!userId && isAuthenticated && user?.isAdmin,
  });
  
  const adjustMutation = useMutation({
    mutationFn: async ({ amount, reason }: { amount: number; reason: string }) => {
      const response = await fetch(`/api/admin/users/${userId}/wallet/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount, reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to adjust balance");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Balance Adjusted",
        description: `New balance: ${data.newBalance} PackPTS`,
      });
      setAdjustDialogOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "wallet"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const grantMutation = useMutation({
    mutationFn: async (entitlementKey: string) => {
      const response = await fetch(`/api/admin/users/${userId}/entitlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entitlementKey }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to grant entitlement");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Entitlement Granted",
        description: `Successfully granted ${grantKey}`,
      });
      setGrantDialogOpen(false);
      setGrantKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "entitlements"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const revokeMutation = useMutation({
    mutationFn: async (entitlementKey: string) => {
      const response = await fetch(`/api/admin/users/${userId}/entitlements/${entitlementKey}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "Admin revocation" }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to revoke entitlement");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Entitlement Revoked",
        description: "Entitlement has been revoked",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "entitlements"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const getEntryBadgeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case "EARN": return "default";
      case "SPEND": return "destructive";
      case "ADJUST": return "secondary";
      case "PURCHASE_CREDIT": return "default";
      case "REVERSAL": return "outline";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => navigate("/admin/users")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-user-detail-title">User Details</h1>
          <p className="text-muted-foreground font-mono text-sm">{userId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              <CardTitle>Wallet</CardTitle>
            </div>
            <Button size="sm" onClick={() => setAdjustDialogOpen(true)} data-testid="button-adjust-balance">
              Adjust Balance
            </Button>
          </CardHeader>
          <CardContent>
            {walletLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : walletData?.wallet ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Current Balance</p>
                    <p className="text-2xl font-bold font-mono">{walletData.wallet.balance.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={walletData.wallet.status === "active" ? "default" : "destructive"}>
                      {walletData.wallet.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Lifetime Earned</p>
                    <p className="font-mono">{walletData.wallet.lifetimeEarned.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Lifetime Spent</p>
                    <p className="font-mono">{walletData.wallet.lifetimeSpent.toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">Recent Transactions</h4>
                  {walletData.ledger.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No transactions</p>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-auto">
                      {walletData.ledger.slice(0, 10).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant={getEntryBadgeVariant(entry.entryType)} className="text-xs">
                              {entry.entryType}
                            </Badge>
                            <span className="text-muted-foreground truncate max-w-[150px]">{entry.reason}</span>
                          </div>
                          <span className={`font-mono ${entry.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                            {entry.amount > 0 ? "+" : ""}{entry.amount}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No wallet found</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <CardTitle>Entitlements</CardTitle>
            </div>
            <Button size="sm" onClick={() => setGrantDialogOpen(true)} data-testid="button-grant-entitlement">
              <Plus className="h-4 w-4 mr-1" />
              Grant
            </Button>
          </CardHeader>
          <CardContent>
            {entitlementsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : entitlements?.entitlements && entitlements.entitlements.length > 0 ? (
              <div className="space-y-2">
                {entitlements.entitlements.map((ent) => (
                  <div key={ent.id} className="flex items-center justify-between p-2 border rounded" data-testid={`entitlement-${ent.entitlementKey}`}>
                    <div>
                      <p className="font-medium">{ent.entitlementKey}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>via {ent.source}</span>
                        {ent.expiresAt && (
                          <span>expires {format(new Date(ent.expiresAt), "MMM dd, yyyy")}</span>
                        )}
                        {ent.revokedAt && (
                          <Badge variant="destructive" className="text-xs">Revoked</Badge>
                        )}
                      </div>
                    </div>
                    {!ent.revokedAt && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => revokeMutation.mutate(ent.entitlementKey)}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-${ent.entitlementKey}`}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No entitlements</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust PackPTS Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Amount (positive or negative)</label>
              <Input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="e.g. 1000 or -500"
                data-testid="input-adjust-amount"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Reason for adjustment"
                data-testid="input-adjust-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => adjustMutation.mutate({ 
                amount: parseInt(adjustAmount), 
                reason: adjustReason 
              })}
              disabled={!adjustAmount || !adjustReason || adjustMutation.isPending}
              data-testid="button-confirm-adjust"
            >
              {adjustMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adjust"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Entitlement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Entitlement Key</label>
              <Select value={grantKey} onValueChange={setGrantKey}>
                <SelectTrigger data-testid="select-entitlement-key">
                  <SelectValue placeholder="Select entitlement" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tier_pro">tier_pro</SelectItem>
                  <SelectItem value="tier_legend">tier_legend</SelectItem>
                  <SelectItem value="unlimited_matches">unlimited_matches</SelectItem>
                  <SelectItem value="vip_access">vip_access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => grantMutation.mutate(grantKey)}
              disabled={!grantKey || grantMutation.isPending}
              data-testid="button-confirm-grant"
            >
              {grantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
