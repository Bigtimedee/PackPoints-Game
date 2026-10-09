import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

export function GuestClaimNotice() {
  const { data } = useQuery<{guestClaim?: {status: string; message: string}}>({queryKey: ["/api/auth/user"], retry: false});
  const retry = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/guest/claim")).json(),
    onSuccess: () => { queryClient.invalidateQueries({queryKey: ["/api/auth/user"]}); queryClient.invalidateQueries({queryKey: ["/api/profile/stats"]}); queryClient.invalidateQueries({queryKey: ["/api/guest/pending-points"]}); },
  });
  if (data?.guestClaim?.status !== "pending") return null;
  return <aside role="status" className="m-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="guest-claim-notice">
    <p>{data.guestClaim.message}</p>
    <Button className="mt-2" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? "Retrying…" : "Retry guest points transfer"}</Button>
    {retry.isError && <p className="mt-2">The transfer is still pending. Your saved guest points haven't been discarded. Contact support if you've finished your Daily5 entry.</p>}
  </aside>;
}
