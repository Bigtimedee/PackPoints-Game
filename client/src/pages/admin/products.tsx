import { useState, useEffect, useRef, useCallback } from "react";
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
  Package,
  DollarSign,
  Zap,
  Power,
  PowerOff,
  ArrowLeftRight,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Info,
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
  stripePriceId: string | null;
  description: string | null;
  sortOrder: number | null;
  isBestValue: boolean | null;
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
  description: string;
  sortOrder: number;
  isBestValue: boolean;
  isActive: boolean;
}

type DriverMode = "USD" | "PACKPTS";
type RatioMode = "AUTO" | "OVERRIDE";

interface BundlePreviewResult {
  resolved: {
    usdPriceCents: number;
    packptsAmount: number;
    ratios: {
      usdPerPackpt: number;
      packptsPerUsd: number;
      usdPerPackptMicro: number;
    };
    ratioMode: string;
  };
  guardrails: {
    decision: "PASS" | "WARN" | "BLOCK";
    reasons: string[];
    computed: {
      netRevenueCents: number;
      grossMarginRate: number;
      effectiveValuePerPtMicrousd: number;
    };
  };
}

const defaultFormData: ProductFormData = {
  sku: "",
  name: "",
  type: "CONSUMABLE",
  packptsGrant: 1000,
  entitlementKey: null,
  durationDays: null,
  priceUsd: 0,
  stripePriceId: "",
  description: "",
  sortOrder: 0,
  isBestValue: false,
  isActive: true,
};

export default function AdminProducts() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);

  const [driver, setDriver] = useState<DriverMode>("PACKPTS");
  const [ratioMode, setRatioMode] = useState<RatioMode>("AUTO");
  const [overrideRatioMicro, setOverrideRatioMicro] = useState<number>(0);
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<BundlePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [overrideGuardrails, setOverrideGuardrails] = useState(false);
  const [overrideGuardrailsReason, setOverrideGuardrailsReason] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/admin/products"],
    queryFn: async () => {
      const res = await fetch("/api/admin/products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json();
    },
  });

  const fetchPreview = useCallback(async (
    priceCents: number,
    packpts: number,
    currentDriver: DriverMode,
    currentRatioMode: RatioMode,
    currentOverrideMicro: number,
  ) => {
    if (currentDriver === "USD" && priceCents <= 0) return;
    if (currentDriver === "PACKPTS" && packpts <= 0) return;

    setPreviewLoading(true);
    try {
      const body: Record<string, any> = {
        driver: currentDriver,
        ratioMode: currentRatioMode,
      };
      if (currentDriver === "USD") {
        body.usdPriceCents = priceCents;
      } else {
        body.packptsAmount = packpts;
      }
      if (currentRatioMode === "OVERRIDE" && currentOverrideMicro > 0) {
        body.overrideRatioUsdPerPackptMicro = currentOverrideMicro;
      }

      const res = await fetch("/api/admin/store/bundles/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Preview failed");
      const result: BundlePreviewResult = await res.json();
      setPreview(result);

      setFormData(prev => ({
        ...prev,
        priceUsd: result.resolved.usdPriceCents,
        packptsGrant: result.resolved.packptsAmount,
      }));
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const debouncedPreview = useCallback((
    priceCents: number,
    packpts: number,
    currentDriver: DriverMode,
    currentRatioMode: RatioMode,
    currentOverrideMicro: number,
  ) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      fetchPreview(priceCents, packpts, currentDriver, currentRatioMode, currentOverrideMicro);
    }, 300);
  }, [fetchPreview]);

  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  const handlePackptsChange = (value: string) => {
    const pts = parseInt(value) || 0;
    setFormData(prev => ({ ...prev, packptsGrant: pts || null }));
    if (formData.type === "CONSUMABLE" && driver === "PACKPTS" && pts > 0) {
      debouncedPreview(formData.priceUsd, pts, "PACKPTS", ratioMode, overrideRatioMicro);
    }
  };

  const handlePriceChange = (value: string) => {
    const cents = parseInt(value) || 0;
    setFormData(prev => ({ ...prev, priceUsd: cents }));
    if (formData.type === "CONSUMABLE" && driver === "USD" && cents > 0) {
      debouncedPreview(cents, formData.packptsGrant || 0, "USD", ratioMode, overrideRatioMicro);
    }
  };

  const toggleDriver = () => {
    const newDriver = driver === "USD" ? "PACKPTS" : "USD";
    setDriver(newDriver);
    const pts = formData.packptsGrant || 0;
    const cents = formData.priceUsd || 0;
    if ((newDriver === "PACKPTS" && pts > 0) || (newDriver === "USD" && cents > 0)) {
      debouncedPreview(cents, pts, newDriver, ratioMode, overrideRatioMicro);
    }
  };

  const handleRatioModeChange = (mode: RatioMode) => {
    setRatioMode(mode);
    if (mode === "AUTO") {
      setOverrideReason("");
      setOverrideRatioMicro(0);
    }
    const pts = formData.packptsGrant || 0;
    const cents = formData.priceUsd || 0;
    if (formData.type === "CONSUMABLE") {
      if ((driver === "PACKPTS" && pts > 0) || (driver === "USD" && cents > 0)) {
        debouncedPreview(cents, pts, driver, mode, mode === "AUTO" ? 0 : overrideRatioMicro);
      }
    }
  };

  const handleOverrideRatioChange = (value: string) => {
    const micro = parseInt(value) || 0;
    setOverrideRatioMicro(micro);
    const pts = formData.packptsGrant || 0;
    const cents = formData.priceUsd || 0;
    if (formData.type === "CONSUMABLE" && micro > 0) {
      if ((driver === "PACKPTS" && pts > 0) || (driver === "USD" && cents > 0)) {
        debouncedPreview(cents, pts, driver, "OVERRIDE", micro);
      }
    }
  };

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
    setDriver("PACKPTS");
    setRatioMode("AUTO");
    setOverrideRatioMicro(0);
    setOverrideReason("");
    setPreview(null);
    setOverrideGuardrails(false);
    setOverrideGuardrailsReason("");
    setShowConfirmDialog(false);
  };

  const openCreate = () => {
    setFormData(defaultFormData);
    setEditingProduct(null);
    setDriver("PACKPTS");
    setRatioMode("AUTO");
    setOverrideRatioMicro(0);
    setOverrideReason("");
    setPreview(null);
    setOverrideGuardrails(false);
    setOverrideGuardrailsReason("");
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
      stripePriceId: product.stripePriceId || product.metadata?.stripePriceId || "",
      description: product.description || "",
      sortOrder: product.sortOrder ?? 0,
      isBestValue: product.isBestValue ?? false,
      isActive: product.isActive,
    });
    setDriver("PACKPTS");
    setRatioMode("AUTO");
    setOverrideRatioMicro(0);
    setOverrideReason("");
    setPreview(null);
    setOverrideGuardrails(false);
    setOverrideGuardrailsReason("");
    setShowDialog(true);

    if (product.type === "CONSUMABLE" && product.packptsGrant && product.packptsGrant > 0) {
      fetchPreview(product.priceUsd || 0, product.packptsGrant, "PACKPTS", "AUTO", 0);
    }
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
      setPreview(null);
    } else if (newType === "SUBSCRIPTION") {
      setFormData({ 
        ...formData, 
        type: newType, 
        packptsGrant: null,
        entitlementKey: formData.entitlementKey || "",
        durationDays: formData.durationDays || 30,
      });
      setPreview(null);
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

    if (formData.type === "CONSUMABLE" && preview?.guardrails.decision === "WARN") {
      setShowConfirmDialog(true);
      return;
    }

    if (formData.type === "CONSUMABLE" && preview?.guardrails.decision === "BLOCK" && !overrideGuardrails) {
      toast({ title: "Blocked", description: "This product is blocked by guardrails. Enable override to continue.", variant: "destructive" });
      return;
    }

    doSubmit();
  };

  const doSubmit = () => {
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

  const handleConfirmSubmit = () => {
    setShowConfirmDialog(false);
    doSubmit();
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

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

  const isConsumable = formData.type === "CONSUMABLE";
  const isMutating = createMutation.isPending || updateMutation.isPending;

  const guardrailIcon = preview?.guardrails.decision === "PASS" 
    ? <ShieldCheck className="h-4 w-4 text-green-500" />
    : preview?.guardrails.decision === "WARN"
    ? <ShieldAlert className="h-4 w-4 text-yellow-500" />
    : preview?.guardrails.decision === "BLOCK"
    ? <ShieldX className="h-4 w-4 text-red-500" />
    : null;

  const guardrailBadgeVariant = preview?.guardrails.decision === "PASS" 
    ? "default" as const
    : preview?.guardrails.decision === "WARN"
    ? "secondary" as const
    : "destructive" as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
                          {product.stripePriceId || product.metadata?.stripePriceId || "-"}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-product-form">
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

            {isConsumable && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {driver === "PACKPTS" 
                        ? "Enter PackPTS, price auto-calculates" 
                        : "Enter Price, PackPTS auto-calculates"}
                    </span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={toggleDriver}
                    data-testid="button-toggle-driver"
                  >
                    <ArrowLeftRight className="h-3 w-3 mr-1" />
                    {driver === "PACKPTS" ? "PTS drives" : "USD drives"}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="packptsGrant">
                      PackPTS Amount *
                      {driver === "PACKPTS" && (
                        <Badge variant="outline" className="ml-2 text-xs">driver</Badge>
                      )}
                    </Label>
                    <Input
                      id="packptsGrant"
                      type="number"
                      placeholder="1500"
                      value={formData.packptsGrant || ""}
                      onChange={(e) => handlePackptsChange(e.target.value)}
                      className={driver === "PACKPTS" ? "border-primary" : ""}
                      data-testid="input-packpts-grant"
                    />
                    {driver === "USD" && preview && (
                      <p className="text-xs text-muted-foreground">
                        auto-calculated
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priceUsd">
                      Price (cents) *
                      {driver === "USD" && (
                        <Badge variant="outline" className="ml-2 text-xs">driver</Badge>
                      )}
                    </Label>
                    <Input
                      id="priceUsd"
                      type="number"
                      placeholder="299"
                      value={formData.priceUsd || ""}
                      onChange={(e) => handlePriceChange(e.target.value)}
                      className={driver === "USD" ? "border-primary" : ""}
                      data-testid="input-price"
                    />
                    <p className="text-xs text-muted-foreground">
                      = ${(formData.priceUsd / 100).toFixed(2)} USD
                      {driver === "PACKPTS" && preview && " (auto-calculated)"}
                    </p>
                  </div>
                </div>

                {preview && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {guardrailIcon}
                        <Badge variant={guardrailBadgeVariant} data-testid="badge-guardrails-status">
                          {preview.guardrails.decision}
                        </Badge>
                        {previewLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Margin: {formatPercent(preview.guardrails.computed.grossMarginRate)}</span>
                        <span>Net: {formatCents(preview.guardrails.computed.netRevenueCents)}</span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Ratio: ${preview.resolved.ratios.usdPerPackpt.toFixed(4)}/pt
                      ({preview.resolved.ratios.packptsPerUsd.toFixed(1)} pts/$)
                    </div>

                    {preview.guardrails.reasons.length > 0 && (
                      <div className={`p-3 rounded-md border text-sm ${
                        preview.guardrails.decision === "WARN" 
                          ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                          : preview.guardrails.decision === "BLOCK"
                          ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                          : ""
                      }`}>
                        <ul className="list-disc list-inside space-y-1">
                          {preview.guardrails.reasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {preview.guardrails.decision === "BLOCK" && (
                      <div className="space-y-2 p-3 rounded-md border border-red-200 dark:border-red-800">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={overrideGuardrails}
                            onCheckedChange={setOverrideGuardrails}
                            data-testid="switch-override-guardrails"
                          />
                          <Label className="text-sm">Override block</Label>
                        </div>
                        {overrideGuardrails && (
                          <div className="space-y-1">
                            <Textarea
                              placeholder="Explain why this override is justified (min 10 chars)..."
                              value={overrideGuardrailsReason}
                              onChange={(e) => setOverrideGuardrailsReason(e.target.value)}
                              className="text-sm"
                              data-testid="input-override-guardrails-reason"
                            />
                            <p className="text-xs text-muted-foreground">
                              {overrideGuardrailsReason.length}/10 characters minimum
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Ratio Mode</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={ratioMode === "AUTO" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleRatioModeChange("AUTO")}
                      data-testid="button-ratio-auto"
                    >
                      Auto
                    </Button>
                    <Button
                      variant={ratioMode === "OVERRIDE" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleRatioModeChange("OVERRIDE")}
                      data-testid="button-ratio-override"
                    >
                      Override
                    </Button>
                  </div>
                  {ratioMode === "OVERRIDE" && (
                    <div className="space-y-2 mt-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Custom ratio (micro USD per PackPT)</Label>
                        <Input
                          type="number"
                          placeholder="2000"
                          value={overrideRatioMicro || ""}
                          onChange={(e) => handleOverrideRatioChange(e.target.value)}
                          data-testid="input-override-ratio"
                        />
                        {overrideRatioMicro > 0 && (
                          <p className="text-xs text-muted-foreground">
                            = ${(overrideRatioMicro / 1000000).toFixed(6)}/pt
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Override reason (min 10 chars)</Label>
                        <Textarea
                          placeholder="Justify the custom ratio..."
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          className="text-sm"
                          data-testid="input-override-reason"
                        />
                        <p className="text-xs text-muted-foreground">
                          {overrideReason.length}/10 characters minimum
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
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

            {!isConsumable && (
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
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Store Description</Label>
              <Input
                id="description"
                placeholder="Short description shown in store"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                data-testid="input-description"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  placeholder="0"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  data-testid="input-sort-order"
                />
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
              <div className="flex items-end gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.isBestValue}
                    onCheckedChange={(checked) => setFormData({ ...formData, isBestValue: checked })}
                    data-testid="switch-best-value"
                  />
                  <Label className="text-xs">Best Value</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.isActive}
                    onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                    data-testid="switch-active"
                  />
                  <Label className="text-xs">Active</Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={
                isMutating ||
                (isConsumable && ratioMode === "OVERRIDE" && overrideReason.length < 10) ||
                (isConsumable && preview?.guardrails.decision === "BLOCK" && overrideGuardrails && overrideGuardrailsReason.length < 10)
              }
              data-testid="button-submit"
            >
              {isMutating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : editingProduct ? "Update Product" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent data-testid="dialog-confirm-warn">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Confirmation Required
            </DialogTitle>
            <DialogDescription>
              This product triggered margin warnings and requires confirmation.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {preview.guardrails.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Net Revenue:</span>
                  <span className="ml-2 font-medium">{formatCents(preview.guardrails.computed.netRevenueCents)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Gross Margin:</span>
                  <span className="ml-2 font-medium">{formatPercent(preview.guardrails.computed.grossMarginRate)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleConfirmSubmit} 
              disabled={isMutating}
              className="bg-yellow-600"
              data-testid="button-confirm-create"
            >
              {isMutating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingProduct ? "Confirm & Update" : "Confirm & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
