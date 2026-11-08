import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { bindAuthResume } from "@/lib/adminSessionRecovery";
import { AUTH_USER_QUERY_KEY, authUserQueryFn, clearAuthSession, scheduleAuthResume } from "@/lib/authRead";

async function logout(): Promise<void> {
  await fetch("/api/auth/local-logout", {
    method: "POST",
    credentials: "include",
  });
  // Hard navigation home so all in-memory auth state resets
  window.location.href = "/";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading, refetch } = useQuery<User | null>({
    queryKey: AUTH_USER_QUERY_KEY,
    queryFn: authUserQueryFn(queryClient),
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      void clearAuthSession(queryClient);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    return bindAuthResume(window, () => {
      void scheduleAuthResume(() => refetch());
    });
  }, [refetch]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    refetch,
  };
}
