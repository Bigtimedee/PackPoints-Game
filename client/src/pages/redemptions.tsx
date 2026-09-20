import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, ExternalLink, Receipt, DollarSign, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";

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
  honesty: string;
}

function statusBadge(status: string) {
  if (status === "CREDIT_GRANTED" || status === "GRANTED") {
    return <Badge data-testid="badge-status-granted">Granted</Badge>;
  }
  if (status === "PURCHASE_CONFIRMED") {
    return <Badge variant="secondary" data-testid="badge-status-review">Pending review</Badge>;
  }
  if (status === "APPROVED") {
    return <Badge variant="outline" data-testid="badge-status-reserved">Reserved — buy then claim</Badge>;
  }
  if (status === "DENIED" || status === "CANCELED" || status === "REVERSED") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function ReceiptDetail() {
  const [, params] = useRoute("/redemptions/:intentId");
  const intentId = params?.intentId || "";
  const { toast } = useToast();
  const [orderId, setOrderId] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");

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
      toast({ title: result.granted ? "Cashback granted" : "Claim submitted", description: result.message });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/redemption/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/wallet"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not claim cashback", description: error.message, variant: "destructive" });
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
    return <p className="text-muted-foreground">Receipt not found.</p>;
  }

  const { intent, credit } = data;
  const platform = intent.source === "goldin" ? "Goldin" : "eBay";
  const creditCents = credit?.creditCents ?? 0;
  const canClaim = intent.status === "APPROVED";

  return (
    <div className="space-y-6" data-testid="page-redemption-receipt">
      <Button variant="ghost" asChild>
        <Link href="/redemptions">
          <ArrowLeft className="h-4 w-4 mr-2" />
          My Redemptions
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            PackPTS cashback receipt
          </CardTitle>
          <CardDescription>{data.honesty}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Status</span>
            {statusBadge(intent.status)}
          </div>
          <div>
            <p className="font-semibold" data-testid="text-receipt-listing">
              {intent.listingTitle || `${platform} listing ${intent.listingId}`}
            </p>
            <p className="text-sm text-muted-foreground">{platform} · listed ${(intent.priceCents / 100).toFixed(2)}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 rounded-md bg-muted">
            <div>
              <p className="text-xs text-muted-foreground">PackPTS spent</p>
              <p className="font-mono font-bold" data-testid="text-receipt-packpts">
                {(credit?.packptsSpent ?? intent.approvedRedeemPackpts).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">USD cashback</p>
              <p className="font-mono font-bold text-accent" data-testid="text-receipt-usd">
                ${(creditCents / 100).toFixed(2)}
              </p>
            </div>
          </div>
          {intent.grantMethod && (
            <p className="text-sm text-muted-foreground">
              Granted via {intent.grantMethod.replace("_", " ").toLowerCase()}
              {intent.grantedAt ? ` · ${new Date(intent.grantedAt).toLocaleString()}` : ""}
            </p>
          )}
          {intent.deniedReason && (
            <p className="text-sm text-destructive">Denied: {intent.deniedReason}</p>
          )}
          <Button variant="outline" asChild>
            <a href={intent.listingUrl} target="_blank" rel="noopener noreferrer">
              Open {platform} listing
              <ExternalLink className="h-3 w-3 ml-2" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {canClaim && (
        <Card>
          <CardHeader>
            <CardTitle>I purchased — claim rebate</CardTitle>
            <CardDescription>
              Pay full price on {platform}, then send the order id so PackPTS can grant ${(creditCents / 100).toFixed(2)} cashback.
              {platform} will not show this discount.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="order-id">Order or transaction id</Label>
              <Input
                id="order-id"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder={`${platform} order number`}
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
              Claim ${(creditCents / 100).toFixed(2)} cashback
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
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-md bg-accent/10">
            <DollarSign className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">PackPTS cashback balance</p>
            <p className="text-xl font-bold font-mono" data-testid="text-rebate-balance">
              ${(rebateCents / 100).toFixed(2)}
            </p>
          </div>
        </CardContent>
      </Card>

      {rebateCents > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Request withdrawal</CardTitle>
            <CardDescription>
              Ops sends this as real USD (PayPal / Venmo / ACH) and marks it paid. Not an eBay payout.
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
            const intent = row.intent;
            const platform = intent.source === "goldin" ? "Goldin" : "eBay";
            const usd = ((row.credit?.creditCents ?? 0) / 100).toFixed(2);
            return (
              <Card key={intent.id} data-testid={`card-redemption-${intent.id}`}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{intent.listingTitle || `${platform} ${intent.listingId}`}</p>
                    <p className="text-sm text-muted-foreground">
                      {platform} · ${(intent.priceCents / 100).toFixed(2)} list · ${usd} cashback
                    </p>
                    <div className="mt-2">{statusBadge(intent.status)}</div>
                  </div>
                  <Button asChild variant={intent.status === "APPROVED" ? "default" : "outline"}>
                    <Link href={`/redemptions/${intent.id}`}>
                      {intent.status === "APPROVED" ? "Claim rebate" : "View receipt"}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <p className="font-medium">No marketplace redemptions yet</p>
              <p className="text-sm text-muted-foreground">
                Apply PackPTS on a live listing, buy at full price, then claim cashback here.
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
    <div className="min-h-screen pb-20 md:pb-8">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-redemptions-title">
          {isDetail ? "Receipt" : "My Redemptions"}
        </h1>
        <p className="text-muted-foreground mb-8">
          PackPTS cashback after eBay or Goldin purchases. Checkout on those sites stays full price.
        </p>
        {isDetail ? <ReceiptDetail /> : <RedemptionsList />}
      </div>
    </div>
  );
}
