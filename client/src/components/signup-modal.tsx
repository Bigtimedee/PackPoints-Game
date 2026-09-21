import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trophy, Zap, User, Mail, Lock, LogIn, RefreshCw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ANON_GATE_COPY, type AnonGateReason } from "@shared/anonGate";
import { AnonGatePlaque, EscrowHeldChip } from "@/components/anon-gate-plaque";

const signupModalSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be 20 characters or less").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const loginModalSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

type SignupModalFormData = z.infer<typeof signupModalSchema>;
type LoginModalFormData = z.infer<typeof loginModalSchema>;

interface SignupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPoints: number;
  onSuccess?: () => void;
  /** Optional legacy modal only. Soft dismiss does not start another round. */
  onPlayAgain?: () => void;
  variant?: "optional" | "soft" | "hard";
  gateReason?: AnonGateReason;
  /** Plaque is the locked sheet. signup/login skips to the account form. */
  openOn?: "plaque" | "signup" | "login";
}

export function SignupModal({ open, onOpenChange, pendingPoints, onSuccess, onPlayAgain, variant = "optional", gateReason: _gateReason, openOn = "plaque" }: SignupModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"signup" | "login">("signup");
  const [step, setStep] = useState<"plaque" | "form">("plaque");
  const isGate = variant === "soft" || variant === "hard";

  useEffect(() => {
    if (!open) return;
    if (openOn === "signup" || openOn === "login") {
      setActiveTab(openOn);
      setStep("form");
    } else {
      setStep("plaque");
    }
  }, [open, openOn]);

  async function dismissSoft() {
    if (variant !== "soft") return;
    try {
      await apiRequest("POST", "/api/anon/soft-dismiss");
    } catch {
      /* still close; the sheet must not trap a guest who can play once more */
    }
    queryClient.invalidateQueries({ queryKey: ["/api/anon/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/daily5/status"] });
  }

  function handleOpenChange(next: boolean) {
    if (!next && variant === "hard") return;
    if (!next && variant === "soft") void dismissSoft();
    if (!next) setStep("plaque");
    onOpenChange(next);
  }
  
  const signupForm = useForm<SignupModalFormData>({
    resolver: zodResolver(signupModalSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const loginForm = useForm<LoginModalFormData>({
    resolver: zodResolver(loginModalSchema),
    defaultValues: {
      usernameOrEmail: "",
      password: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: SignupModalFormData) => {
      try {
        const res = await apiRequest("POST", "/api/auth/register", {
          username: data.username,
          email: data.email,
          password: data.password,
        });
        return res.json();
      } catch (error: any) {
        if (error.message === "Load failed" || error.message === "Failed to fetch") {
          throw new Error("Network error. Please check your connection and try again.");
        }
        if (error.message.startsWith("409:")) {
          throw new Error("Username or email already taken");
        }
        if (error.message.startsWith("400:")) {
          throw new Error("Invalid username, email, or password format");
        }
        throw error;
      }
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/guest/pending-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });
      onOpenChange(false);
      signupForm.reset();
      await new Promise(resolve => setTimeout(resolve, 150));
      if (onSuccess) onSuccess();
    },
    onError: (err: Error) => {
      signupForm.setError("root", { message: err.message });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginModalFormData) => {
      try {
        const res = await apiRequest("POST", "/api/auth/local-login", data);
        return res.json();
      } catch (error: any) {
        if (error.message === "Load failed" || error.message === "Failed to fetch") {
          throw new Error("Network error. Please check your connection and try again.");
        }
        if (error.message.startsWith("401:")) {
          throw new Error("Invalid username or password");
        }
        throw error;
      }
    },
    onSuccess: async (data) => {
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/guest/pending-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });
      onOpenChange(false);
      loginForm.reset();
      await new Promise(resolve => setTimeout(resolve, 150));
      if (onSuccess) onSuccess();
    },
    onError: (err: Error) => {
      loginForm.setError("root", { message: err.message });
    },
  });

  const onSignupSubmit = (data: SignupModalFormData) => {
    registerMutation.mutate(data);
  };

  const onLoginSubmit = (data: LoginModalFormData) => {
    loginMutation.mutate(data);
  };

  const isPending = registerMutation.isPending || loginMutation.isPending;
  const title = variant === "hard"
    ? ANON_GATE_COPY.hardTitle
    : variant === "soft"
      ? ANON_GATE_COPY.softTitle
      : "Save Your Points!";
  const description = variant === "hard"
    ? ANON_GATE_COPY.hardBody
    : variant === "soft"
      ? ANON_GATE_COPY.softBody
      : "Sign up for a new account or log in to your existing account to claim your points.";
  const allowAnotherRound = variant === "optional" && !!onPlayAgain;

  if (isGate && step === "plaque") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          hideClose={variant === "hard"}
          className="max-w-[390px] gap-0 border-0 bg-transparent p-0 shadow-none"
          onEscapeKeyDown={(event) => {
            if (variant === "hard") event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (variant === "hard") event.preventDefault();
          }}
          data-testid={variant === "hard" ? "dialog-anon-hard-gate" : "dialog-anon-soft-gate"}
        >
          <AnonGatePlaque
            variant={variant}
            escrowPoints={pendingPoints}
            onCreate={() => {
              setActiveTab("signup");
              setStep("form");
            }}
            onSignIn={() => {
              setActiveTab("login");
              setStep("form");
            }}
            onContinue={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={isGate ? handleOpenChange : onOpenChange}>
      <DialogContent
        hideClose={variant === "hard"}
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (variant === "hard") event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (variant === "hard") event.preventDefault();
        }}
        data-testid={variant === "hard" ? "dialog-anon-hard-gate" : variant === "soft" ? "dialog-anon-soft-gate" : "dialog-signup"}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        
        {isGate ? (
          <EscrowHeldChip points={pendingPoints} />
        ) : pendingPoints > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-md bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
              <span className="text-lg font-bold font-mono">{pendingPoints} points</span>
              <span className="text-muted-foreground">earned this game</span>
            </div>
            <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-green-500/10 border border-green-500/20">
              <Trophy className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700 dark:text-green-400">+250 bonus PackPTS for new accounts!</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 px-4 rounded-md bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold font-mono">250 free PackPTS</span>
            <span className="text-muted-foreground">on signup!</span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "signup" | "login")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signup" data-testid="modal-tab-signup" disabled={isPending}>
              Sign Up
            </TabsTrigger>
            <TabsTrigger value="login" data-testid="modal-tab-login" disabled={isPending}>
              Log In
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signup" className="mt-4">
            <Form {...signupForm}>
              <form onSubmit={signupForm.handleSubmit(onSignupSubmit)} className="space-y-4">
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
                            {...field}
                            disabled={registerMutation.isPending}
                            data-testid="input-modal-signup-username"
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
                            {...field}
                            disabled={registerMutation.isPending}
                            data-testid="input-modal-signup-email"
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
                            {...field}
                            disabled={registerMutation.isPending}
                            data-testid="input-modal-signup-password"
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
                            {...field}
                            disabled={registerMutation.isPending}
                            data-testid="input-modal-signup-confirm-password"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {signupForm.formState.errors.root && (
                  <p className="text-sm text-destructive" data-testid="text-modal-signup-error">
                    {signupForm.formState.errors.root.message}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <Button 
                    type="submit" 
                    disabled={registerMutation.isPending}
                    className="w-full min-h-11"
                    data-testid="button-modal-signup-submit"
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <User className="h-4 w-4 mr-2" />
                        {variant === "hard" ? ANON_GATE_COPY.hardCta : variant === "soft" ? ANON_GATE_COPY.softCta : "Create Account & Claim Points"}
                      </>
                    )}
                  </Button>
                  {allowAnotherRound ? (
                    <Button 
                      type="button" 
                      variant="outline"
                      className="w-full min-h-11"
                      onClick={() => {
                        onOpenChange(false);
                        onPlayAgain?.();
                      }}
                      disabled={registerMutation.isPending}
                      data-testid="button-modal-play-again"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Play Again
                    </Button>
                  ) : variant === "optional" ? (
                    <Button 
                      type="button" 
                      variant="ghost"
                      className="w-full min-h-11"
                      onClick={() => onOpenChange(false)}
                      disabled={registerMutation.isPending}
                      data-testid="button-modal-skip"
                    >
                      Skip for Now
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11"
                    onClick={() => { window.location.href = "/api/auth/workos/start"; }}
                    disabled={isPending}
                    data-testid="button-modal-workos-signup"
                  >
                    Continue with WorkOS
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="login" className="mt-4">
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
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
                            disabled={loginMutation.isPending}
                            data-testid="input-modal-login-username"
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
                            disabled={loginMutation.isPending}
                            data-testid="input-modal-login-password"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {loginForm.formState.errors.root && (
                  <p className="text-sm text-destructive" data-testid="text-modal-login-error">
                    {loginForm.formState.errors.root.message}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <Button 
                    type="submit" 
                    disabled={loginMutation.isPending}
                    className="w-full min-h-11"
                    data-testid="button-modal-login-submit"
                  >
                    {loginMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Logging In...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4 mr-2" />
                        {variant === "optional" ? "Log In & Claim Points" : ANON_GATE_COPY.signInCta}
                      </>
                    )}
                  </Button>
                  {allowAnotherRound ? (
                    <Button 
                      type="button" 
                      variant="outline"
                      className="w-full min-h-11"
                      onClick={() => {
                        onOpenChange(false);
                        onPlayAgain?.();
                      }}
                      disabled={loginMutation.isPending}
                      data-testid="button-modal-play-again-login"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Play Again
                    </Button>
                  ) : variant === "optional" ? (
                    <Button 
                      type="button" 
                      variant="ghost"
                      className="w-full min-h-11"
                      onClick={() => onOpenChange(false)}
                      disabled={loginMutation.isPending}
                      data-testid="button-modal-skip"
                    >
                      Skip for Now
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11"
                    onClick={() => { window.location.href = "/api/auth/workos/start"; }}
                    disabled={isPending}
                    data-testid="button-modal-workos"
                  >
                    Continue with WorkOS
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
