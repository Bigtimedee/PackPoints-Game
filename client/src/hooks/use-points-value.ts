import { useQuery } from "@tanstack/react-query";
import { usdFor as usdForValue, type PointsValue } from "@/lib/pointsCopy";

// Rebates are live; never render off-state copy while the value loads (Dave lock).
const FALLBACK: PointsValue = { rebateLive: true, expiry: null };

export function usePointsValue() {
  const q = useQuery<PointsValue>({
    queryKey: ["/api/points/value"],
    queryFn: async () => {
      const res = await fetch("/api/points/value", { credentials: "omit" });
      if (!res.ok) throw new Error(`points value ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    retry: 1,
  });
  const value = q.data ?? FALLBACK;
  return {
    value,
    loaded: !!q.data,
    rebateLive: value.rebateLive === true,
    usdFor: (points: number) => usdForValue(value, points),
  };
}
