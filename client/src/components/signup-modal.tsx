import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Trophy, Zap, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterRequest } from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface SignupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingPoints: number;
  onSuccess?: () => void;
}

export function SignupModal({ open, onOpenChange, pendingPoints, onSuccess }: SignupModalProps) {
  const queryClient = useQueryClient();
  
  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterRequest) => {
      const res = await apiRequest("POST", "/api/auth/register", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Registration failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/pending-points"] });
      onOpenChange(false);
      form.reset();
      if (onSuccess) onSuccess();
    },
    onError: (err: Error) => {
      form.setError("root", { message: err.message });
    },
  });

  const onSubmit = (data: RegisterRequest) => {
    registerMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                    <Input
                      placeholder="Choose a username"
                      {...field}
                      disabled={registerMutation.isPending}
                      data-testid="input-signup-username"
                    />
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
                    <Input
                      type="password"
                      placeholder="Choose a password"
                      {...field}
                      disabled={registerMutation.isPending}
                      data-testid="input-signup-password"
                    />
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
