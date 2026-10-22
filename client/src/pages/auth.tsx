import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient, getStoredUtmParams } from "@/lib/queryClient";
import { trackSignupError, trackSignupStarted, trackSignupView } from "@/lib/signupFunnel";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { readSignupSavedLine } from "@/lib/signupSaved";
import { Loader2, User, Mail, Lock, Sparkles } from "lucide-react";

const signupSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
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
  const [emailTaken, setEmailTaken] = useState(false);
  const startedEmail = useRef(false);
  const sawSignupView = useRef(false);

  const urlParams = new URLSearchParams(searchString);
  const tabFromUrl = urlParams.get("tab");
  
  useEffect(() => {
    if (tabFromUrl === "signup") {
      setActiveTab("signup");
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (sawSignupView.current) return;
    sawSignupView.current = true;
    trackSignupView("auth", tabFromUrl === "signup" ? "signup" : "login");
  }, [tabFromUrl]);

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
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
      const utmParams = getStoredUtmParams();
      const response = await apiRequest("POST", "/api/auth/register", {
        email: data.email,
        password: data.password,
        signupSurface: "auth",
        ...utmParams,
      });
      return response.json();
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });

      if (data.activated === false) {
        toast({
          title: "Signup failed",
          description: "This account is suspended.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Account created!",
        description: await readSignupSavedLine(Number(data.user?.points ?? 0)),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/daily5");
    },
    onError: (error: Error) => {
      if (error?.name === "TypeError" || /failed to fetch|load failed|network/i.test(error?.message || "")) {
        trackSignupError("network", "auth");
      }
      const taken = error instanceof ApiError && error.code === "email_taken";
      setEmailTaken(taken);
      if (taken) return;
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
      // Invalidate and refetch auth state before navigating
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      const message = error?.message || "Invalid username or password";
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const onSignup = (data: SignupFormData) => {
    setEmailTaken(false);
    if (!startedEmail.current) {
      startedEmail.current = true;
      trackSignupStarted("email", "auth");
    }
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
          <CardTitle className="text-2xl font-bold">PackPTS</CardTitle>
          <CardDescription>
            Guess the player. Earn points. Redeem rewards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SocialAuthButtons
            surface="auth"
            disabled={signupMutation.isPending || loginMutation.isPending}
          />
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
              <Form {...signupForm}>
                <form
                  onSubmit={signupForm.handleSubmit(onSignup, () => trackSignupError("validation", "auth"))}
                  onFocus={() => {
                    if (startedEmail.current) return;
                    startedEmail.current = true;
                    trackSignupStarted("email", "auth");
                  }}
                  className="space-y-4"
                >
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
                  {emailTaken && (
                    <div className="space-y-2" data-testid="signup-email-taken">
                      <p className="text-sm text-destructive">This email already has an account.</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full min-h-11"
                        data-testid="button-signup-email-login"
                        onClick={() => {
                          loginForm.setValue("usernameOrEmail", signupForm.getValues("email"));
                          setActiveTab("login");
                        }}
                      >
                        Log in
                      </Button>
                    </div>
                  )}
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={signupMutation.isPending}
                    data-testid="button-signup-submit"
                  >
                    {signupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Account
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>

          <p className="text-center text-xs text-muted-foreground">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
