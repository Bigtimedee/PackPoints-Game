import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, User, Mail, Lock, Sparkles, Gift, Users } from "lucide-react";
import { SiReplit } from "react-icons/si";

const signupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be 20 characters or less").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

type SignupFormData = z.infer<typeof signupSchema>;
type LoginFormData = z.infer<typeof loginSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("login");
  const [inviteCode, setInviteCode] = useState("");

  const urlParams = new URLSearchParams(searchString);
  const tabFromUrl = urlParams.get("tab");
  
  useEffect(() => {
    if (tabFromUrl === "signup") {
      setActiveTab("signup");
    }
  }, [tabFromUrl]);

  const { data: capStatus } = useQuery<any>({
    queryKey: ["/api/access/cap"],
    retry: false,
  });

  const spotsRemaining = capStatus ? capStatus.maxActive - capStatus.currentActive : 0;
  const percentFull = capStatus ? Math.min(100, (capStatus.currentActive / capStatus.maxActive) * 100) : 0;
  const capReached = spotsRemaining <= 0;

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      usernameOrEmail: "",
      password: "",
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username: data.username,
        email: data.email,
        password: data.password,
        inviteCode: inviteCode || undefined,
      });
      return response.json();
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/access/cap"] });
      
      if (!data.activated && data.waitlistPosition) {
        toast({
          title: "You're on the waitlist!",
          description: `Position #${data.waitlistPosition}. We'll notify you when a spot opens.`,
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        setLocation("/waitlist");
      } else {
        toast({
          title: "Account created!",
          description: "Welcome to PackPoints. Start playing to earn PackPTS!",
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        setLocation("/");
      }
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to create account";
      toast({
        title: "Signup failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await apiRequest("POST", "/api/auth/local-login", data);
      return response.json();
    },
    onSuccess: async (data) => {
      // Directly set user data in cache from login response to avoid session cookie race condition
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      // Invalidate profile stats so the profile page fetches fresh data with new session
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });
      toast({
        title: "Welcome back!",
        description: "You've successfully logged in.",
      });
      // Small delay to ensure session cookie is fully processed by browser before navigating
      await new Promise(resolve => setTimeout(resolve, 150));
      setLocation("/");
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

  const handleReplitLogin = () => {
    // Check if we're in an iframe
    if (window.self !== window.top) {
      toast({
        title: "Open in new tab",
        description: "Replit login requires opening the app in a new browser tab.",
        variant: "destructive",
      });
      return;
    }
    window.location.href = "/api/login";
  };

  const handleWorkOSLogin = () => {
    if (window.self !== window.top) {
      toast({
        title: "Open in new tab",
        description: "WorkOS login requires opening the app in a new browser tab.",
        variant: "destructive",
      });
      return;
    }
    window.location.href = "/api/auth/workos/start";
  };

  const onSignup = (data: SignupFormData) => {
    signupMutation.mutate(data);
  };

  const onLogin = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 py-8 overflow-y-auto bg-gradient-to-br from-background via-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">PackPoints</CardTitle>
          <CardDescription>
            Guess the player. Earn points. Redeem rewards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">Log In</TabsTrigger>
              <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4 mt-4">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
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
                              data-testid="input-login-username"
                              {...field} 
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
                              data-testid="input-login-password"
                              {...field} 
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
                    disabled={loginMutation.isPending}
                    data-testid="button-login-submit"
                  >
                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Log In
                  </Button>
                  <div className="text-center">
                    <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary">
                      Forgot your password?
                    </Link>
                  </div>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="signup" className="space-y-4 mt-4">
              {capStatus && (
                <div className="space-y-2 pb-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      Founders Cap
                    </span>
                    <span className="font-medium">
                      {capStatus.currentActive} / {capStatus.maxActive}
                    </span>
                  </div>
                  <Progress value={percentFull} className="h-1.5" />
                  <div className="text-center">
                    {spotsRemaining > 0 ? (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-600 text-xs">
                        {spotsRemaining} spots remaining
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 text-xs">
                        Cap reached - use invite code or join waitlist
                      </Badge>
                    )}
                  </div>
                </div>
              )}
              
              {capReached && (
                <div className="p-3 bg-muted/50 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Gift className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Have an Invite Code?</span>
                  </div>
                  <div className="relative">
                    <Gift className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="Enter invite code"
                      className="pl-10 uppercase font-mono"
                      data-testid="input-invite-code"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Without an invite code, you'll be added to the waitlist.
                  </p>
                </div>
              )}

              <Form {...signupForm}>
                <form onSubmit={signupForm.handleSubmit(onSignup)} className="space-y-4">
                  <FormField
                    control={signupForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                              placeholder="Choose a username" 
                              className="pl-10"
                              data-testid="input-signup-username"
                              {...field} 
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                              type="email" 
                              placeholder="Enter your email" 
                              className="pl-10"
                              data-testid="input-signup-email"
                              {...field} 
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                              type="password" 
                              placeholder="Create a password" 
                              className="pl-10"
                              data-testid="input-signup-password"
                              {...field} 
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signupForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                              type="password" 
                              placeholder="Confirm your password" 
                              className="pl-10"
                              data-testid="input-signup-confirm-password"
                              {...field} 
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
                    disabled={signupMutation.isPending}
                    data-testid="button-signup-submit"
                  >
                    {signupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {capReached && !inviteCode ? "Join Waitlist" : "Create Account"}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <div className="space-y-3">
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={handleReplitLogin}
              data-testid="button-replit-login"
            >
              <SiReplit className="mr-2 h-4 w-4" />
              Continue with Replit
            </Button>

            <Button 
              variant="outline" 
              className="w-full" 
              onClick={handleWorkOSLogin}
              data-testid="button-workos-login"
            >
              <Lock className="mr-2 h-4 w-4" />
              Continue with WorkOS
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
