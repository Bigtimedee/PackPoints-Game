import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuthUser, WaitlistStatus } from "@/types/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Users, Clock, Share2, Copy, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";

export default function WaitlistPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const { data: waitlistStatus, isLoading: isWaitlistLoading } = useQuery<WaitlistStatus>({
    queryKey: ["/api/waitlist/status"],
    enabled: !!user,
    retry: false,
  });

  const handleCopyReferralLink = async () => {
    const referralLink = `${window.location.origin}/auth?ref=${user?.id || "friend"}`;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Share it with a friend.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const onSubmit = () => {
    setLocation("/auth?tab=signup");
  };

  if (user && !isWaitlistLoading && !waitlistStatus?.isOnWaitlist) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">You're Already In!</CardTitle>
            <CardDescription>
              Your account is active. Start playing and earning PackPTS.
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

  if (waitlistStatus?.isOnWaitlist) {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">You're on the Waitlist</CardTitle>
            <CardDescription>
              We'll notify you at <span className="font-medium">{user?.email}</span> when a spot opens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <div className="text-5xl font-bold text-primary">#{waitlistStatus.position || "N/A"}</div>
              <div className="text-sm text-muted-foreground mt-1">Your position in line</div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Share2 className="w-4 h-4" />
                <span className="font-medium text-sm">Move Up the List</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Share your referral link. Each signup moves you up!
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCopyReferralLink}
                data-testid="button-copy-referral"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Referral Link
                  </>
                )}
              </Button>
            </div>
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
            <Users className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription>
            Signup is open. Use Google, Apple, or email and password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            type="button"
            className="w-full"
            onClick={onSubmit}
            data-testid="button-join-waitlist"
          >
            Create Account
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Button
              variant="ghost"
              className="p-0 h-auto text-primary hover:text-primary/80"
              onClick={() => setLocation("/auth")}
              data-testid="link-login"
            >
              Log in
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
