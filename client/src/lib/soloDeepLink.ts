/**
 * Set id named by a solo deep link or share link. Accepts both
 * /game/solo?setId=<id> and the older /game/solo?set=<id>; setId wins.
 */
export function soloDeepLinkSetId(search: string | null | undefined): string | null {
  const params = new URLSearchParams((search || "").replace(/^\?/, ""));
  const id = (params.get("setId") || params.get("set") || "").trim();
  return id || null;
}

export type SetPageView = "loading" | "notFound" | "error" | "ready";

/**
 * What the set page renders. "Set not found" only on a real 404; any other
 * failure, or no data yet, keeps the skeleton (or a retry state after the
 * fetch has finished failing).
 */
export function setPageView(state: {
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  hasData: boolean;
}): SetPageView {
  if (state.hasData) return "ready";
  const status = (state.error as { status?: unknown } | null)?.status;
  if (status === 404) return "notFound";
  if (state.isLoading || state.isFetching || !state.error) return "loading";
  return "error";
}
