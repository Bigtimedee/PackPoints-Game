import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";

const SET_ID = "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4";
const BASE = `/api/admin/held-sets/${SET_ID}`;
type Row = { cardId: string; player: string; number: string; isPlayable: boolean; source: string | null;
  blockedReason: string | null; maskReady: boolean; refusal: string | null; previewPath: string };

export function AdminHeldMaskReview() {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [excludeId, setExcludeId] = useState("");
  const [reason, setReason] = useState("");
  const ids = text.split(/[\s,]+/).filter(Boolean);
  const review = useQuery<{ cards: Row[] }>({ queryKey: [BASE + "/review"], enabled, retry: false });
  const job = useQuery<{ state: string; results: Array<{ cardId: string; status: string; reason?: string }> }>({
    queryKey: [BASE + `/prepare/${jobId}`], enabled: Boolean(jobId), retry: false,
    refetchInterval: (q) => q.state.data?.state === "running" ? 5000 : false,
  });
  const prepare = useMutation({ mutationFn: async () => {
    if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("Enter 1-20 unique card IDs.");
    const r = await apiRequest("POST", BASE + "/prepare", { cardIds: ids, reviewed: true }); return r.json();
  }, onSuccess: (data) => { setJobId(data.id); setChecked([]); setError(""); }, onError: (e: Error) => setError(e.message) });
  const approve = useMutation({ mutationFn: async () => {
    const r = await apiRequest("POST", BASE + "/approve-reviewed", { cardIds: checked, reviewed: true, maskVersion: CURRENT_MASK_VERSION, note }); return r.json();
  }, onSuccess: () => { setChecked([]); setError(""); void review.refetch(); }, onError: (e: Error) => setError(e.message) });
  const exclude = useMutation({ mutationFn: async () => {
    const r = await apiRequest("POST", `/api/admin/cards/${excludeId}/exclude`, { reason }); return r.json();
  }, onSuccess: () => { setExcludeId(""); setReason(""); setError(""); void review.refetch(); }, onError: (e: Error) => setError(e.message) });
  const selected = review.data?.cards.filter((r) => ids.includes(r.cardId)) ?? [];
  return <Card className="mt-6"><CardHeader><CardTitle>Held Donruss mask preparation</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm">The set stays held. Reading records and prepared previews never builds an image. POST preparation writes mask files and may record a refusal. Source screening alone is not QA approval.</p>
      <Button onClick={() => { setEnabled(true); if (enabled) void review.refetch(); }}>Read or refresh review records</Button>
      {review.error && <p role="alert">{String(review.error)}</p>}
      <label className="block">Explicit card IDs (1-20)
        <textarea className="w-full min-h-24 border rounded p-2" value={text} onChange={(e) => { setText(e.target.value); setChecked([]); }} placeholder="Paste exact reviewed candidate IDs, separated by commas or newlines" />
      </label>
      <Button disabled={prepare.isPending || job.data?.state === "running"} onClick={() => {
        if (window.confirm(`Prepare ${ids.length} exact candidate IDs? This writes production mask files. Donruss remains held.`)) prepare.mutate();
      }}>Prepare these masks (writes files)</Button>
      {jobId && <div><p>Job {jobId}: {job.data?.state ?? "loading"}</p>
        <ul>{job.data?.results.map((r) => <li key={r.cardId}>{r.cardId}: {r.status} {r.reason}</li>)}</ul>
        <Button onClick={() => void review.refetch()}>Refresh readiness after job</Button>
      </div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{selected.map((r) => <div key={r.cardId} className="border rounded p-3 space-y-2">
        <p>{r.player} #{r.number}</p><p className="text-xs break-all">{r.cardId}</p>
        <p className="text-sm">Approval: {r.source ?? "none"}. {r.blockedReason ?? r.refusal ?? "No recorded refusal"}</p>
        {r.maskReady && r.isPlayable ? <><img src={r.previewPath} alt={`Prepared name-covered ${r.player} card`} className="w-full" />
          <label className="text-sm"><input type="checkbox" checked={checked.includes(r.cardId)} onChange={(e) => setChecked((prev) => e.target.checked ? [...prev, r.cardId] : prev.filter((id) => id !== r.cardId))} /> I inspected these pixels: exact lower band, no exposed names/signatures, correct source.</label></>
          : <p>Not ready. Preview will not bake or repair it.</p>}
      </div>)}</div>
      <label className="block">Visual review note<Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Button disabled={!checked.length || !note.trim() || approve.isPending} onClick={() => {
        if (window.confirm(`Record explicit QA approval for ${checked.length} inspected masks? Existing seed records may be promoted to QA. The set remains held.`)) approve.mutate();
      }}>Approve only checked, inspected masks</Button>
      <hr />
      <p className="text-sm">Manual source exclusion. Existing quarantined rows cannot be restored here.</p>
      <label className="block">Exact card ID<Input value={excludeId} onChange={(e) => setExcludeId(e.target.value)} /></label>
      <label className="block">Exclusion reason<Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button variant="destructive" disabled={!reason.trim() || exclude.isPending || !review.data?.cards.some((r) => r.cardId === excludeId && r.isPlayable)} onClick={() => {
        const row = review.data?.cards.find((r) => r.cardId === excludeId);
        if (window.confirm(`Exclude ${row?.player} #${row?.number} (${excludeId})?\nReason: ${reason}`)) exclude.mutate();
      }}>Save this source exclusion</Button>
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </CardContent></Card>;
}
