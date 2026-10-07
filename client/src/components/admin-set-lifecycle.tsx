import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type Challenge = { key:string;sourceHash:string;previewHash:string;planHash:string };
type Review = {id:string;player:string;number:string|null;status:string;eligible:boolean;reason:string|null;challenge:Challenge|null;previewUrl:string|null;sourceUrl:string|null};
type Snapshot = {set:{setName:string;isActive:boolean};lifecycle:{revision:string;published:boolean;profile:{nameAnchor?:string;topBandPct?:number;bottomBandPct?:number;fixedNameBand?:boolean}|null}|null;registeredProfile:unknown;cards:Review[];counts:Record<string,number>;jobs:{request_id:string;results:Record<string,{status:string}>}[]};
export function AdminSetLifecycle({setId,onClose}:{setId:string;onClose:()=>void}) {
  const base=`/api/admin/set-lifecycle/${setId}`;
  const {data,error,refetch,isFetching}=useQuery<Snapshot>({queryKey:[base],refetchInterval:5000});
  const [edge,setEdge]=useState('bottom');const [height,setHeight]=useState(16);
  useEffect(()=>{
    const profile=data?.lifecycle?.profile;
    if(profile?.nameAnchor==='top'||profile?.nameAnchor==='bottom'){
      setEdge(profile.nameAnchor);
      const fraction=profile.nameAnchor==='top'?profile.topBandPct:profile.bottomBandPct;
      if(typeof fraction==='number'&&Number.isFinite(fraction))setHeight(Math.round(fraction*10000)/100);
    }
  },[data?.lifecycle?.revision]);
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [selected,setSelected]=useState<string|null>(null);
  const [sourceReviewed,setSourceReviewed]=useState(false);const [maskReviewed,setMaskReviewed]=useState(false);const [note,setNote]=useState('');
  const [sourceLoaded,setSourceLoaded]=useState(false);const [maskLoaded,setMaskLoaded]=useState(false);
  const [filter,setFilter]=useState('needs-review');
  const storageKey=`admin-set-preparation:${setId}`;
  const [pendingRequest,setPendingRequest]=useState<string|null>(()=>localStorage.getItem(storageKey));
  const card=data?.cards.find(c=>c.id===selected);
  useEffect(()=>{setSourceReviewed(false);setMaskReviewed(false);setSourceLoaded(false);setMaskLoaded(false);setNote('');},[selected,card?.challenge?.key,card?.challenge?.sourceHash,card?.challenge?.previewHash,card?.challenge?.planHash]);
  useEffect(()=>{if(pendingRequest&&data?.jobs.some(j=>j.request_id===pendingRequest)){localStorage.removeItem(storageKey);setPendingRequest(null);}},[data,pendingRequest,storageKey]);
  async function action(suffix:string,body:unknown) {
    setBusy(true);setMessage('');
    try {const result=await (await apiRequest('POST',`${base}/${suffix}`,body,{timeoutMs:120000})).json();
      setMessage(result.published===true?'Published. Only current approved cards can be dealt.':result.approved?'Review saved.':result.accepted?'Preparation saved. You can close this panel; it continues after reload or restart.':'Saved.');
      await refetch();await queryClient.invalidateQueries({queryKey:['/api/admin/game-sets']});return true;
    }catch(e){setMessage(e instanceof Error?e.message:'Action failed. Refresh before retrying.');return false;}finally{setBusy(false);}
  }
  async function prepare() {const requestId=pendingRequest||crypto.randomUUID();localStorage.setItem(storageKey,requestId);setPendingRequest(requestId);
    if(await action('prepare',{requestId,allEligible:true})){localStorage.removeItem(storageKey);setPendingRequest(null);}}
  const working=(data?.counts.pending||0)+(data?.counts.processing||0);
  const rows=data?.cards.filter(c=>filter==='all'||filter==='needs-review'&&['ready','stale','unprepared','error'].includes(c.status)||filter==='excluded'&&c.status==='excluded')||[];
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{data?.set.setName||'Set'} · self-service release</DialogTitle><DialogDescription>Create and import on Playable Sets first. Save a layout, prepare every eligible card, inspect each source/mask pair, then publish. Existing protected releases keep their original workflow.</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="text-destructive">{error.message}</p>}
    {message&&<p role="status" className="rounded border p-3">{message}</p>}
    {!data&&!error&&<p>Loading saved progress…</p>}
    {data&&<>
      <section className="rounded border p-4 space-y-3"><h3 className="font-semibold">1. Layout</h3><p className="text-sm text-muted-foreground">{data.lifecycle?'Layout saved. Changing it invalidates prior approvals.':'No layout saved; this set remains held.'} Only simple full-width top/bottom name bands can be authored here. Slabs, diagonal names and multiple-name designs need a supported profile; do not use a guessed band.</p>
        <div className="flex flex-wrap items-end gap-3">
          {!!data.registeredProfile&&<Button disabled={busy||!!working} onClick={()=>action('layout',{mode:'registered'})}>Use registered layout</Button>}
          <label className="text-sm">Name band edge<select className="block border rounded p-2 bg-background" value={edge} onChange={e=>setEdge(e.target.value)}><option value="bottom">Bottom</option><option value="top">Top</option></select></label>
          <label className="text-sm">Height %<Input type="number" min={5} max={edge==='top'?35:55} value={height} onChange={e=>setHeight(Number(e.target.value))} className="w-24" /></label>
          <Button variant="outline" disabled={busy||!!working||height<5||height>(edge==='top'?35:55)} onClick={()=>action('layout',{mode:'custom',edge,height})}>Save name band</Button>
        </div>
      </section>
      <section className="rounded border p-4 space-y-3"><h3 className="font-semibold">2. Prepare and inspect</h3><p className="text-sm">{data.cards.length} imported · {Object.entries(data.counts).map(([status,count])=>`${count} ${status}`).join(' · ')}</p>
        <p className="text-sm text-muted-foreground">Preparation is saved per card and resumes after a server restart. Errors remain held; retry never restores exclusions or quarantine flags. For changed sources, correct or re-import using the existing Admin tools, then prepare again.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy||!!working||!data.lifecycle} onClick={prepare}>{pendingRequest?'Retry saved request':data.jobs.length?'Prepare / retry unresolved cards':'Prepare all eligible cards'}</Button><Button variant="outline" disabled={busy||isFetching} onClick={()=>refetch()}>Refresh saved progress</Button>
          <label className="sr-only" htmlFor="release-filter">Filter cards</label><select id="release-filter" value={filter} onChange={e=>setFilter(e.target.value)} className="border rounded p-2 bg-background"><option value="needs-review">Needs review</option><option value="all">All imported cards</option><option value="excluded">Excluded</option></select></div>
        {!!working&&<p role="status">{working} cards queued or processing. You may leave this screen and return later.</p>}
        <div className="max-h-56 overflow-y-auto border rounded divide-y">{rows.length?rows.map(c=><button key={c.id} className={`w-full text-left p-3 hover:bg-muted ${selected===c.id?'bg-muted':''}`} onClick={()=>setSelected(c.id)}><span className="font-medium">{c.number||'—'} · {c.player}</span><span className="ml-3 text-sm">{c.status}</span>{c.reason&&<span className="block text-sm text-muted-foreground">{c.reason}</span>}</button>):<p className="p-3">No cards in this filter.</p>}</div>
        {card&&<div className="space-y-3"><h4 className="font-semibold">{card.number} · {card.player}</h4>
          {card.challenge&&<><div className="grid md:grid-cols-2 gap-4"><figure><figcaption>Captured source — check image/name accuracy</figcaption><a href={card.sourceUrl!} target="_blank" rel="noreferrer"><img alt={`Captured source for ${card.player}`} src={card.sourceUrl!} onLoad={()=>setSourceLoaded(true)} onError={()=>setSourceLoaded(false)} className="w-full max-h-[600px] object-contain bg-muted" /></a></figure><figure><figcaption>Prepared mask — check names and remaining art</figcaption><a href={card.previewUrl!} target="_blank" rel="noreferrer"><img alt={`Prepared mask for ${card.player}`} src={card.previewUrl!} onLoad={()=>setMaskLoaded(true)} onError={()=>setMaskLoaded(false)} className="w-full max-h-[600px] object-contain bg-muted" /></a></figure></div>
          <p className="text-sm text-muted-foreground">Open images for full size. Approve only if the source is correct, every player name is unreadable, and useful card art remains. OCR is a safeguard, not a substitute for visual review.</p>
          <label className="block text-sm"><input type="checkbox" disabled={!sourceLoaded||busy} checked={sourceReviewed} onChange={e=>setSourceReviewed(e.target.checked)} /> I inspected the captured source and it is accurate.</label>
          <label className="block text-sm"><input type="checkbox" disabled={!maskLoaded||busy} checked={maskReviewed} onChange={e=>setMaskReviewed(e.target.checked)} /> I inspected the mask; names are hidden and useful art remains.</label></>}
          <label className="block text-sm">Review note / exclusion reason (at least 10 characters)<textarea className="w-full border rounded p-2 bg-background" value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} /></label>
          <div className="flex gap-2">{card.challenge&&<Button disabled={busy||!sourceLoaded||!maskLoaded||!sourceReviewed||!maskReviewed||note.trim().length<10||card.status==='approved'} onClick={()=>action(`approve/${card.id}`,{sourceReviewed,maskReviewed,note,challenge:card.challenge})}>Approve this exact source and mask</Button>}
          <Button variant="destructive" disabled={busy||note.trim().length<10||card.status==='excluded'} onClick={()=>{if(window.confirm('Exclude this card from play? Preparation cannot undo exclusions.'))void action(`exclude/${card.id}`,{reason:note});}}>Exclude from play</Button></div>
        </div>}
      </section>
      <section className="rounded border p-4 space-y-3"><h3 className="font-semibold">3. Publish</h3><p className="text-sm">{data.lifecycle?.published?'Published; deals still check approval, card flags and file integrity.':'Held until publication.'} At least five approved cards and full eligible coverage are required. Activate inactive sets on Playable Sets first.</p>
        <Button disabled={busy||!!working||!data.lifecycle||data.lifecycle.published||!data.set.isActive} onClick={()=>{if(window.confirm('Publish this set? All remaining eligible cards must have current source/mask approval.'))void action('publish',{publish:true});}}>Publish reviewed set</Button>
        {data.lifecycle?.published&&<Button className="ml-2" variant="outline" disabled={busy} onClick={()=>action('withdraw',{})}>Withdraw publication</Button>}
      </section>
    </>}
  </DialogContent></Dialog>;
}
