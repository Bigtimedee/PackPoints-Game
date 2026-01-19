import { useState, useEffect, useCallback } from "react";
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
  RefreshCw
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

type SalesChannel = "web_stripe" | "ios_iap" | "android_iap";
type PackageDecision = "PASS" | "WARN" | "BLOCK" | "OVERRIDE";

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

export default function AdminPackageGuardrails() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("calculator");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingEvaluation, setPendingEvaluation] = useState<EvaluationResult | null>(null);

  const [formData, setFormData] = useState<PackageFormData>({
    sku: "",
    name: "",
    priceCents: 999,
    ptsGrant: 6000,
    channel: "web_stripe",
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

  const previewMutation = useMutation({
    mutationFn: async (data: { priceCents: number; ptsGrant: number; channel: SalesChannel }) => {
      const res = await apiRequest("POST", "/api/admin/store/packages/preview", data);
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

  const handleCreateSubmit = () => {
    createMutation.mutate(formData);
  };

  const handleConfirmSubmit = () => {
    createMutation.mutate({ ...formData, confirm: true });
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const evaluation = previewMutation.data as EvaluationResult | undefined;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PackPTS Package Guardrails</h1>
          <p className="text-muted-foreground">Validate package profitability before creation</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-package">
          <Plus className="w-4 h-4 mr-2" />
          Create Package
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
                <CardTitle className="flex items-center justify-between">
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
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create PackPTS Package</DialogTitle>
            <DialogDescription>
              Create a new package with automatic profit validation
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                placeholder="PACKPTS_10000"
                data-testid="input-create-sku"
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="10,000 PackPTS"
                data-testid="input-create-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Price (USD)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={(formData.priceCents / 100).toFixed(2)}
                    onChange={(e) => setFormData({ ...formData, priceCents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                    data-testid="input-create-price"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>PackPTS</Label>
                <Input
                  type="number"
                  value={formData.ptsGrant}
                  onChange={(e) => setFormData({ ...formData, ptsGrant: parseInt(e.target.value) || 0 })}
                  data-testid="input-create-pts"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sales Channel</Label>
              <Select value={formData.channel} onValueChange={(v) => setFormData({ ...formData, channel: v as SalesChannel })}>
                <SelectTrigger data-testid="select-create-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web_stripe">Web (Stripe)</SelectItem>
                  <SelectItem value="ios_iap">iOS In-App Purchase</SelectItem>
                  <SelectItem value="android_iap">Android In-App Purchase</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button 
              onClick={handleCreateSubmit} 
              disabled={createMutation.isPending || !formData.sku || !formData.name}
              data-testid="button-submit-create"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Package
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
              onClick={handleConfirmSubmit} 
              disabled={createMutation.isPending}
              className="bg-yellow-600 hover:bg-yellow-700"
              data-testid="button-confirm-create"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm & Create
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
      <div className="flex items-center justify-between">
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
          <div className="flex gap-2">
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
