import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, ArrowLeft, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";
import { ReceiptPlaque } from "@/components/receipt-plaque";
import {
  RECEIPT_COLORS,
  RECEIPT_COPY,
  buildReceiptPlaqueView,
  formatUsdCents,
  formatWalletHeader,
  type ReceiptPlaqueView,
} from "@shared/receiptContract";

interface Intent {
  id: string;
  source: "ebay" | "goldin";
  listingId: string;
  listingUrl: string;
  listingTitle: string | null;
  priceCents: number;
  approvedRedeemPackpts: number;
  status: string;
  grantMethod: string | null;
  grantedAt: string | null;
  evidenceOrderId: string | null;
  evidenceNote: string | null;
  evidenceReceiptUrl: string | null;
  deniedReason: string | null;
  createdAt: string;
}

interface Credit {
  id: string;
  packptsSpent: number;
  creditCents: number;
  status: string;
  grantMethod: string | null;
  grantedAt: string | null;
}

interface ReceiptRow {
  intent: Intent;
  credit: Credit | null;
  rebateBalanceCents: number;
  grantMethod: string | null;
  plaque?: ReceiptPlaqueView;
  honesty: string;
}

function plaqueFromRow(row: ReceiptRow): ReceiptPlaqueView {
  if (row.plaque) return row.plaque;
  const { intent, credit } = row;
  return buildReceiptPlaqueView({
    intentId: intent.id,
    source: intent.source,
    listingId: intent.listingId,
    listingTitle: intent.listingTitle,
    listingUrl: intent.listingUrl,
    priceCents: intent.priceCents,
    packptsSpent: credit?.packptsSpent ?? intent.approvedRedeemPackpts,
    creditCents: credit?.creditCents ?? 0,
    status: intent.status,
    grantMethod: row.grantMethod ?? intent.grantMethod ?? credit?.grantMethod ?? null,
    grantedAt: intent.grantedAt ?? credit?.grantedAt ?? null,
    createdAt: intent.createdAt,
    evidenceOrderId: intent.evidenceOrderId,
    evidenceNote: intent.evidenceNote,
    evidenceReceiptUrl: intent.evidenceReceiptUrl,
    deniedReason: intent.deniedReason,
    rebateBalanceCents: row.rebateBalanceCents,
  });
}

async function downloadReceiptPng(intentId: string) {
  const res = await fetch(`/api/marketplace/redemption/receipts/${intentId}/png`, { credentials: "include" });
  if (!res.ok) throw new Error("Could not build receipt PNG");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `packpts-receipt-${intentId.slice(0, 8)}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

function ReceiptDetail() {
  const [, params] = useRoute("/redemptions/:intentId");
  const intentId = params?.intentId || "";
  const { toast } = useToast();
  const [orderId, setOrderId] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [pngBusy, setPngBusy] = useState(false);

  const { data, isLoading } = useQuery<ReceiptRow>({
    queryKey: ["/api/marketplace/redemption/receipts", intentId],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/redemption/receipts/${intentId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Receipt not found");
      return res.json();
    },
    enabled: !!intentId,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/marketplace/purchase/confirm", {
        purchaseIntentId: intentId,
        orderId,
        evidenceNote,
        receiptUrl: receiptUrl || undefined,
      });
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: result.granted ? "USD credit granted to PackPTS wallet" : "Credit pending review",
        description: result.heldForReview
          ? "Purchase confirmed. PackPTS will finish review."
          : result.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/redemption/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/wallet"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not claim rebate", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <p style={{ color: RECEIPT_COLORS.muted }}>Receipt not found.</p>;
  }

  const plaque = plaqueFromRow(data);
  const canClaim = data.intent.status === "APPROVED";
  const rebateUsd = formatUsdCents(plaque.creditCents);

  return (
    <div className="space-y-6" data-testid="page-redemption-receipt">
      <Button variant="ghost" asChild className="text-inherit">
        <Link href="/redemptions">
          <ArrowLeft className="h-4 w-4 mr-2" />
          My Redemptions
        </Link>
      </Button>

      <ReceiptPlaque plaque={plaque} />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            setPngBusy(true);
            try {
              await downloadReceiptPng(intentId);
            } catch (error) {
              toast({
                title: "Could not download receipt",
                description: error instanceof Error ? error.message : "PNG failed",
                variant: "destructive",
              });
            } finally {
              setPngBusy(false);
            }
          }}
          disabled={pngBusy}
          data-testid="button-download-receipt"
        >
          {pngBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Download 1080 PNG
        </Button>
        {plaque.listingUrl && (
          <Button variant="outline" asChild>
            <a href={plaque.listingUrl} target="_blank" rel="noopener noreferrer">
              Open {plaque.partner} listing
              <ExternalLink className="h-3 w-3 ml-2" />
            </a>
          </Button>
        )}
      </div>

      {canClaim && (
        <Card className="border-0" style={{ background: RECEIPT_COLORS.surface, color: RECEIPT_COLORS.ink }}>
          <CardHeader>
            <CardTitle>I purchased. Claim rebate</CardTitle>
            <CardDescription style={{ color: RECEIPT_COLORS.muted }}>
              {RECEIPT_COPY.confirmToUnlock}. {RECEIPT_COPY.partnerCheckoutUnchanged}. PackPTS reserved {rebateUsd}.
              Rebates of $25 or more stay PURCHASE_CONFIRMED with Credit pending review until PackPTS review finishes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="order-id">Order or transaction id</Label>
              <Input
                id="order-id"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder={`${plaque.partner} order number`}
                data-testid="input-claim-order-id"
              />
            </div>
            <div>
              <Label htmlFor="receipt-url">Receipt URL (optional)</Label>
              <Input
                id="receipt-url"
                value={receiptUrl}
                onChange={(e) => setReceiptUrl(e.target.value)}
                placeholder="https://"
                data-testid="input-claim-receipt-url"
              />
            </div>
            <div>
              <Label htmlFor="claim-note">Note</Label>
              <Textarea
                id="claim-note"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                placeholder="Anything that helps us match the purchase"
                data-testid="input-claim-note"
              />
            </div>
            <Button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              data-testid="button-claim-rebate"
            >
              {confirmMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Claim {rebateUsd} rebate
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RedemptionsList() {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("paypal");
  const [destination, setDestination] = useState("");

  const { data, isLoading } = useQuery<{
    receipts: ReceiptRow[];
    payouts: Array<{ id: string; amountCents: number; status: string; method: string; createdAt: string }>;
    rebateBalanceCents: number;
    honesty: string;
  }>({
    queryKey: ["/api/marketplace/redemption/receipts"],
    queryFn: async () => {
      const res = await fetch("/api/marketplace/redemption/receipts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load redemptions");
      return res.json();
    },
  });

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const res = await apiRequest("POST", "/api/rebate/payout-request", {
        amountCents,
        method,
        destination,
      });
      return res.json();
    },
    onSuccess: (result) => {
      toast({ title: "Payout requested", description: result.message });
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/redemption/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/wallet"] });
    },
    onError: (error: Error) => {
      toast({ title: "Payout failed", description: error.message, variant: "destructive" });
    },
  });

  const rebateCents = data?.rebateBalanceCents ?? wallet?.rebateBalanceCents ?? 0;

  return (
    <div className="space-y-6" data-testid="page-my-redemptions">
      <div className="flex items-center justify-between" data-testid="text-rebate-balance">
        <p className="text-sm tracking-[0.18em]" style={{ color: RECEIPT_COLORS.muted }}>PACKPTS RECEIPT</p>
        <p className="text-sm" style={{ color: RECEIPT_COLORS.muted }}>{formatWalletHeader(rebateCents)}</p>
      </div>

      {rebateCents > 0 && (
        <Card className="border-0" style={{ background: RECEIPT_COLORS.surface, color: RECEIPT_COLORS.ink }}>
          <CardHeader>
            <CardTitle>Request withdrawal</CardTitle>
            <CardDescription style={{ color: RECEIPT_COLORS.muted }}>
              PackPTS sends this as real USD (PayPal / Venmo / ACH) after review. {RECEIPT_COPY.partnerCheckoutUnchanged}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Label>Amount (USD)</Label>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={(rebateCents / 100).toFixed(2)}
                  data-testid="input-payout-amount"
                />
              </div>
              <div>
                <Label>Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger data-testid="select-payout-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="venmo">Venmo</SelectItem>
                    <SelectItem value="ach">ACH / bank</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Destination</Label>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="email or handle"
                  data-testid="input-payout-destination"
                />
              </div>
            </div>
            <Button
              onClick={() => payoutMutation.mutate()}
              disabled={payoutMutation.isPending || !amount || !destination}
              data-testid="button-request-payout"
            >
              {payoutMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Request payout
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : data?.receipts.length ? (
          data.receipts.map((row) => {
            const plaque = plaqueFromRow(row);
            return (
              <Link key={plaque.intentId} href={`/redemptions/${plaque.intentId}`} className="block">
                <ReceiptPlaque plaque={plaque} compact />
                <p className="px-2 pt-2 text-right text-sm" style={{ color: RECEIPT_COLORS.muted }}>
                  {row.intent.status === "APPROVED" ? "Claim rebate" : "View receipt"}
                </p>
              </Link>
            );
          })
        ) : (
          <Card className="border-0" style={{ background: RECEIPT_COLORS.surface, color: RECEIPT_COLORS.ink }}>
            <CardContent className="p-8 text-center space-y-2">
              <p className="font-medium">No PackPTS receipts yet</p>
              <p className="text-sm" style={{ color: RECEIPT_COLORS.muted }}>
                Apply PackPTS on a live listing, buy at partner price, then claim the post-purchase rebate here.
                Partner checkout unchanged.
              </p>
              <Button asChild>
                <Link href="/marketplace">Browse listings</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function RedemptionsPage() {
  const [isDetail] = useRoute("/redemptions/:intentId");

  return (
    <div className="min-h-screen pb-20 md:pb-8" style={{ background: RECEIPT_COLORS.canvas, color: RECEIPT_COLORS.ink }}>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-redemptions-title">
          {isDetail ? "PackPTS receipt" : "My Redemptions"}
        </h1>
        <p className="mb-8" style={{ color: RECEIPT_COLORS.muted }}>
          Post-purchase rebate after eBay or Goldin purchases. Partner checkout unchanged.
        </p>
        {isDetail ? <ReceiptDetail /> : <RedemptionsList />}
      </div>
    </div>
  );
}
