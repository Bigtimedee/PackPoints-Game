import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

interface DailyProgressResponse {
  dayDate: string;
  cardsAnswered: number;
  matchesCompleted: number;
  capCards: number;
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

export const DAILY_PROGRESS_QUERY_KEY = ["dailyProgress"];

export function useDailyProgress() {
  const { data, isLoading, refetch, error } = useQuery<DailyProgressResponse | null>({
    queryKey: DAILY_PROGRESS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/progress/daily", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error("Failed to fetch daily progress");
      }
      return res.json();
    },
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

  const cardsAnswered = data?.cardsAnswered ?? 0;
  const capCards = data?.capCards ?? 200;
  const percentUsed = capCards > 0 ? Math.min(100, (cardsAnswered / capCards) * 100) : 0;
  const isAtCap = cardsAnswered >= capCards;

  return {
    progress: data ?? null,
    cardsAnswered,
    cardsCompleted: cardsAnswered,
    cardsMax: capCards,
    capCards,
    matchesCompleted: data?.matchesCompleted ?? 0,
    dayDate: data?.dayDate ?? "",
    percentUsed,
    isAtCap,
    remaining: capCards - cardsAnswered,
    todayEarned: cardsAnswered,
    dailyCap: capCards,
    resetIn,
    isLoading,
    error,
    refetch,
  };
}
