import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Shield, Mail, Lock, User, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LinkChallenge {
  id: string;
  provider: string;
  email: string | null;
  targetUsername: string | null;
  expiresAt: string;
  isHighValue: boolean;
}

export default function LinkRequiredPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"login" | "email">("login");
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const searchParams = new URLSearchParams(window.location.search);
  const provider = searchParams.get("provider") || "unknown";
  const maskedEmail = searchParams.get("email") || "";
  const verified = searchParams.get("verified") === "true";

  const { data: challenge, isLoading: challengeLoading, error: challengeError } = useQuery<LinkChallenge>({
    queryKey: ["/api/auth/link/challenge"],
    retry: false,
  });

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      usernameOrEmail: "",
      password: "",
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await apiRequest("POST", "/api/auth/local-login", data);
      return response.json();
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      confirmMutation.mutate();
    },
    onError: (error: any) => {
      const message = error?.message || "Invalid username or password";
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/link/confirm", {});
      return response.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/identities"] });
      toast({
        title: "Account linked!",
        description: `Your ${provider} account has been successfully linked.`,
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      setLocation("/");
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to link account";
      const code = error?.code;
      
      if (code === "VERIFICATION_REQUIRED") {
        toast({
          title: "Email verification required",
          description: "This is a high-value account. Please verify via email first.",
          variant: "destructive",
        });
        setActiveTab("email");
      } else if (code === "WRONG_ACCOUNT") {
        toast({
          title: "Wrong account",
          description: "Please log in to the account that owns this email.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Link failed",
          description: message,
          variant: "destructive",
        });
      }
    },
  });

  const sendMagicLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/link/send-magic", {});
      return response.json();
    },
    onSuccess: () => {
      setMagicLinkSent(true);
      toast({
        title: "Email sent!",
        description: "Check your inbox for the verification link.",
      });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to send verification email";
      toast({
        title: "Failed to send email",
        description: message,
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/link/cancel", {});
      return response.json();
    },
    onSuccess: () => {
      setLocation("/");
    },
  });

  useEffect(() => {
    if (verified && challenge) {
      confirmMutation.mutate();
    }
  }, [verified, challenge]);

  if (challengeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (challengeError || !challenge) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>No Pending Link</CardTitle>
            <CardDescription>
              There's no account linking request in progress.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">Go to Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const providerName = provider === "workos" ? "WorkOS" : provider;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-amber-500" />
          </div>
          <CardTitle>Account Protection</CardTitle>
          <CardDescription>
            We found an existing PackPTS account with the email{" "}
            <span className="font-mono text-foreground">{challenge.email || maskedEmail}</span>.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              To protect your account, please verify you own this email before linking your {providerName} login.
            </AlertDescription>
          </Alert>

          {challenge.isHighValue && (
            <Alert className="border-amber-500/50 bg-amber-500/5">
              <Shield className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-700 dark:text-amber-400">
                This is a high-value account. Email verification is required.
              </AlertDescription>
            </Alert>
          )}

          {verified && (
            <Alert className="border-green-500/50 bg-green-500/5">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Email verified! Completing link...
              </AlertDescription>
            </Alert>
          )}

          {!verified && (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "login" | "email")} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" data-testid="tab-link-login">
                  Log In
                </TabsTrigger>
                <TabsTrigger value="email" data-testid="tab-link-email">
                  Email Verification
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Log in to your existing PackPTS account to link your {providerName} login.
                </p>

                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit((data) => loginMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="usernameOrEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username or Email</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Enter your username or email"
                                className="pl-10"
                                {...field}
                                disabled={loginMutation.isPending || confirmMutation.isPending}
                                data-testid="input-link-username"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="password"
                                placeholder="Enter your password"
                                className="pl-10"
                                {...field}
                                disabled={loginMutation.isPending || confirmMutation.isPending}
                                data-testid="input-link-password"
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
                      disabled={loginMutation.isPending || confirmMutation.isPending}
                      data-testid="button-link-login"
                    >
                      {loginMutation.isPending || confirmMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Verifying...
                        </>
                      ) : (
                        "Log In & Link Account"
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="text-center">
                  <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
                    Forgot your password?
                  </Link>
                </div>
              </TabsContent>

              <TabsContent value="email" className="mt-4 space-y-4">
                {magicLinkSent ? (
                  <div className="text-center space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                      <Mail className="h-8 w-8 text-green-500" />
                    </div>
                    <div>
                      <p className="font-medium">Check your email</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        We sent a verification link to {challenge.email || maskedEmail}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The link expires in 15 minutes. Check your spam folder if you don't see it.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => sendMagicLinkMutation.mutate()}
                      disabled={sendMagicLinkMutation.isPending}
                      className="w-full"
                    >
                      Resend Email
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      We'll send a verification link to your email. Click it to verify ownership and link your account.
                    </p>
                    
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="h-5 w-5 text-muted-foreground" />
                        <span className="font-mono">{challenge.email || maskedEmail}</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => sendMagicLinkMutation.mutate()}
                      disabled={sendMagicLinkMutation.isPending}
                      className="w-full"
                      data-testid="button-send-magic-link"
                    >
                      {sendMagicLinkMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 mr-2" />
                          Send Verification Email
                        </>
                      )}
                    </Button>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}

          <Separator />

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="flex-1"
              data-testid="button-cancel-link"
            >
              Cancel
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link href="/">Continue as Guest</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
