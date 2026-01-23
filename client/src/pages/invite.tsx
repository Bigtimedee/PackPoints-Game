import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Gift, CheckCircle2, XCircle, Sparkles, ArrowRight } from "lucide-react";
import { useLocation, useSearch } from "wouter";

const inviteSchema = z.object({
  code: z.string().min(1, "Invite code is required").transform(val => val.toUpperCase().trim()),
});

type InviteFormData = z.infer<typeof inviteSchema>;

export default function InvitePage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [validationResult, setValidationResult] = useState<any>(null);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const urlParams = new URLSearchParams(searchString);
  const codeFromUrl = urlParams.get("code");

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      code: codeFromUrl || "",
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/access/validate-invite", { code });
      return response.json();
    },
    onSuccess: (data) => {
      setValidationResult(data);
      if (!data.valid) {
        toast({
          title: "Invalid Code",
          description: data.error || "This invite code cannot be used.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      setValidationResult({ valid: false, error: error?.message || "Failed to validate code" });
    },
  });

  const consumeMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/access/consume-invite", { code });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      
      if (data.activated) {
        toast({
          title: "Welcome to PackPTS!",
          description: "Your account is now active. Start playing!",
        });
        setLocation("/");
      } else if (data.sessionStored) {
        toast({
          title: "Code Verified!",
          description: "Complete your signup to claim your spot.",
        });
        setLocation("/auth?tab=signup");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to use invite",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (codeFromUrl && !validationResult) {
      validateMutation.mutate(codeFromUrl);
    }
  }, [codeFromUrl]);

  const onValidate = (data: InviteFormData) => {
    setValidationResult(null);
    validateMutation.mutate(data.code);
  };

  const handleUseCode = () => {
    const code = form.getValues("code");
    consumeMutation.mutate(code);
  };

  if (user?.status === "ACTIVE") {
    return (
      <div className="container max-w-lg mx-auto py-12 px-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Already Activated!</CardTitle>
            <CardDescription>
              Your account is already active. No invite code needed.
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

  return (
    <div className="container max-w-lg mx-auto py-12 px-4">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Enter Invite Code</CardTitle>
          <CardDescription>
            Skip the waitlist with an invite code from a friend or the PackPTS team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onValidate)} className="space-y-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invite Code</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Gift className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          {...field}
                          placeholder="XXXX-XXXX"
                          className="pl-10 uppercase font-mono text-lg tracking-wider text-center"
                          data-testid="input-invite-code"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!validationResult && (
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={validateMutation.isPending}
                  data-testid="button-validate-code"
                >
                  {validateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    "Validate Code"
                  )}
                </Button>
              )}
            </form>
          </Form>

          {validationResult && (
            <div className={`p-4 rounded-lg border ${
              validationResult.valid 
                ? "bg-green-500/10 border-green-500/30" 
                : "bg-destructive/10 border-destructive/30"
            }`}>
              {validationResult.valid ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="font-medium text-green-600 dark:text-green-400">Valid Invite Code</span>
                  </div>
                  
                  {validationResult.invite && (
                    <div className="space-y-2 text-sm">
                      {validationResult.invite.reservedSeat && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="bg-amber-500/20 text-amber-600">
                            <Sparkles className="w-3 h-3 mr-1" />
                            Reserved Seat
                          </Badge>
                          <span className="text-muted-foreground">Guaranteed spot</span>
                        </div>
                      )}
                      {validationResult.invite.maxUses && (
                        <p className="text-muted-foreground">
                          Uses remaining: {validationResult.invite.maxUses - (validationResult.invite.usedCount || 0)}
                        </p>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={handleUseCode}
                    disabled={consumeMutation.isPending}
                    data-testid="button-use-invite"
                  >
                    {consumeMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Activating...
                      </>
                    ) : user ? (
                      <>
                        Activate My Account
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    ) : (
                      <>
                        Continue to Sign Up
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-destructive" />
                  <span className="text-destructive">
                    {validationResult.error || "Invalid or expired code"}
                  </span>
                </div>
              )}
            </div>
          )}

          {validationResult && !validationResult.valid && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setValidationResult(null);
                form.reset();
              }}
              data-testid="button-try-another"
            >
              Try Another Code
            </Button>
          )}

          <div className="text-center text-sm text-muted-foreground">
            <p>Don't have an invite code?</p>
            <Button
              variant="ghost"
              className="p-0 h-auto text-primary hover:text-primary/80"
              onClick={() => setLocation("/waitlist")}
              data-testid="link-join-waitlist"
            >
              Join the Waitlist
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
