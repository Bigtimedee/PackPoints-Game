// One POST per user intent. An uncertain HTTP response is recovered by GET only.
export interface ScanIntent { setId: string; kind: "silhouettes" | "mismatches"; requestId: string; jobId?: string }
export interface ScanJob {
  id: string; setId: string; requestId: string; kind: ScanIntent["kind"];
  status: "running" | "completed" | "failed" | "interrupted"; error: string | null;
  report: { totalCards: number; processed: number; scanned: number; checked: number;
    silhouettesFound: number; mismatches: number; blocked: number; verified: number;
    quarantined: number; skipped: number; errors: number;
    findings: Array<{ cardId: string; storedPlayer: string | null; apiPlayer: string | null }>;
    issues: Array<{ cardId: string; stage: string }> };
}
export type ScanTransport = (method: "POST" | "GET", url: string, body?: unknown) => Promise<ScanJob | null>;
export async function startScanOnce(intent: ScanIntent, transport: ScanTransport): Promise<ScanJob> {
  const path = intent.kind === "silhouettes" ? "rescan-silhouettes" : "detect-player-mismatches";
  try {
    const job = await transport("POST", `/api/admin/game-sets/${intent.setId}/${path}`,
      { requestId: intent.requestId, autoQuarantine: intent.kind === "mismatches" });
    if (!job) throw new Error("Missing scan response");
    return job;
  } catch {
    return readScanStatus(intent, transport);
  }
}
export async function readScanStatus(intent: ScanIntent, transport: ScanTransport): Promise<ScanJob> {
  const job = await transport("GET", `/api/admin/game-sets/${intent.setId}/scan-jobs${intent.jobId ? `/${intent.jobId}` : ""}`);
  // Without a known job ID the newest job is only evidence if it matches the intent.
  // A running same-kind job may legitimately coalesce another request; GET recovery stays conservative.
  if (!job || job.setId !== intent.setId || job.kind !== intent.kind
    || (!intent.jobId && job.requestId !== intent.requestId)) {
    throw new Error("Start could not be confirmed. Card changes may have occurred; reconcile scan history before a new scan.");
  }
  return job;
}
