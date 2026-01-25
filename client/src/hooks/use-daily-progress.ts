import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

interface DailyProgressResponse {
  todayEarned: number;
  dailyCap: number;
  remaining: number;
  percentUsed: number;
  isAtCap: boolean;
  cardsCompleted: number;
  cardsMax: number;
  dayKey: string;
}

function getLocalMidnightReset(): { hours: number; minutes: number; ms: number } {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msUntilReset = tomorrow.getTime() - now.getTime();
  return {
    hours: Math.floor(msUntilReset / (1000 * 60 * 60)),
    minutes: Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60)),
    ms: msUntilReset,
  };
}

export function useDailyProgress() {
  const { data, isLoading, refetch, error } = useQuery<DailyProgressResponse | null>({
    queryKey: ["/api/user/daily-progress"],
    retry: false,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const [resetIn, setResetIn] = useState(getLocalMidnightReset);

  useEffect(() => {
    const interval = setInterval(() => {
      setResetIn(getLocalMidnightReset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return {
    progress: data ?? null,
    todayEarned: data?.todayEarned ?? 0,
    dailyCap: data?.dailyCap ?? 15000,
    remaining: data?.remaining ?? 15000,
    percentUsed: data?.percentUsed ?? 0,
    isAtCap: data?.isAtCap ?? false,
    cardsCompleted: data?.cardsCompleted ?? 0,
    cardsMax: data?.cardsMax ?? 200,
    dayKey: data?.dayKey ?? "",
    resetIn,
    isLoading,
    error,
    refetch,
  };
}
