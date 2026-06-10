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
import { ArrowLeft, Wallet, Shield, Plus, Minus, Loader2, UserCog, Ban, CheckCircle, User, Mail, Calendar } from "lucide-react";
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

interface AdminStatus {
  isAdmin: boolean;
  isSuspended: boolean;
  username: string | null;
}

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  status: string;
  isAdmin: boolean;
  authProvider: string;
  createdAt: string | null;
  points: number;
  gamesPlayed: number;
  correctAnswers: number;
  totalAnswers: number;
  accuracy: number;
  avgPointsPerGame: number;
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
  
  const [revokeAdminDialogOpen, setRevokeAdminDialogOpen] = useState(false);
  const [revokeAdminReason, setRevokeAdminReason] = useState("");
  
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);
  
  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/admin/users", userId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch user profile");
      return response.json();
    },
    enabled: !!userId && isAuthenticated && user?.isAdmin,
  });

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
  
  const { data: adminStatus, isLoading: adminStatusLoading } = useQuery<AdminStatus>({
    queryKey: ["/api/admin/users", userId, "admin-status"],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}/admin-status`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch admin status");
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
  
  const grantAdminMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}/grant-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to grant admin access");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Admin Access Granted",
        description: "User now has admin privileges",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "admin-status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const revokeAdminMutation = useMutation({
    mutationFn: async (reason: string) => {
      const response = await fetch(`/api/admin/users/${userId}/revoke-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to revoke admin access");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Admin Access Revoked",
        description: "User no longer has admin privileges",
      });
      setRevokeAdminDialogOpen(false);
      setRevokeAdminReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "admin-status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const suspendMutation = useMutation({
    mutationFn: async (reason: string) => {
      const response = await fetch(`/api/admin/users/${userId}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to suspend user");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "User Suspended",
        description: "User account has been suspended",
      });
      setSuspendDialogOpen(false);
      setSuspendReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "admin-status"] });
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
  
  const unsuspendMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/users/${userId}/unsuspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to unsuspend user");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "User Unsuspended",
        description: "User account has been reactivated",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "admin-status"] });
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

      <Card>
        <CardContent className="pt-6">
          {profileLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : profile ? (
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold">{profile.username}</h2>
                    {profile.isAdmin && <Badge variant="default" className="text-xs">Admin</Badge>}
                    <Badge variant={
                      profile.status === "ACTIVE" ? "default" :
                      profile.status === "BANNED" ? "destructive" :
                      "secondary"
                    } className="text-xs">{profile.status}</Badge>
                  </div>
                  {profile.displayName && <p className="text-sm text-muted-foreground">{profile.displayName}</p>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm sm:border-l sm:pl-6">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono">{profile.email || <span className="text-muted-foreground italic">No email on file</span>}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="capitalize">{profile.authProvider} auth</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span>Joined {profile.createdAt ? format(new Date(profile.createdAt), "MMM d, yyyy") : "unknown"}</span>
                </div>
              </div>
              <div className="flex gap-6 sm:border-l sm:pl-6 text-sm">
                <div>
                  <p className="text-muted-foreground">Points</p>
                  <p className="font-mono font-bold">{profile.points.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Games</p>
                  <p className="font-mono font-bold">{profile.gamesPlayed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Accuracy</p>
                  <p className="font-mono font-bold">{profile.accuracy}%</p>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            <CardTitle>Admin Management</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {adminStatusLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : adminStatus ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <p className="text-sm text-muted-foreground">Admin Status</p>
                  <Badge variant={adminStatus.isAdmin ? "default" : "secondary"}>
                    {adminStatus.isAdmin ? "Admin" : "Regular User"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Account Status</p>
                  <Badge variant={adminStatus.isSuspended ? "destructive" : "default"}>
                    {adminStatus.isSuspended ? "Suspended" : "Active"}
                  </Badge>
                </div>
              </div>
              
              <div className="flex gap-2 flex-wrap pt-4 border-t">
                {adminStatus.isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevokeAdminDialogOpen(true)}
                    disabled={revokeAdminMutation.isPending}
                    data-testid="button-revoke-admin"
                  >
                    <Shield className="h-4 w-4 mr-1" />
                    Revoke Admin
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => grantAdminMutation.mutate()}
                    disabled={grantAdminMutation.isPending}
                    data-testid="button-grant-admin"
                  >
                    {grantAdminMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4 mr-1" />
                    )}
                    Grant Admin
                  </Button>
                )}
                
                {adminStatus.isSuspended ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => unsuspendMutation.mutate()}
                    disabled={unsuspendMutation.isPending}
                    data-testid="button-unsuspend"
                  >
                    {unsuspendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-1" />
                    )}
                    Unsuspend User
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setSuspendDialogOpen(true)}
                    disabled={suspendMutation.isPending}
                    data-testid="button-suspend"
                  >
                    <Ban className="h-4 w-4 mr-1" />
                    Suspend User
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Unable to load admin status</p>
          )}
        </CardContent>
      </Card>

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

      <Dialog open={revokeAdminDialogOpen} onOpenChange={setRevokeAdminDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Admin Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              This will remove admin privileges from this user. They will no longer be able to access the Admin Portal.
            </p>
            <div>
              <label className="text-sm font-medium">Reason for revocation</label>
              <Textarea
                value={revokeAdminReason}
                onChange={(e) => setRevokeAdminReason(e.target.value)}
                placeholder="Enter the reason for revoking admin access"
                data-testid="input-revoke-admin-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeAdminDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => revokeAdminMutation.mutate(revokeAdminReason)}
              disabled={!revokeAdminReason || revokeAdminMutation.isPending}
              data-testid="button-confirm-revoke-admin"
            >
              {revokeAdminMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Suspending this user will deactivate their wallet and revoke any admin privileges. They will not be able to play games or earn points.
            </p>
            <div>
              <label className="text-sm font-medium">Reason for suspension</label>
              <Textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Enter the reason for suspending this user"
                data-testid="input-suspend-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => suspendMutation.mutate(suspendReason)}
              disabled={!suspendReason || suspendMutation.isPending}
              data-testid="button-confirm-suspend"
            >
              {suspendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Suspend User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
