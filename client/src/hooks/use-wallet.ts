import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

interface WalletData {
  wallet: {
    id: string;
    balance: number;
    availablePts: number;
    debtPts: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    rebateBalanceCents?: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  riskState: { status: "NORMAL" | "UNDER_REVIEW" | "FROZEN"; reason?: string };
  recentTransactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    reason: string;
    createdAt: string;
  }>;
}

async function fetchWallet(): Promise<WalletData | null> {
  const response = await fetch("/wallet", {
    credentials: "include",
  });

  if (response.status === 401 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Validate response shape in development. Zod stays out of the production shell.
  if (import.meta.env.DEV) {
    const { z } = await import("zod");
    const result = z.object({
      wallet: z.object({ availablePts: z.number(), balance: z.number(), debtPts: z.number() }),
      riskState: z.object({ status: z.string() }),
    }).safeParse(data);
    if (!result.success) {
      console.error("[useWallet] Invalid wallet response shape:", result.error.issues);
      console.error("[useWallet] Received data:", data);
    }
  }
  
  // Dev assertion for critical numeric fields
  if (import.meta.env.DEV) {
    if (!Number.isFinite(data?.wallet?.availablePts)) {
      console.error("[useWallet] wallet.availablePts is invalid:", data?.wallet?.availablePts, data);
    }
    if (!Number.isFinite(data?.wallet?.balance)) {
      console.error("[useWallet] wallet.balance is invalid:", data?.wallet?.balance, data);
    }
    if (!Number.isFinite(data?.wallet?.debtPts)) {
      console.error("[useWallet] wallet.debtPts is invalid:", data?.wallet?.debtPts, data);
    }
  }

  return data;
}

export function useWallet() {
  const { isAuthenticated } = useAuth();
  const { data, isLoading, refetch, error } = useQuery<WalletData | null>({
    queryKey: ["/wallet"],
    queryFn: fetchWallet,
    enabled: isAuthenticated,
    retry: 2,
    retryDelay: 1000,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const riskStatus = data?.riskState?.status ?? "NORMAL";
  const isRestricted = riskStatus === "FROZEN" || riskStatus === "UNDER_REVIEW";
  const debtPts = data?.wallet?.debtPts ?? 0;
  const availablePts = data?.wallet?.availablePts ?? 0;
  
  // Compute if user can redeem (status normal, no debt, has points)
  const canRedeem = riskStatus === "NORMAL" && debtPts === 0;

  return {
    wallet: data?.wallet ?? null,
    riskState: data?.riskState ?? { status: "NORMAL" as const },
    recentTransactions: data?.recentTransactions ?? [],
    isLoading,
    error,
    refetch,
    // Convenience accessors for consistent usage across the app
    availablePts,
    debtPts,
    canRedeem,
    // isRestricted is true for both FROZEN and UNDER_REVIEW (blocks earning)
    isRestricted,
    isFrozen: riskStatus === "FROZEN",
    isUnderReview: riskStatus === "UNDER_REVIEW",
    restrictedReason: data?.riskState?.reason,
  };
}
