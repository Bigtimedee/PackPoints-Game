import { describe, expect, it, afterEach, vi } from "vitest";
vi.mock("../services/analytics/track", () => ({ track: () => {} }));
import { sanitizePointsEvent, POINTS_EVENTS } from "../routes/pointsEvents";

describe("points clarity events", () => {
  afterEach(() => { delete process.env.REBATES_LIVE; });
  it("accepts the four spec events and stamps rebateLive from the server", () => {
    expect([...POINTS_EVENTS]).toEqual(["points_strip_view", "points_cta_click", "points_page_view", "wallet_sheet_open"]);
    expect(sanitizePointsEvent({ event: "wallet_sheet_open", rebateLive: true, surface: "wallet_sheet" })).toEqual({ event: "wallet_sheet_open", payload: { rebateLive: false, surface: "wallet_sheet" } });
    process.env.REBATES_LIVE = "true";
    expect(sanitizePointsEvent({ event: "points_page_view" })?.payload.rebateLive).toBe(true);
  });
  it("drops unknown events and unknown props", () => {
    expect(sanitizePointsEvent({ event: "answer_submitted" })).toBeNull();
    expect(sanitizePointsEvent(null)).toBeNull();
    expect(sanitizePointsEvent({ event: "points_cta_click", cta: "x", surface: "<script>", extra: 1 })?.payload).toEqual({ rebateLive: false });
  });
});
