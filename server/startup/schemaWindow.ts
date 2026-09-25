/**
 * Paths registered on the server outside `/api`. During the schema window the
 * early handler answers these with 503. After the schema step, that handler
 * calls next() and the real route (registered before the SPA catch-all) runs.
 * Client pages under `/auth` are held only while the window is open.
 */
const HELD_EXACT = new Set(["/health", "/wallet", "/auth", "/ws"]);
const HELD_PREFIXES = [
  "/out/",
  "/p/",
  "/r/",
  "/auth/",
  "/wallet/",
  "/internal/",
  "/webhooks/",
  "/generated/",
  "/ws/",
];

export function schemaWindowHolds(urlPath: string): boolean {
  const stripped = (urlPath.split("?")[0] || urlPath).replace(/\/+$/, "") || "/";
  if (HELD_EXACT.has(stripped)) return true;
  if (stripped === "/webhooks" || stripped === "/generated") return true;
  return HELD_PREFIXES.some((prefix) => stripped.startsWith(prefix));
}
