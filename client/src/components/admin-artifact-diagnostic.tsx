import { useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
type Diagnostic = {
  readAt:string;
  runtime:{cwd:string;artifactRoot:string;maskVersion:string;buildCommit:string|null;deploymentCommit:string|null};
  review:{status:string;revision:string|null;currentRevision:string|null;revisionMatches:boolean;identityMatches:boolean;storedWitnessKey:string|null;computedWitnessKey:string;witnessMatches:boolean};
  artifacts:{valid:boolean;category:string;refusalObservation?:string;checks:Record<string,{state:string;storedHash?:string|null;computedHash?:string;matches?:boolean}>};
  scope:string;
};
/** Mounted only for the selected card; a changed selection gets a new key.
 * No automatic requests, batches, provider calls or remediation controls.
 */
export function AdminArtifactDiagnostic({setId,cardId}:{setId:string;cardId:string}) {
  const [result,setResult]=useState<Diagnostic|null>(null);
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);
  async function inspect() {
    setLoading(true);setError('');setResult(null);
    try {setResult(await (await apiRequest('GET',`/api/admin/set-lifecycle/${setId}/artifact-diagnostic/${cardId}`)).json());}
    catch(e){setError(e instanceof Error?e.message:'Could not read diagnostic. No changes made.');}
    finally{setLoading(false);}
  }
  return <section aria-label="Read-only artifact diagnostic" className="rounded border p-3 space-y-2 text-sm">
    <Button type="button" variant="outline" disabled={loading} onClick={inspect}>{loading?'Reading this card…':'Inspect saved artifact (read-only)'}</Button>
    <p className="text-muted-foreground">Reads this card’s saved review and current files. Does not prepare, approve, repair or clear refusals.</p>
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {result&&<div role="status" className="space-y-2">
      <p>Read at {result.readAt}. Saved review: {result.review.status}. File validation: {result.artifacts.category.replaceAll('_',' ')}.</p>
      <p>Revision: {result.review.revisionMatches?'matches':'does not match / unavailable'} · card witness: {result.review.witnessMatches?'matches':'does not match'} · set identity: {result.review.identityMatches?'matches':'does not match / unavailable'}</p>
      <p className="text-muted-foreground">{result.scope}</p>
      <details><summary>File checks, hashes and runtime location</summary><div className="space-y-2 break-all">
        <p>Working directory: {result.runtime.cwd}<br />Artifact root: {result.runtime.artifactRoot}<br />Mask version: {result.runtime.maskVersion}<br />Build commit: {result.runtime.buildCommit||'unavailable'}<br />Deployment commit: {result.runtime.deploymentCommit||'unavailable'}</p>
        <p>Saved revision: {result.review.revision||'unavailable'}<br />Current revision: {result.review.currentRevision||'unavailable'}<br />Saved witness: {result.review.storedWitnessKey||'unavailable'}<br />Computed witness: {result.review.computedWitnessKey}</p>
        <p>Refusal marker read: {result.artifacts.refusalObservation||'not checked'}</p>
        <ul>{Object.entries(result.artifacts.checks).map(([name,check])=><li key={name}>{name}: {check.state.replaceAll('_',' ')}{check.matches!==undefined&&` · hash ${check.matches?'matches':'differs'}`}{check.storedHash!==undefined&&<><br />Stored: {check.storedHash||'unset / malformed'}</>}{check.computedHash&&<><br />Computed: {check.computedHash}</>}</li>)}</ul>
      </div></details>
    </div>}
  </section>;
}
