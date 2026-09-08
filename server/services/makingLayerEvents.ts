/**
 * Making Layer funnel events — written to event_log via analyticsService.
 *
 * Same spine as Maker Rate MAU (makingLayerMetrics.ts). Admin queries join
 * event_log.user_id → users and exclude users.is_admin. Do not send these
 * through a second telemetry system.
 */
import { analyticsService } from "./analyticsService";
import type { AnalyticsEventType } from "@shared/schema";

export const MAKING_LAYER_EVENTS = {
  makeStarted: "make_started",
  identifySuccess: "identify_success",
  identifyFail: "identify_fail",
  nameStarted: "name_started",
  publishSuccess: "publish_success",
  publishFail: "publish_fail",
  shareGenerated: "share_generated",
  shareOpened: "share_opened",
  setViewed: "set_viewed",
} as const;

export type MakingLayerEventType =
  (typeof MAKING_LAYER_EVENTS)[keyof typeof MAKING_LAYER_EVENTS];

/** Ordered success path used for conversion + drop-off. */
/** MAKE_FLOW success path, including Design MAKE_FRICTION name/mixtape + share-open. */
export const MAKING_FUNNEL_SUCCESS_STEPS = [
  MAKING_LAYER_EVENTS.makeStarted,
  MAKING_LAYER_EVENTS.identifySuccess,
  MAKING_LAYER_EVENTS.nameStarted,
  MAKING_LAYER_EVENTS.publishSuccess,
  MAKING_LAYER_EVENTS.shareGenerated,
  MAKING_LAYER_EVENTS.shareOpened,
  MAKING_LAYER_EVENTS.setViewed,
] as const;

/** Client-originated events (POST /api/make/event). */
export const MAKING_LAYER_CLIENT_EVENTS = [
  MAKING_LAYER_EVENTS.makeStarted,
  MAKING_LAYER_EVENTS.nameStarted,
  MAKING_LAYER_EVENTS.shareOpened,
] as const;

export type MakingLayerClientEvent = (typeof MAKING_LAYER_CLIENT_EVENTS)[number];

export function isMakingLayerClientEvent(value: unknown): value is MakingLayerClientEvent {
  return (
    typeof value === "string" &&
    (MAKING_LAYER_CLIENT_EVENTS as readonly string[]).includes(value)
  );
}

export const MAKING_FUNNEL_FAIL_STEPS = [
  MAKING_LAYER_EVENTS.identifyFail,
  MAKING_LAYER_EVENTS.publishFail,
] as const;

export const MAKING_FUNNEL_EVENT_TYPES = [
  ...MAKING_FUNNEL_SUCCESS_STEPS,
  ...MAKING_FUNNEL_FAIL_STEPS,
] as const;

export function logMakingLayerEvent(
  eventType: MakingLayerEventType,
  userId?: string | null,
  metadata?: Record<string, unknown>,
): void {
  void analyticsService
    .track(eventType as AnalyticsEventType, userId ?? null, metadata)
    .catch((err: unknown) => {
      console.error(
        "[MakingLayer] event_log failed:",
        err instanceof Error ? err.message : err,
      );
    });
}

export function requestUserId(req: {
  user?: { claims?: { sub?: string } };
  session?: { localUserId?: string };
}): string | null {
  return req.user?.claims?.sub || req.session?.localUserId || null;
}
