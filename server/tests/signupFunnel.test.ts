import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  FUNNEL_EVENT_TYPE_MAX,
  SIGNUP_FUNNEL_EVENTS,
  buildSignupFunnelSection,
  funnelToken,
  parseClientFunnelEvent,
  signupFunnelPath,
} from "../services/signupFunnel";

describe("signup funnel event names", () => {
  it("fits funnel_events.event_type after the varchar widen", () => {
    for (const name of SIGNUP_FUNNEL_EVENTS) {
      expect(name.length).toBeLessThanOrEqual(FUNNEL_EVENT_TYPE_MAX);
    }
    expect("first_daily5_complete_registered".length).toBeGreaterThan(24);
    const schema = fs.readFileSync(path.join(__dirname, "../../shared/schema.ts"), "utf8");
    expect(schema).toContain('eventType: varchar("event_type", { length: 40 })');
  });
});

describe("parseClientFunnelEvent", () => {
  it("accepts the four client events and rejects server-only names", () => {
    expect(parseClientFunnelEvent({ event: "signup_view", surface: "plaque", variant: "soft" })).toEqual({
      eventType: "signup_view", mode: "soft", path: "plaque", utmSource: null,
    });
    expect(parseClientFunnelEvent({ event: "signup_started", surface: "modal", method: "email" })?.mode).toBe("email");
    expect(parseClientFunnelEvent({ event: "signup_started", surface: "modal", method: "Google" })?.mode).toBe("google");
    expect(parseClientFunnelEvent({ event: "signup_error", surface: "auth", reason: "workos_not_configured" })?.mode).toBe("workos_unconfigured");
    expect(parseClientFunnelEvent({ event: "share_view", surface: "daily5", audience: "guest" })).toMatchObject({
      eventType: "share_view", mode: "guest", path: "daily5",
    });
    expect(parseClientFunnelEvent({ event: "signup_complete", method: "email", surface: "modal" })).toBeNull();
    expect(parseClientFunnelEvent({ event: "first_daily5_complete_registered" })).toBeNull();
    expect(parseClientFunnelEvent({ event: "signup_started", surface: "modal", method: "password" })).toBeNull();
    expect(parseClientFunnelEvent({ event: "signup_view", variant: "soft" })).toBeNull();
    expect(parseClientFunnelEvent(null)).toBeNull();
  });

  it("keeps reasons inside the mode column", () => {
    expect(funnelToken("Username already taken")?.length).toBeLessThanOrEqual(20);
    expect(signupFunnelPath("modal", "Ab12_cd")).toBe("modal Ab12_cd");
    expect(signupFunnelPath("modal", "has space")).toBe("modal");
    expect(signupFunnelPath("Not A Surface")).toBe("not_a_surface");
  });
});

describe("buildSignupFunnelSection", () => {
  it("rolls events up by surface, method, reason, day, and utm source", () => {
    const section = buildSignupFunnelSection({
      events: [
        { event_type: "signup_view", mode: "soft", surface: "plaque", source: "x", n: 4 },
        { event_type: "signup_view", mode: "hard", surface: "modal", source: "direct", n: 1 },
        { event_type: "signup_started", mode: "email", surface: "modal", source: "x", n: 2 },
        { event_type: "signup_started", mode: "workos", surface: "auth", source: "x", n: 1 },
        { event_type: "signup_error", mode: "email_taken", surface: "modal", source: "x", n: 1 },
        { event_type: "signup_complete", mode: "email", surface: "modal", source: "x", n: 1 },
        { event_type: "first_daily5_complete_registered", mode: "daily5", surface: "daily5", source: "x", n: 1 },
        { event_type: "share_view", mode: "registered", surface: "daily5", source: "direct", n: 3 },
        { event_type: "visit", mode: "", surface: "", source: "x", n: 9 },
      ],
      dailyEvents: [
        { date: "2026-10-22", visits: 10, first_answers: 4, game_completes: 2, signup_views: 5, signup_started: 3, signup_completes: 1, first_daily5: 1 },
      ],
      registeredDaily: [{ date: "2026-10-22", n: 2 }, { date: "2026-10-21", n: 1 }],
      registeredBySource: [{ source: "x", n: 2 }, { source: "reddit", n: 1 }],
    });
    expect(section.views).toBe(5);
    expect(section.started).toBe(3);
    expect(section.errors).toBe(1);
    expect(section.completes).toBe(1);
    expect(section.firstDaily5Registered).toBe(1);
    expect(section.shareViews).toBe(3);
    expect(section.viewsBySurface[0]).toEqual({ surface: "plaque", count: 4 });
    expect(section.startedByMethod.find((m) => m.method === "email")?.count).toBe(2);
    expect(section.errorsByReason).toEqual([{ reason: "email_taken", count: 1 }]);
    expect(section.completesByMethod).toEqual([{ method: "email", count: 1 }]);
    expect(section.daily.find((d) => d.date === "2026-10-22")).toMatchObject({
      visits: 10, signupViews: 5, signupStarted: 3, registered: 2, firstDaily5Registered: 1,
    });
    expect(section.daily.find((d) => d.date === "2026-10-21")?.registered).toBe(1);
    const x = section.byUtmSource.find((s) => s.source === "x");
    expect(x).toMatchObject({ visits: 9, signupViews: 4, signupStarted: 3, completes: 1, registered: 2, firstDaily5Registered: 1 });
    expect(section.byUtmSource.find((s) => s.source === "reddit")?.registered).toBe(1);
  });
});
