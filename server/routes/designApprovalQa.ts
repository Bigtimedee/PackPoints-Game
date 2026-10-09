/**
 * Design records (or revokes) approval of a set's mask profile. Same COVER_QA_TOKEN
 * header gate as the other /api/qa routes; a bad or missing header is 404.
 * Approval alone never bakes, approves cards, or pins covers.
 */
import type { Express, Request, Response } from "express";
import { coverQaEnabled, coverQaHeaderMatches } from "../lib/coverQaAuth";
import { applyNoStoreHeaders } from "../lib/noStoreResponse";
import { findSet } from "../services/setLifecycle";
import { lifecycleSet } from "../services/setLifecycleRegistry";
import { isClearedSetId, maskProfileForSet, refreshHeldSets, setHasRegisteredMaskProfile } from "../config/heldSets";
import { invalidatePublicMaskSetCache } from "../services/publicMaskGate";
import { readDesignApproval, recordDesignApproval, revokeDesignApproval } from "../services/setDesignApproval";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res: Response, status: number, body: unknown) {
  applyNoStoreHeaders(res);
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).json(body);
}
function authorized(req: Request, res: Response): boolean {
  if (coverQaEnabled() && coverQaHeaderMatches(req.get("x-qa-token") ?? undefined)) return true;
  send(res, 404, { error: "Not found" });
  return false;
}
async function maskProfileId(setId: string): Promise<string | null> {
  const lifecycle = lifecycleSet(setId);
  if (lifecycle?.profile) return `lifecycle:${lifecycle.revision}`;
  const set = await findSet(setId);
  if (!set || !setHasRegisteredMaskProfile(set)) return null;
  return maskProfileForSet(set).id;
}

export function registerDesignApprovalQaRoutes(app: Express): void {
  const path = "/api/qa/sets/:setId/design-approval";
  app.get(path, (req, res) => {
    if (!authorized(req, res)) return;
    if (!UUID.test(req.params.setId)) { send(res, 400, { error: "Invalid set" }); return; }
    void (async () => {
      const row = await readDesignApproval(req.params.setId);
      send(res, 200, { setId: req.params.setId, inClearedSetIds: isClearedSetId(req.params.setId),
        maskProfileId: await maskProfileId(req.params.setId), approval: row });
    })().catch(() => send(res, 500, { error: "Lookup failed" }));
  });
  app.post(path, (req, res) => {
    if (!authorized(req, res)) return;
    const setId = req.params.setId;
    if (!UUID.test(setId)) { send(res, 400, { error: "Invalid set" }); return; }
    const body = req.body ?? {};
    const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy.trim().slice(0, 200) : "";
    if (body.approve !== true || !approvedBy) {
      send(res, 400, { error: "Body must be {\"approve\":true,\"approvedBy\":\"<name>\",\"note\"?:string}" });
      return;
    }
    void (async () => {
      const set = await findSet(setId);
      if (!set) { send(res, 404, { error: "Set not found" }); return; }
      const profile = await maskProfileId(setId);
      if (!profile) { send(res, 409, { error: "No registered mask profile for this set; Design cannot approve it yet", code: "no_mask_profile" }); return; }
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
      await recordDesignApproval(setId, profile, approvedBy, note);
      await refreshHeldSets(); invalidatePublicMaskSetCache(setId);
      send(res, 200, { setId, approved: true, maskProfileId: profile });
    })().catch(() => send(res, 500, { error: "Approval failed" }));
  });
  app.delete(path, (req, res) => {
    if (!authorized(req, res)) return;
    if (!UUID.test(req.params.setId)) { send(res, 400, { error: "Invalid set" }); return; }
    void (async () => {
      await revokeDesignApproval(req.params.setId);
      await refreshHeldSets(); invalidatePublicMaskSetCache(req.params.setId);
      send(res, 200, { setId: req.params.setId, approved: false, inClearedSetIds: isClearedSetId(req.params.setId) });
    })().catch(() => send(res, 500, { error: "Revoke failed" }));
  });
}
