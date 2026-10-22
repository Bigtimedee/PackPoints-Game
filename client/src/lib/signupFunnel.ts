/**
 * Client beacon for the signup funnel. Fire-and-forget. Never throws.
 * Completes are recorded on the server, not here.
 */
import { getSignupAttributionPayload } from "./attribution";

export type SignupMethod = "email" | "workos" | "google" | "apple";

const recent = new Map<string, number>();
const DEDUPE_MS = 800;

function post(event: string, fields: Record<string, string | undefined>): void {
  try {
    const key = `${event}:${Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v ?? ""}`).join("&")}`;
    const now = Date.now();
    const prev = recent.get(key) ?? 0;
    if (now - prev < DEDUPE_MS) return;
    recent.set(key, now);
    const utmSource = getSignupAttributionPayload().utmSource;
    const body = JSON.stringify({ event, ...fields, ...(utmSource ? { utmSource } : {}) });
    void fetch("/api/funnel/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body,
    }).catch(() => { /* analytics must not break signup */ });
  } catch {
    /* ignore */
  }
}

export function trackSignupView(surface: string, variant: string): void {
  post("signup_view", { surface, variant });
}

export function trackSignupStarted(method: SignupMethod, surface: string): void {
  post("signup_started", { method, surface });
}

export function trackSignupError(reason: string, surface: string): void {
  post("signup_error", { reason, surface });
}

export function trackShareView(surface: string, audience: "registered" | "guest"): void {
  post("share_view", { surface, audience });
}
