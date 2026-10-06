import type { Express, Request, RequestHandler } from "express";
import type { AdminScanKind } from "../services/adminScanCore";
import type { AdminScanJob } from "../services/adminScanRegistry";
export interface AdminScanRouteDeps {
  findSet: (id: string) => Promise<string | null>;
  actor: (req: Request) => string | null | undefined;
  start: (setId: string, kind: AdminScanKind, requestId: string, auto: boolean, actor: string) => Promise<AdminScanJob>;
  read: (setId: string, jobId?: string) => Promise<AdminScanJob | null>;
  log: (...args: unknown[]) => void;
}
// GETs are read-only, all endpoints share existing authentication/admin middleware.
export function registerAdminCardScanRoutes(app: Express, isAuthenticated: RequestHandler,
  requireAdmin: RequestHandler, deps: AdminScanRouteDeps): void {

  for (const [path, kind] of [
    ["rescan-silhouettes", "silhouettes"],
    ["detect-player-mismatches", "mismatches"],
  ] as const) {
    app.post(`/api/admin/game-sets/:id/${path}`, isAuthenticated, requireAdmin, async (req, res) => {
      try {
        const { requestId, autoQuarantine = false } = req.body ?? {};
        if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
          || typeof autoQuarantine !== "boolean") {
          return res.status(400).json({ error: "A UUID requestId and boolean autoQuarantine are required; scans now return an asynchronous job." });
        }
        const setId = await deps.findSet(req.params.id);
        if (!setId) return res.status(404).json({ error: "Game set not found" });
        const actor = deps.actor(req);
        if (!actor) return res.status(403).json({ error: "Admin actor required" });
        const job = await deps.start(setId, kind, requestId, kind === "mismatches" && autoQuarantine, actor);
        return res.status(job.status === "running" ? 202 : 200).json(job);
      } catch (error) {
        deps.log("[AdminScan] Start failed", error);
        const status = (error as { status?: number }).status === 409 ? 409 : 503;
        return res.status(status).json({ error: status === 409 ? "Another scan is running for this set or the request ID conflicts. Check scan status; do not retry blindly."
          : "Scan start could not be confirmed. Check scan status before retrying; the scan-job migration must be applied." });
      }
    });
  }
  app.get("/api/admin/game-sets/:id/scan-jobs", isAuthenticated, requireAdmin, async (req, res) => {
    try { res.json(await deps.read(req.params.id)); }
    catch (error) { deps.log("[AdminScan] Status unavailable", error); res.status(503).json({ error: "Scan status unavailable; do not restart a possibly running scan." }); }
  });
  app.get("/api/admin/game-sets/:id/scan-jobs/:jobId", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.jobId)) {
        return res.status(400).json({ error: "A UUID scan job ID is required" });
      }
      const job = await deps.read(req.params.id, req.params.jobId);
      if (!job) return res.status(404).json({ error: "Scan job not found; do not repeat an uncertain mutation." });
      res.json(job);
    } catch (error) { deps.log("[AdminScan] Status unavailable", error); res.status(503).json({ error: "Scan status unavailable; do not restart a possibly running scan." }); }
  });

}
