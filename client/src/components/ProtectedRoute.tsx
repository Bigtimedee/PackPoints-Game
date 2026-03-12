import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "wouter";
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
  const [location] = useLocation();
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30_000,
  });

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

  if (requireAdmin) {
    if (!user) {
      return <Navigate to={redirectTo || `/auth?redirect=${encodeURIComponent(location)}`} />;
    }
    if (user.role !== 'admin') {
      return <Navigate to={redirectTo || "/"} />;
    }
  }

  if (requireAuth && !user) {
    return <Navigate to={redirectTo || `/auth?redirect=${encodeURIComponent(location)}`} />;
  }

  return <>{children}</>;
}
