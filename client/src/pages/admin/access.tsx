import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Users, Gift, Clock, Plus, Copy, Check, Settings, UserPlus, Mail, Sparkles } from "lucide-react";
import { format } from "date-fns";

export default function AdminAccess() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [newCapValue, setNewCapValue] = useState("");
  const [newReservedValue, setNewReservedValue] = useState("");
  const [isCapDialogOpen, setIsCapDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    maxUses: "1",
    expiresInDays: "30",
    reservedSeat: true,
    note: "",
  });

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const { data: accessSummary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/admin/access/summary"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: inviteCodes, isLoading: invitesLoading, refetch: refetchInvites } = useQuery<any>({
    queryKey: ["/api/admin/invites"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: waitlist, isLoading: waitlistLoading, refetch: refetchWaitlist } = useQuery<any>({
    queryKey: ["/api/admin/waitlist"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const updateCapMutation = useMutation({
    mutationFn: async (data: { maxActive?: number; reservedSeats?: number }) => {
      const response = await apiRequest("POST", "/api/admin/access/cap", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/access/cap"] });
      toast({ title: "Cap updated", description: "Access cap settings have been saved." });
      setIsCapDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to update cap", description: error?.message, variant: "destructive" });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/admin/invites/create", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access/summary"] });
      toast({ title: "Invite created", description: `Code: ${data.invite?.code}` });
      setIsInviteDialogOpen(false);
      setInviteForm({ maxUses: "1", expiresInDays: "30", reservedSeat: true, note: "" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create invite", description: error?.message, variant: "destructive" });
    },
  });

  const inviteWaitlistMutation = useMutation({
    mutationFn: async (waitlistId: string) => {
      const response = await apiRequest("POST", `/api/admin/waitlist/${waitlistId}/invite`, {});
      return response.json();
    },
    onSuccess: () => {
      refetchWaitlist();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/access/summary"] });
      toast({ title: "Invite sent", description: "Waitlist entry has been invited." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to invite", description: error?.message, variant: "destructive" });
    },
  });

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleUpdateCap = () => {
    const updates: any = {};
    if (newCapValue) updates.maxActive = parseInt(newCapValue);
    if (newReservedValue) updates.reservedSeats = parseInt(newReservedValue);
    if (Object.keys(updates).length > 0) {
      updateCapMutation.mutate(updates);
    }
  };

  const handleCreateInvite = () => {
    const expiresAt = inviteForm.expiresInDays
      ? new Date(Date.now() + parseInt(inviteForm.expiresInDays) * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    createInviteMutation.mutate({
      maxUses: parseInt(inviteForm.maxUses) || 1,
      expiresAt,
      reservedSeat: inviteForm.reservedSeat,
      note: inviteForm.note || undefined,
    });
  };

  if (authLoading || summaryLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const summary = accessSummary || { cap: {}, stats: {} };
  const percentFull = summary.cap?.maxActive ? (summary.cap.currentActive / summary.cap.maxActive) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-admin-access-title">Founders Cap</h1>
          <p className="text-muted-foreground">Manage access limits, invite codes, and waitlist</p>
        </div>
        <Dialog open={isCapDialogOpen} onOpenChange={setIsCapDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="button-edit-cap">
              <Settings className="w-4 h-4 mr-2" />
              Edit Cap Settings
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Access Cap</DialogTitle>
              <DialogDescription>Adjust the maximum number of active users and reserved seats.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Max Active Users (current: {summary.cap?.maxActive})</Label>
                <Input
                  type="number"
                  placeholder={summary.cap?.maxActive?.toString()}
                  value={newCapValue}
                  onChange={(e) => setNewCapValue(e.target.value)}
                  data-testid="input-max-active"
                />
              </div>
              <div className="space-y-2">
                <Label>Reserved Seats for Invites (current: {summary.cap?.reservedSeats})</Label>
                <Input
                  type="number"
                  placeholder={summary.cap?.reservedSeats?.toString()}
                  value={newReservedValue}
                  onChange={(e) => setNewReservedValue(e.target.value)}
                  data-testid="input-reserved-seats"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCapDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleUpdateCap} disabled={updateCapMutation.isPending} data-testid="button-save-cap">
                {updateCapMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Active Users</span>
            </div>
            <p className="text-2xl font-bold font-mono">{summary.cap?.currentActive || 0}</p>
            <p className="text-xs text-muted-foreground">of {summary.cap?.maxActive || 500}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Reserved Seats</span>
            </div>
            <p className="text-2xl font-bold font-mono">{summary.cap?.reservedSeats || 0}</p>
            <p className="text-xs text-muted-foreground">{summary.cap?.reservedUsed || 0} used</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Gift className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Active Invites</span>
            </div>
            <p className="text-2xl font-bold font-mono">{summary.stats?.activeInvites || 0}</p>
            <p className="text-xs text-muted-foreground">{summary.stats?.totalInvitesUsed || 0} used total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Waitlist</span>
            </div>
            <p className="text-2xl font-bold font-mono">{summary.stats?.pendingWaitlist || 0}</p>
            <p className="text-xs text-muted-foreground">pending</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Founders Cap Progress</span>
            <span className="font-medium">{Math.round(percentFull)}%</span>
          </div>
          <Progress value={percentFull} className="h-3" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{summary.cap?.availableSeats || 0} seats available</span>
            <span>{summary.cap?.reservedSeats - (summary.cap?.reservedUsed || 0)} reserved remaining</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites" data-testid="tab-invites">
            <Gift className="w-4 h-4 mr-2" />
            Invite Codes
          </TabsTrigger>
          <TabsTrigger value="waitlist" data-testid="tab-waitlist">
            <Clock className="w-4 h-4 mr-2" />
            Waitlist
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invites" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Invite Codes</CardTitle>
                <CardDescription>Manage invite codes for early access</CardDescription>
              </div>
              <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-invite">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Invite
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Invite Code</DialogTitle>
                    <DialogDescription>Generate a new invite code for early access.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Max Uses</Label>
                      <Input
                        type="number"
                        min="1"
                        value={inviteForm.maxUses}
                        onChange={(e) => setInviteForm({ ...inviteForm, maxUses: e.target.value })}
                        data-testid="input-invite-max-uses"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Expires in Days (leave empty for no expiry)</Label>
                      <Input
                        type="number"
                        min="1"
                        value={inviteForm.expiresInDays}
                        onChange={(e) => setInviteForm({ ...inviteForm, expiresInDays: e.target.value })}
                        data-testid="input-invite-expires"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Reserved Seat (bypasses cap)</Label>
                      <Switch
                        checked={inviteForm.reservedSeat}
                        onCheckedChange={(checked) => setInviteForm({ ...inviteForm, reservedSeat: checked })}
                        data-testid="switch-reserved-seat"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Note (optional)</Label>
                      <Input
                        value={inviteForm.note}
                        onChange={(e) => setInviteForm({ ...inviteForm, note: e.target.value })}
                        placeholder="e.g., For Twitter giveaway"
                        data-testid="input-invite-note"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateInvite} disabled={createInviteMutation.isPending} data-testid="button-confirm-create-invite">
                      {createInviteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create Code
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Uses</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inviteCodes?.codes?.map((invite: any) => (
                      <TableRow key={invite.id} data-testid={`row-invite-${invite.code}`}>
                        <TableCell className="font-mono">{invite.code}</TableCell>
                        <TableCell>
                          {invite.reservedSeat ? (
                            <Badge variant="secondary" className="bg-amber-500/20 text-amber-600">Reserved</Badge>
                          ) : (
                            <Badge variant="secondary">Normal</Badge>
                          )}
                        </TableCell>
                        <TableCell>{invite.usedCount || 0} / {invite.maxUses || "∞"}</TableCell>
                        <TableCell>
                          {invite.expiresAt ? format(new Date(invite.expiresAt), "MMM d, yyyy") : "Never"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{invite.note || "-"}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyCode(invite.code)}
                            data-testid={`button-copy-${invite.code}`}
                          >
                            {copiedCode === invite.code ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!inviteCodes?.codes || inviteCodes.codes.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No invite codes yet. Create one to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="waitlist" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Waitlist Entries</CardTitle>
              <CardDescription>Pending users waiting for access</CardDescription>
            </CardHeader>
            <CardContent>
              {waitlistLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Position</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Referral</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waitlist?.entries?.map((entry: any, index: number) => (
                      <TableRow key={entry.id} data-testid={`row-waitlist-${entry.id}`}>
                        <TableCell className="font-mono">{index + 1}</TableCell>
                        <TableCell>{entry.email}</TableCell>
                        <TableCell>
                          {entry.status === "PENDING" && (
                            <Badge variant="secondary">Pending</Badge>
                          )}
                          {entry.status === "INVITED" && (
                            <Badge variant="secondary" className="bg-green-500/20 text-green-600">Invited</Badge>
                          )}
                          {entry.status === "CONVERTED" && (
                            <Badge variant="secondary" className="bg-blue-500/20 text-blue-600">Converted</Badge>
                          )}
                        </TableCell>
                        <TableCell>{format(new Date(entry.createdAt), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-muted-foreground">{entry.referralSource || "-"}</TableCell>
                        <TableCell>
                          {entry.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => inviteWaitlistMutation.mutate(entry.id)}
                              disabled={inviteWaitlistMutation.isPending}
                              data-testid={`button-invite-${entry.id}`}
                            >
                              <UserPlus className="w-4 h-4 mr-1" />
                              Invite
                            </Button>
                          )}
                          {entry.status === "INVITED" && entry.inviteCode && (
                            <span className="font-mono text-xs">{entry.inviteCode}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!waitlist?.entries || waitlist.entries.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No waitlist entries yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
