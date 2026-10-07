import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
type Preflight = { parameters:{set:string;category?:string};totalCards:number|null;pages:number|null;sampleCount:number;observedAt:string;warning:string;cards:{id:string;player:string;set:string;number:string;description:string;imageUrl:string|null}[] };
export function AdminImportPreflight({query,category,onImport,importing=false}:{query:string;category:string;onImport?:()=>void;importing?:boolean}) {
  const [acknowledged,setAcknowledged]=useState(false);
  const check=useMutation({mutationFn:async()=>{
    const response=await apiRequest('POST','/api/admin/playable-sets/import-preflight',{set:query,category},{timeoutMs:120000});
    return response.json() as Promise<Preflight>;
  },onMutate:()=>setAcknowledged(false)});
  const snapshot=!check.isPending && !check.isError && check.data?.parameters.set===query && (check.data.parameters.category||'')===category ? check.data : undefined;
  return <section className="space-y-3 rounded border p-3" data-testid="import-preflight">
    <h3 className="font-medium">Verify exact import scope</h3>
    <p className="text-sm text-muted-foreground">This checks the importer's exact set and category, not general-search matches. It does not import or publish cards.</p>
    <p className="text-sm break-words">Set: {query || 'Not configured'} · category: {category || 'Any'}</p>
    <Button type="button" variant="outline" disabled={!query.trim()||check.isPending||importing} onClick={()=>check.mutate()} data-testid="button-import-preflight">{check.isPending?'Checking provider…':'Check exact source'}</Button>
    {check.error&&<p role="alert" className="text-sm text-destructive">{check.error.message}</p>}
    {snapshot&&<>
      <p role="status" className="text-sm">Provider-reported total: {snapshot.totalCards===null?'unknown':snapshot.totalCards} · pages: {snapshot.pages===null?'unknown':snapshot.pages} · first-page sample: {snapshot.sampleCount}. Checked {new Date(snapshot.observedAt).toLocaleTimeString()}.</p>
      <p className="text-xs text-muted-foreground">{snapshot.warning}</p>
      {snapshot.totalCards===0&&<p className="text-sm text-destructive">No exact-set matches. Correct the query before importing.</p>}
      {snapshot.totalCards!==null&&snapshot.totalCards>2500&&<p className="text-sm text-destructive">This exceeds the self-service preparation limit of 2,500 cards.</p>}
      <div className="max-h-60 overflow-y-auto space-y-2">{snapshot.cards.map((card,i)=><div key={card.id||i} className="flex gap-3 rounded border p-2">{card.imageUrl&&<a href={card.imageUrl} target="_blank" rel="noreferrer"><img src={card.imageUrl} alt={`Source sample: ${card.player||card.description}`} className="h-28 w-20 object-contain" /></a>}<div className="text-sm"><p>{card.player || card.description}</p><p>{card.set} · #{card.number}</p></div></div>)}</div>
      <p className="text-xs text-muted-foreground">Open source samples to inspect the name placement. These are not prepared masks, layout approval, or complete set review.</p>
      {onImport&&<><label className="block text-sm"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={importing||check.isPending}/> I reviewed the exact query and scope; import every matching page{snapshot.totalCards===null?' even though the provider total is unknown':''}.</label><Button type="button" disabled={!acknowledged||snapshot.totalCards===0||check.isPending||importing} onClick={onImport} data-testid="button-confirm-preflight-import">{importing?'Importing…':'Import checked source'}</Button></>}
    </>}
  </section>;
}
