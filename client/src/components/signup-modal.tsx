import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trophy, Zap, User, Mail, Lock } from "lucide-react";
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

type SignupModalFormData = z.infer<typeof signupModalSchema>;

interface SignupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPoints: number;
  onSuccess?: () => void;
}

export function SignupModal({ open, onOpenChange, pendingPoints, onSuccess }: SignupModalProps) {
  const queryClient = useQueryClient();
  
  const form = useForm<SignupModalFormData>({
    resolver: zodResolver(signupModalSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
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
      // Directly set user data in cache from registration response to avoid session cookie race condition
      if (data.user) {
        queryClient.setQueryData(["/api/auth/user"], data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/guest/pending-points"] });
      // Invalidate profile stats so the profile page fetches fresh data with new session
      queryClient.invalidateQueries({ queryKey: ["/api/profile/stats"] });
      onOpenChange(false);
      form.reset();
      // Small delay to ensure session cookie is fully processed by browser before callbacks
      await new Promise(resolve => setTimeout(resolve, 150));
      if (onSuccess) onSuccess();
    },
    onError: (err: Error) => {
      form.setError("root", { message: err.message });
    },
  });

  const onSubmit = (data: SignupModalFormData) => {
    registerMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Save Your Points!
          </DialogTitle>
          <DialogDescription>
            Create an account to keep your earned points and track your progress on the leaderboard.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex items-center justify-center gap-2 py-4 px-4 rounded-md bg-primary/10">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold font-mono">{pendingPoints} points</span>
          <span className="text-muted-foreground">waiting to be claimed!</span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
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
                        data-testid="input-signup-username"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
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
                        data-testid="input-signup-email"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
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
                        data-testid="input-signup-password"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
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
                        data-testid="input-signup-confirm-password"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive" data-testid="text-signup-error">
                {form.formState.errors.root.message}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button 
                type="submit" 
                disabled={registerMutation.isPending}
                className="w-full"
                data-testid="button-signup-submit"
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
                data-testid="button-signup-skip"
              >
                Skip for Now
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
