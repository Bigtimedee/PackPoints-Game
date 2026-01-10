import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Loader2, 
  Plus, 
  Edit, 
  Trash2,
  Coins,
  DollarSign,
  Percent,
  ArrowUpDown,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface RedemptionTier {
  id: string;
  name: string;
  packptsRequired: number;
  usdCapCents: number;
  effectiveRatePct: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TierFormData {
  name: string;
  packptsRequired: number;
  usdCapCents: number;
  effectiveRatePct: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

const defaultFormData: TierFormData = {
  name: "",
  packptsRequired: 1000,
  usdCapCents: 500,
  effectiveRatePct: 100,
  description: "",
  sortOrder: 0,
  isActive: true,
};

export default function AdminTiers() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingTier, setEditingTier] = useState<RedemptionTier | null>(null);
  const [formData, setFormData] = useState<TierFormData>(defaultFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<RedemptionTier | null>(null);

  const { data, isLoading, error } = useQuery<{ tiers: RedemptionTier[] }>({
    queryKey: ["/api/admin/redemption-tiers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/redemption-tiers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tiers");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TierFormData) => {
      return apiRequest("POST", "/api/admin/redemption-tiers", data);
    },
    onSuccess: () => {
      toast({ title: "Tier created", description: "The redemption tier has been created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemption-tiers"] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create tier", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TierFormData> }) => {
      return apiRequest("PATCH", `/api/admin/redemption-tiers/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Tier updated", description: "The redemption tier has been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemption-tiers"] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update tier", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/redemption-tiers/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Tier deleted", description: "The redemption tier has been deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/redemption-tiers"] });
      setDeleteConfirm(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete tier", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingTier(null);
    setFormData(defaultFormData);
  };

  const openCreate = () => {
    const maxSort = data?.tiers?.reduce((max, t) => Math.max(max, t.sortOrder), 0) || 0;
    setFormData({ ...defaultFormData, sortOrder: maxSort + 1 });
    setEditingTier(null);
    setShowDialog(true);
  };

  const openEdit = (tier: RedemptionTier) => {
    setEditingTier(tier);
    setFormData({
      name: tier.name,
      packptsRequired: tier.packptsRequired,
      usdCapCents: tier.usdCapCents,
      effectiveRatePct: tier.effectiveRatePct,
      description: tier.description,
      sortOrder: tier.sortOrder,
      isActive: tier.isActive,
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.packptsRequired || !formData.usdCapCents) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (editingTier) {
      updateMutation.mutate({ id: editingTier.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const effectiveValue = Math.floor(formData.usdCapCents * (formData.effectiveRatePct / 100));
  const ratePerThousand = Math.floor((effectiveValue / formData.packptsRequired) * 1000);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load tiers. Please ensure you have admin access.
      </div>
    );
  }

  const tiers = data?.tiers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Redemption Tiers</h1>
          <p className="text-muted-foreground">Manage PackPTS redemption tiers and payout rates</p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-tier">
          <Plus className="h-4 w-4 mr-2" />
          Add Tier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Tier Configuration
          </CardTitle>
          <CardDescription>
            Each tier defines a fixed PackPTS amount and maximum USD value. The effective rate controls the actual payout (margin control).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tiers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">PackPTS</TableHead>
                    <TableHead className="text-right">Max Value</TableHead>
                    <TableHead className="text-right">Rate %</TableHead>
                    <TableHead className="text-right">Actual Payout</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiers.map((tier) => {
                    const actualPayout = Math.floor(tier.usdCapCents * (tier.effectiveRatePct / 100));
                    return (
                      <TableRow key={tier.id} data-testid={`row-tier-${tier.id}`}>
                        <TableCell className="font-mono text-muted-foreground">
                          {tier.sortOrder}
                        </TableCell>
                        <TableCell className="font-medium">
                          {tier.name}
                          <p className="text-xs text-muted-foreground">{tier.description}</p>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {tier.packptsRequired.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          ${(tier.usdCapCents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {tier.effectiveRatePct}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600 dark:text-green-400 font-bold">
                          ${(actualPayout / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {tier.isActive ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {tier.updatedAt ? (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(tier.updatedAt), "MMM d, HH:mm")}
                            </div>
                          ) : (
                            <span>-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(tier)}
                              data-testid={`button-edit-tier-${tier.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteConfirm(tier)}
                              data-testid={`button-delete-tier-${tier.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No tiers configured. Click "Add Tier" to create one.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTier ? "Edit Tier" : "Create Tier"}</DialogTitle>
            <DialogDescription>
              {editingTier ? "Update the tier configuration" : "Add a new redemption tier"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Starter"
                  data-testid="input-tier-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  data-testid="input-tier-order"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g., Up to $5 toward a card"
                data-testid="input-tier-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="packptsRequired" className="flex items-center gap-1">
                  <Coins className="h-3 w-3" /> PackPTS Required *
                </Label>
                <Input
                  id="packptsRequired"
                  type="number"
                  min={100}
                  step={100}
                  value={formData.packptsRequired}
                  onChange={(e) => setFormData({ ...formData, packptsRequired: parseInt(e.target.value) || 1000 })}
                  data-testid="input-tier-packpts"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usdCapCents" className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Max Value (cents) *
                </Label>
                <Input
                  id="usdCapCents"
                  type="number"
                  min={100}
                  step={100}
                  value={formData.usdCapCents}
                  onChange={(e) => setFormData({ ...formData, usdCapCents: parseInt(e.target.value) || 500 })}
                  data-testid="input-tier-usd"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="effectiveRatePct" className="flex items-center gap-1">
                <Percent className="h-3 w-3" /> Effective Rate (Margin Control)
              </Label>
              <div className="flex items-center gap-4">
                <Input
                  id="effectiveRatePct"
                  type="number"
                  min={0}
                  max={100}
                  value={formData.effectiveRatePct}
                  onChange={(e) => setFormData({ ...formData, effectiveRatePct: parseInt(e.target.value) || 100 })}
                  className="w-24"
                  data-testid="input-tier-rate"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                100% = full payout. Lower percentages increase your margin.
              </p>
            </div>

            <div className="p-3 rounded-md bg-muted space-y-1">
              <p className="text-sm font-medium">Preview</p>
              <p className="text-xs text-muted-foreground">
                {formData.packptsRequired.toLocaleString()} PackPTS = ${(effectiveValue / 100).toFixed(2)} actual payout
              </p>
              <p className="text-xs text-muted-foreground">
                Rate: ${(ratePerThousand / 100).toFixed(2)} per 1,000 PTS
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Active</Label>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-tier-active"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-tier"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingTier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tier</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the "{deleteConfirm?.name}" tier? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-tier"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
