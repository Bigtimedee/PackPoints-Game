import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Zap, Loader2, AlertCircle, Home, Play } from "lucide-react";
import { Link, useSearch } from "wouter";

interface CheckoutSessionStatus {
  sessionId: string;
  status: "CREATED" | "PAID" | "CANCELED" | "EXPIRED";
  sku: string | null;
  packptsGrant: number | null;
  amountCents: number | null;
}

export default function StoreSuccess() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sessionId = params.get("session_id");
  const queryClient = useQueryClient();
  const [pollCount, setPollCount] = useState(0);

  const { data, isLoading, isError } = useQuery<CheckoutSessionStatus>({
    queryKey: ["/api/store/checkout", sessionId],
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === "PAID") return false;
      if (data.status === "EXPIRED" || data.status === "CANCELED") return false;
      if (pollCount > 30) return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (data?.status === "CREATED") {
      setPollCount((prev) => prev + 1);
    }
  }, [data]);

  useEffect(() => {
    if (data?.status === "PAID") {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  }, [data?.status, queryClient]);

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto text-destructive mb-4" />
            <h1 className="text-2xl font-bold mb-2">Missing Session</h1>
            <p className="text-muted-foreground mb-6">
              No checkout session found. Please try your purchase again.
            </p>
            <Button asChild className="gap-2">
              <Link href="/store">
                <Home className="h-4 w-4" />
                Back to Store
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || (data?.status === "CREATED" && pollCount < 30)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-16 w-16 mx-auto text-accent animate-spin mb-4" />
            <h1 className="text-2xl font-bold mb-2">Processing Payment</h1>
            <p className="text-muted-foreground">
              Please wait while we confirm your purchase...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto text-destructive mb-4" />
            <h1 className="text-2xl font-bold mb-2">Payment Issue</h1>
            <p className="text-muted-foreground mb-6">
              We couldn't confirm your payment. If you were charged, your PackPTS will be credited automatically.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" asChild>
                <Link href="/store">Try Again</Link>
              </Button>
              <Button asChild>
                <Link href="/profile">View Profile</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data?.status === "CANCELED") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h1 className="text-2xl font-bold mb-2">Payment Cancelled</h1>
            <p className="text-muted-foreground mb-6">
              Your payment was cancelled. No charges were made to your account.
            </p>
            <Button asChild className="gap-2">
              <Link href="/store">
                <Home className="h-4 w-4" />
                Back to Store
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data?.status === "EXPIRED") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h1 className="text-2xl font-bold mb-2">Session Expired</h1>
            <p className="text-muted-foreground mb-6">
              This checkout session has expired. Please start a new purchase.
            </p>
            <Button asChild className="gap-2">
              <Link href="/store">
                <Home className="h-4 w-4" />
                Back to Store
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center">
          <div className="relative mb-6">
            <CheckCircle className="h-20 w-20 mx-auto text-green-500" />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
              <div className="flex items-center gap-1 bg-accent/20 text-accent px-3 py-1 rounded-full">
                <Zap className="h-4 w-4" />
                <span className="font-mono font-bold" data-testid="text-pts-added">
                  +{data?.packptsGrant?.toLocaleString() || "0"}
                </span>
              </div>
            </div>
          </div>
          
          <h1 className="text-2xl font-bold mb-2" data-testid="text-success-title">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground mb-8">
            Your PackPTS have been added to your account. You're ready to play!
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="outline" asChild>
              <Link href="/store" data-testid="link-back-store">
                <Home className="h-4 w-4 mr-2" />
                Back to Store
              </Link>
            </Button>
            <Button asChild data-testid="link-play">
              <Link href="/">
                <Play className="h-4 w-4 mr-2" />
                Start Playing
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
