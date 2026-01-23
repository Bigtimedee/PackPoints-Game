import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Ticket, CheckCircle2, XCircle, Sparkles, ArrowRight } from "lucide-react";
import { useLocation, useSearch } from "wouter";

export default function RedeemPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [redeemResult, setRedeemResult] = useState<any>(null);

  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const urlParams = new URLSearchParams(searchString);
  const passValid = urlParams.get("pass") === "valid";
  const passError = urlParams.get("error");

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/founders-pass/redeem");
      return response.json();
    },
    onSuccess: (data) => {
      setRedeemResult(data);
      if (data.approved) {
        toast({
          title: "Pass Approved!",
          description: "Complete your signup to claim your Founder spot.",
        });
      } else {
        toast({
          title: "Pass Issue",
          description: data.error || "Unable to redeem this pass.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      setRedeemResult({ approved: false, error: error?.message || "Failed to redeem pass" });
      toast({
        title: "Redemption Failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (passValid && !redeemResult && (!user || user?.status !== "ACTIVE")) {
      redeemMutation.mutate();
    }
  }, [passValid, user]);

  if (userLoading) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user?.status === "ACTIVE") {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Already a Founder!</CardTitle>
            <CardDescription>
              Your account is already active. No pass needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setLocation("/")} data-testid="button-start-playing">
              Start Playing
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (passError) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Pass Issue</CardTitle>
            <CardDescription>
              {passError === "invalid" && "This pass link is invalid or has already been used."}
              {passError === "consumed" && "This Founders Pass has already been redeemed by someone else."}
              {passError === "expired" && "This Founders Pass has expired."}
              {passError === "deactivated" && "All Founders Passes have been deactivated - the 500 Founder spots are filled!"}
              {!["invalid", "consumed", "expired", "deactivated"].includes(passError) && "Unable to process this pass."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              You can still join the waitlist for future access.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLocation("/auth")} data-testid="button-login">
                Sign In
              </Button>
              <Button onClick={() => setLocation("/auth?tab=signup")} data-testid="button-signup">
                Join Waitlist
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (redeemMutation.isPending) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
            <CardTitle className="text-2xl">Verifying Pass...</CardTitle>
            <CardDescription>
              Checking your Founders Pass. Just a moment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (redeemResult?.approved) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <Ticket className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl flex items-center justify-center gap-2">
              <Sparkles className="w-6 h-6 text-yellow-500" />
              Pass Approved!
              <Sparkles className="w-6 h-6 text-yellow-500" />
            </CardTitle>
            <CardDescription>
              Your friend's Founders Pass is valid. Complete signup to claim your spot!
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">You've been invited by a Founder</p>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                <Ticket className="w-4 h-4 mr-2" />
                Founders Pass
              </Badge>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                This pass grants you guaranteed access to PackPTS as one of the first 500 Founders.
              </p>
              <ul className="text-sm space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span>Skip the waitlist entirely</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span>Immediate account activation</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span>Receive your own Founders Pass to share</span>
                </li>
              </ul>
            </div>

            <Button 
              className="w-full" 
              size="lg"
              onClick={() => setLocation("/auth?tab=signup")}
              data-testid="button-complete-signup"
            >
              Complete Signup
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Already have an account?{" "}
              <Button variant="ghost" className="p-0 h-auto underline" onClick={() => setLocation("/auth")} data-testid="link-login">
                Sign in
              </Button>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (redeemResult && !redeemResult.approved) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Unable to Redeem</CardTitle>
            <CardDescription>
              {redeemResult.error || "This pass cannot be used."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center">
              You can still join the waitlist for future access.
            </p>
            <Button onClick={() => setLocation("/auth?tab=signup")} data-testid="button-join-waitlist">
              Join Waitlist
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-lg mx-auto py-12 px-4">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Ticket className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Founders Pass</CardTitle>
          <CardDescription>
            If you received a Founders Pass link from a friend, click it to automatically validate your pass.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            No pass link? You can still join the waitlist or sign in.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => setLocation("/auth")} data-testid="button-sign-in">
              Sign In
            </Button>
            <Button onClick={() => setLocation("/auth?tab=signup")} data-testid="button-join-waitlist-default">
              Join Waitlist
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
