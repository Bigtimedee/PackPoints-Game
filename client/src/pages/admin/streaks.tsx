import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Flame, Snowflake, Users, Trophy, Settings, Loader2, Save, Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface StreakStats {
  totalActiveStreaks: number;
  averageStreakLength: number;
  longestCurrentStreak: number;
  totalClaimsToday: number;
  totalPointsAwardedToday: number;
  freezesAvailableTotal: number;
}

interface RewardConfig {
  id: number;
  dayNumber: number;
  baseReward: number;
  milestoneBonus: number;
  createdAt: string;
  updatedAt: string;
}

interface TopStreak {
  userId: number;
  username: string;
  currentDays: number;
  longestDays: number;
}

export default function AdminStreaks() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [newConfig, setNewConfig] = useState({ dayNumber: "", baseReward: "", milestoneBonus: "" });
  const [editingConfig, setEditingConfig] = useState<RewardConfig | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || !user?.isAdmin)) {
      navigate("/admin");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  const { data: stats, isLoading: statsLoading } = useQuery<StreakStats>({
    queryKey: ["/api/admin/streaks/stats"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: configs, isLoading: configsLoading } = useQuery<RewardConfig[]>({
    queryKey: ["/api/admin/streaks/config"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const { data: topStreaks, isLoading: topStreaksLoading } = useQuery<TopStreak[]>({
    queryKey: ["/api/admin/streaks/top"],
    enabled: isAuthenticated && user?.isAdmin,
  });

  const addConfigMutation = useMutation({
    mutationFn: async (config: { dayNumber: number; baseReward: number; milestoneBonus: number }) => {
      return apiRequest("POST", "/api/admin/streaks/config", config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/streaks/config"] });
      toast({ title: "Reward config added successfully" });
      setNewConfig({ dayNumber: "", baseReward: "", milestoneBonus: "" });
      setAddDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add config", description: error.message, variant: "destructive" });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (config: { id: number; dayNumber: number; baseReward: number; milestoneBonus: number }) => {
      return apiRequest("PATCH", `/api/admin/streaks/config/${config.id}`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/streaks/config"] });
      toast({ title: "Reward config updated successfully" });
      setEditingConfig(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update config", description: error.message, variant: "destructive" });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/streaks/config/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/streaks/config"] });
      toast({ title: "Reward config deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete config", description: error.message, variant: "destructive" });
    },
  });

  const handleAddConfig = () => {
    const dayNumber = parseInt(newConfig.dayNumber);
    const baseReward = parseInt(newConfig.baseReward);
    const milestoneBonus = parseInt(newConfig.milestoneBonus);

    if (isNaN(dayNumber) || dayNumber < 1) {
      toast({ title: "Invalid day number", variant: "destructive" });
      return;
    }
    if (isNaN(baseReward) || baseReward < 0) {
      toast({ title: "Invalid base reward", variant: "destructive" });
      return;
    }
    if (isNaN(milestoneBonus) || milestoneBonus < 0) {
      toast({ title: "Invalid milestone bonus", variant: "destructive" });
      return;
    }

    addConfigMutation.mutate({ dayNumber, baseReward, milestoneBonus });
  };

  const handleUpdateConfig = () => {
    if (!editingConfig) return;
    updateConfigMutation.mutate({
      id: editingConfig.id,
      dayNumber: editingConfig.dayNumber,
      baseReward: editingConfig.baseReward,
      milestoneBonus: editingConfig.milestoneBonus,
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-admin-streaks-title">Streak Management</h1>
        <p className="text-muted-foreground">Configure rewards and view streak statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statsLoading ? (
          [...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : stats ? (
          <>
            <Card data-testid="card-stat-active-streaks">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span className="text-xs text-muted-foreground">Active Streaks</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.totalActiveStreaks}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-avg-length">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Avg Length</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.averageStreakLength.toFixed(1)}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-longest">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  <span className="text-xs text-muted-foreground">Longest Active</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.longestCurrentStreak}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-claims-today">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Claims Today</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.totalClaimsToday}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-pts-today">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="h-4 w-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">PTS Today</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.totalPointsAwardedToday.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card data-testid="card-stat-freezes">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Snowflake className="h-4 w-4 text-cyan-500" />
                  <span className="text-xs text-muted-foreground">Total Freezes</span>
                </div>
                <p className="text-2xl font-bold font-mono">{stats.freezesAvailableTotal}</p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Reward Configuration
              </CardTitle>
              <CardDescription>Define rewards for each streak day</CardDescription>
            </div>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-config">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Day
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Reward Configuration</DialogTitle>
                  <DialogDescription>Define rewards for a specific streak day</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="dayNumber">Day Number</Label>
                    <Input
                      id="dayNumber"
                      type="number"
                      min="1"
                      placeholder="e.g. 7"
                      value={newConfig.dayNumber}
                      onChange={(e) => setNewConfig({ ...newConfig, dayNumber: e.target.value })}
                      data-testid="input-day-number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="baseReward">Base Reward (PackPTS)</Label>
                    <Input
                      id="baseReward"
                      type="number"
                      min="0"
                      placeholder="e.g. 100"
                      value={newConfig.baseReward}
                      onChange={(e) => setNewConfig({ ...newConfig, baseReward: e.target.value })}
                      data-testid="input-base-reward"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="milestoneBonus">Milestone Bonus (PackPTS)</Label>
                    <Input
                      id="milestoneBonus"
                      type="number"
                      min="0"
                      placeholder="e.g. 500"
                      value={newConfig.milestoneBonus}
                      onChange={(e) => setNewConfig({ ...newConfig, milestoneBonus: e.target.value })}
                      data-testid="input-milestone-bonus"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={handleAddConfig} 
                    disabled={addConfigMutation.isPending}
                    data-testid="button-save-new-config"
                  >
                    {addConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {configsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : configs && configs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Base Reward</TableHead>
                    <TableHead>Milestone Bonus</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.sort((a, b) => a.dayNumber - b.dayNumber).map((config) => (
                    <TableRow key={config.id} data-testid={`row-config-${config.dayNumber}`}>
                      <TableCell>
                        <Badge variant="outline">Day {config.dayNumber}</Badge>
                      </TableCell>
                      <TableCell>
                        {editingConfig?.id === config.id ? (
                          <Input
                            type="number"
                            value={editingConfig.baseReward}
                            onChange={(e) => setEditingConfig({ ...editingConfig, baseReward: parseInt(e.target.value) || 0 })}
                            className="w-24"
                          />
                        ) : (
                          <span className="font-mono">{config.baseReward.toLocaleString()}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingConfig?.id === config.id ? (
                          <Input
                            type="number"
                            value={editingConfig.milestoneBonus}
                            onChange={(e) => setEditingConfig({ ...editingConfig, milestoneBonus: parseInt(e.target.value) || 0 })}
                            className="w-24"
                          />
                        ) : (
                          <span className="font-mono">{config.milestoneBonus > 0 ? `+${config.milestoneBonus.toLocaleString()}` : "-"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingConfig?.id === config.id ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setEditingConfig(null)}>Cancel</Button>
                            <Button size="sm" onClick={handleUpdateConfig} disabled={updateConfigMutation.isPending}>
                              {updateConfigMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setEditingConfig(config)} data-testid={`button-edit-${config.dayNumber}`}>
                              Edit
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              className="text-destructive"
                              onClick={() => deleteConfigMutation.mutate(config.id)}
                              disabled={deleteConfigMutation.isPending}
                              data-testid={`button-delete-${config.dayNumber}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <p>No reward configurations yet.</p>
                <p className="text-sm">Add your first day to start configuring streak rewards.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Top Streaks
            </CardTitle>
            <CardDescription>Users with the longest active streaks</CardDescription>
          </CardHeader>
          <CardContent>
            {topStreaksLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : topStreaks && topStreaks.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Best</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topStreaks.map((streak, index) => (
                    <TableRow key={streak.userId} data-testid={`row-top-streak-${index + 1}`}>
                      <TableCell>
                        <Badge variant={index < 3 ? "default" : "secondary"}>#{index + 1}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{streak.username}</TableCell>
                      <TableCell>
                        <span className="font-mono text-orange-500">{streak.currentDays}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-muted-foreground">{streak.longestDays}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <p>No active streaks yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
