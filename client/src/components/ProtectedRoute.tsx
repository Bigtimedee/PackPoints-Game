import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthUser } from "@/types/api";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requireAdmin?: boolean;
  redirectTo?: string;
}

/**
 * Route guard component.
 *
 * Usage:
 *   <ProtectedRoute requireAuth>  — redirects to /auth if not logged in
 *   <ProtectedRoute requireAdmin> — redirects to / if not admin
 */
export function ProtectedRoute({
  children,
  requireAuth = false,
  requireAdmin = false,
  redirectTo,
}: ProtectedRouteProps) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isLoading) return;

    if (requireAdmin) {
      if (!user) {
        setLocation(redirectTo || `/auth?redirect=${encodeURIComponent(location)}`);
        return;
      }
      if (user.role !== 'admin') {
        setLocation(redirectTo || "/");
        return;
      }
    }

    if (requireAuth && !user) {
      setLocation(redirectTo || `/auth?redirect=${encodeURIComponent(location)}`);
    }
  }, [isLoading, user, requireAuth, requireAdmin, redirectTo, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
