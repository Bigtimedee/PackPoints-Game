// Points clarity analytics. Server stamps rebateLive; fire-and-forget, never throws.
export type PointsEvent = "points_strip_view" | "points_cta_click" | "points_page_view" | "wallet_sheet_open";
export function trackPoints(event: PointsEvent, props: { surface?: string; cta?: string } = {}): void {
  try {
    void fetch("/api/points/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({ event, ...props }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
