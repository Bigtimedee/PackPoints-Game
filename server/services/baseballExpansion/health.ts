/**
 * Design set-health contract.
 *
 * The denominator is the original submitted pool. Failed cards are excluded.
 * At least 95% of that original pool must pass. Every released card must pass.
 * Under 95% is a systemic mask/source failure: resubmit the same manifest.
 * Cherry-picking the passes is not a release. The released count must also
 * meet the existing public-set minimum.
 */
export const ORIGINAL_POOL_PASS_RATE = 0.95;
export const MIN_SOURCE_SHORT_SIDE = 600;
/** Same floor as PUBLIC_SET_MIN_ELIGIBLE_CARDS. The contract test keeps them equal. */
export const ENGINEERING_SET_MINIMUM = 5;

export const POOL_VERDICTS = [
  "pass",
  "resubmit_systemic",
  "below_engineering_minimum",
  "released_leak",
  "incomplete",
] as const;

export type PoolVerdict = (typeof POOL_VERDICTS)[number];

export interface PoolCardResult {
  cardId: string;
  passed: boolean;
}

export interface StoredHealth {
  originalCount: number;
  passedCount: number;
  releasedCount: number;
  verdict: string;
}

export interface PoolHealth {
  originalCount: number;
  passedCount: number;
  failedCount: number;
  failedCardIds: string[];
  releasedCount: number;
  releasedPassCount: number;
  originalPassRate: number | null;
  releasedPassRate: number | null;
  threshold: number;
  engineeringMinimum: number;
  verdict: PoolVerdict;
  cherryPickAllowed: false;
  releaseAuthorized: boolean;
  addedAfterSubmission: string[];
}

export function evaluatePoolHealth(input: {
  originalCardIds: readonly string[];
  results: readonly PoolCardResult[];
  releaseIds?: readonly string[];
  engineeringMinimum?: number;
}): PoolHealth {
  const minimum = input.engineeringMinimum ?? ENGINEERING_SET_MINIMUM;
  const original = [...input.originalCardIds];
  const originalSet = new Set(original);
  const byId = new Map<string, PoolCardResult>();
  const added: string[] = [];
  for (const result of input.results) {
    if (!originalSet.has(result.cardId)) {
      added.push(result.cardId);
      continue;
    }
    if (!byId.has(result.cardId)) byId.set(result.cardId, result);
  }
  const failedCardIds: string[] = [];
  let passedCount = 0;
  for (const id of original) {
    const result = byId.get(id);
    if (result?.passed) passedCount += 1;
    else failedCardIds.push(id);
  }
  const passedIds = original.filter((id) => byId.get(id)?.passed === true);
  const releaseIds = input.releaseIds ? [...input.releaseIds] : passedIds;
  const releasedPassCount = releaseIds.filter((id) => byId.get(id)?.passed === true && originalSet.has(id)).length;
  const leaked = releaseIds.some((id) => !originalSet.has(id) || byId.get(id)?.passed !== true);
  const originalCount = original.length;
  const originalPassRate = originalCount === 0 ? null : passedCount / originalCount;
  const releasedPassRate = releaseIds.length === 0 ? null : releasedPassCount / releaseIds.length;
  let verdict: PoolVerdict = "pass";
  if (originalCount === 0 || original.some((id, index) => original.indexOf(id) !== index)) verdict = "incomplete";
  else if (leaked || releasedPassCount !== releaseIds.length) verdict = "released_leak";
  else if (originalPassRate == null || originalPassRate < ORIGINAL_POOL_PASS_RATE) verdict = "resubmit_systemic";
  else if (releaseIds.length < minimum) verdict = "below_engineering_minimum";
  return {
    originalCount,
    passedCount,
    failedCount: failedCardIds.length,
    failedCardIds,
    releasedCount: verdict === "pass" ? releaseIds.length : 0,
    releasedPassCount: verdict === "pass" ? releasedPassCount : 0,
    originalPassRate,
    releasedPassRate,
    threshold: ORIGINAL_POOL_PASS_RATE,
    engineeringMinimum: minimum,
    verdict,
    cherryPickAllowed: false,
    releaseAuthorized: verdict === "pass",
    addedAfterSubmission: added,
  };
}

export function sourceFailReasons(input: {
  width: number;
  height: number;
  blockedReason?: string | null;
  isPlayable?: boolean;
  hasSource: boolean;
  hasMasked: boolean;
  nameCheckPassed: boolean;
  maskRefused?: boolean;
  variant?: string | null;
}): string[] {
  const reasons: string[] = [];
  if (!input.hasSource) reasons.push("source_missing");
  if (!input.hasMasked) reasons.push("masked_missing");
  const short = Math.min(input.width, input.height);
  if (!(input.width > 0) || !(input.height > 0) || short < MIN_SOURCE_SHORT_SIDE) reasons.push("short_side");
  const variant = (input.variant || "").trim().toLowerCase();
  if (variant && variant !== "base") reasons.push("not_base");
  if (input.isPlayable === false) reasons.push(input.blockedReason || "not_playable");
  else if (input.blockedReason) reasons.push(input.blockedReason);
  if (input.maskRefused) reasons.push("mask_refused");
  if (!input.nameCheckPassed) reasons.push("name_check_missing");
  return [...new Set(reasons)];
}

export function approvalHealthBlock(
  isExpansion: boolean,
  health: StoredHealth | null,
  engineeringMinimum = ENGINEERING_SET_MINIMUM,
): { code: string; error: string } | null {
  if (!isExpansion) return null;
  if (!health || health.originalCount <= 0) {
    return {
      code: "pool_health",
      error: "No original-pool health record. Export the full submitted pool and resubmit. Cherry-pick is not a release.",
    };
  }
  const rate = health.passedCount / health.originalCount;
  if (health.verdict !== "pass" || rate < ORIGINAL_POOL_PASS_RATE || health.releasedCount !== health.passedCount) {
    return {
      code: "pool_health",
      error: "Original submitted pool is under the 95% set-health threshold or the release is not 100% clean. Fix the mask or source and resubmit the same manifest.",
    };
  }
  if (health.releasedCount < engineeringMinimum) {
    return {
      code: "below_engineering_minimum",
      error: `Released count ${health.releasedCount} is below the engineering minimum ${engineeringMinimum}.`,
    };
  }
  return null;
}

export function designApprovalDecision(input: {
  isExpansion: boolean;
  profileId: string | null;
  health?: StoredHealth | null;
}): { ok: true } | { ok: false; code: string; error: string } {
  if (input.isExpansion) {
    return {
      ok: false,
      code: "held_prep_only",
      error: "Held prep cannot record Design GREEN. A full-pool release is a separate gate.",
    };
  }
  if (!input.profileId) {
    return { ok: false, code: "no_mask_profile", error: "No registered mask profile for this set; Design cannot approve it yet" };
  }
  return { ok: true };
}
