import { usePointsValue } from "@/hooks/use-points-value";
import { SIGNUP_BODY_LIVE } from "@/lib/pointsCopy";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest, getStoredUtmParams } from "@/lib/queryClient";
import { trackSignupError, trackSignupStarted, trackSignupView } from "@/lib/signupFunnel";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { Loader2, Trophy, User, Mail, Lock, LogIn, RefreshCw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ANON_GATE_COPY, type AnonGateReason } from "@shared/anonGate";
import { EscrowHeldChip } from "@/components/anon-gate-plaque";
import { useGuestWallChrome } from "@/lib/guestWallChrome";
import { useToast } from "@/hooks/use-toast";
import { readSignupSavedLine } from "@/lib/signupSaved";

const signupModalSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
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
  /** signup and login both open on the account form. plaque is accepted and treated as signup. */
  openOn?: "plaque" | "signup" | "login";
}

export function SignupModal({ open, onOpenChange, pendingPoints, onSuccess, onPlayAgain, variant = "optional", gateReason: _gateReason, openOn = "signup" }: SignupModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"signup" | "login">("signup");
  const [emailTaken, setEmailTaken] = useState(false);
  const isGate = variant === "soft" || variant === "hard";
  const seenViews = useRef(new Set<string>());
  const startedEmail = useRef(false);
  // Hard wall dialog: hide the chat bubble and static footer while it is open.
  useGuestWallChrome(open && variant === "hard");

  useEffect(() => {
    if (!open) {
      seenViews.current.clear();
      startedEmail.current = false;
      return;
    }
    const key = `modal:${variant}`;
    if (seenViews.current.has(key)) return;
    seenViews.current.add(key);
    trackSignupView("modal", variant);
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(openOn === "login" ? "login" : "signup");
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
    onOpenChange(next);
  }
  
  const signupForm = useForm<SignupModalFormData>({
    resolver: zodResolver(signupModalSchema),
    defaultValues: {
      email: "",
      password: "",
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
          email: data.email,
          password: data.password,
          signupSurface: "modal",
          ...getStoredUtmParams(),
        });
        return res.json();
      } catch (error: any) {
        if (error.message === "Load failed" || error.message === "Failed to fetch" || error?.name === "TypeError") {
          trackSignupError("network", "modal");
          throw new Error("Network error. Please check your connection and try again.");
        }
        if (error instanceof ApiError && error.code === "email_taken") {
          throw error;
        }
        if (error.message.startsWith("409:") || error.status === 409) {
          throw new Error("Username or email already taken");
        }
        if (error.message.startsWith("400:") || error.status === 400) {
          throw new Error("Invalid email or password format");
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
      toast({
        title: "Account created!",
        description: await readSignupSavedLine(Number(data.user?.points ?? 0)),
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (onSuccess) onSuccess();
    },
    onError: (err: Error) => {
      const taken = err instanceof ApiError && err.code === "email_taken";
      setEmailTaken(taken);
      signupForm.setError("root", {
        message: taken ? "This email already has an account." : err.message,
      });
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
    setEmailTaken(false);
    if (!startedEmail.current) {
      startedEmail.current = true;
      trackSignupStarted("email", "modal");
    }
    registerMutation.mutate(data);
  };

  const onLoginSubmit = (data: LoginModalFormData) => {
    loginMutation.mutate(data);
  };

  const isPending = registerMutation.isPending || loginMutation.isPending;
  const title = variant === "hard" ? ANON_GATE_COPY.hardTitle : ANON_GATE_COPY.softTitle;
  const { rebateLive } = usePointsValue();
  const description = rebateLive ? SIGNUP_BODY_LIVE : variant === "hard" ? ANON_GATE_COPY.hardBody : ANON_GATE_COPY.softBody;
  const allowAnotherRound = variant === "optional" && !!onPlayAgain;

  return (
    <Dialog open={open} onOpenChange={isGate ? handleOpenChange : onOpenChange}>
      <DialogContent
        hideClose={variant === "hard"}
        className="w-[calc(100%-2rem)] gap-3 rounded-lg p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-md sm:gap-4 sm:p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
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
        
        <EscrowHeldChip points={pendingPoints} />

        <SocialAuthButtons surface="modal" disabled={isPending} />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "signup" | "login")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signup" data-testid="modal-tab-signup" disabled={isPending}>
              Sign Up
            </TabsTrigger>
            <TabsTrigger value="login" data-testid="modal-tab-login" disabled={isPending}>
              Log In
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signup" className="mt-3 sm:mt-4">
            <Form {...signupForm}>
              <form
                onSubmit={signupForm.handleSubmit(onSignupSubmit, () => trackSignupError("validation", "modal"))}
                onFocus={() => {
                  if (startedEmail.current) return;
                  startedEmail.current = true;
                  trackSignupStarted("email", "modal");
                }}
                className="space-y-3 sm:space-y-4"
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

                {signupForm.formState.errors.root && (
                  <p className="text-sm text-destructive" data-testid="text-modal-signup-error">
                    {signupForm.formState.errors.root.message}
                  </p>
                )}
                {emailTaken && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11"
                    data-testid="button-modal-signup-email-login"
                    onClick={() => {
                      loginForm.setValue("usernameOrEmail", signupForm.getValues("email"));
                      setActiveTab("login");
                    }}
                  >
                    Log in
                  </Button>
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
                        {variant === "hard" ? ANON_GATE_COPY.hardCta : ANON_GATE_COPY.softCta}
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
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="login" className="mt-3 sm:mt-4">
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-3 sm:space-y-4">
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
                        {ANON_GATE_COPY.signInCta}
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
                </div>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
        {variant === "soft" && (
          <Button
            type="button"
            variant="ghost"
            className="w-full min-h-11"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
            data-testid="button-modal-continue-once"
          >
            {ANON_GATE_COPY.softSecondary}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
