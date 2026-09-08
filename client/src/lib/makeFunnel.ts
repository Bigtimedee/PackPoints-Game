/**
 * Client writer for Making Layer event_log events (MAKE_FRICTION).
 * Server allowlists types on POST /api/make/event.
 */
import { apiRequest } from "./queryClient";

export type MakeClientEvent = "make_started" | "name_started" | "share_opened";

export function logMakeClientEvent(
  eventType: MakeClientEvent,
  metadata?: Record<string, unknown>,
): void {
  void apiRequest("POST", "/api/make/event", { eventType, metadata }).catch(() => {});
}
