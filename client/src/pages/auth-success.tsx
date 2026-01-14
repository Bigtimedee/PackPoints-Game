import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Loader2, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface User {
  id: string;
  username: string | null;
  email: string | null;
}

export default function AuthSuccess() {
  const [, setLocation] = useLocation();

  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: 3,
    retryDelay: 500,
  });

  useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const timer = setTimeout(() => {
        setLocation("/");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [user, setLocation]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setLocation("/auth?error=session_failed");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [error, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
      <Card className="w-full max-w-sm" data-testid="card-auth-success">
        <CardContent className="pt-6 text-center space-y-4">
          {isLoading ? (
            <>
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <p className="text-lg font-medium">Signing you in...</p>
              <p className="text-sm text-muted-foreground">Please wait a moment</p>
            </>
          ) : user ? (
            <>
              <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
              <p className="text-lg font-medium">Welcome, {user.username || "Player"}!</p>
              <p className="text-sm text-muted-foreground">Redirecting you to the app...</p>
            </>
          ) : error ? (
            <>
              <p className="text-lg font-medium text-destructive">Sign in failed</p>
              <p className="text-sm text-muted-foreground">Redirecting to login...</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
