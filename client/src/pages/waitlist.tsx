import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { AuthUser, CapStatus, WaitlistStatus } from "@/types/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Users, Clock, Mail, Gift, Share2, Copy, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";

const waitlistSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  inviteCode: z.string().optional(),
});

type WaitlistFormData = z.infer<typeof waitlistSchema>;

export default function WaitlistPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const { data: capStatus, isLoading: isCapLoading } = useQuery<CapStatus>({
    queryKey: ["/api/access/cap"],
    retry: false,
  });

  const { data: waitlistStatus, isLoading: isWaitlistLoading } = useQuery<WaitlistStatus>({
    queryKey: ["/api/waitlist/status"],
    enabled: !!user,
    retry: false,
  });

  const form = useForm<WaitlistFormData>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: {
      email: user?.email || "",
      inviteCode: "",
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (data: WaitlistFormData) => {
      const response = await apiRequest("POST", "/api/waitlist/join", {
        email: data.email,
        referralSource: "direct",
        inviteCode: data.inviteCode || undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist/status"] });
      
      if (data.activated) {
        toast({
          title: "You're in!",
          description: "Your account has been activated. Start playing now!",
        });
        setLocation("/");
      } else {
        toast({
          title: "You're on the waitlist!",
          description: `Position #${data.position}. We'll notify you when a spot opens.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to join waitlist",
        description: error?.message || "Please try again later.",
        variant: "destructive",
      });
    },
  });

  const handleCopyReferralLink = async () => {
    const referralLink = `${window.location.origin}/auth?ref=${user?.id || "friend"}`;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Share it with friends to move up the waitlist.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const onSubmit = (data: WaitlistFormData) => {
    joinMutation.mutate(data);
  };

  const spotsRemaining = capStatus ? capStatus.maxUsers - capStatus.currentUsers : 0;
  const percentFull = capStatus ? Math.min(100, (capStatus.currentUsers / capStatus.maxUsers) * 100) : 0;

  if (user && !waitlistStatus?.isOnWaitlist && capStatus && !capStatus.isCapped) {
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
          <CardTitle className="text-2xl">Join the Founders</CardTitle>
          <CardDescription>
            PackPTS is in limited early access. Join the waitlist or use an invite code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isCapLoading && capStatus && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Founders Cap</span>
                <span className="font-medium">
                  {capStatus.currentUsers} / {capStatus.maxUsers}
                </span>
              </div>
              <Progress value={percentFull} className="h-2" />
              <div className="text-center">
                {spotsRemaining > 0 ? (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                    {spotsRemaining} spots remaining
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
                    Cap reached - Join waitlist
                  </Badge>
                )}
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          {...field}
                          type="email"
                          placeholder="you@example.com"
                          className="pl-10"
                          data-testid="input-email"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invite Code (Optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Gift className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          {...field}
                          placeholder="Enter invite code"
                          className="pl-10 uppercase font-mono"
                          data-testid="input-invite-code"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={joinMutation.isPending}
                data-testid="button-join-waitlist"
              >
                {joinMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : spotsRemaining > 0 ? (
                  "Get Early Access"
                ) : (
                  "Join Waitlist"
                )}
              </Button>
            </form>
          </Form>

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
