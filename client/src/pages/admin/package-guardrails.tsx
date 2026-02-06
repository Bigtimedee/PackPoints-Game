import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Calculator,
  AlertTriangle,
  XCircle,
  CheckCircle,
  ShieldAlert,
  Settings,
  DollarSign,
  TrendingUp,
  Percent,
  RefreshCw,
  Package,
  ArrowRightLeft,
  Pencil
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type SalesChannel = "web_stripe" | "ios_iap" | "android_iap";
type PackageDecision = "PASS" | "WARN" | "BLOCK" | "OVERRIDE";
type DriverMode = "USD" | "PACKPTS";
type RatioMode = "AUTO" | "OVERRIDE";

interface ComputedMetrics {
  priceCents: number;
  ptsGrant: number;
  channel: SalesChannel;
  feeRate: number;
  feeFixedCents: number;
  platformFeeRate: number;
  processorFeeCents: number;
  platformFeeCents: number;
  totalFeesCents: number;
  netRevenueCents: number;
  totalRedemptionCostCents: number;
  grossMarginRate: number;
  impliedValuePerPtMicrousd: number;
  marginContributionCents: number;
}

interface EvaluationResult {
  decision: PackageDecision;
  reasons: string[];
  computed: ComputedMetrics;
  policy: {
    minMarginRate: number;
    warnMarginBand: number;
    maxValuePerPtMicrousd: number;
    allowOverride: boolean;
    reserveRate: number;
  };
  feeProfile: {
    channel: SalesChannel;
    feeRate: number;
    feeFixedCents: number;
    platformFeeRate: number;
  };
}

interface FeeProfile {
  id: string;
  channel: SalesChannel;
  feeRate: number;
  feeFixedCents: number;
  platformFeeRate: number;
}

interface Policy {
  id: string;
  minMarginRate: number;
  warnMarginBand: number;
  maxValuePerPtMicrousd: number;
  allowOverride: boolean;
  reserveRate: number;
}

interface Config {
  policy: Policy | null;
  feeProfiles: FeeProfile[];
}

interface PackageFormData {
  sku: string;
  name: string;
  priceCents: number;
  ptsGrant: number;
  channel: SalesChannel;
}

interface BundleFormData {
  sku: string;
  name: string;
  usdPriceCents: number;
  packptsAmount: number;
  channel: SalesChannel;
  driver: DriverMode;
  ratioMode: RatioMode;
  overrideRatioUsdPerPackptMicro: number;
  overrideReason: string;
  overrideGuardrails: boolean;
  overrideGuardrailsReason: string;
}

interface BundlePreviewResult {
  resolved: {
    usdPriceCents: number;
    packptsAmount: number;
    ratios: { usdPerPackptMicro: number; packptPerUsdMicro: number };
    ratioMode: RatioMode;
  };
  guardrails: EvaluationResult;
}

interface BundleListItem {
  id: string;
  sku: string;
  name: string;
  usdPriceCents: number;
  packptsAmount: number;
  channel: string;
  ratioUsdPerPackptMicro: number;
  ratioPackptPerUsdMicro: number;
  ratioMode: string;
  guardrailsStatus: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const channelLabels: Record<SalesChannel, string> = {
  web_stripe: "Web (Stripe)",
  ios_iap: "iOS In-App Purchase",
  android_iap: "Android In-App Purchase",
};

function DecisionBadge({ decision }: { decision: PackageDecision }) {
  switch (decision) {
    case "PASS":
      return <Badge className="bg-green-600" data-testid="badge-decision-pass"><CheckCircle className="w-3 h-3 mr-1" />PASS</Badge>;
    case "WARN":
      return <Badge className="bg-yellow-600" data-testid="badge-decision-warn"><AlertTriangle className="w-3 h-3 mr-1" />WARN</Badge>;
    case "BLOCK":
      return <Badge className="bg-red-600" data-testid="badge-decision-block"><XCircle className="w-3 h-3 mr-1" />BLOCK</Badge>;
    case "OVERRIDE":
      return <Badge className="bg-purple-600" data-testid="badge-decision-override"><ShieldAlert className="w-3 h-3 mr-1" />OVERRIDE</Badge>;
    default:
      return <Badge>{decision}</Badge>;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatMicrousd(microusd: number): string {
  return `$${(microusd / 1000000).toFixed(6)}`;
}

function formatRatioUsdPerPt(microusd: number): string {
  return `$${(microusd / 1000000).toFixed(4)}/pt`;
}

function formatRatioPtsPerUsd(microusd: number): string {
  const ptsPerDollar = microusd / 1000000;
  return `${ptsPerDollar.toFixed(0)} pts/$1`;
}

export default function AdminPackageGuardrails() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("calculator");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingEvaluation, setPendingEvaluation] = useState<EvaluationResult | null>(null);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);

  const [formData, setFormData] = useState<PackageFormData>({
    sku: "",
    name: "",
    priceCents: 999,
    ptsGrant: 6000,
    channel: "web_stripe",
  });

  const [bundleForm, setBundleForm] = useState<BundleFormData>({
    sku: "",
    name: "",
    usdPriceCents: 999,
    packptsAmount: 6000,
    channel: "web_stripe",
    driver: "USD",
    ratioMode: "AUTO",
    overrideRatioUsdPerPackptMicro: 2000,
    overrideReason: "",
    overrideGuardrails: false,
    overrideGuardrailsReason: "",
  });

  const [calcPriceCents, setCalcPriceCents] = useState(999);
  const [calcPtsGrant, setCalcPtsGrant] = useState(6000);
  const [calcChannel, setCalcChannel] = useState<SalesChannel>("web_stripe");

  const { data: config, isLoading: configLoading } = useQuery<Config>({
    queryKey: ["/api/admin/store/packages/config"],
    queryFn: async () => {
      const res = await fetch("/api/admin/store/packages/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const { data: bundlesList, isLoading: bundlesLoading } = useQuery<BundleListItem[]>({
    queryKey: ["/api/admin/store/bundles"],
    queryFn: async () => {
      const res = await fetch("/api/admin/store/bundles", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch bundles");
      const data = await res.json();
      return data.bundles || [];
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (data: { priceCents: number; ptsGrant: number; channel: SalesChannel }) => {
      const res = await apiRequest("POST", "/api/admin/store/packages/preview", data);
      return res.json();
    },
  });

  const bundlePreviewMutation = useMutation({
    mutationFn: async (data: { channel: SalesChannel; usdPriceCents: number; packptsAmount: number; driver: DriverMode; ratioMode: RatioMode; overrideRatioUsdPerPackptMicro: number }) => {
      const res = await apiRequest("POST", "/api/admin/store/bundles/preview", data);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: PackageFormData & { confirm?: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/store/packages", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Package created", description: "The PackPTS package has been created successfully." });
      setShowCreateDialog(false);
      setShowConfirmDialog(false);
      setPendingEvaluation(null);
      setFormData({ sku: "", name: "", priceCents: 999, ptsGrant: 6000, channel: "web_stripe" });
    },
    onError: async (error: any) => {
      if (error.response) {
        const data = await error.response.json();
        if (data.error === "CONFIRMATION_REQUIRED") {
          setPendingEvaluation(data.evaluation);
          setShowConfirmDialog(true);
          return;
        }
        if (data.error === "PACKAGE_BLOCKED") {
          setPendingEvaluation(data.evaluation);
          toast({
            title: "Package Blocked",
            description: data.message,
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Error", description: data.message || "Failed to create package", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Failed to create package", variant: "destructive" });
      }
    },
  });

  const resetBundleForm = () => {
    setBundleForm({
      sku: "",
      name: "",
      usdPriceCents: 999,
      packptsAmount: 6000,
      channel: "web_stripe",
      driver: "USD",
      ratioMode: "AUTO",
      overrideRatioUsdPerPackptMicro: 2000,
      overrideReason: "",
      overrideGuardrails: false,
      overrideGuardrailsReason: "",
    });
  };

  const handleBundleMutationError = (error: any) => {
    const msg = error?.message || "";
    const colonIdx = msg.indexOf(": ");
    if (colonIdx > 0) {
      try {
        const jsonStr = msg.substring(colonIdx + 2);
        const parsed = JSON.parse(jsonStr);
        if (parsed.error === "CONFIRMATION_REQUIRED") {
          setPendingEvaluation(parsed.evaluation);
          setShowConfirmDialog(true);
          return;
        }
        if (parsed.error === "PACKAGE_BLOCKED") {
          setPendingEvaluation(parsed.evaluation);
          toast({
            title: "Bundle Blocked",
            description: parsed.message || "This bundle is blocked by guardrails. Enable override in the form to proceed.",
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Error", description: parsed.message || parsed.error || "Failed to save bundle", variant: "destructive" });
        return;
      } catch {}
    }
    toast({ title: "Error", description: "Failed to save bundle", variant: "destructive" });
  };

  const createBundleMutation = useMutation({
    mutationFn: async (data: BundleFormData & { confirm?: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/store/bundles", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bundle created", description: "The PackPTS bundle has been created successfully." });
      setShowCreateDialog(false);
      setShowConfirmDialog(false);
      setPendingEvaluation(null);
      setEditingBundleId(null);
      resetBundleForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/store/bundles"] });
    },
    onError: handleBundleMutationError,
  });

  const updateBundleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: BundleFormData & { confirm?: boolean } }) => {
      const res = await apiRequest("PUT", `/api/admin/store/bundles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bundle updated", description: "The PackPTS bundle has been updated successfully." });
      setShowCreateDialog(false);
      setShowConfirmDialog(false);
      setPendingEvaluation(null);
      setEditingBundleId(null);
      resetBundleForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/store/bundles"] });
    },
    onError: handleBundleMutationError,
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async (data: Partial<Policy>) => {
      return apiRequest("PUT", "/api/admin/store/packages/policy", data);
    },
    onSuccess: () => {
      toast({ title: "Policy updated", description: "The package policy has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/store/packages/config"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update policy", variant: "destructive" });
    },
  });

  const updateFeeProfileMutation = useMutation({
    mutationFn: async ({ channel, data }: { channel: SalesChannel; data: Partial<FeeProfile> }) => {
      return apiRequest("PUT", `/api/admin/store/packages/fee-profile/${channel}`, data);
    },
    onSuccess: () => {
      toast({ title: "Fee profile updated", description: "The fee profile has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/store/packages/config"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update fee profile", variant: "destructive" });
    },
  });

  const runPreview = useCallback(() => {
    if (calcPriceCents > 0 && calcPtsGrant > 0) {
      previewMutation.mutate({
        priceCents: calcPriceCents,
        ptsGrant: calcPtsGrant,
        channel: calcChannel,
      });
    }
  }, [calcPriceCents, calcPtsGrant, calcChannel]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      runPreview();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [calcPriceCents, calcPtsGrant, calcChannel]);

  const lastPreviewRef = useRef<string>("");
  useEffect(() => {
    if (!showCreateDialog) return;
    const driverValue = bundleForm.driver === "USD" ? bundleForm.usdPriceCents : bundleForm.packptsAmount;
    if (driverValue <= 0) return;
    const key = `${bundleForm.channel}-${bundleForm.usdPriceCents}-${bundleForm.packptsAmount}-${bundleForm.driver}-${bundleForm.ratioMode}-${bundleForm.overrideRatioUsdPerPackptMicro}`;
    if (key === lastPreviewRef.current) return;
    const timeoutId = setTimeout(() => {
      lastPreviewRef.current = key;
      bundlePreviewMutation.mutate({
        channel: bundleForm.channel,
        usdPriceCents: bundleForm.usdPriceCents,
        packptsAmount: bundleForm.packptsAmount,
        driver: bundleForm.driver,
        ratioMode: bundleForm.ratioMode,
        overrideRatioUsdPerPackptMicro: bundleForm.overrideRatioUsdPerPackptMicro,
      }, {
        onSuccess: (result: BundlePreviewResult) => {
          if (result.resolved) {
            setBundleForm(prev => ({
              ...prev,
              usdPriceCents: result.resolved.usdPriceCents,
              packptsAmount: result.resolved.packptsAmount,
            }));
          }
        },
      });
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [showCreateDialog, bundleForm.channel, bundleForm.usdPriceCents, bundleForm.packptsAmount, bundleForm.driver, bundleForm.ratioMode, bundleForm.overrideRatioUsdPerPackptMicro]);

  const handleCreateSubmit = () => {
    createMutation.mutate(formData);
  };

  const handleConfirmSubmit = () => {
    createMutation.mutate({ ...formData, confirm: true });
  };

  const handleBundleSubmit = () => {
    if (editingBundleId) {
      updateBundleMutation.mutate({ id: editingBundleId, data: bundleForm });
    } else {
      createBundleMutation.mutate(bundleForm);
    }
  };

  const handleBundleConfirmSubmit = () => {
    if (editingBundleId) {
      updateBundleMutation.mutate({ id: editingBundleId, data: { ...bundleForm, confirm: true } });
    } else {
      createBundleMutation.mutate({ ...bundleForm, confirm: true });
    }
  };

  const openBundleEditor = (bundle?: BundleListItem) => {
    if (bundle) {
      setEditingBundleId(bundle.id);
      setBundleForm({
        sku: bundle.sku,
        name: bundle.name,
        usdPriceCents: bundle.usdPriceCents,
        packptsAmount: bundle.packptsAmount,
        channel: bundle.channel as SalesChannel,
        driver: "USD",
        ratioMode: bundle.ratioMode as RatioMode,
        overrideRatioUsdPerPackptMicro: bundle.ratioUsdPerPackptMicro,
        overrideReason: "",
        overrideGuardrails: false,
        overrideGuardrailsReason: "",
      });
    } else {
      setEditingBundleId(null);
      setBundleForm({
        sku: "",
        name: "",
        usdPriceCents: 999,
        packptsAmount: 6000,
        channel: "web_stripe",
        driver: "USD",
        ratioMode: "AUTO",
        overrideRatioUsdPerPackptMicro: 2000,
        overrideReason: "",
        overrideGuardrails: false,
        overrideGuardrailsReason: "",
      });
    }
    setShowCreateDialog(true);
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const evaluation = previewMutation.data as EvaluationResult | undefined;
  const bundlePreview = bundlePreviewMutation.data as BundlePreviewResult | undefined;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">PackPTS Package Guardrails</h1>
          <p className="text-muted-foreground">Validate package profitability before creation</p>
        </div>
        <Button onClick={() => openBundleEditor()} data-testid="button-create-package">
          <Plus className="w-4 h-4 mr-2" />
          Create Bundle
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="calculator" data-testid="tab-calculator">
            <Calculator className="w-4 h-4 mr-2" />
            Profit Calculator
          </TabsTrigger>
          <TabsTrigger value="policy" data-testid="tab-policy">
            <Settings className="w-4 h-4 mr-2" />
            Policy Settings
          </TabsTrigger>
          <TabsTrigger value="fees" data-testid="tab-fees">
            <DollarSign className="w-4 h-4 mr-2" />
            Fee Profiles
          </TabsTrigger>
          <TabsTrigger value="bundles" data-testid="tab-bundles">
            <Package className="w-4 h-4 mr-2" />
            Bundles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calculator" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Package Parameters</CardTitle>
                <CardDescription>Enter price and points to calculate profitability</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Price (USD)</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={(calcPriceCents / 100).toFixed(2)}
                      onChange={(e) => setCalcPriceCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                      data-testid="input-calc-price"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>PackPTS Granted</Label>
                  <Input
                    type="number"
                    value={calcPtsGrant}
                    onChange={(e) => setCalcPtsGrant(parseInt(e.target.value) || 0)}
                    data-testid="input-calc-pts"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Sales Channel</Label>
                  <Select value={calcChannel} onValueChange={(v) => setCalcChannel(v as SalesChannel)}>
                    <SelectTrigger data-testid="select-calc-channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="web_stripe">Web (Stripe)</SelectItem>
                      <SelectItem value="ios_iap">iOS In-App Purchase</SelectItem>
                      <SelectItem value="android_iap">Android In-App Purchase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  onClick={runPreview} 
                  variant="outline" 
                  className="w-full"
                  disabled={previewMutation.isPending}
                  data-testid="button-refresh-preview"
                >
                  {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Refresh Preview
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                  Profit Analysis
                  {evaluation && <DecisionBadge decision={evaluation.decision} />}
                </CardTitle>
                <CardDescription>
                  {evaluation ? (
                    <span>{evaluation.reasons.join("; ")}</span>
                  ) : (
                    "Enter values to see analysis"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {previewMutation.isPending ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : evaluation ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-sm text-muted-foreground">Gross Revenue</div>
                        <div className="text-lg font-semibold" data-testid="text-gross-revenue">
                          {formatCents(evaluation.computed.priceCents)}
                        </div>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-sm text-muted-foreground">Total Fees</div>
                        <div className="text-lg font-semibold text-red-600" data-testid="text-total-fees">
                          -{formatCents(evaluation.computed.totalFeesCents)}
                        </div>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-sm text-muted-foreground">Net Revenue</div>
                        <div className="text-lg font-semibold text-green-600" data-testid="text-net-revenue">
                          {formatCents(evaluation.computed.netRevenueCents)}
                        </div>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-sm text-muted-foreground">Gross Margin</div>
                        <div className={`text-lg font-semibold ${evaluation.computed.grossMarginRate >= evaluation.policy.minMarginRate ? "text-green-600" : "text-red-600"}`} data-testid="text-gross-margin">
                          {formatPercent(evaluation.computed.grossMarginRate)}
                        </div>
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Processor Fee ({formatPercent(evaluation.computed.feeRate)} + {formatCents(evaluation.computed.feeFixedCents)})</span>
                        <span>{formatCents(evaluation.computed.processorFeeCents)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Platform Fee ({formatPercent(evaluation.computed.platformFeeRate)})</span>
                        <span>{formatCents(evaluation.computed.platformFeeCents)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Redemption Liability ({evaluation.computed.ptsGrant} pts)</span>
                        <span className="text-orange-600" data-testid="text-redemption-cost">-{formatCents(evaluation.computed.totalRedemptionCostCents)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Implied Value per PackPTS</span>
                        <span data-testid="text-implied-value">{formatMicrousd(evaluation.computed.impliedValuePerPtMicrousd)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Margin Contribution</span>
                        <span className="text-green-600">{formatCents(evaluation.computed.marginContributionCents)}</span>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <div className="text-sm text-muted-foreground mb-2">Policy Requirements</div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline">
                          Min Margin: {formatPercent(evaluation.policy.minMarginRate)}
                        </Badge>
                        <Badge variant="outline">
                          Warn Band: +{formatPercent(evaluation.policy.warnMarginBand)}
                        </Badge>
                        <Badge variant="outline">
                          Max Value/pt: {formatMicrousd(evaluation.policy.maxValuePerPtMicrousd)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground">
                    Enter package values to see profit analysis
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="policy" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Package Validation Policy</CardTitle>
              <CardDescription>Configure minimum margin and warning thresholds</CardDescription>
            </CardHeader>
            <CardContent>
              {config?.policy ? (
                <PolicyEditor policy={config.policy} onSave={(data) => updatePolicyMutation.mutate(data)} isPending={updatePolicyMutation.isPending} />
              ) : (
                <p className="text-muted-foreground">No active policy configured</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fees" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fee Profiles by Channel</CardTitle>
              <CardDescription>Configure payment processor and platform fees</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Processor Fee Rate</TableHead>
                    <TableHead>Fixed Fee</TableHead>
                    <TableHead>Platform Fee</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config?.feeProfiles.map((profile) => (
                    <FeeProfileRow 
                      key={profile.id} 
                      profile={profile} 
                      onSave={(data) => updateFeeProfileMutation.mutate({ channel: profile.channel, data })}
                      isPending={updateFeeProfileMutation.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bundles" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                Bundles
                <Button onClick={() => openBundleEditor()} data-testid="button-create-bundle-tab">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Bundle
                </Button>
              </CardTitle>
              <CardDescription>Manage PackPTS bundles with guardrails validation</CardDescription>
            </CardHeader>
            <CardContent>
              {bundlesLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : bundlesList && bundlesList.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>PackPTS</TableHead>
                      <TableHead>Ratio</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundlesList.map((bundle) => (
                      <TableRow key={bundle.id} data-testid={`row-bundle-${bundle.id}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-bundle-sku-${bundle.id}`}>{bundle.sku}</TableCell>
                        <TableCell data-testid={`text-bundle-name-${bundle.id}`}>{bundle.name}</TableCell>
                        <TableCell data-testid={`text-bundle-price-${bundle.id}`}>{formatCents(bundle.usdPriceCents)}</TableCell>
                        <TableCell data-testid={`text-bundle-packpts-${bundle.id}`}>{bundle.packptsAmount.toLocaleString()}</TableCell>
                        <TableCell data-testid={`text-bundle-ratio-${bundle.id}`}>
                          USD/PT: {formatRatioUsdPerPt(bundle.ratioUsdPerPackptMicro)}
                        </TableCell>
                        <TableCell>
                          <DecisionBadge decision={bundle.guardrailsStatus as PackageDecision} />
                        </TableCell>
                        <TableCell>{channelLabels[bundle.channel as SalesChannel] || bundle.channel}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(bundle.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openBundleEditor(bundle)}
                            data-testid={`button-edit-bundle-${bundle.id}`}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  No bundles created yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open);
        if (!open) {
          setEditingBundleId(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingBundleId ? "Edit Bundle" : "Create PackPTS Bundle"}</DialogTitle>
            <DialogDescription>
              {editingBundleId ? "Update bundle configuration with guardrails validation" : "Create a new bundle with automatic profit validation"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={bundleForm.sku}
                  onChange={(e) => setBundleForm({ ...bundleForm, sku: e.target.value })}
                  placeholder="PACKPTS_10000"
                  data-testid="input-bundle-sku"
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={bundleForm.name}
                  onChange={(e) => setBundleForm({ ...bundleForm, name: e.target.value })}
                  placeholder="10,000 PackPTS"
                  data-testid="input-bundle-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Driver Mode</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={bundleForm.driver === "USD" ? "default" : "outline"}
                  onClick={() => setBundleForm({ ...bundleForm, driver: "USD" })}
                  data-testid="button-driver-usd"
                  className="toggle-elevate"
                >
                  <DollarSign className="w-4 h-4 mr-1" />
                  USD
                </Button>
                <ArrowRightLeft className="w-4 h-4 self-center text-muted-foreground" />
                <Button
                  variant={bundleForm.driver === "PACKPTS" ? "default" : "outline"}
                  onClick={() => setBundleForm({ ...bundleForm, driver: "PACKPTS" })}
                  data-testid="button-driver-packpts"
                  className="toggle-elevate"
                >
                  <Package className="w-4 h-4 mr-1" />
                  PACKPTS
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>USD Price</Label>
                <div className={`flex items-center gap-2 ${bundleForm.driver !== "USD" ? "rounded-md bg-muted p-1" : ""}`}>
                  <span className="text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={(bundleForm.usdPriceCents / 100).toFixed(2)}
                    onChange={(e) => setBundleForm({ ...bundleForm, usdPriceCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                    disabled={bundleForm.driver !== "USD"}
                    data-testid="input-bundle-usd-price"
                  />
                </div>
                {bundleForm.driver !== "USD" && bundlePreview && (
                  <p className="text-xs text-muted-foreground">Computed: {formatCents(bundlePreview.resolved.usdPriceCents)}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>PackPTS Amount</Label>
                <div className={`${bundleForm.driver !== "PACKPTS" ? "rounded-md bg-muted p-1" : ""}`}>
                  <Input
                    type="number"
                    value={bundleForm.packptsAmount}
                    onChange={(e) => setBundleForm({ ...bundleForm, packptsAmount: parseInt(e.target.value) || 0 })}
                    disabled={bundleForm.driver !== "PACKPTS"}
                    data-testid="input-bundle-packpts"
                  />
                </div>
                {bundleForm.driver !== "PACKPTS" && bundlePreview && (
                  <p className="text-xs text-muted-foreground">Computed: {bundlePreview.resolved.packptsAmount.toLocaleString()} pts</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sales Channel</Label>
              <Select value={bundleForm.channel} onValueChange={(v) => setBundleForm({ ...bundleForm, channel: v as SalesChannel })}>
                <SelectTrigger data-testid="select-bundle-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web_stripe">Web (Stripe)</SelectItem>
                  <SelectItem value="ios_iap">iOS In-App Purchase</SelectItem>
                  <SelectItem value="android_iap">Android In-App Purchase</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 p-4 border rounded-lg">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Label className="text-base font-semibold">Ratio Mode</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={bundleForm.ratioMode === "AUTO" ? "default" : "outline"}
                    onClick={() => setBundleForm({ ...bundleForm, ratioMode: "AUTO" })}
                    data-testid="button-ratio-auto"
                  >
                    AUTO
                  </Button>
                  <Button
                    size="sm"
                    variant={bundleForm.ratioMode === "OVERRIDE" ? "default" : "outline"}
                    onClick={() => setBundleForm({ ...bundleForm, ratioMode: "OVERRIDE" })}
                    data-testid="button-ratio-override"
                  >
                    OVERRIDE
                  </Button>
                </div>
              </div>
              {bundleForm.ratioMode === "AUTO" && config?.policy && (
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  Using policy default ratio. Max value per pt: {formatMicrousd(config.policy.maxValuePerPtMicrousd)}
                </div>
              )}
              {bundleForm.ratioMode === "OVERRIDE" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Custom Ratio (micro-USD per PackPTS)</Label>
                    <Input
                      type="number"
                      value={bundleForm.overrideRatioUsdPerPackptMicro}
                      onChange={(e) => setBundleForm({ ...bundleForm, overrideRatioUsdPerPackptMicro: parseInt(e.target.value) || 0 })}
                      data-testid="input-bundle-override-ratio"
                    />
                    <p className="text-xs text-muted-foreground">
                      = {formatRatioUsdPerPt(bundleForm.overrideRatioUsdPerPackptMicro)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Override Reason (min 10 characters)</Label>
                    <Textarea
                      value={bundleForm.overrideReason}
                      onChange={(e) => setBundleForm({ ...bundleForm, overrideReason: e.target.value })}
                      placeholder="Explain why a custom ratio is needed..."
                      data-testid="input-bundle-override-reason"
                    />
                  </div>
                </div>
              )}
            </div>

            {bundlePreviewMutation.isPending ? (
              <div className="flex items-center justify-center h-24 border rounded-lg">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Computing preview...</span>
              </div>
            ) : bundlePreview ? (
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Label className="text-base font-semibold">Live Preview</Label>
                  <DecisionBadge decision={bundlePreview.guardrails.decision} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-xs text-muted-foreground">USD per PackPTS</div>
                    <div className="font-semibold" data-testid="text-preview-usd-per-pt">
                      {formatRatioUsdPerPt(bundlePreview.resolved.ratios.usdPerPackptMicro)}
                    </div>
                  </div>
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-xs text-muted-foreground">PackPTS per $1</div>
                    <div className="font-semibold" data-testid="text-preview-pts-per-usd">
                      {formatRatioPtsPerUsd(bundlePreview.resolved.ratios.packptPerUsdMicro)}
                    </div>
                  </div>
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-xs text-muted-foreground">Gross Margin</div>
                    <div className={`font-semibold ${bundlePreview.guardrails.computed.grossMarginRate >= (bundlePreview.guardrails.policy?.minMarginRate || 0) ? "text-green-600" : "text-red-600"}`} data-testid="text-preview-margin">
                      {formatPercent(bundlePreview.guardrails.computed.grossMarginRate)}
                    </div>
                  </div>
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-xs text-muted-foreground">Net Revenue</div>
                    <div className="font-semibold text-green-600" data-testid="text-preview-net-revenue">
                      {formatCents(bundlePreview.guardrails.computed.netRevenueCents)}
                    </div>
                  </div>
                </div>

                {bundlePreview.guardrails.reasons.length > 0 && (
                  <div className="text-sm space-y-1">
                    {bundlePreview.guardrails.reasons.map((reason, i) => (
                      <div key={i} className="text-muted-foreground">{reason}</div>
                    ))}
                  </div>
                )}

                {bundlePreview.guardrails.decision === "BLOCK" && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg space-y-3">
                    <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                      <XCircle className="w-4 h-4" />
                      Bundle blocked by guardrails
                    </div>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={bundleForm.overrideGuardrails}
                        onCheckedChange={(checked) => setBundleForm({ ...bundleForm, overrideGuardrails: checked === true })}
                        data-testid="checkbox-override-guardrails"
                      />
                      <Label className="text-sm cursor-pointer">Override guardrails block</Label>
                    </div>
                    {bundleForm.overrideGuardrails && (
                      <div className="space-y-2">
                        <Label className="text-sm">Override Reason (required)</Label>
                        <Textarea
                          value={bundleForm.overrideGuardrailsReason}
                          onChange={(e) => setBundleForm({ ...bundleForm, overrideGuardrailsReason: e.target.value })}
                          placeholder="Explain why this override is justified..."
                          data-testid="input-bundle-guardrails-reason"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-bundle-cancel">Cancel</Button>
            <Button
              onClick={handleBundleSubmit}
              disabled={
                createBundleMutation.isPending ||
                updateBundleMutation.isPending ||
                !bundleForm.sku ||
                !bundleForm.name ||
                (bundleForm.ratioMode === "OVERRIDE" && bundleForm.overrideReason.length < 10) ||
                (bundlePreview?.guardrails.decision === "BLOCK" && bundleForm.overrideGuardrails && bundleForm.overrideGuardrailsReason.length < 10)
              }
              data-testid="button-submit-bundle"
            >
              {(createBundleMutation.isPending || updateBundleMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingBundleId ? "Update Bundle" : "Create Bundle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="w-5 h-5" />
              Confirmation Required
            </DialogTitle>
            <DialogDescription>
              This package triggered warnings and requires explicit confirmation to save.
            </DialogDescription>
          </DialogHeader>
          {pendingEvaluation && (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {pendingEvaluation.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Net Revenue:</span>
                  <span className="ml-2 font-medium">{formatCents(pendingEvaluation.computed.netRevenueCents)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Gross Margin:</span>
                  <span className="ml-2 font-medium">{formatPercent(pendingEvaluation.computed.grossMarginRate)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleBundleConfirmSubmit} 
              disabled={createBundleMutation.isPending || updateBundleMutation.isPending}
              className="bg-yellow-600"
              data-testid="button-confirm-create"
            >
              {(createBundleMutation.isPending || updateBundleMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingBundleId ? "Confirm & Update" : "Confirm & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PolicyEditor({ 
  policy, 
  onSave, 
  isPending 
}: { 
  policy: Policy; 
  onSave: (data: Partial<Policy>) => void;
  isPending: boolean;
}) {
  const [minMarginRate, setMinMarginRate] = useState(policy.minMarginRate * 100);
  const [warnMarginBand, setWarnMarginBand] = useState(policy.warnMarginBand * 100);
  const [maxValuePerPtMicrousd, setMaxValuePerPtMicrousd] = useState(policy.maxValuePerPtMicrousd);
  const [allowOverride, setAllowOverride] = useState(policy.allowOverride);
  const [reserveRate, setReserveRate] = useState(policy.reserveRate * 100);

  const handleSave = () => {
    onSave({
      minMarginRate: minMarginRate / 100,
      warnMarginBand: warnMarginBand / 100,
      maxValuePerPtMicrousd,
      allowOverride,
      reserveRate: reserveRate / 100,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Minimum Gross Margin (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={minMarginRate}
            onChange={(e) => setMinMarginRate(parseFloat(e.target.value) || 0)}
            data-testid="input-min-margin"
          />
          <p className="text-xs text-muted-foreground">Packages below this margin will be blocked</p>
        </div>
        <div className="space-y-2">
          <Label>Warning Band (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={warnMarginBand}
            onChange={(e) => setWarnMarginBand(parseFloat(e.target.value) || 0)}
            data-testid="input-warn-band"
          />
          <p className="text-xs text-muted-foreground">Warn if margin is within this % of minimum</p>
        </div>
        <div className="space-y-2">
          <Label>Max Value per PackPTS (micro-USD)</Label>
          <Input
            type="number"
            value={maxValuePerPtMicrousd}
            onChange={(e) => setMaxValuePerPtMicrousd(parseInt(e.target.value) || 0)}
            data-testid="input-max-value"
          />
          <p className="text-xs text-muted-foreground">Warn if implied value exceeds this (1000 = $0.001/pt)</p>
        </div>
        <div className="space-y-2">
          <Label>Reserve Rate (%)</Label>
          <Input
            type="number"
            step="1"
            value={reserveRate}
            onChange={(e) => setReserveRate(parseFloat(e.target.value) || 0)}
            data-testid="input-reserve-rate"
          />
          <p className="text-xs text-muted-foreground">% of net revenue to margin pool</p>
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Switch 
            checked={allowOverride} 
            onCheckedChange={setAllowOverride}
            data-testid="switch-allow-override"
          />
          <Label>Allow Admin Override</Label>
        </div>
        <Button onClick={handleSave} disabled={isPending} data-testid="button-save-policy">
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Policy
        </Button>
      </div>
    </div>
  );
}

function FeeProfileRow({ 
  profile, 
  onSave,
  isPending
}: { 
  profile: FeeProfile; 
  onSave: (data: Partial<FeeProfile>) => void;
  isPending: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [feeRate, setFeeRate] = useState(profile.feeRate * 100);
  const [feeFixedCents, setFeeFixedCents] = useState(profile.feeFixedCents);
  const [platformFeeRate, setPlatformFeeRate] = useState(profile.platformFeeRate * 100);

  const handleSave = () => {
    onSave({
      feeRate: feeRate / 100,
      feeFixedCents,
      platformFeeRate: platformFeeRate / 100,
    });
    setIsEditing(false);
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{channelLabels[profile.channel]}</TableCell>
      <TableCell>
        {isEditing ? (
          <Input
            type="number"
            step="0.1"
            value={feeRate}
            onChange={(e) => setFeeRate(parseFloat(e.target.value) || 0)}
            className="w-20"
          />
        ) : (
          formatPercent(profile.feeRate)
        )}
      </TableCell>
      <TableCell>
        {isEditing ? (
          <Input
            type="number"
            value={feeFixedCents}
            onChange={(e) => setFeeFixedCents(parseInt(e.target.value) || 0)}
            className="w-20"
          />
        ) : (
          formatCents(profile.feeFixedCents)
        )}
      </TableCell>
      <TableCell>
        {isEditing ? (
          <Input
            type="number"
            step="0.1"
            value={platformFeeRate}
            onChange={(e) => setPlatformFeeRate(parseFloat(e.target.value) || 0)}
            className="w-20"
          />
        ) : (
          formatPercent(profile.platformFeeRate)
        )}
      </TableCell>
      <TableCell>
        {isEditing ? (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleSave} disabled={isPending}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>Edit</Button>
        )}
      </TableCell>
    </TableRow>
  );
}
