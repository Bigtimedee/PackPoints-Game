/** One-tab, one-use Daily5 intent across sign-in. Never accepts a redirect URL. */
export const DAILY5_AUTH_RETURN_KEY = "packpts_daily5_auth_return_v1";
export const DAILY5_AUTH_RETURN_TTL_MS = 30 * 60 * 1000;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserSession(): Store | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}
function validSearch(search: unknown): search is string {
  return typeof search === "string" && search.length <= 4096
    && (search === "" || search.startsWith("?")) && !/[\r\n#]/.test(search);
}

export function rememberDaily5AuthReturn(
  pathname: string,
  search = "",
  store: Store | null = browserSession(),
  now = Date.now(),
): void {
  if (!store) return;
  try {
    // An unrelated fresh auth start supersedes an abandoned Daily5 attempt.
    store.removeItem(DAILY5_AUTH_RETURN_KEY);
    if ((pathname === "/daily5" || pathname === "/daily") && validSearch(search)) {
      store.setItem(DAILY5_AUTH_RETURN_KEY, JSON.stringify({ v: 1, ts: now, search }));
    }
  } catch { /* Storage blocked: auth must still work. */ }
}

/** Call only when authenticated navigation actually fires, not during effect setup. */
export function consumeDaily5AuthReturn(
  store: Store | null = browserSession(),
  now = Date.now(),
): string {
  if (!store) return "/";
  try {
    const raw = store.getItem(DAILY5_AUTH_RETURN_KEY);
    store.removeItem(DAILY5_AUTH_RETURN_KEY);
    if (!raw) return "/";
    const record = JSON.parse(raw);
    if (record?.v !== 1 || !Number.isFinite(record.ts)
      || record.ts > now || now - record.ts >= DAILY5_AUTH_RETURN_TTL_MS
      || !validSearch(record.search)) return "/";
    // Fixed app destination. Query data cannot turn this into an external URL.
    return `/daily5${record.search}`;
  } catch { return "/"; }
}
