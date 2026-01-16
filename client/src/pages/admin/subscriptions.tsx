import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { 
  Loader2, 
  Plus, 
  Edit, 
  RefreshCw,
  DollarSign,
  Coins,
  Star,
  Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface SubscriptionProduct {
  id: string;
  name: string;
  description: string | null;
  packptsGrant: number;
  priceUsd: number;
  billingInterval: string;
  stripePriceId: string | null;
  sortOrder: number;
  isBestValue: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionFormData {
  name: string;
  description: string;
  packptsGrant: number;
  priceUsd: number;
  billingInterval: string;
  stripePriceId: string;
  sortOrder: number;
  isBestValue: boolean;
  isActive: boolean;
}

const defaultFormData: SubscriptionFormData = {
  name: "",
  description: "",
  packptsGrant: 1000,
  priceUsd: 999,
  billingInterval: "month",
  stripePriceId: "",
  sortOrder: 0,
  isBestValue: false,
  isActive: true,
};

export default function AdminSubscriptions() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SubscriptionProduct | null>(null);
  const [formData, setFormData] = useState<SubscriptionFormData>(defaultFormData);

  const { data: products, isLoading, error } = useQuery<SubscriptionProduct[]>({
    queryKey: ["/api/admin/subscription-products"],
    queryFn: async () => {
      const res = await fetch("/api/admin/subscription-products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch subscription products");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SubscriptionFormData) => {
      return apiRequest("POST", "/api/admin/subscription-products", data);
    },
    onSuccess: () => {
      toast({ title: "Subscription created", description: "The subscription package has been created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/subscriptions"] });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create subscription", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SubscriptionFormData> }) => {
      return apiRequest("PUT", `/api/admin/subscription-products/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Subscription updated", description: "The subscription package has been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/subscriptions"] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update subscription", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/subscription-products/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Subscription deactivated", description: "The subscription package has been deactivated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/subscriptions"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to deactivate subscription", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  };

  const openCreate = () => {
    setFormData(defaultFormData);
    setEditingProduct(null);
    setShowDialog(true);
  };

  const openEdit = (product: SubscriptionProduct) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || "",
      packptsGrant: product.packptsGrant,
      priceUsd: product.priceUsd,
      billingInterval: product.billingInterval,
      stripePriceId: product.stripePriceId || "",
      sortOrder: product.sortOrder,
      isBestValue: product.isBestValue,
      isActive: product.isActive,
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (formData.packptsGrant <= 0) {
      toast({ title: "Error", description: "PackPTS grant must be positive", variant: "destructive" });
      return;
    }
    if (formData.priceUsd <= 0) {
      toast({ title: "Error", description: "Price must be positive", variant: "destructive" });
      return;
    }

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatPackPts = (amount: number) => {
    return amount.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load subscription products</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Subscription Packages</h1>
          <p className="text-muted-foreground">
            Manage monthly PackPTS subscription packages
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-subscription">
          <Plus className="h-4 w-4 mr-2" />
          Add Package
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Active Subscriptions
          </CardTitle>
          <CardDescription>
            Configure pricing, PackPTS grants, and display order for subscription packages
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!products || products.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>No subscription packages configured</p>
              <p className="text-sm">Create your first subscription package to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>PackPTS/Month</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Value Ratio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const valueRatio = Math.round(product.packptsGrant / (product.priceUsd / 100));
                  return (
                    <TableRow key={product.id} data-testid={`row-subscription-${product.id}`}>
                      <TableCell className="font-mono">{product.sortOrder}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{product.name}</span>
                          {product.isBestValue && (
                            <Badge variant="default" className="gap-1">
                              <Star className="h-3 w-3" />
                              Best Value
                            </Badge>
                          )}
                        </div>
                        {product.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {product.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Coins className="h-4 w-4 text-yellow-500" />
                          <span className="font-medium">{formatPackPts(product.packptsGrant)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-4 w-4 text-green-500" />
                          <span>{formatPrice(product.priceUsd)}/mo</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{valueRatio} PTS/$</Badge>
                      </TableCell>
                      <TableCell>
                        {product.isActive ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            size="icon" 
                            variant="ghost"
                            onClick={() => openEdit(product)}
                            data-testid={`button-edit-${product.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {product.isActive && (
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(product.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-${product.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Edit Subscription Package" : "Create Subscription Package"}
            </DialogTitle>
            <DialogDescription>
              {editingProduct 
                ? "Update the subscription package details" 
                : "Configure a new monthly PackPTS subscription package"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Package Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Starter Pack"
                data-testid="input-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this package"
                rows={2}
                data-testid="input-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="packptsGrant">PackPTS per Month</Label>
                <Input
                  id="packptsGrant"
                  type="number"
                  min="1"
                  value={formData.packptsGrant}
                  onChange={(e) => setFormData({ ...formData, packptsGrant: parseInt(e.target.value) || 0 })}
                  data-testid="input-packpts"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="priceUsd">Price (cents)</Label>
                <Input
                  id="priceUsd"
                  type="number"
                  min="1"
                  value={formData.priceUsd}
                  onChange={(e) => setFormData({ ...formData, priceUsd: parseInt(e.target.value) || 0 })}
                  data-testid="input-price"
                />
                <p className="text-xs text-muted-foreground">
                  {formatPrice(formData.priceUsd)} per month
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingInterval">Billing Interval</Label>
                <Select 
                  value={formData.billingInterval} 
                  onValueChange={(v) => setFormData({ ...formData, billingInterval: v })}
                >
                  <SelectTrigger data-testid="select-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sortOrder">Display Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  min="0"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  data-testid="input-sortorder"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripePriceId">Stripe Price ID (optional)</Label>
              <Input
                id="stripePriceId"
                value={formData.stripePriceId}
                onChange={(e) => setFormData({ ...formData, stripePriceId: e.target.value })}
                placeholder="price_xxxxxxxxxxxx"
                data-testid="input-stripepriceid"
              />
              <p className="text-xs text-muted-foreground">
                If empty, price will be created dynamically in Stripe
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="isBestValue"
                  checked={formData.isBestValue}
                  onCheckedChange={(checked) => setFormData({ ...formData, isBestValue: checked })}
                  data-testid="switch-bestvalue"
                />
                <Label htmlFor="isBestValue">Mark as "Best Value"</Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                  data-testid="switch-active"
                />
                <Label htmlFor="isActive">Active</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingProduct ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
