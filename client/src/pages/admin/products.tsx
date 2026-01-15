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
  Package,
  DollarSign,
  Zap,
  Power,
  PowerOff
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Product {
  id: string;
  sku: string;
  name: string;
  type: string;
  packptsGrant: number | null;
  entitlementKey: string | null;
  durationDays: number | null;
  priceUsd: number | null;
  isActive: boolean;
  metadata: {
    stripePriceId?: string;
    [key: string]: any;
  } | null;
  createdAt: string;
}

interface ProductFormData {
  sku: string;
  name: string;
  type: "CONSUMABLE" | "ENTITLEMENT" | "SUBSCRIPTION";
  packptsGrant: number | null;
  entitlementKey: string | null;
  durationDays: number | null;
  priceUsd: number;
  stripePriceId: string;
  isActive: boolean;
}

const defaultFormData: ProductFormData = {
  sku: "",
  name: "",
  type: "CONSUMABLE",
  packptsGrant: 1000,
  entitlementKey: null,
  durationDays: null,
  priceUsd: 299,
  stripePriceId: "",
  isActive: true,
};

export default function AdminProducts() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);

  const { data, isLoading, error } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/admin/products"],
    queryFn: async () => {
      const res = await fetch("/api/admin/products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ProductFormData) => {
      return apiRequest("POST", "/api/admin/products", data);
    },
    onSuccess: () => {
      toast({ title: "Product created", description: "The product has been created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create product", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProductFormData> }) => {
      return apiRequest("PATCH", `/api/admin/products/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Product updated", description: "The product has been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update product", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/admin/products/${id}/toggle`, {});
    },
    onSuccess: () => {
      toast({ title: "Status updated", description: "Product status has been toggled" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to toggle product status", variant: "destructive" });
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

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      type: product.type as ProductFormData["type"],
      packptsGrant: product.packptsGrant,
      entitlementKey: product.entitlementKey,
      durationDays: product.durationDays,
      priceUsd: product.priceUsd || 0,
      stripePriceId: product.metadata?.stripePriceId || "",
      isActive: product.isActive,
    });
    setShowDialog(true);
  };

  const handleTypeChange = (newType: ProductFormData["type"]) => {
    if (newType === "CONSUMABLE") {
      setFormData({ 
        ...formData, 
        type: newType, 
        packptsGrant: formData.packptsGrant || 1000,
        entitlementKey: null,
        durationDays: null,
      });
    } else if (newType === "ENTITLEMENT") {
      setFormData({ 
        ...formData, 
        type: newType, 
        packptsGrant: null,
        entitlementKey: formData.entitlementKey || "",
        durationDays: null,
      });
    } else if (newType === "SUBSCRIPTION") {
      setFormData({ 
        ...formData, 
        type: newType, 
        packptsGrant: null,
        entitlementKey: formData.entitlementKey || "",
        durationDays: formData.durationDays || 30,
      });
    }
  };

  const handleSubmit = () => {
    if (!formData.sku || !formData.name || !formData.priceUsd) {
      toast({ title: "Error", description: "Please fill in SKU, Name, and Price", variant: "destructive" });
      return;
    }
    if (formData.type === "CONSUMABLE" && (!formData.packptsGrant || formData.packptsGrant <= 0)) {
      toast({ title: "Error", description: "PackPTS amount is required for consumable products", variant: "destructive" });
      return;
    }
    if (formData.type === "ENTITLEMENT" && !formData.entitlementKey) {
      toast({ title: "Error", description: "Entitlement key is required for entitlement products", variant: "destructive" });
      return;
    }
    if (formData.type === "SUBSCRIPTION" && (!formData.entitlementKey || !formData.durationDays)) {
      toast({ title: "Error", description: "Entitlement key and duration are required for subscriptions", variant: "destructive" });
      return;
    }
    
    const submitData = {
      ...formData,
      packptsGrant: formData.type === "CONSUMABLE" ? formData.packptsGrant : null,
      entitlementKey: formData.type !== "CONSUMABLE" ? formData.entitlementKey : null,
      durationDays: formData.type === "SUBSCRIPTION" ? formData.durationDays : null,
    };

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

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
        Failed to load products. Please ensure you have admin access.
      </div>
    );
  }

  const allProducts = data?.products || [];
  const packptsProducts = allProducts.filter(p => p.type === "CONSUMABLE" && p.packptsGrant);
  const otherProducts = allProducts.filter(p => p.type !== "CONSUMABLE" || !p.packptsGrant);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-products-title">Store Products</h1>
          <p className="text-muted-foreground">Manage PackPTS bundles and other purchasable products</p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-product">
          <Plus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            PackPTS Bundles
          </CardTitle>
          <CardDescription>
            These are the PackPTS packages users can purchase in the Store
          </CardDescription>
        </CardHeader>
        <CardContent>
          {packptsProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">PackPTS</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Stripe Price ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packptsProducts.map((product) => (
                    <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                      <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Zap className="h-4 w-4 text-yellow-500" />
                          <span className="font-mono">{product.packptsGrant?.toLocaleString()}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DollarSign className="h-4 w-4 text-green-500" />
                          <span className="font-mono">${((product.priceUsd || 0) / 100).toFixed(2)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {product.metadata?.stripePriceId || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.isActive ? "default" : "secondary"}>
                          {product.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(product.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEdit(product)}
                            data-testid={`button-edit-${product.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => toggleMutation.mutate(product.id)}
                            disabled={toggleMutation.isPending}
                            data-testid={`button-toggle-${product.id}`}
                          >
                            {product.isActive ? (
                              <PowerOff className="h-4 w-4 text-destructive" />
                            ) : (
                              <Power className="h-4 w-4 text-green-500" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No PackPTS bundles yet. Create one to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {otherProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Other Products
            </CardTitle>
            <CardDescription>
              Entitlements, subscriptions, and other product types
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{product.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${((product.priceUsd || 0) / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.isActive ? "default" : "secondary"}>
                          {product.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEdit(product)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => toggleMutation.mutate(product.id)}
                            disabled={toggleMutation.isPending}
                          >
                            {product.isActive ? (
                              <PowerOff className="h-4 w-4 text-destructive" />
                            ) : (
                              <Power className="h-4 w-4 text-green-500" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg" data-testid="dialog-product-form">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Product" : "Create Product"}</DialogTitle>
            <DialogDescription>
              {editingProduct 
                ? "Update the product details below" 
                : "Create a new product for the store"
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU *</Label>
                <Input
                  id="sku"
                  placeholder="packpts_1500"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  disabled={!!editingProduct}
                  data-testid="input-sku"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type *</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: ProductFormData["type"]) => handleTypeChange(value)}
                  disabled={!!editingProduct}
                >
                  <SelectTrigger data-testid="select-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONSUMABLE">Consumable (PackPTS)</SelectItem>
                    <SelectItem value="ENTITLEMENT">Entitlement</SelectItem>
                    <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="1,500 PackPTS Bundle"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-name"
              />
            </div>

            {formData.type === "CONSUMABLE" && (
              <div className="space-y-2">
                <Label htmlFor="packptsGrant">PackPTS Amount *</Label>
                <Input
                  id="packptsGrant"
                  type="number"
                  placeholder="1500"
                  value={formData.packptsGrant || ""}
                  onChange={(e) => setFormData({ ...formData, packptsGrant: parseInt(e.target.value) || null })}
                  data-testid="input-packpts-grant"
                />
              </div>
            )}

            {formData.type === "ENTITLEMENT" && (
              <div className="space-y-2">
                <Label htmlFor="entitlementKey">Entitlement Key</Label>
                <Input
                  id="entitlementKey"
                  placeholder="pro_tier"
                  value={formData.entitlementKey || ""}
                  onChange={(e) => setFormData({ ...formData, entitlementKey: e.target.value || null })}
                />
              </div>
            )}

            {formData.type === "SUBSCRIPTION" && (
              <div className="space-y-2">
                <Label htmlFor="durationDays">Duration (days)</Label>
                <Input
                  id="durationDays"
                  type="number"
                  placeholder="30"
                  value={formData.durationDays || ""}
                  onChange={(e) => setFormData({ ...formData, durationDays: parseInt(e.target.value) || null })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priceUsd">Price (cents) *</Label>
                <Input
                  id="priceUsd"
                  type="number"
                  placeholder="299"
                  value={formData.priceUsd}
                  onChange={(e) => setFormData({ ...formData, priceUsd: parseInt(e.target.value) || 0 })}
                  data-testid="input-price"
                />
                <p className="text-xs text-muted-foreground">
                  = ${(formData.priceUsd / 100).toFixed(2)} USD
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stripePriceId">Stripe Price ID</Label>
                <Input
                  id="stripePriceId"
                  placeholder="price_xxxxx"
                  value={formData.stripePriceId}
                  onChange={(e) => setFormData({ ...formData, stripePriceId: e.target.value })}
                  data-testid="input-stripe-price-id"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Product is visible in store</p>
              </div>
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                data-testid="switch-active"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : editingProduct ? "Update Product" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
