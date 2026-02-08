import { db } from "../db";
import { setAuditLog } from "@shared/schema";

export const OPERATION_SOURCES = ["ADMIN_MANUAL", "SYSTEM_NON_DESTRUCTIVE", "CARDHEDGE_CONFIRMED"] as const;
export type OperationSource = typeof OPERATION_SOURCES[number];

export const MUTATION_ACTIONS = [
  "SET_UNPLAYABLE",
  "DELETE_CARD",
  "SOFT_DELETE_CARD",
  "DECREMENT_PLAYABLE_COUNT",
  "UPDATE_QUARANTINE",
  "UPDATE_VALIDATION_FIELDS",
  "APPLY_PROPOSED_CHANGES",
  "PURGE_SET",
  "REIMPORT_SET",
] as const;
export type MutationAction = typeof MUTATION_ACTIONS[number];

const DESTRUCTIVE_ACTIONS: MutationAction[] = [
  "SET_UNPLAYABLE",
  "DELETE_CARD",
  "SOFT_DELETE_CARD",
  "DECREMENT_PLAYABLE_COUNT",
  "APPLY_PROPOSED_CHANGES",
  "PURGE_SET",
];

const NON_DESTRUCTIVE_ACTIONS: MutationAction[] = [
  "UPDATE_QUARANTINE",
  "UPDATE_VALIDATION_FIELDS",
];

const ADMIN_ONLY_ACTIONS: MutationAction[] = [
  "APPLY_PROPOSED_CHANGES",
  "PURGE_SET",
  "REIMPORT_SET",
];

export interface MutationContext {
  operationSource: OperationSource;
  action: MutationAction;
  actorUserId?: string;
  reason?: string;
  evidence?: Record<string, unknown>;
}

export interface MutationAllowedResult {
  allowed: boolean;
  reason?: string;
}

export function isKillSwitchEnabled(): boolean {
  return process.env.DISABLE_AUTOMATED_SET_MUTATIONS === "true";
}

export function assertMutationAllowed(context: MutationContext): MutationAllowedResult {
  const { operationSource, action } = context;

  if (!operationSource) {
    return {
      allowed: false,
      reason: "operation_source is required for all mutations",
    };
  }

  if (!OPERATION_SOURCES.includes(operationSource)) {
    return {
      allowed: false,
      reason: `Invalid operation_source: ${operationSource}`,
    };
  }

  if (isKillSwitchEnabled() && operationSource !== "ADMIN_MANUAL") {
    console.log(`[MutationGuard] KILL SWITCH: Blocked ${action} from ${operationSource}`);
    return {
      allowed: false,
      reason: "DISABLE_AUTOMATED_SET_MUTATIONS kill switch is enabled",
    };
  }

  if (ADMIN_ONLY_ACTIONS.includes(action) && operationSource !== "ADMIN_MANUAL") {
    return {
      allowed: false,
      reason: `Action ${action} requires ADMIN_MANUAL operation_source`,
    };
  }

  if (DESTRUCTIVE_ACTIONS.includes(action) && operationSource !== "ADMIN_MANUAL") {
    return {
      allowed: false,
      reason: `Destructive action ${action} is not allowed for ${operationSource}. Only ADMIN_MANUAL can perform destructive mutations.`,
    };
  }

  if (operationSource === "SYSTEM_NON_DESTRUCTIVE" && !NON_DESTRUCTIVE_ACTIONS.includes(action)) {
    return {
      allowed: false,
      reason: `SYSTEM_NON_DESTRUCTIVE can only perform: ${NON_DESTRUCTIVE_ACTIONS.join(", ")}`,
    };
  }

  return { allowed: true };
}

export interface AuditLogEntry {
  setId?: string;
  actionType: string;
  operationSource: OperationSource;
  actorUserId?: string;
  beforeTotalCards?: number;
  afterTotalCards?: number;
  beforePlayableCards?: number;
  afterPlayableCards?: number;
  reason?: string;
  evidenceJson?: Record<string, unknown>;
  cardId?: string;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(setAuditLog).values({
      setId: entry.setId || null,
      actionType: entry.actionType,
      operationSource: entry.operationSource,
      actorUserId: entry.actorUserId || null,
      beforeTotalCards: entry.beforeTotalCards ?? 0,
      afterTotalCards: entry.afterTotalCards ?? 0,
      beforePlayableCards: entry.beforePlayableCards ?? 0,
      afterPlayableCards: entry.afterPlayableCards ?? 0,
      deltaTotalCards: (entry.afterTotalCards ?? 0) - (entry.beforeTotalCards ?? 0),
      deltaPlayableCards: (entry.afterPlayableCards ?? 0) - (entry.beforePlayableCards ?? 0),
      reason: entry.reason || null,
      evidenceJson: entry.evidenceJson || null,
    });
  } catch (error) {
    console.error("[MutationGuard] Failed to write audit log:", error);
  }
}

export function logMutationBlocked(context: MutationContext, result: MutationAllowedResult): void {
  console.warn(`[MutationGuard] BLOCKED: ${context.action} from ${context.operationSource} - ${result.reason}`);
  
  writeAuditLog({
    actionType: `BLOCKED_${context.action}`,
    operationSource: context.operationSource,
    actorUserId: context.actorUserId,
    reason: result.reason,
    evidenceJson: context.evidence,
  }).catch(() => {});
}

export const QUARANTINE_STATUSES = ["OK", "SUSPECT_TRANSIENT", "SUSPECT_PERSISTENT", "QUARANTINED_ADMIN_REVIEW"] as const;
export type QuarantineStatus = typeof QUARANTINE_STATUSES[number];

export function determineQuarantineStatus(
  failCount: number,
  hasTransientErrors: boolean,
  cardHedgeConfirmed: boolean
): QuarantineStatus {
  if (failCount === 0) return "OK";
  if (failCount < 5) return "SUSPECT_TRANSIENT";
  if (hasTransientErrors) return "SUSPECT_PERSISTENT";
  if (cardHedgeConfirmed) return "QUARANTINED_ADMIN_REVIEW";
  return "SUSPECT_PERSISTENT";
}

export function isTransientError(httpStatus: number | null, errorMessage: string | null): boolean {
  const transientCodes = [408, 429, 500, 502, 503, 504];
  if (httpStatus !== null && transientCodes.includes(httpStatus)) return true;
  
  const transientPatterns = [
    /timeout/i,
    /network error/i,
    /econnreset/i,
    /enotfound/i,
    /rate limit/i,
    /abort/i,
    /ETIMEDOUT/i,
    /ECONNREFUSED/i,
  ];
  
  if (errorMessage) {
    for (const pattern of transientPatterns) {
      if (pattern.test(errorMessage)) return true;
    }
  }
  
  return false;
}

export const MIN_FAILURES_FOR_PROPOSAL = 5;
export const MIN_HOURS_FOR_PROPOSAL = 24;
