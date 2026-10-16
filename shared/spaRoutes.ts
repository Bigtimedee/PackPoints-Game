/**
 * Every client route in client/src/App.tsx, so the server can answer unknown
 * paths with a real 404 (the SPA still renders its own not-found UI).
 * server/tests/seoPages.test.ts fails if App.tsx gains a route missing here.
 */
export const SPA_ROUTE_PATTERNS: readonly string[] = [
  "/", "/daily", "/daily5", "/how-to-play", "/about", "/points", "/sets", "/sets/:id",
  "/admin", "/admin/access", "/admin/analytics", "/admin/audit-log", "/admin/card-reports", "/admin/card-search",
  "/admin/card-sets", "/admin/card-telemetry", "/admin/cardhedge-card", "/admin/daily5", "/admin/dashboard",
  "/admin/geo", "/admin/growth", "/admin/metrics", "/admin/package-guardrails", "/admin/playable-sets",
  "/admin/products", "/admin/redemptions", "/admin/set-of-week", "/admin/streaks", "/admin/subscriptions",
  "/admin/tiers", "/admin/users", "/admin/users/:userId",
  "/auth", "/auth-error", "/auth/error", "/auth/link-required", "/auth/success",
  "/collab/:id", "/creators", "/dmca", "/forgot-password", "/friends", "/game/:mode", "/invite",
  "/leaderboard", "/lobby", "/lobby/:action", "/lobby/:id", "/make", "/marketplace", "/match/:matchId",
  "/partners", "/privacy-policy", "/profile", "/queue", "/redeem", "/redemptions", "/redemptions/:intentId",
  "/reset-password", "/review/tiktok-sandbox", "/roadmap", "/store", "/store/cancel", "/store/success",
  "/terms-of-service", "/waitlist",
];

function toRegex(pattern: string): RegExp {
  const body = pattern.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${body}/?$`);
}
const COMPILED = SPA_ROUTE_PATTERNS.map(toRegex);

/** Path only (no query). True when App.tsx has a route for it. */
export function isKnownSpaRoute(path: string): boolean {
  const p = (path || "/").split("?")[0].split("#")[0] || "/";
  return COMPILED.some((re) => re.test(p));
}
