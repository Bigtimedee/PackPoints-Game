import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trophy, Zap, User, Mail, Lock, LogIn } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

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
}

export function SignupModal({ open, onOpenChange, pendingPoints, onSuccess }: SignupModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"signup" | "login">("signup");
  
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Save Your Points!
          </DialogTitle>
          <DialogDescription>
            Sign up for a new account or log in to your existing account to claim your points.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex items-center justify-center gap-2 py-4 px-4 rounded-md bg-primary/10">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold font-mono">{pendingPoints} points</span>
          <span className="text-muted-foreground">waiting to be claimed!</span>
        </div>

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
                    className="w-full"
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
                        Create Account & Claim Points
                      </>
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => onOpenChange(false)}
                    disabled={registerMutation.isPending}
                    data-testid="button-modal-skip"
                  >
                    Skip for Now
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
                    className="w-full"
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
                        Log In & Claim Points
                      </>
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => onOpenChange(false)}
                    disabled={loginMutation.isPending}
                    data-testid="button-modal-skip"
                  >
                    Skip for Now
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
