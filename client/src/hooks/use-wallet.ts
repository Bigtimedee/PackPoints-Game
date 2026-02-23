import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// Zod schema for type-safe wallet response validation
const WalletResponseSchema = z.object({
  wallet: z.object({
    id: z.string(),
    balance: z.number(),
    availablePts: z.number(),
    debtPts: z.number(),
    lifetimeEarned: z.number(),
    lifetimeSpent: z.number(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  riskState: z.object({
    status: z.enum(["NORMAL", "UNDER_REVIEW", "FROZEN"]),
    reason: z.string().optional(),
  }),
  recentTransactions: z.array(z.object({
    id: z.string(),
    type: z.string(),
    amount: z.number(),
    balanceAfter: z.number(),
    reason: z.string(),
    createdAt: z.string(),
  })),
});

type WalletData = z.infer<typeof WalletResponseSchema>;

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
  
  // Validate response shape in development
  if (import.meta.env.DEV) {
    const result = WalletResponseSchema.safeParse(data);
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
  const { data, isLoading, refetch, error } = useQuery<WalletData | null>({
    queryKey: ["/wallet"],
    queryFn: fetchWallet,
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
