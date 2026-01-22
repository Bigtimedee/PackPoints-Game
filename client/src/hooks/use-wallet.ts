import { useQuery } from "@tanstack/react-query";

interface WalletData {
  wallet: {
    id: string;
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  riskState: {
    status: "NORMAL" | "UNDER_REVIEW" | "FROZEN";
    reason?: string;
  };
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

  return response.json();
}

export function useWallet() {
  const { data, isLoading, refetch, error } = useQuery<WalletData | null>({
    queryKey: ["/wallet"],
    queryFn: fetchWallet,
    retry: false,
    staleTime: 1000 * 30, // 30 seconds
  });

  const status = data?.riskState?.status ?? "NORMAL";
  const isRestricted = status === "FROZEN" || status === "UNDER_REVIEW";

  return {
    wallet: data?.wallet ?? null,
    riskState: data?.riskState ?? { status: "NORMAL" as const },
    recentTransactions: data?.recentTransactions ?? [],
    isLoading,
    error,
    refetch,
    // isRestricted is true for both FROZEN and UNDER_REVIEW (blocks earning)
    isRestricted,
    isFrozen: status === "FROZEN",
    isUnderReview: status === "UNDER_REVIEW",
    restrictedReason: data?.riskState?.reason,
  };
}
