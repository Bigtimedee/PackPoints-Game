/** Explicit POST preparation only. GET previews never validate, repair, or bake. */
import fs from "fs";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { maskReadySidecarDir } from "../masking/maskReadySidecar";

export const MAX_PREPARE_CARDS = 20;
export function explicitPreparationIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  if (input.all !== undefined || input.reviewed !== true || !Array.isArray(input.cardIds)
      || input.cardIds.length < 1 || input.cardIds.length > MAX_PREPARE_CARDS) return null;
  if (!input.cardIds.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return null;
  const ids = [...new Set(input.cardIds as string[])];
  return ids.length === input.cardIds.length ? ids : null;
}

/** Strict exact-band/current-version readiness. Never calls the bake or image gate. */
export function preparedMaskFile(cardId: string, dir = maskReadySidecarDir()): string | null {
  // Inspect this card only. Scanning the full volume per row made review GET time out.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) return null;
  const stem = path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}`);
  if (!fs.existsSync(`${stem}.ok`) || fs.existsSync(`${stem}.fail`)) return null;
  try {
    const plan = JSON.parse(fs.readFileSync(`${stem}.json`, "utf8"));
    const [band] = plan.regions ?? [];
    if (plan.maskVersion !== CURRENT_MASK_VERSION || plan.layoutClass !== "BOTTOM_PLAQUE"
      || plan.regions?.length !== 1 || band.xPct !== 0 || band.yPct !== 84
      || band.wPct !== 100 || band.hPct !== 16 || band.type !== "blur") return null;
  } catch { return null; }
  for (const rotation of ["", "_r90", "_r180", "_r270"]) {
    const file = path.join(dir, `${cardId}_${CURRENT_MASK_VERSION}${rotation}.jpg`);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* unavailable */ }
  }
  return null;
}

export interface PreparedCardResult { cardId: string; status: "ready" | "refused" | "error"; reason?: string }
export async function prepareExplicitCards(
  ids: string[],
  bake: (id: string) => Promise<unknown>,
  ready: (id: string) => boolean,
  failure: (id: string) => string | null,
  onResult: (result: PreparedCardResult) => void,
): Promise<void> {
  // Sequential dispatch bounds demand on the existing global bake queue.
  for (const cardId of ids) {
    try {
      await bake(cardId);
      onResult(ready(cardId) ? { cardId, status: "ready" }
        : { cardId, status: "refused", reason: failure(cardId) ?? "not_ready" });
    } catch {
      onResult({ cardId, status: "error", reason: "bake_failed" });
    }
  }
}
